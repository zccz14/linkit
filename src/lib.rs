pub mod auth;
pub mod bark;
pub mod config;
pub mod db;

use std::{
    io::Cursor,
    path::{Path as FilePath, PathBuf},
    sync::{Arc, Mutex},
    time::Instant,
};

use auth_mini_axum::{AuthMiniLayer, JwksCachePolicy};
use axum::{
    Router,
    body::Body,
    extract::{Multipart, Path, Query, State},
    http::{HeaderMap, StatusCode, header},
    middleware::from_fn_with_state,
    response::{IntoResponse, Response},
    routing::{get, patch, post, put},
};
use image::{ImageReader, imageops::FilterType};
use rand::{Rng, distr::Alphanumeric};
use rust_embed::RustEmbed;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{FromRow, SqlitePool};
use sysinfo::{Disks, Networks, System};
use tower_http::{
    compression::CompressionLayer,
    cors::{Any, CorsLayer},
    limit::RequestBodyLimitLayer,
    trace::TraceLayer,
};
use uuid::Uuid;

use crate::{
    auth::{AuthManager, UserIdentity},
    config::BootstrapConfig,
};

const MAX_UPLOAD_BYTES: usize = 52_428_800;
const AVATAR_EDGE: u32 = 256;
const MAX_AVATAR_PIXELS: u64 = 16_777_216;
const AVATAR_BACKFILL_INTERVAL: std::time::Duration = std::time::Duration::from_secs(5);
const BARK_NOTIFICATION_BODY_MAX_BYTES: usize = 3_000;
const MESSAGE_PAGE_SIZE: i64 = 50;
const LIST_CONVERSATIONS_QUERY: &str = "SELECT c.id,c.kind,c.title,c.created_by,c.created_at,CASE WHEN c.kind='group' THEN c.avatar_attachment_id END avatar_attachment_id,CASE WHEN c.kind='direct' THEN COALESCE((SELECT p.display_name FROM conversation_members cm_peer JOIN profiles p ON p.user_id=cm_peer.user_id WHERE cm_peer.conversation_id=c.id AND cm_peer.user_id<>? LIMIT 1),(SELECT b.name FROM conversation_bots cb JOIN bots b ON b.id=cb.bot_id WHERE cb.conversation_id=c.id LIMIT 1)) END counterpart_name,CASE WHEN c.kind='direct' THEN (SELECT p.avatar_attachment_id FROM conversation_members cm_peer JOIN profiles p ON p.user_id=cm_peer.user_id WHERE cm_peer.conversation_id=c.id AND cm_peer.user_id<>? LIMIT 1) END counterpart_avatar_attachment_id,(SELECT body FROM messages WHERE conversation_id=c.id ORDER BY created_at DESC LIMIT 1) latest_body,(SELECT created_at FROM messages WHERE conversation_id=c.id ORDER BY created_at DESC LIMIT 1) latest_at,(SELECT COUNT(*) FROM messages WHERE conversation_id=c.id AND created_at>cm.last_read_at AND sender_id<>?) unread_count FROM conversations c JOIN conversation_members cm ON cm.conversation_id=c.id WHERE cm.user_id=? ORDER BY COALESCE(latest_at,c.created_at) DESC";
const CONVERSATION_QUERY: &str = "SELECT c.id,c.kind,c.title,c.created_by,c.created_at,CASE WHEN c.kind='group' THEN c.avatar_attachment_id END avatar_attachment_id,CASE WHEN c.kind='direct' THEN COALESCE((SELECT p.display_name FROM conversation_members cm_peer JOIN profiles p ON p.user_id=cm_peer.user_id WHERE cm_peer.conversation_id=c.id AND cm_peer.user_id<>? LIMIT 1),(SELECT b.name FROM conversation_bots cb JOIN bots b ON b.id=cb.bot_id WHERE cb.conversation_id=c.id LIMIT 1)) END counterpart_name,CASE WHEN c.kind='direct' THEN (SELECT p.avatar_attachment_id FROM conversation_members cm_peer JOIN profiles p ON p.user_id=cm_peer.user_id WHERE cm_peer.conversation_id=c.id AND cm_peer.user_id<>? LIMIT 1) END counterpart_avatar_attachment_id,(SELECT body FROM messages WHERE conversation_id=c.id ORDER BY created_at DESC LIMIT 1) latest_body,(SELECT created_at FROM messages WHERE conversation_id=c.id ORDER BY created_at DESC LIMIT 1) latest_at,(SELECT COUNT(*) FROM messages WHERE conversation_id=c.id AND created_at>cm.last_read_at AND sender_id<>?) unread_count FROM conversations c JOIN conversation_members cm ON cm.conversation_id=c.id WHERE c.id=? AND cm.user_id=?";

#[derive(Clone)]
pub struct AppState {
    pub db: SqlitePool,
    pub auth: AuthManager,
    pub uploads: Arc<PathBuf>,
    bark: bark::BarkGateway,
    database_path: Arc<PathBuf>,
    system_monitor: Arc<Mutex<SystemMonitor>>,
    events: tokio::sync::broadcast::Sender<ConversationEvent>,
}

impl AppState {
    pub async fn new(bootstrap: BootstrapConfig, db: SqlitePool) -> anyhow::Result<Self> {
        let auth = AuthManager::default();
        let complete: bool = meta(&db, "setup_complete").await?.parse()?;
        if complete {
            let issuer = meta(&db, "auth_issuer").await?;
            let audiences = auth_audiences(&db).await?;
            auth.configure(&issuer, &audiences).await?;
        }
        let (events, _) = tokio::sync::broadcast::channel(256);
        let bark = bark::BarkGateway::load().unwrap_or_else(|error| {
            tracing::error!(%error, "Bark gateway disabled because its APNs configuration is invalid");
            bark::BarkGateway::disabled()
        });
        let state = Self {
            db,
            auth,
            uploads: Arc::new(bootstrap.upload_dir),
            bark,
            database_path: Arc::new(bootstrap.database_path),
            system_monitor: Arc::new(Mutex::new(SystemMonitor::new())),
            events,
        };
        schedule_avatar_backfill(state.clone());
        Ok(state)
    }
}

pub fn router(state: AppState) -> Router {
    let signed_in = Router::new()
        .route("/api/me", get(me))
        .route("/api/admin/system", get(system_overview))
        .route("/api/admin/bark-users", get(bark_notification_users))
        .route("/api/events", get(events))
        .route("/api/profile", put(update_profile))
        .route(
            "/api/settings/bark",
            get(bark_notification_settings)
                .post(reset_bark_binding)
                .delete(revoke_bark_binding),
        )
        .route(
            "/api/settings/bark/devices/{id}",
            axum::routing::delete(delete_bark_device),
        )
        .route("/api/users", get(list_users))
        .route("/api/users/search", get(search_users))
        .route("/api/users/{username}", get(read_user))
        .route(
            "/api/conversations",
            get(list_conversations).post(create_group),
        )
        .route(
            "/api/conversations/{id}",
            get(conversation_detail).patch(update_group_title),
        )
        .route("/api/conversations/direct/{username}", post(open_direct))
        .route(
            "/api/conversations/{id}/members",
            post(add_member).delete(remove_member),
        )
        .route(
            "/api/conversations/{id}/messages",
            get(list_messages).post(send_message),
        )
        .route("/api/conversations/{id}/read", post(mark_read))
        .route(
            "/api/attachments",
            post(upload_attachment).layer(RequestBodyLimitLayer::new(MAX_UPLOAD_BYTES)),
        )
        .route("/api/attachments/{id}/content", get(download_attachment))
        .route(
            "/api/attachments/{id}/avatar",
            get(download_avatar_derivative),
        )
        .route("/api/bots", get(list_bots).post(create_bot))
        .route("/api/bots/{id}", patch(update_bot).delete(delete_bot))
        .route(
            "/api/bots/{id}/groups/{conversation_id}",
            post(add_bot_to_group).delete(remove_bot_from_group),
        )
        .route_layer(from_fn_with_state(state.clone(), auth::authenticate))
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods([
                    axum::http::Method::GET,
                    axum::http::Method::POST,
                    axum::http::Method::PUT,
                    axum::http::Method::PATCH,
                    axum::http::Method::DELETE,
                ])
                .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE]),
        );

    Router::new()
        .route("/api/health", get(health))
        .route("/api/config", get(public_config))
        .route("/api/public/profiles/{user_id}", get(public_profile))
        .route(
            "/api/public/profiles/{user_id}/avatar",
            get(public_profile_avatar),
        )
        .route(
            "/api/public/conversations/{id}/avatar",
            get(public_group_avatar),
        )
        .route("/api/setup", get(setup_status).post(setup))
        .route("/bot/v1/messages", post(bot_send_message))
        .route("/bot/v1/conversations/{id}", get(bot_conversation))
        .route("/api/bark/b/{capability}/ping", get(bark_binding_ping))
        .route(
            "/api/bark/b/{capability}/register",
            get(bark_register).post(bark_register_post),
        )
        .merge(signed_in)
        .fallback(static_asset)
        .layer(axum::extract::DefaultBodyLimit::disable())
        .layer(CompressionLayer::new())
        .layer(
            TraceLayer::new_for_http().make_span_with(|request: &axum::http::Request<_>| {
                tracing::info_span!(
                    "http_request",
                    method = %request.method(),
                    path = request_log_path(request.uri().path()),
                )
            }),
        )
        .with_state(state)
}

#[derive(Debug, thiserror::Error)]
#[error("{message}")]
pub struct AppError {
    status: StatusCode,
    message: String,
}

impl AppError {
    fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: message.into(),
        }
    }
    fn unauthorized(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::UNAUTHORIZED,
            message: message.into(),
        }
    }
    fn forbidden(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::FORBIDDEN,
            message: message.into(),
        }
    }
    fn not_found(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            message: message.into(),
        }
    }
    fn conflict(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::CONFLICT,
            message: message.into(),
        }
    }
    fn unavailable(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::SERVICE_UNAVAILABLE,
            message: message.into(),
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        (
            self.status,
            axum::Json(json!({"error":{"message":self.message,"code":self.status.as_u16()}})),
        )
            .into_response()
    }
}

impl From<sqlx::Error> for AppError {
    fn from(error: sqlx::Error) -> Self {
        tracing::error!(%error, "database request failed");
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: "database request failed".to_owned(),
        }
    }
}

impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        tracing::error!(%error, "storage request failed");
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: "storage request failed".to_owned(),
        }
    }
}

#[derive(Serialize)]
struct Health {
    status: &'static str,
}

#[derive(Clone, Serialize)]
struct ConversationEvent {
    conversation_id: String,
    sender_id: String,
    message: Message,
}

async fn events(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<UserIdentity>,
) -> axum::response::sse::Sse<
    impl futures_util::Stream<Item = Result<axum::response::sse::Event, std::convert::Infallible>>,
> {
    let mut receiver = state.events.subscribe();
    let stream = async_stream::stream! {
        while let Ok(event) = receiver.recv().await {
            let member: Option<i64> = sqlx::query_scalar("SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?")
                .bind(&event.conversation_id)
                .bind(&user.id)
                .fetch_optional(&state.db)
                .await
                .unwrap_or(None);
            if member.is_some() {
                let payload = serde_json::to_string(&event).expect("event serializes");
                yield Ok(axum::response::sse::Event::default().event("message").data(payload));
            }
        }
    };
    axum::response::sse::Sse::new(stream).keep_alive(axum::response::sse::KeepAlive::default())
}

async fn health() -> axum::Json<Health> {
    axum::Json(Health { status: "ok" })
}

#[derive(Serialize)]
struct BarkResponse {
    code: u16,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<serde_json::Value>,
    timestamp: i64,
}

fn bark_response(status: StatusCode, message: impl Into<String>, data: Option<Value>) -> Response {
    (
        status,
        axum::Json(BarkResponse {
            code: status.as_u16(),
            message: message.into(),
            data,
            timestamp: chrono::Utc::now().timestamp(),
        }),
    )
        .into_response()
}

async fn bark_binding_ping(
    State(state): State<AppState>,
    Path(capability): Path<String>,
) -> Response {
    if !state.bark.configured()
        || bark_binding_for_capability(&state.db, &capability)
            .await
            .ok()
            .flatten()
            .is_none()
    {
        return bark_response(StatusCode::NOT_FOUND, "Bark server is unavailable", None);
    }
    bark_response(StatusCode::OK, "pong", None)
}

async fn bark_register(
    State(state): State<AppState>,
    Path(capability): Path<String>,
    Query(input): Query<bark::RegisterInput>,
) -> Response {
    register_bark_device(state, capability, input).await
}

async fn bark_register_post(
    State(state): State<AppState>,
    Path(capability): Path<String>,
    axum::extract::Form(input): axum::extract::Form<bark::RegisterInput>,
) -> Response {
    register_bark_device(state, capability, input).await
}

async fn register_bark_device(
    state: AppState,
    capability: String,
    input: bark::RegisterInput,
) -> Response {
    if !state.bark.configured() {
        return bark_response(
            StatusCode::SERVICE_UNAVAILABLE,
            "Bark APNs is not configured",
            None,
        );
    }
    let binding = match bark_binding_for_capability(&state.db, &capability).await {
        Ok(Some(binding)) => binding,
        Ok(None) | Err(_) => {
            return bark_response(StatusCode::NOT_FOUND, "Bark server is unavailable", None);
        }
    };
    if input.device_token == "deleted" {
        if input.key.is_empty() {
            return bark_response(StatusCode::BAD_REQUEST, "device key is empty", None);
        }
        let result =
            sqlx::query("DELETE FROM bark_user_devices WHERE user_id=? AND device_key_hash=?")
                .bind(&binding.user_id)
                .bind(bark::hash_secret(&input.key))
                .execute(&state.db)
                .await;
        return match result {
            Ok(_) => bark_response(StatusCode::OK, "success", Some(json!({"key": input.key}))),
            Err(_) => bark_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                "device registration failed",
                None,
            ),
        };
    }
    if bark::validate_device_token(&input.device_token).is_err() {
        return bark_response(StatusCode::BAD_REQUEST, "device token is invalid", None);
    }
    match upsert_bark_device(&state.db, &binding.user_id, &input.key, &input.device_token).await {
        Ok(key) => bark_response(
            StatusCode::OK,
            "success",
            Some(json!({"key": key, "device_key": key})),
        ),
        Err(_) => bark_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "device registration failed",
            None,
        ),
    }
}

fn request_log_path(path: &str) -> &str {
    if path == "/api/bark" || path.starts_with("/api/bark/") {
        "/api/bark/[redacted]"
    } else {
        path
    }
}

#[derive(Serialize)]
struct PublicConfig {
    setup_required: bool,
    auth_issuer: Option<String>,
    public_origin: Option<String>,
}

async fn public_config(
    State(state): State<AppState>,
) -> Result<axum::Json<PublicConfig>, AppError> {
    let setup_required = meta(&state.db, "setup_complete").await? != "true";
    let auth_issuer = meta(&state.db, "auth_issuer").await?;
    let public_origin = meta(&state.db, "public_origin").await?;
    Ok(axum::Json(PublicConfig {
        setup_required,
        auth_issuer: (!auth_issuer.is_empty()).then_some(auth_issuer),
        public_origin: (!public_origin.is_empty()).then_some(public_origin),
    }))
}

#[derive(Serialize)]
struct SetupStatus {
    setup_required: bool,
}

async fn setup_status(State(state): State<AppState>) -> Result<axum::Json<SetupStatus>, AppError> {
    Ok(axum::Json(SetupStatus {
        setup_required: meta(&state.db, "setup_complete").await? != "true",
    }))
}

#[derive(Deserialize)]
struct SetupInput {
    root_user_id: String,
    auth_issuer: String,
    auth_audience: String,
    #[serde(default)]
    trusted_auth_audiences: Vec<String>,
    public_origin: String,
}

async fn setup(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::Json(input): axum::Json<SetupInput>,
) -> Result<axum::Json<SetupStatus>, AppError> {
    if meta(&state.db, "setup_complete").await? == "true" {
        return Err(AppError::conflict("Linkit setup is already complete"));
    }
    let issuer = valid_origin(&input.auth_issuer, "Auth Mini issuer")?;
    let audience = valid_audience(&input.auth_audience)?;
    let trusted_audiences = normalize_trusted_audiences(&audience, input.trusted_auth_audiences)?;
    let trusted_audiences_json = serde_json::to_string(&trusted_audiences)
        .map_err(|_| AppError::bad_request("trusted_auth_audiences is not valid"))?;
    let public_origin = valid_origin(&input.public_origin, "public origin")?;
    if input.root_user_id.trim().is_empty() {
        return Err(AppError::bad_request("root_user_id is required"));
    }
    let token = bearer_token(&headers)?;
    let layer = AuthMiniLayer::from_issuer(&issuer, audience.clone(), JwksCachePolicy::default())
        .await
        .map_err(|_| AppError::unavailable("Auth Mini JWKS is unavailable"))?;
    let principal = layer
        .verifier()
        .verify(token)
        .await
        .map_err(|_| AppError::unauthorized("root user token is invalid"))?;
    if principal.subject != input.root_user_id {
        return Err(AppError::forbidden(
            "root_user_id must equal the verified Auth Mini subject",
        ));
    }
    let now = chrono::Utc::now().timestamp();
    let mut tx = state.db.begin().await?;
    for (key, value) in [
        ("root_user_id", input.root_user_id.as_str()),
        ("auth_issuer", issuer.as_str()),
        ("auth_audience", audience.as_str()),
        ("auth_trusted_audiences", trusted_audiences_json.as_str()),
        ("public_origin", public_origin.as_str()),
        ("setup_complete", "true"),
    ] {
        sqlx::query("UPDATE app_meta SET value=? WHERE key=?")
            .bind(value)
            .bind(key)
            .execute(&mut *tx)
            .await?;
    }
    sqlx::query("INSERT INTO users(id,created_at) VALUES(?,?) ON CONFLICT(id) DO NOTHING")
        .bind(&input.root_user_id)
        .bind(now)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    state.auth.configure(&issuer, &trusted_audiences).await?;
    Ok(axum::Json(SetupStatus {
        setup_required: false,
    }))
}

#[derive(Clone, Serialize, FromRow)]
struct Profile {
    user_id: String,
    username: String,
    display_name: String,
    motto: String,
    avatar_attachment_id: Option<String>,
    updated_at: i64,
}

async fn profile_for_user(db: &SqlitePool, user_id: &str) -> Result<Option<Profile>, AppError> {
    Ok(sqlx::query_as("SELECT user_id,username,display_name,motto,avatar_attachment_id,updated_at FROM profiles WHERE user_id=?").bind(user_id).fetch_optional(db).await?)
}

#[derive(Debug, Serialize)]
struct PublicProfile {
    user_id: String,
    username: String,
    display_name: String,
    avatar_url: Option<String>,
}

async fn public_profile(
    State(state): State<AppState>,
    Path(user_id): Path<String>,
) -> Result<axum::Json<PublicProfile>, AppError> {
    let public_origin = meta(&state.db, "public_origin").await?;
    let profile = sqlx::query_as::<_, (String, String, String, Option<String>, i64)>(
        "SELECT p.user_id,p.username,p.display_name,
                CASE WHEN EXISTS(
                    SELECT 1 FROM attachments a
                    WHERE a.id=p.avatar_attachment_id
                      AND a.owner_user_id=p.user_id
                      AND a.media_type LIKE 'image/%'
                ) THEN p.avatar_attachment_id END,
                p.updated_at
         FROM profiles p WHERE p.user_id=?",
    )
    .bind(&user_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::not_found("user not found"))?;
    Ok(axum::Json(PublicProfile {
        user_id: profile.0,
        username: profile.1,
        display_name: profile.2,
        avatar_url: profile
            .3
            .map(|_| public_profile_avatar_url(&public_origin, &user_id, profile.4)),
    }))
}

fn public_profile_avatar_url(public_origin: &str, user_id: &str, version: i64) -> String {
    let mut url = url::Url::parse(public_origin).expect("configured public origin is valid");
    url.path_segments_mut()
        .expect("configured public origin is a base URL")
        .extend(["api", "public", "profiles", user_id, "avatar"]);
    url.query_pairs_mut().append_pair("v", &version.to_string());
    url.into()
}

async fn public_profile_avatar(
    State(state): State<AppState>,
    Path(user_id): Path<String>,
) -> Result<Response, AppError> {
    let row: Option<(String, String, String)> = sqlx::query_as(
        "SELECT COALESCE(d.storage_name,a.storage_name),CASE WHEN d.source_attachment_id IS NULL THEN a.file_name ELSE 'avatar.webp' END,COALESCE(d.media_type,a.media_type)
         FROM profiles p JOIN attachments a ON a.id=p.avatar_attachment_id
         LEFT JOIN avatar_derivatives d ON d.source_attachment_id=a.id
         WHERE p.user_id=? AND a.owner_user_id=p.user_id AND a.media_type LIKE 'image/%'",
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await?;
    let Some((storage_name, file_name, media_type)) = row else {
        return Err(AppError::not_found("avatar not found"));
    };
    attachment_inline_response(&state.uploads, storage_name, file_name, media_type).await
}

async fn public_group_avatar(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, AppError> {
    let row: Option<(String, String, String)> = sqlx::query_as(
        "SELECT COALESCE(d.storage_name,a.storage_name),CASE WHEN d.source_attachment_id IS NULL THEN a.file_name ELSE 'avatar.webp' END,COALESCE(d.media_type,a.media_type)
         FROM conversations c JOIN attachments a ON a.id=c.avatar_attachment_id
         LEFT JOIN avatar_derivatives d ON d.source_attachment_id=a.id
         WHERE c.id=? AND c.kind='group' AND a.media_type LIKE 'image/%'",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?;
    let Some((storage_name, file_name, media_type)) = row else {
        return Err(AppError::not_found("group avatar not found"));
    };
    attachment_inline_response(&state.uploads, storage_name, file_name, media_type).await
}

async fn attachment_inline_response(
    uploads: &std::path::Path,
    storage_name: String,
    file_name: String,
    media_type: String,
) -> Result<Response, AppError> {
    let bytes = tokio::fs::read(uploads.join(storage_name)).await?;
    Ok((
        [
            (header::CONTENT_TYPE, media_type),
            (
                header::CONTENT_DISPOSITION,
                format!("inline; filename=\"{}\"", file_name.replace('\"', "_")),
            ),
            (
                header::CACHE_CONTROL,
                "public, max-age=31536000, immutable".to_owned(),
            ),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff".to_owned()),
        ],
        Body::from(bytes),
    )
        .into_response())
}

async fn download_avatar_derivative(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<UserIdentity>,
    Path(id): Path<String>,
) -> Result<Response, AppError> {
    let row: Option<(String, String)> = sqlx::query_as(
        "SELECT d.storage_name,d.media_type FROM avatar_derivatives d WHERE d.source_attachment_id=? AND (EXISTS(SELECT 1 FROM profiles p WHERE p.avatar_attachment_id=d.source_attachment_id) OR EXISTS(SELECT 1 FROM conversations c JOIN conversation_members cm ON cm.conversation_id=c.id WHERE c.avatar_attachment_id=d.source_attachment_id AND c.kind='group' AND cm.user_id=?))",
    )
    .bind(&id).bind(&user.id).fetch_optional(&state.db).await?;
    let Some((storage_name, media_type)) = row else {
        return Err(AppError::not_found("avatar not found"));
    };
    attachment_inline_response(
        &state.uploads,
        storage_name,
        "avatar.webp".to_owned(),
        media_type,
    )
    .await
}

fn schedule_avatar_backfill(state: AppState) {
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(AVATAR_BACKFILL_INTERVAL).await;
            let source: Result<Option<(String, String)>, sqlx::Error> = sqlx::query_as(
                "SELECT a.id,a.owner_user_id FROM attachments a WHERE a.media_type LIKE 'image/%' AND (EXISTS(SELECT 1 FROM profiles p WHERE p.avatar_attachment_id=a.id) OR EXISTS(SELECT 1 FROM conversations c WHERE c.kind='group' AND c.avatar_attachment_id=a.id)) AND NOT EXISTS(SELECT 1 FROM avatar_derivatives d WHERE d.source_attachment_id=a.id) ORDER BY a.created_at LIMIT 1",
            ).fetch_optional(&state.db).await;
            match source {
                Ok(Some((id, owner))) => {
                    if let Err(error) = normalize_avatar_attachment(&state, &id, &owner).await {
                        tracing::warn!(%error, attachment_id=%id, "avatar backfill skipped invalid source");
                    }
                }
                Ok(None) => return,
                Err(error) => tracing::warn!(%error, "avatar backfill query failed"),
            }
        }
    });
}

async fn normalize_avatar_attachment(
    state: &AppState,
    attachment_id: &str,
    owner_user_id: &str,
) -> Result<(), AppError> {
    if sqlx::query_scalar::<_, i64>("SELECT 1 FROM avatar_derivatives WHERE source_attachment_id=?")
        .bind(attachment_id)
        .fetch_optional(&state.db)
        .await?
        .is_some()
    {
        return Ok(());
    }
    let source: Option<(String, String, i64)> = sqlx::query_as("SELECT storage_name,media_type,byte_size FROM attachments WHERE id=? AND owner_user_id=? AND media_type LIKE 'image/%'").bind(attachment_id).bind(owner_user_id).fetch_optional(&state.db).await?;
    let Some((storage_name, media_type, source_byte_size)) = source else {
        return Err(AppError::bad_request(
            "avatar_attachment_id must be one of your image uploads",
        ));
    };
    let source_bytes = tokio::fs::read(state.uploads.join(storage_name)).await?;
    let normalized =
        tokio::task::spawn_blocking(move || canonical_avatar(&source_bytes, &media_type))
            .await
            .map_err(|_| AppError::unavailable("avatar processing interrupted"))??;
    let derivative_storage_name = format!("avatar-{attachment_id}.webp");
    let temporary_storage_name = format!("{derivative_storage_name}.tmp-{}", Uuid::new_v4());
    tokio::fs::write(state.uploads.join(&temporary_storage_name), &normalized).await?;
    tokio::fs::rename(
        state.uploads.join(&temporary_storage_name),
        state.uploads.join(&derivative_storage_name),
    )
    .await?;
    let now = chrono::Utc::now().timestamp();
    sqlx::query("INSERT INTO avatar_derivatives(source_attachment_id,storage_name,media_type,byte_size,width,height,source_byte_size,created_at,updated_at) VALUES(?,?, 'image/webp', ?, ?, ?, ?, ?, ?) ON CONFLICT(source_attachment_id) DO UPDATE SET storage_name=excluded.storage_name,media_type=excluded.media_type,byte_size=excluded.byte_size,width=excluded.width,height=excluded.height,source_byte_size=excluded.source_byte_size,updated_at=excluded.updated_at")
      .bind(attachment_id).bind(derivative_storage_name).bind(normalized.len() as i64).bind(i64::from(AVATAR_EDGE)).bind(i64::from(AVATAR_EDGE)).bind(source_byte_size).bind(now).bind(now).execute(&state.db).await?;
    Ok(())
}

fn canonical_avatar(bytes: &[u8], media_type: &str) -> Result<Vec<u8>, AppError> {
    if !matches!(
        media_type,
        "image/jpeg" | "image/png" | "image/webp" | "image/gif"
    ) {
        return Err(AppError::bad_request(
            "avatars must be JPEG, PNG, WebP, or GIF images",
        ));
    }
    let mut reader = ImageReader::new(Cursor::new(bytes));
    reader.limits(image::Limits::default());
    let image = reader
        .with_guessed_format()
        .map_err(|_| AppError::bad_request("avatar image format is invalid"))?
        .decode()
        .map_err(|_| AppError::bad_request("avatar image cannot be decoded"))?;
    let (width, height) = (image.width(), image.height());
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > MAX_AVATAR_PIXELS {
        return Err(AppError::bad_request(
            "avatar image dimensions are unsupported",
        ));
    }
    let edge = width.min(height);
    let cropped = image
        .crop_imm((width - edge) / 2, (height - edge) / 2, edge, edge)
        .resize_exact(AVATAR_EDGE, AVATAR_EDGE, FilterType::Lanczos3);
    let mut output = Cursor::new(Vec::new());
    cropped
        .write_to(&mut output, image::ImageFormat::WebP)
        .map_err(|_| AppError::bad_request("avatar image cannot be encoded"))?;
    Ok(output.into_inner())
}

#[derive(Serialize)]
struct Me {
    id: String,
    root: bool,
    profile: Option<Profile>,
}

async fn me(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<UserIdentity>,
) -> Result<axum::Json<Me>, AppError> {
    let root = meta(&state.db, "root_user_id").await? == user.id;
    Ok(axum::Json(Me {
        profile: profile_for_user(&state.db, &user.id).await?,
        id: user.id,
        root,
    }))
}

#[derive(Serialize)]
struct SystemOverview {
    generated_at: i64,
    cpu_usage_percent: f32,
    used_memory_bytes: u64,
    total_memory_bytes: u64,
    received_bytes_per_second: f64,
    transmitted_bytes_per_second: f64,
    received_bytes_total: u64,
    transmitted_bytes_total: u64,
    sqlite_bytes: u64,
    disks: Vec<DiskOverview>,
}

#[derive(Serialize)]
struct DiskOverview {
    mount_point: String,
    total_bytes: u64,
    available_bytes: u64,
}

struct SystemMonitor {
    system: System,
    disks: Disks,
    networks: Networks,
    previous_network: Option<(u64, u64, Instant)>,
}

impl SystemMonitor {
    fn new() -> Self {
        Self {
            system: System::new_all(),
            disks: Disks::new_with_refreshed_list(),
            networks: Networks::new_with_refreshed_list(),
            previous_network: None,
        }
    }

    fn snapshot(&mut self, sqlite_bytes: u64) -> SystemOverview {
        self.system.refresh_cpu_usage();
        self.system.refresh_memory();
        self.disks.refresh(false);
        self.networks.refresh(false);

        let received_bytes_total: u64 = self
            .networks
            .values()
            .map(|network| network.total_received())
            .sum();
        let transmitted_bytes_total: u64 = self
            .networks
            .values()
            .map(|network| network.total_transmitted())
            .sum();
        let now = Instant::now();
        let (received_bytes_per_second, transmitted_bytes_per_second) = match self.previous_network
        {
            Some((received, transmitted, previous_at)) => {
                let elapsed = now.duration_since(previous_at).as_secs_f64();
                if elapsed > 0.0 {
                    (
                        received_bytes_total.saturating_sub(received) as f64 / elapsed,
                        transmitted_bytes_total.saturating_sub(transmitted) as f64 / elapsed,
                    )
                } else {
                    (0.0, 0.0)
                }
            }
            None => (0.0, 0.0),
        };
        self.previous_network = Some((received_bytes_total, transmitted_bytes_total, now));

        SystemOverview {
            generated_at: chrono::Utc::now().timestamp(),
            cpu_usage_percent: self.system.global_cpu_usage(),
            used_memory_bytes: self.system.used_memory(),
            total_memory_bytes: self.system.total_memory(),
            received_bytes_per_second,
            transmitted_bytes_per_second,
            received_bytes_total,
            transmitted_bytes_total,
            sqlite_bytes,
            disks: self
                .disks
                .list()
                .iter()
                .map(|disk| DiskOverview {
                    mount_point: disk.mount_point().display().to_string(),
                    total_bytes: disk.total_space(),
                    available_bytes: disk.available_space(),
                })
                .collect(),
        }
    }
}

async fn system_overview(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<UserIdentity>,
) -> Result<axum::Json<SystemOverview>, AppError> {
    require_root(&state.db, &user.id).await?;
    let sqlite_bytes = sqlite_bytes(&state.database_path)?;
    let overview = state
        .system_monitor
        .lock()
        .expect("system monitor mutex is not poisoned")
        .snapshot(sqlite_bytes);
    Ok(axum::Json(overview))
}

#[derive(Serialize, FromRow)]
struct BarkNotificationUser {
    display_name: String,
    username: String,
    device_count: i64,
    last_device_updated_at: i64,
}

async fn bark_notification_users(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<UserIdentity>,
) -> Result<axum::Json<Vec<BarkNotificationUser>>, AppError> {
    require_root(&state.db, &user.id).await?;
    Ok(axum::Json(list_bark_notification_users(&state.db).await?))
}

async fn list_bark_notification_users(
    db: &SqlitePool,
) -> Result<Vec<BarkNotificationUser>, AppError> {
    Ok(sqlx::query_as(
        "SELECT p.display_name,p.username,COUNT(d.id) device_count,MAX(d.updated_at) last_device_updated_at
         FROM bark_user_devices d
         JOIN profiles p ON p.user_id=d.user_id
         GROUP BY d.user_id,p.display_name,p.username
         ORDER BY last_device_updated_at DESC,p.username COLLATE NOCASE",
    )
    .fetch_all(db)
    .await?)
}

#[derive(Deserialize)]
struct ProfileInput {
    username: String,
    display_name: String,
    motto: String,
    avatar_attachment_id: Option<String>,
}

async fn update_profile(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<UserIdentity>,
    axum::Json(input): axum::Json<ProfileInput>,
) -> Result<axum::Json<Profile>, AppError> {
    let username = valid_username(&input.username)?;
    let display_name = nonempty(&input.display_name, "display_name", 80)?;
    let motto = bounded(&input.motto, "motto", 280)?;
    if let Some(attachment_id) = &input.avatar_attachment_id {
        normalize_avatar_attachment(&state, attachment_id, &user.id).await?;
        let allowed: Option<String> = sqlx::query_scalar("SELECT id FROM attachments WHERE id=? AND owner_user_id=? AND media_type LIKE 'image/%'").bind(attachment_id).bind(&user.id).fetch_optional(&state.db).await?;
        if allowed.is_none() {
            return Err(AppError::bad_request(
                "avatar_attachment_id must be one of your image uploads",
            ));
        }
    }
    let now = chrono::Utc::now().timestamp();
    let result = sqlx::query("INSERT INTO profiles(user_id,username,display_name,motto,avatar_attachment_id,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET username=excluded.username,display_name=excluded.display_name,motto=excluded.motto,avatar_attachment_id=excluded.avatar_attachment_id,updated_at=excluded.updated_at")
        .bind(&user.id).bind(username).bind(display_name).bind(motto).bind(input.avatar_attachment_id).bind(now).execute(&state.db).await;
    if let Err(error) = result {
        if matches!(error, sqlx::Error::Database(ref database) if database.is_unique_violation()) {
            return Err(AppError::conflict("username is already taken"));
        }
        return Err(error.into());
    }
    Ok(axum::Json(
        profile_for_user(&state.db, &user.id)
            .await?
            .expect("profile was inserted"),
    ))
}

#[derive(Deserialize)]
struct UserQuery {
    query: Option<String>,
}

async fn list_users(
    State(state): State<AppState>,
    Query(query): Query<UserQuery>,
) -> Result<axum::Json<Vec<Profile>>, AppError> {
    let query = query.query.unwrap_or_default().trim().to_owned();
    let rows = sqlx::query_as("SELECT user_id,username,display_name,motto,avatar_attachment_id,updated_at FROM profiles WHERE username LIKE '%' || ? || '%' OR display_name LIKE '%' || ? || '%' ORDER BY username LIMIT 50").bind(&query).bind(&query).fetch_all(&state.db).await?;
    Ok(axum::Json(rows))
}

#[derive(Serialize, FromRow)]
struct UserSearchResult {
    user_id: String,
    username: String,
    display_name: String,
    avatar_attachment_id: Option<String>,
    updated_at: i64,
}

#[derive(Serialize)]
struct UserSearchResponse {
    user_id: String,
    username: String,
    display_name: String,
    avatar_url: Option<String>,
}

async fn search_users(
    State(state): State<AppState>,
    Query(query): Query<UserQuery>,
) -> Result<axum::Json<Vec<UserSearchResponse>>, AppError> {
    let query = bounded(&query.query.unwrap_or_default(), "query", 80)?;
    if query.is_empty() {
        return Ok(axum::Json(Vec::new()));
    }
    let prefix = format!("{}%", escape_like(&query));
    let rows = sqlx::query_as::<_, UserSearchResult>(
        "SELECT user_id,username,display_name,avatar_attachment_id,updated_at
         FROM profiles
         WHERE username LIKE ? ESCAPE '\\' COLLATE NOCASE
            OR display_name LIKE ? ESCAPE '\\' COLLATE NOCASE
         ORDER BY CASE WHEN username=? COLLATE NOCASE THEN 0 WHEN display_name=? COLLATE NOCASE THEN 1 ELSE 2 END, username COLLATE NOCASE
         LIMIT 5",
    )
    .bind(&prefix)
    .bind(&prefix)
    .bind(&query)
    .bind(&query)
    .fetch_all(&state.db)
    .await?;
    let public_origin = meta(&state.db, "public_origin").await?;
    Ok(axum::Json(
        rows.into_iter()
            .map(|row| UserSearchResponse {
                avatar_url: row.avatar_attachment_id.map(|_| {
                    public_profile_avatar_url(&public_origin, &row.user_id, row.updated_at)
                }),
                user_id: row.user_id,
                username: row.username,
                display_name: row.display_name,
            })
            .collect(),
    ))
}

fn escape_like(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

async fn read_user(
    State(state): State<AppState>,
    Path(username): Path<String>,
) -> Result<axum::Json<Profile>, AppError> {
    sqlx::query_as("SELECT user_id,username,display_name,motto,avatar_attachment_id,updated_at FROM profiles WHERE username=?").bind(username).fetch_optional(&state.db).await?.map(axum::Json).ok_or_else(|| AppError::not_found("user not found"))
}

#[derive(Clone, Serialize, FromRow)]
struct Conversation {
    id: String,
    kind: String,
    title: String,
    created_by: String,
    created_at: i64,
    avatar_attachment_id: Option<String>,
    counterpart_name: Option<String>,
    counterpart_avatar_attachment_id: Option<String>,
    latest_body: Option<String>,
    latest_at: Option<i64>,
    unread_count: i64,
}

async fn list_conversations(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<UserIdentity>,
) -> Result<axum::Json<Vec<Conversation>>, AppError> {
    let rows = sqlx::query_as(LIST_CONVERSATIONS_QUERY)
        .bind(&user.id)
        .bind(&user.id)
        .bind(&user.id)
        .bind(&user.id)
        .fetch_all(&state.db)
        .await?;
    Ok(axum::Json(rows))
}

#[derive(Clone, Serialize, FromRow)]
struct ConversationMember {
    user_id: String,
    username: String,
    display_name: String,
    role: String,
}

#[derive(Serialize)]
struct ConversationDetail {
    #[serde(flatten)]
    conversation: Conversation,
    members: Vec<ConversationMember>,
    bots: Vec<Bot>,
}

async fn conversation_detail(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<UserIdentity>,
    Path(id): Path<String>,
) -> Result<axum::Json<ConversationDetail>, AppError> {
    let conversation = conversation(&state.db, &id, &user.id).await?;
    let members = sqlx::query_as("SELECT cm.user_id,p.username,p.display_name,cm.role FROM conversation_members cm JOIN profiles p ON p.user_id=cm.user_id WHERE cm.conversation_id=? ORDER BY cm.joined_at")
        .bind(&id)
        .fetch_all(&state.db)
        .await?;
    let bots = sqlx::query_as("SELECT b.id,b.owner_user_id,b.name,b.token_prefix,b.created_at,b.updated_at FROM bots b JOIN conversation_bots cb ON cb.bot_id=b.id WHERE cb.conversation_id=? ORDER BY cb.added_at")
        .bind(&id)
        .fetch_all(&state.db)
        .await?;
    Ok(axum::Json(ConversationDetail {
        conversation,
        members,
        bots,
    }))
}

#[derive(Deserialize)]
struct GroupInput {
    title: String,
    usernames: Vec<String>,
}

#[derive(Deserialize)]
struct UpdateGroupInput {
    title: Option<String>,
    avatar_attachment_id: Option<Option<String>>,
}

async fn update_group_title(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<UserIdentity>,
    Path(id): Path<String>,
    axum::Json(input): axum::Json<UpdateGroupInput>,
) -> Result<axum::Json<Conversation>, AppError> {
    require_group_owner(&state.db, &id, &user.id).await?;
    if input.title.is_none() && input.avatar_attachment_id.is_none() {
        return Err(AppError::bad_request(
            "title or avatar_attachment_id is required",
        ));
    }
    if let Some(title) = input.title {
        sqlx::query("UPDATE conversations SET title=? WHERE id=? AND kind='group'")
            .bind(nonempty(&title, "title", 120)?)
            .bind(&id)
            .execute(&state.db)
            .await?;
    }
    if let Some(avatar_attachment_id) = input.avatar_attachment_id {
        if let Some(attachment_id) = &avatar_attachment_id {
            normalize_avatar_attachment(&state, attachment_id, &user.id).await?;
            let allowed: Option<String> = sqlx::query_scalar(
                "SELECT id FROM attachments WHERE id=? AND owner_user_id=? AND media_type LIKE 'image/%'",
            )
            .bind(attachment_id)
            .bind(&user.id)
            .fetch_optional(&state.db)
            .await?;
            if allowed.is_none() {
                return Err(AppError::bad_request(
                    "avatar_attachment_id must be one of your image uploads",
                ));
            }
        }
        sqlx::query("UPDATE conversations SET avatar_attachment_id=? WHERE id=? AND kind='group'")
            .bind(avatar_attachment_id)
            .bind(&id)
            .execute(&state.db)
            .await?;
    }
    conversation(&state.db, &id, &user.id).await.map(axum::Json)
}

async fn create_group(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<UserIdentity>,
    axum::Json(input): axum::Json<GroupInput>,
) -> Result<axum::Json<Conversation>, AppError> {
    let title = nonempty(&input.title, "title", 120)?;
    let now = chrono::Utc::now().timestamp();
    let id = Uuid::new_v4().to_string();
    let mut tx = state.db.begin().await?;
    sqlx::query(
        "INSERT INTO conversations(id,kind,title,created_by,created_at) VALUES(?,'group',?,?,?)",
    )
    .bind(&id)
    .bind(&title)
    .bind(&user.id)
    .bind(now)
    .execute(&mut *tx)
    .await?;
    sqlx::query("INSERT INTO conversation_members(conversation_id,user_id,role,joined_at) VALUES(?,?,'owner',?)").bind(&id).bind(&user.id).bind(now).execute(&mut *tx).await?;
    for username in input.usernames {
        add_member_by_username(&mut tx, &id, &username, now).await?;
    }
    tx.commit().await?;
    conversation(&state.db, &id, &user.id).await.map(axum::Json)
}

async fn open_direct(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<UserIdentity>,
    Path(username): Path<String>,
) -> Result<axum::Json<Conversation>, AppError> {
    let target = user_id_from_username(&state.db, &username).await?;
    if target == user.id {
        return Err(AppError::bad_request(
            "cannot open a direct conversation with yourself",
        ));
    }
    let direct_key = direct_key(&user.id, &target);
    let now = chrono::Utc::now().timestamp();
    let id = Uuid::new_v4().to_string();
    let mut tx = state.db.begin().await?;
    sqlx::query("INSERT INTO conversations(id,kind,title,direct_key,created_by,created_at) VALUES(?,'direct','',?,?,?) ON CONFLICT(direct_key) DO NOTHING").bind(&id).bind(&direct_key).bind(&user.id).bind(now).execute(&mut *tx).await?;
    let actual_id: String = sqlx::query_scalar("SELECT id FROM conversations WHERE direct_key=?")
        .bind(&direct_key)
        .fetch_one(&mut *tx)
        .await?;
    for member in [&user.id, &target] {
        sqlx::query("INSERT INTO conversation_members(conversation_id,user_id,role,joined_at) VALUES(?,?,'member',?) ON CONFLICT DO NOTHING").bind(&actual_id).bind(member).bind(now).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    conversation(&state.db, &actual_id, &user.id)
        .await
        .map(axum::Json)
}

#[derive(Deserialize)]
struct MemberInput {
    username: String,
}

async fn add_member(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<UserIdentity>,
    Path(id): Path<String>,
    axum::Json(input): axum::Json<MemberInput>,
) -> Result<StatusCode, AppError> {
    require_group_owner(&state.db, &id, &user.id).await?;
    let now = chrono::Utc::now().timestamp();
    let mut tx = state.db.begin().await?;
    add_member_by_username(&mut tx, &id, &input.username, now).await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn remove_member(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<UserIdentity>,
    Path(id): Path<String>,
    axum::Json(input): axum::Json<MemberInput>,
) -> Result<StatusCode, AppError> {
    require_group_owner(&state.db, &id, &user.id).await?;
    let member_id = user_id_from_username(&state.db, &input.username).await?;
    if member_id == user.id {
        return Err(AppError::bad_request(
            "a group owner cannot remove themselves",
        ));
    }
    let result = sqlx::query(
        "DELETE FROM conversation_members WHERE conversation_id=? AND user_id=? AND role='member'",
    )
    .bind(&id)
    .bind(member_id)
    .execute(&state.db)
    .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::not_found("group member not found"));
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Clone, Serialize, FromRow)]
struct Attachment {
    id: String,
    file_name: String,
    media_type: String,
    byte_size: i64,
    created_at: i64,
}

#[derive(Clone, Serialize, FromRow)]
struct StoredMessage {
    id: String,
    conversation_id: String,
    sender_kind: String,
    sender_id: String,
    sender_name: String,
    sender_deleted: bool,
    body: String,
    urgent: bool,
    created_at: i64,
    #[serde(skip_serializing)]
    sequence: i64,
}

#[derive(Clone, Serialize)]
struct Message {
    #[serde(flatten)]
    message: StoredMessage,
    attachments: Vec<Attachment>,
    cursor: String,
}

#[derive(Deserialize)]
struct MessagePageQuery {
    before_cursor: Option<String>,
    after_cursor: Option<String>,
}

#[derive(Serialize)]
struct MessagePage {
    messages: Vec<Message>,
    older_cursor: Option<String>,
    newer_cursor: Option<String>,
}

async fn list_messages(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<UserIdentity>,
    Path(id): Path<String>,
    Query(query): Query<MessagePageQuery>,
) -> Result<axum::Json<MessagePage>, AppError> {
    require_member(&state.db, &id, &user.id).await?;
    Ok(axum::Json(messages_for(&state.db, &id, query).await?))
}

#[derive(Deserialize)]
struct SendMessageInput {
    body: String,
    attachment_ids: Vec<String>,
    #[serde(default)]
    urgent: bool,
}

async fn send_message(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<UserIdentity>,
    Path(id): Path<String>,
    axum::Json(input): axum::Json<SendMessageInput>,
) -> Result<axum::Json<Message>, AppError> {
    require_member(&state.db, &id, &user.id).await?;
    let message = create_message(
        &state.db,
        NewMessage {
            conversation_id: &id,
            sender_kind: "user",
            sender_id: &user.id,
            body: input.body,
            attachment_ids: input.attachment_ids,
            urgent: input.urgent,
            attachment_owner: Some(&user.id),
            client_message_id: None,
        },
    )
    .await?;
    let _ = state.events.send(ConversationEvent {
        conversation_id: id.clone(),
        sender_id: user.id.clone(),
        message: message.clone(),
    });
    dispatch_bark_notifications(state, id, Some(user.id), message.clone());
    Ok(axum::Json(message))
}

async fn mark_read(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<UserIdentity>,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    let now = chrono::Utc::now().timestamp();
    let result = sqlx::query(
        "UPDATE conversation_members SET last_read_at=? WHERE conversation_id=? AND user_id=?",
    )
    .bind(now)
    .bind(id)
    .bind(user.id)
    .execute(&state.db)
    .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::not_found("conversation not found"));
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn upload_attachment(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<UserIdentity>,
    mut multipart: Multipart,
) -> Result<axum::Json<Attachment>, AppError> {
    let Some(field) = multipart
        .next_field()
        .await
        .map_err(|_| AppError::bad_request("invalid multipart upload"))?
    else {
        return Err(AppError::bad_request("file is required"));
    };
    if field.name() != Some("file") {
        return Err(AppError::bad_request("upload field must be named file"));
    }
    let file_name = field
        .file_name()
        .map(str::to_owned)
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "upload".to_owned());
    let media_type = field
        .content_type()
        .map(str::to_owned)
        .unwrap_or_else(|| "application/octet-stream".to_owned());
    let bytes = field
        .bytes()
        .await
        .map_err(|_| AppError::bad_request("could not read upload"))?;
    if bytes.is_empty() || bytes.len() > MAX_UPLOAD_BYTES {
        return Err(AppError::bad_request(
            "file must be between 1 byte and 50 MiB",
        ));
    }
    let id = Uuid::new_v4().to_string();
    let storage_name = format!("{id}.bin");
    tokio::fs::write(state.uploads.join(&storage_name), &bytes).await?;
    let now = chrono::Utc::now().timestamp();
    sqlx::query("INSERT INTO attachments(id,owner_user_id,file_name,media_type,byte_size,storage_name,created_at) VALUES(?,?,?,?,?,?,?)").bind(&id).bind(&user.id).bind(&file_name).bind(&media_type).bind(bytes.len() as i64).bind(&storage_name).bind(now).execute(&state.db).await?;
    Ok(axum::Json(Attachment {
        id,
        file_name,
        media_type,
        byte_size: bytes.len() as i64,
        created_at: now,
    }))
}

async fn download_attachment(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<UserIdentity>,
    Path(id): Path<String>,
) -> Result<Response, AppError> {
    let row: Option<(String, String, String, Option<String>)> = sqlx::query_as("SELECT a.storage_name,a.file_name,a.media_type,a.message_id FROM attachments a WHERE a.id=? AND (a.owner_user_id=? OR EXISTS(SELECT 1 FROM messages m JOIN conversation_members cm ON cm.conversation_id=m.conversation_id WHERE m.id=a.message_id AND cm.user_id=?) OR EXISTS(SELECT 1 FROM profiles p WHERE p.avatar_attachment_id=a.id) OR EXISTS(SELECT 1 FROM conversations c JOIN conversation_members cm ON cm.conversation_id=c.id WHERE c.avatar_attachment_id=a.id AND c.kind='group' AND cm.user_id=?))").bind(&id).bind(&user.id).bind(&user.id).bind(&user.id).fetch_optional(&state.db).await?;
    let Some((storage_name, file_name, media_type, _)) = row else {
        return Err(AppError::not_found("attachment not found"));
    };
    let bytes = tokio::fs::read(state.uploads.join(storage_name)).await?;
    Ok((
        [
            (header::CONTENT_TYPE, media_type),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{}\"", file_name.replace('"', "_")),
            ),
        ],
        Body::from(bytes),
    )
        .into_response())
}

#[derive(Clone, Serialize, FromRow)]
struct Bot {
    id: String,
    owner_user_id: String,
    name: String,
    token_prefix: String,
    created_at: i64,
    updated_at: i64,
}

#[derive(Serialize)]
struct CreatedBot {
    #[serde(flatten)]
    bot: Bot,
    token: String,
}

#[derive(Deserialize)]
struct CreateBotInput {
    name: String,
}

async fn list_bots(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<UserIdentity>,
) -> Result<axum::Json<Vec<Bot>>, AppError> {
    Ok(axum::Json(sqlx::query_as("SELECT id,owner_user_id,name,token_prefix,created_at,updated_at FROM bots WHERE owner_user_id=? ORDER BY created_at DESC").bind(user.id).fetch_all(&state.db).await?))
}

async fn create_bot(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<UserIdentity>,
    axum::Json(input): axum::Json<CreateBotInput>,
) -> Result<axum::Json<CreatedBot>, AppError> {
    let name = nonempty(&input.name, "name", 80)?;
    let id = Uuid::new_v4().to_string();
    let token = new_bot_token();
    let now = chrono::Utc::now().timestamp();
    let bot = Bot {
        id: id.clone(),
        owner_user_id: user.id.clone(),
        name,
        token_prefix: token[..11].to_owned(),
        created_at: now,
        updated_at: now,
    };
    sqlx::query("INSERT INTO bots(id,owner_user_id,name,token_prefix,token_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").bind(&bot.id).bind(&bot.owner_user_id).bind(&bot.name).bind(&bot.token_prefix).bind(token_hash(&token)).bind(bot.created_at).bind(bot.updated_at).execute(&state.db).await?;
    Ok(axum::Json(CreatedBot { bot, token }))
}

#[derive(Deserialize)]
struct UpdateBotInput {
    name: Option<String>,
    new_owner_username: Option<String>,
    rotate_token: Option<bool>,
}

#[derive(Serialize)]
struct UpdatedBot {
    #[serde(flatten)]
    bot: Bot,
    token: Option<String>,
}

async fn update_bot(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<UserIdentity>,
    Path(id): Path<String>,
    axum::Json(input): axum::Json<UpdateBotInput>,
) -> Result<axum::Json<UpdatedBot>, AppError> {
    let mut bot: Bot = sqlx::query_as(
        "SELECT id,owner_user_id,name,token_prefix,created_at,updated_at FROM bots WHERE id=?",
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::not_found("bot not found"))?;
    if bot.owner_user_id != user.id {
        return Err(AppError::forbidden(
            "only the bot owner can update this bot",
        ));
    }
    let name = input
        .name
        .as_deref()
        .map(|value| nonempty(value, "name", 80))
        .transpose()?
        .unwrap_or_else(|| bot.name.clone());
    let owner = match input.new_owner_username {
        Some(username) => user_id_from_username(&state.db, &username).await?,
        None => bot.owner_user_id.clone(),
    };
    let token = input.rotate_token.unwrap_or(false).then(new_bot_token);
    let prefix = token
        .as_ref()
        .map(|value| value[..11].to_owned())
        .unwrap_or_else(|| bot.token_prefix.clone());
    let now = chrono::Utc::now().timestamp();
    if let Some(token) = &token {
        sqlx::query("UPDATE bots SET owner_user_id=?,name=?,token_prefix=?,token_hash=?,updated_at=? WHERE id=?").bind(&owner).bind(&name).bind(&prefix).bind(token_hash(token)).bind(now).bind(&id).execute(&state.db).await?;
    } else {
        sqlx::query("UPDATE bots SET owner_user_id=?,name=?,updated_at=? WHERE id=?")
            .bind(&owner)
            .bind(&name)
            .bind(now)
            .bind(&id)
            .execute(&state.db)
            .await?;
    }
    bot.owner_user_id = owner;
    bot.name = name;
    bot.token_prefix = prefix;
    bot.updated_at = now;
    Ok(axum::Json(UpdatedBot { bot, token }))
}

async fn delete_bot(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<UserIdentity>,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    delete_owned_bot(&state.db, &id, &user.id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn delete_owned_bot(db: &SqlitePool, id: &str, owner_user_id: &str) -> Result<(), AppError> {
    let result = sqlx::query("DELETE FROM bots WHERE id=? AND owner_user_id=?")
        .bind(id)
        .bind(owner_user_id)
        .execute(db)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::not_found("bot not found"));
    }
    Ok(())
}

async fn add_bot_to_group(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<UserIdentity>,
    Path((id, conversation_id)): Path<(String, String)>,
) -> Result<StatusCode, AppError> {
    let bot: Option<String> =
        sqlx::query_scalar("SELECT id FROM bots WHERE id=? AND owner_user_id=?")
            .bind(&id)
            .bind(&user.id)
            .fetch_optional(&state.db)
            .await?;
    if bot.is_none() {
        return Err(AppError::not_found("bot not found"));
    }
    require_group_owner(&state.db, &conversation_id, &user.id).await?;
    sqlx::query("INSERT INTO conversation_bots(conversation_id,bot_id,added_at) VALUES(?,?,?) ON CONFLICT DO NOTHING").bind(&conversation_id).bind(id).bind(chrono::Utc::now().timestamp()).execute(&state.db).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn remove_bot_from_group(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<UserIdentity>,
    Path((id, conversation_id)): Path<(String, String)>,
) -> Result<StatusCode, AppError> {
    require_group_owner(&state.db, &conversation_id, &user.id).await?;
    let result = sqlx::query("DELETE FROM conversation_bots WHERE conversation_id=? AND bot_id=?")
        .bind(&conversation_id)
        .bind(&id)
        .execute(&state.db)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::not_found("group bot not found"));
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct BotMessageInput {
    conversation_id: Option<String>,
    recipient_username: Option<String>,
    body: String,
    attachment_ids: Option<Vec<String>>,
    #[serde(default)]
    urgent: bool,
    client_message_id: Option<String>,
}

#[derive(Serialize, FromRow)]
struct BotConversation {
    id: String,
    kind: String,
    title: String,
}

async fn bot_conversation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<axum::Json<BotConversation>, AppError> {
    let bot = bot_from_headers(&state.db, &headers).await?;
    let conversation: Option<BotConversation> = sqlx::query_as("SELECT c.id,c.kind,c.title FROM conversations c JOIN conversation_bots cb ON cb.conversation_id=c.id WHERE c.id=? AND cb.bot_id=?")
        .bind(&id).bind(&bot.id).fetch_optional(&state.db).await?;
    conversation
        .map(axum::Json)
        .ok_or_else(|| AppError::forbidden("bot is not a member of this conversation"))
}

async fn bot_send_message(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::Json(input): axum::Json<BotMessageInput>,
) -> Result<axum::Json<Message>, AppError> {
    let bot = bot_from_headers(&state.db, &headers).await?;
    let conversation_id = match (input.conversation_id, input.recipient_username) {
        (Some(id), None) => {
            let allowed: Option<String> = sqlx::query_scalar("SELECT c.id FROM conversations c JOIN conversation_bots cb ON cb.conversation_id=c.id WHERE c.id=? AND cb.bot_id=?").bind(&id).bind(&bot.id).fetch_optional(&state.db).await?;
            allowed
                .ok_or_else(|| AppError::forbidden("bot is not a member of this conversation"))?
        }
        (None, Some(username)) => open_bot_direct(&state.db, &bot.id, &username).await?,
        _ => {
            return Err(AppError::bad_request(
                "provide exactly one of conversation_id or recipient_username",
            ));
        }
    };
    let message = create_message(
        &state.db,
        NewMessage {
            conversation_id: &conversation_id,
            sender_kind: "bot",
            sender_id: &bot.id,
            body: input.body,
            attachment_ids: input.attachment_ids.unwrap_or_default(),
            urgent: input.urgent,
            attachment_owner: None,
            client_message_id: input.client_message_id,
        },
    )
    .await?;
    let _ = state.events.send(ConversationEvent {
        conversation_id: conversation_id.clone(),
        sender_id: bot.id,
        message: message.clone(),
    });
    dispatch_bark_notifications(state, conversation_id, None, message.clone());
    Ok(axum::Json(message))
}

#[derive(FromRow)]
struct BarkBinding {
    id: String,
    user_id: String,
    token_hash: String,
}

#[derive(Serialize, FromRow)]
struct BarkDevice {
    id: String,
    created_at: i64,
    updated_at: i64,
}

#[derive(Serialize)]
struct BarkNotificationSettings {
    base_url: String,
    devices: Vec<BarkDevice>,
    apns_configured: bool,
}

async fn bark_notification_settings(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<UserIdentity>,
) -> Result<axum::Json<BarkNotificationSettings>, AppError> {
    Ok(axum::Json(bark_settings_for(&state, &user.id).await?))
}

async fn reset_bark_binding(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<UserIdentity>,
) -> Result<axum::Json<BarkNotificationSettings>, AppError> {
    let mut transaction = state.db.begin().await?;
    sqlx::query("DELETE FROM bark_user_devices WHERE user_id=?")
        .bind(&user.id)
        .execute(&mut *transaction)
        .await?;
    sqlx::query("DELETE FROM bark_user_bindings WHERE user_id=?")
        .bind(&user.id)
        .execute(&mut *transaction)
        .await?;
    transaction.commit().await?;
    Ok(axum::Json(bark_settings_for(&state, &user.id).await?))
}

async fn revoke_bark_binding(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<UserIdentity>,
) -> Result<StatusCode, AppError> {
    let mut transaction = state.db.begin().await?;
    sqlx::query("DELETE FROM bark_user_devices WHERE user_id=?")
        .bind(&user.id)
        .execute(&mut *transaction)
        .await?;
    sqlx::query("DELETE FROM bark_user_bindings WHERE user_id=?")
        .bind(&user.id)
        .execute(&mut *transaction)
        .await?;
    transaction.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn delete_bark_device(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<UserIdentity>,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    let result = sqlx::query("DELETE FROM bark_user_devices WHERE id=? AND user_id=?")
        .bind(id)
        .bind(user.id)
        .execute(&state.db)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::not_found("Bark device was not found"));
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn bark_settings_for(
    state: &AppState,
    user_id: &str,
) -> Result<BarkNotificationSettings, AppError> {
    let (binding, capability) = ensure_bark_binding(&state.db, user_id).await?;
    let origin = meta(&state.db, "public_origin").await?;
    if origin.is_empty() {
        return Err(AppError::unavailable("public_origin is not configured"));
    }
    let devices = sqlx::query_as::<_, BarkDevice>(
        "SELECT id,created_at,updated_at FROM bark_user_devices WHERE user_id=? ORDER BY updated_at DESC",
    )
    .bind(&binding.user_id)
    .fetch_all(&state.db)
    .await?;
    Ok(BarkNotificationSettings {
        base_url: format!("{}/api/bark/b/{capability}", origin.trim_end_matches('/')),
        devices,
        apns_configured: state.bark.configured(),
    })
}

async fn bark_binding_secret(db: &SqlitePool) -> Result<String, AppError> {
    let candidate = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    sqlx::query("INSERT INTO app_meta(key,value) VALUES('bark_binding_secret',?) ON CONFLICT(key) DO NOTHING")
        .bind(candidate)
        .execute(db)
        .await?;
    meta(db, "bark_binding_secret").await
}

fn bark_capability(binding_id: &str, secret: &str) -> String {
    use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
    use ring::hmac;

    let key = hmac::Key::new(hmac::HMAC_SHA256, secret.as_bytes());
    let signature = URL_SAFE_NO_PAD.encode(hmac::sign(&key, binding_id.as_bytes()).as_ref());
    format!("{binding_id}.{signature}")
}

async fn ensure_bark_binding(
    db: &SqlitePool,
    user_id: &str,
) -> Result<(BarkBinding, String), AppError> {
    let secret = bark_binding_secret(db).await?;
    if let Some(binding) = sqlx::query_as::<_, BarkBinding>(
        "SELECT id,user_id,token_hash FROM bark_user_bindings WHERE user_id=?",
    )
    .bind(user_id)
    .fetch_optional(db)
    .await?
    {
        let capability = bark_capability(&binding.id, &secret);
        return Ok((binding, capability));
    }
    let id = Uuid::new_v4().to_string();
    let capability = bark_capability(&id, &secret);
    let now = chrono::Utc::now().timestamp();
    let token_hash = bark::hash_secret(&capability);
    sqlx::query("INSERT INTO bark_user_bindings(id,user_id,token_hash,created_at,updated_at) VALUES(?,?,?,?,?)")
        .bind(&id)
        .bind(user_id)
        .bind(&token_hash)
        .bind(now)
        .bind(now)
        .execute(db)
        .await?;
    Ok((
        BarkBinding {
            id,
            user_id: user_id.to_owned(),
            token_hash,
        },
        capability,
    ))
}

async fn bark_binding_for_capability(
    db: &SqlitePool,
    capability: &str,
) -> Result<Option<BarkBinding>, AppError> {
    let Some((id, _)) = capability.split_once('.') else {
        return Ok(None);
    };
    let Some(binding) = sqlx::query_as::<_, BarkBinding>(
        "SELECT id,user_id,token_hash FROM bark_user_bindings WHERE id=?",
    )
    .bind(id)
    .fetch_optional(db)
    .await?
    else {
        return Ok(None);
    };
    let secret = bark_binding_secret(db).await?;
    let expected = bark_capability(&binding.id, &secret);
    let token_hash = bark::hash_secret(capability);
    if expected != capability || binding.token_hash != token_hash {
        return Ok(None);
    }
    Ok(Some(binding))
}

async fn upsert_bark_device(
    db: &SqlitePool,
    user_id: &str,
    requested_key: &str,
    device_token: &str,
) -> Result<String, AppError> {
    let key = if requested_key.is_empty() {
        bark::new_device_key()
    } else {
        let owned: Option<i64> = sqlx::query_scalar(
            "SELECT 1 FROM bark_user_devices WHERE user_id=? AND device_key_hash=?",
        )
        .bind(user_id)
        .bind(bark::hash_secret(requested_key))
        .fetch_optional(db)
        .await?;
        if owned.is_some() {
            requested_key.to_owned()
        } else {
            bark::new_device_key()
        }
    };
    let now = chrono::Utc::now().timestamp();
    sqlx::query("INSERT INTO bark_user_devices(id,user_id,device_key_hash,device_token,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(device_token) DO UPDATE SET user_id=excluded.user_id,device_key_hash=excluded.device_key_hash,updated_at=excluded.updated_at")
        .bind(Uuid::new_v4().to_string())
        .bind(user_id)
        .bind(bark::hash_secret(&key))
        .bind(device_token)
        .bind(now)
        .bind(now)
        .execute(db)
        .await?;
    Ok(key)
}

async fn delete_bark_device_by_token(db: &SqlitePool, device_token: &str) -> Result<(), AppError> {
    sqlx::query("DELETE FROM bark_user_devices WHERE device_token=?")
        .bind(device_token)
        .execute(db)
        .await?;
    Ok(())
}

#[derive(Clone, FromRow)]
struct BarkNotificationDestination {
    user_id: String,
    device_token: String,
}

async fn bark_notification_destinations(
    db: &SqlitePool,
    conversation_id: &str,
) -> Result<Vec<BarkNotificationDestination>, sqlx::Error> {
    sqlx::query_as(
        "SELECT d.user_id,d.device_token FROM bark_user_devices d JOIN conversation_members cm ON cm.user_id=d.user_id WHERE cm.conversation_id=?",
    )
    .bind(conversation_id)
    .fetch_all(db)
    .await
}

fn bark_notification_recipients(
    destinations: Vec<BarkNotificationDestination>,
    sender_user_id: Option<&str>,
) -> Vec<BarkNotificationDestination> {
    destinations
        .into_iter()
        .filter(|destination| sender_user_id != Some(destination.user_id.as_str()))
        .collect()
}

fn dispatch_bark_notifications(
    state: AppState,
    conversation_id: String,
    sender_user_id: Option<String>,
    message: Message,
) {
    tokio::spawn(deliver_bark_notifications(
        state,
        conversation_id,
        sender_user_id,
        message,
    ));
}

async fn deliver_bark_notifications(
    state: AppState,
    conversation_id: String,
    sender_user_id: Option<String>,
    message: Message,
) {
    let destinations = bark_notification_destinations(&state.db, &conversation_id).await;
    let destinations = match destinations {
        Ok(destinations) => destinations,
        Err(error) => {
            tracing::error!(%error, "could not load Bark message notification devices");
            return;
        }
    };
    let title = format!("Linkit · {}", message.message.sender_name);
    let body = if message.message.body.is_empty() {
        "Sent an attachment".to_owned()
    } else {
        bark_notification_body(&message.message.body)
    };
    let public_origin = match meta(&state.db, "public_origin").await {
        Ok(origin) if !origin.is_empty() => origin,
        Ok(_) => {
            tracing::error!(
                "could not build Bark notification URL because public_origin is not configured"
            );
            return;
        }
        Err(error) => {
            tracing::error!(%error, "could not read public_origin for Bark notification URL");
            return;
        }
    };
    let url = bark_conversation_url(&public_origin, &conversation_id);
    let icon = bark_notification_icon(&state.db, &public_origin, &conversation_id, &message).await;
    let push = bark::PushInput::message(
        title,
        body,
        conversation_id,
        Some(message.message.id),
        url,
        icon,
        message.message.urgent,
    );
    for destination in bark_notification_recipients(destinations, sender_user_id.as_deref()) {
        match state.bark.deliver(&destination.device_token, &push).await {
            Ok(bark::Delivery::Delivered) => {}
            Ok(bark::Delivery::InvalidDeviceToken) => {
                if let Err(error) =
                    delete_bark_device_by_token(&state.db, &destination.device_token).await
                {
                    tracing::warn!(%error, "could not remove an invalid Bark device token");
                }
            }
            Err(error) => {
                tracing::warn!(user_id = %destination.user_id, %error, "Bark message notification failed")
            }
        }
    }
}

async fn bark_notification_icon(
    db: &SqlitePool,
    public_origin: &str,
    conversation_id: &str,
    message: &Message,
) -> String {
    let fallback = bark_default_icon_url(public_origin);
    let conversation: Option<(String, Option<String>)> = sqlx::query_as(
        "SELECT c.kind,CASE WHEN EXISTS(
            SELECT 1 FROM attachments a
            WHERE a.id=c.avatar_attachment_id AND a.media_type LIKE 'image/%'
         ) THEN c.avatar_attachment_id END
         FROM conversations c WHERE c.id=?",
    )
    .bind(conversation_id)
    .fetch_optional(db)
    .await
    .ok()
    .flatten();
    match conversation {
        Some((kind, Some(_))) if kind == "group" => {
            public_group_avatar_url(public_origin, conversation_id)
        }
        Some((kind, _)) if kind == "direct" && message.message.sender_kind == "user" => {
            let avatar: Option<(String, i64)> = sqlx::query_as(
                "SELECT p.avatar_attachment_id,p.updated_at FROM profiles p
                 JOIN attachments a ON a.id=p.avatar_attachment_id
                 WHERE p.user_id=? AND a.owner_user_id=p.user_id AND a.media_type LIKE 'image/%'",
            )
            .bind(&message.message.sender_id)
            .fetch_optional(db)
            .await
            .ok()
            .flatten();
            avatar
                .map(|(_, updated_at)| {
                    public_profile_avatar_url(public_origin, &message.message.sender_id, updated_at)
                })
                .unwrap_or(fallback)
        }
        _ => fallback,
    }
}

fn public_group_avatar_url(public_origin: &str, conversation_id: &str) -> String {
    let mut url = url::Url::parse(public_origin).expect("configured public origin is valid");
    url.path_segments_mut()
        .expect("configured public origin is a base URL")
        .extend(["api", "public", "conversations", conversation_id, "avatar"]);
    url.into()
}

fn bark_default_icon_url(public_origin: &str) -> String {
    format!("{}/linkit-logo.png", public_origin.trim_end_matches('/'))
}

fn bark_conversation_url(public_origin: &str, conversation_id: &str) -> String {
    format!(
        "{}/#/conversations/{}",
        public_origin.trim_end_matches('/'),
        bark_url_path_segment(conversation_id)
    )
}

fn bark_url_path_segment(value: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            encoded.push(byte as char);
        } else {
            encoded.push('%');
            encoded.push(HEX[(byte >> 4) as usize] as char);
            encoded.push(HEX[(byte & 0x0f) as usize] as char);
        }
    }
    encoded
}

fn bark_notification_body(body: &str) -> String {
    let mut end = 0;
    for (index, character) in body.char_indices() {
        let next = index + character.len_utf8();
        if next > BARK_NOTIFICATION_BODY_MAX_BYTES {
            break;
        }
        end = next;
    }
    body[..end].to_owned()
}

struct NewMessage<'a> {
    conversation_id: &'a str,
    sender_kind: &'a str,
    sender_id: &'a str,
    body: String,
    attachment_ids: Vec<String>,
    urgent: bool,
    attachment_owner: Option<&'a str>,
    client_message_id: Option<String>,
}

async fn create_message(db: &SqlitePool, input: NewMessage<'_>) -> Result<Message, AppError> {
    let NewMessage {
        conversation_id,
        sender_kind,
        sender_id,
        body,
        attachment_ids,
        urgent,
        attachment_owner,
        client_message_id,
    } = input;
    let client_message_id = client_message_id
        .map(|value| bounded(&value, "client_message_id", 200))
        .transpose()?
        .filter(|value| !value.trim().is_empty());
    let body = bounded(&body, "body", 10_000)?;
    if body.trim().is_empty() && attachment_ids.is_empty() {
        return Err(AppError::bad_request(
            "a message needs text or an attachment",
        ));
    }
    if let Some(client_message_id) = &client_message_id {
        let existing: Option<String> = sqlx::query_scalar("SELECT id FROM messages WHERE conversation_id=? AND sender_kind=? AND sender_id=? AND client_message_id=?")
            .bind(conversation_id).bind(sender_kind).bind(sender_id).bind(client_message_id).fetch_optional(db).await?;
        if let Some(id) = existing {
            return message(db, &id).await;
        }
    }
    let now = chrono::Utc::now().timestamp();
    let id = Uuid::new_v4().to_string();
    let mut tx = db.begin().await?;
    if let Some(owner) = attachment_owner {
        for attachment_id in &attachment_ids {
            let available: Option<String> = sqlx::query_scalar(
                "SELECT id FROM attachments WHERE id=? AND owner_user_id=? AND message_id IS NULL",
            )
            .bind(attachment_id)
            .bind(owner)
            .fetch_optional(&mut *tx)
            .await?;
            if available.is_none() {
                return Err(AppError::bad_request(
                    "attachment_ids must be your unattached uploads",
                ));
            }
        }
    } else if !attachment_ids.is_empty() {
        return Err(AppError::bad_request(
            "bot messages cannot attach user uploads",
        ));
    }
    sqlx::query("INSERT INTO message_sequences DEFAULT VALUES")
        .execute(&mut *tx)
        .await?;
    let sequence: i64 = sqlx::query_scalar("SELECT last_insert_rowid()")
        .fetch_one(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO messages(id,conversation_id,sender_kind,sender_id,body,urgent,created_at,sequence,client_message_id) VALUES(?,?,?,?,?,?,?,?,?)")
        .bind(&id)
        .bind(conversation_id)
        .bind(sender_kind)
        .bind(sender_id)
        .bind(body)
        .bind(urgent)
        .bind(now)
        .bind(sequence)
        .bind(client_message_id)
        .execute(&mut *tx)
        .await?;
    for attachment_id in attachment_ids {
        sqlx::query("UPDATE attachments SET message_id=? WHERE id=?")
            .bind(&id)
            .bind(attachment_id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    message(db, &id).await
}

fn message_cursor(created_at: i64, sequence: i64) -> String {
    format!("{created_at}:{sequence}")
}

fn parse_message_cursor(cursor: &str) -> Result<(i64, i64), AppError> {
    let (created_at, sequence) = cursor
        .split_once(':')
        .ok_or_else(|| AppError::bad_request("message cursor is invalid"))?;
    let created_at = created_at
        .parse()
        .map_err(|_| AppError::bad_request("message cursor is invalid"))?;
    let sequence = sequence
        .parse()
        .map_err(|_| AppError::bad_request("message cursor is invalid"))?;
    if sequence <= 0 {
        return Err(AppError::bad_request("message cursor is invalid"));
    }
    Ok((created_at, sequence))
}

async fn message_from_row(db: &SqlitePool, row: StoredMessage) -> Result<Message, AppError> {
    Ok(Message {
        cursor: message_cursor(row.created_at, row.sequence),
        attachments: attachments_for(db, &row.id).await?,
        message: row,
    })
}

async fn messages_for(
    db: &SqlitePool,
    conversation_id: &str,
    query: MessagePageQuery,
) -> Result<MessagePage, AppError> {
    let MessagePageQuery {
        before_cursor,
        after_cursor,
    } = query;
    if before_cursor.is_some() && after_cursor.is_some() {
        return Err(AppError::bad_request(
            "provide at most one of before_cursor or after_cursor",
        ));
    }

    enum PageDirection {
        Latest,
        Older,
        Newer,
    }

    let (mut rows, direction) = if let Some(cursor) = before_cursor {
        let (created_at, sequence) = parse_message_cursor(&cursor)?;
        let rows = sqlx::query_as("SELECT m.id,m.conversation_id,m.sender_kind,m.sender_id,COALESCE(p.display_name,b.name,m.sender_id) sender_name,(m.sender_kind='bot' AND b.id IS NULL) sender_deleted,m.body,m.urgent,m.created_at,m.sequence FROM messages m LEFT JOIN profiles p ON m.sender_kind='user' AND p.user_id=m.sender_id LEFT JOIN bots b ON m.sender_kind='bot' AND b.id=m.sender_id WHERE m.conversation_id=? AND (m.created_at<? OR (m.created_at=? AND m.sequence<?)) ORDER BY m.created_at DESC,m.sequence DESC LIMIT ?")
                .bind(conversation_id)
                .bind(created_at)
                .bind(created_at)
                .bind(sequence)
                .bind(MESSAGE_PAGE_SIZE + 1)
                .fetch_all(db)
                .await?;
        (rows, PageDirection::Older)
    } else if let Some(cursor) = after_cursor {
        let (created_at, sequence) = parse_message_cursor(&cursor)?;
        let rows = sqlx::query_as("SELECT m.id,m.conversation_id,m.sender_kind,m.sender_id,COALESCE(p.display_name,b.name,m.sender_id) sender_name,(m.sender_kind='bot' AND b.id IS NULL) sender_deleted,m.body,m.urgent,m.created_at,m.sequence FROM messages m LEFT JOIN profiles p ON m.sender_kind='user' AND p.user_id=m.sender_id LEFT JOIN bots b ON m.sender_kind='bot' AND b.id=m.sender_id WHERE m.conversation_id=? AND (m.created_at>? OR (m.created_at=? AND m.sequence>?)) ORDER BY m.created_at,m.sequence LIMIT ?")
                .bind(conversation_id)
                .bind(created_at)
                .bind(created_at)
                .bind(sequence)
                .bind(MESSAGE_PAGE_SIZE + 1)
                .fetch_all(db)
                .await?;
        (rows, PageDirection::Newer)
    } else {
        let rows = sqlx::query_as("SELECT m.id,m.conversation_id,m.sender_kind,m.sender_id,COALESCE(p.display_name,b.name,m.sender_id) sender_name,(m.sender_kind='bot' AND b.id IS NULL) sender_deleted,m.body,m.urgent,m.created_at,m.sequence FROM messages m LEFT JOIN profiles p ON m.sender_kind='user' AND p.user_id=m.sender_id LEFT JOIN bots b ON m.sender_kind='bot' AND b.id=m.sender_id WHERE m.conversation_id=? ORDER BY m.created_at DESC,m.sequence DESC LIMIT ?")
                .bind(conversation_id)
                .bind(MESSAGE_PAGE_SIZE + 1)
                .fetch_all(db)
                .await?;
        (rows, PageDirection::Latest)
    };
    let has_more = rows.len() as i64 > MESSAGE_PAGE_SIZE;
    rows.truncate(MESSAGE_PAGE_SIZE as usize);
    if matches!(direction, PageDirection::Latest | PageDirection::Older) {
        rows.reverse();
    }
    let mut messages = Vec::with_capacity(rows.len());
    for row in rows {
        messages.push(message_from_row(db, row).await?);
    }
    let first_cursor = messages.first().map(|message| message.cursor.clone());
    let last_cursor = messages.last().map(|message| message.cursor.clone());
    let (older_cursor, newer_cursor) = match direction {
        PageDirection::Latest => (has_more.then_some(first_cursor).flatten(), None),
        PageDirection::Older => (has_more.then_some(first_cursor).flatten(), last_cursor),
        PageDirection::Newer => (first_cursor, has_more.then_some(last_cursor).flatten()),
    };
    Ok(MessagePage {
        messages,
        older_cursor,
        newer_cursor,
    })
}

async fn message(db: &SqlitePool, id: &str) -> Result<Message, AppError> {
    let row: StoredMessage = sqlx::query_as("SELECT m.id,m.conversation_id,m.sender_kind,m.sender_id,COALESCE(p.display_name,b.name,m.sender_id) sender_name,(m.sender_kind='bot' AND b.id IS NULL) sender_deleted,m.body,m.urgent,m.created_at,m.sequence FROM messages m LEFT JOIN profiles p ON m.sender_kind='user' AND p.user_id=m.sender_id LEFT JOIN bots b ON m.sender_kind='bot' AND b.id=m.sender_id WHERE m.id=?").bind(id).fetch_optional(db).await?.ok_or_else(|| AppError::not_found("message not found"))?;
    message_from_row(db, row).await
}

async fn attachments_for(db: &SqlitePool, message_id: &str) -> Result<Vec<Attachment>, AppError> {
    Ok(sqlx::query_as("SELECT id,file_name,media_type,byte_size,created_at FROM attachments WHERE message_id=? ORDER BY created_at").bind(message_id).fetch_all(db).await?)
}

async fn conversation(db: &SqlitePool, id: &str, user_id: &str) -> Result<Conversation, AppError> {
    sqlx::query_as(CONVERSATION_QUERY)
        .bind(user_id)
        .bind(user_id)
        .bind(user_id)
        .bind(id)
        .bind(user_id)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| AppError::not_found("conversation not found"))
}

async fn require_member(
    db: &SqlitePool,
    conversation_id: &str,
    user_id: &str,
) -> Result<(), AppError> {
    let found: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?",
    )
    .bind(conversation_id)
    .bind(user_id)
    .fetch_optional(db)
    .await?;
    if found.is_none() {
        return Err(AppError::not_found("conversation not found"));
    }
    Ok(())
}

async fn require_group_owner(
    db: &SqlitePool,
    conversation_id: &str,
    user_id: &str,
) -> Result<(), AppError> {
    let found: Option<i64> = sqlx::query_scalar("SELECT 1 FROM conversations c JOIN conversation_members cm ON cm.conversation_id=c.id WHERE c.id=? AND c.kind='group' AND cm.user_id=? AND cm.role='owner'").bind(conversation_id).bind(user_id).fetch_optional(db).await?;
    if found.is_none() {
        return Err(AppError::forbidden(
            "only a group owner can manage membership",
        ));
    }
    Ok(())
}

async fn require_root(db: &SqlitePool, user_id: &str) -> Result<(), AppError> {
    if meta(db, "root_user_id").await? != user_id {
        return Err(AppError::forbidden(
            "only the Root User can access this administration endpoint",
        ));
    }
    Ok(())
}

fn sqlite_bytes(database_path: &FilePath) -> Result<u64, AppError> {
    let mut bytes = file_size(database_path)?;
    bytes += file_size(&database_path.with_extension("sqlite3-wal"))?;
    bytes += file_size(&database_path.with_extension("sqlite3-shm"))?;
    Ok(bytes)
}

fn file_size(path: &FilePath) -> Result<u64, AppError> {
    match std::fs::metadata(path) {
        Ok(metadata) => Ok(metadata.len()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(0),
        Err(error) => Err(error.into()),
    }
}

async fn add_member_by_username(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    conversation_id: &str,
    username: &str,
    now: i64,
) -> Result<(), AppError> {
    let user_id: Option<String> =
        sqlx::query_scalar("SELECT user_id FROM profiles WHERE username=?")
            .bind(username.trim())
            .fetch_optional(&mut **tx)
            .await?;
    let user_id = user_id.ok_or_else(|| AppError::not_found("user not found"))?;
    sqlx::query("INSERT INTO conversation_members(conversation_id,user_id,role,joined_at) VALUES(?,?,'member',?) ON CONFLICT DO NOTHING").bind(conversation_id).bind(user_id).bind(now).execute(&mut **tx).await?;
    Ok(())
}

async fn user_id_from_username(db: &SqlitePool, username: &str) -> Result<String, AppError> {
    sqlx::query_scalar("SELECT user_id FROM profiles WHERE username=?")
        .bind(username.trim())
        .fetch_optional(db)
        .await?
        .ok_or_else(|| AppError::not_found("user not found"))
}

async fn open_bot_direct(
    db: &SqlitePool,
    bot_id: &str,
    recipient_username: &str,
) -> Result<String, AppError> {
    let recipient = user_id_from_username(db, recipient_username).await?;
    let direct_key = format!("bot:{bot_id}:user:{recipient}");
    let now = chrono::Utc::now().timestamp();
    let id = Uuid::new_v4().to_string();
    let mut tx = db.begin().await?;
    sqlx::query("INSERT INTO conversations(id,kind,title,direct_key,created_by,created_at) VALUES(?,'direct','',?,?,?) ON CONFLICT(direct_key) DO NOTHING").bind(&id).bind(&direct_key).bind(&recipient).bind(now).execute(&mut *tx).await?;
    let actual_id: String = sqlx::query_scalar("SELECT id FROM conversations WHERE direct_key=?")
        .bind(&direct_key)
        .fetch_one(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO conversation_members(conversation_id,user_id,role,joined_at) VALUES(?,?,'member',?) ON CONFLICT DO NOTHING").bind(&actual_id).bind(&recipient).bind(now).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO conversation_bots(conversation_id,bot_id,added_at) VALUES(?,?,?) ON CONFLICT DO NOTHING").bind(&actual_id).bind(bot_id).bind(now).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(actual_id)
}

async fn bot_from_headers(db: &SqlitePool, headers: &HeaderMap) -> Result<Bot, AppError> {
    let token = bearer_token(headers)?;
    if !token.starts_with("sk-") {
        return Err(AppError::unauthorized("bot token must start with sk-"));
    }
    sqlx::query_as("SELECT id,owner_user_id,name,token_prefix,created_at,updated_at FROM bots WHERE token_hash=?").bind(token_hash(token)).fetch_optional(db).await?.ok_or_else(|| AppError::unauthorized("bot token is invalid"))
}

async fn meta(db: &SqlitePool, key: &str) -> Result<String, AppError> {
    sqlx::query_scalar("SELECT value FROM app_meta WHERE key=?")
        .bind(key)
        .fetch_one(db)
        .await
        .map_err(Into::into)
}

fn bearer_token(headers: &HeaderMap) -> Result<&str, AppError> {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::unauthorized("Bearer token is required"))
}

fn valid_username(value: &str) -> Result<String, AppError> {
    let value = value.trim();
    if !(3..=32).contains(&value.len())
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    {
        return Err(AppError::bad_request(
            "username must be 3-32 letters, numbers, underscores, or hyphens",
        ));
    }
    Ok(value.to_owned())
}

fn nonempty(value: &str, field: &str, max: usize) -> Result<String, AppError> {
    let value = bounded(value, field, max)?;
    if value.trim().is_empty() {
        return Err(AppError::bad_request(format!("{field} is required")));
    }
    Ok(value)
}

fn bounded(value: &str, field: &str, max: usize) -> Result<String, AppError> {
    if value.chars().count() > max {
        return Err(AppError::bad_request(format!(
            "{field} must be at most {max} characters"
        )));
    }
    Ok(value.trim().to_owned())
}

fn valid_origin(value: &str, label: &str) -> Result<String, AppError> {
    let parsed = url::Url::parse(value.trim())
        .map_err(|_| AppError::bad_request(format!("{label} must be a valid URL")))?;
    let local = matches!(
        parsed.host_str(),
        Some("localhost") | Some("127.0.0.1") | Some("::1")
    );
    if !matches!(parsed.scheme(), "https" | "http")
        || parsed.host_str().is_none()
        || (parsed.scheme() == "http" && !local)
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err(AppError::bad_request(format!(
            "{label} must be an HTTPS origin"
        )));
    }
    Ok(parsed.as_str().trim_end_matches('/').to_owned())
}

fn valid_audience(value: &str) -> Result<String, AppError> {
    let value = value.trim().to_ascii_lowercase();
    if value.is_empty() || value.contains(['/', ':', '?', '#', '@']) {
        return Err(AppError::bad_request("auth_audience must be a hostname"));
    }
    Ok(value)
}

async fn auth_audiences(db: &SqlitePool) -> Result<Vec<String>, AppError> {
    let audience = meta(db, "auth_audience").await?;
    let trusted = meta(db, "auth_trusted_audiences")
        .await
        .unwrap_or_else(|_| "[]".to_owned());
    let values = serde_json::from_str::<Vec<String>>(&trusted).unwrap_or_default();
    normalize_trusted_audiences(&audience, values)
}

fn normalize_trusted_audiences(
    primary: &str,
    trusted: Vec<String>,
) -> Result<Vec<String>, AppError> {
    let mut audiences = vec![valid_audience(primary)?];
    for value in trusted {
        let audience = valid_audience(&value)?;
        if !audiences.contains(&audience) {
            audiences.push(audience);
        }
    }
    Ok(audiences)
}

fn direct_key(first: &str, second: &str) -> String {
    if first < second {
        format!("user:{first}:user:{second}")
    } else {
        format!("user:{second}:user:{first}")
    }
}
fn new_bot_token() -> String {
    format!(
        "sk-{}",
        rand::rng()
            .sample_iter(&Alphanumeric)
            .take(40)
            .map(char::from)
            .collect::<String>()
    )
}
fn token_hash(token: &str) -> String {
    format!("{:x}", Sha256::digest(token.as_bytes()))
}

include!(concat!(env!("OUT_DIR"), "/embedded_assets_fingerprint.rs"));

#[derive(RustEmbed)]
#[folder = "web/dist/"]
struct Assets;

async fn static_asset(uri: axum::http::Uri) -> Response {
    if uri.path().starts_with("/api/") || uri.path().starts_with("/bot/") {
        return StatusCode::NOT_FOUND.into_response();
    }
    let requested = uri.path().trim_start_matches('/');
    let path = if requested.is_empty() {
        "index.html"
    } else {
        requested
    };
    let asset = Assets::get(path);
    let fallback = asset.is_none();
    match asset.or_else(|| Assets::get("index.html")) {
        Some(asset) => {
            let mime = if fallback || path == "index.html" {
                "text/html; charset=utf-8"
            } else {
                match path.rsplit('.').next() {
                    Some("js") => "text/javascript",
                    Some("css") => "text/css",
                    Some("svg") => "image/svg+xml",
                    Some("png") => "image/png",
                    Some("ico") => "image/x-icon",
                    _ => "application/octet-stream",
                }
            };
            ([(header::CONTENT_TYPE, mime)], asset.data).into_response()
        }
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    fn test_state(db: SqlitePool) -> AppState {
        test_state_with_bark(db, bark::BarkGateway::test_gateway())
    }

    fn test_state_with_bark(db: SqlitePool, bark: bark::BarkGateway) -> AppState {
        let (events, _) = tokio::sync::broadcast::channel(1);
        AppState {
            db,
            auth: AuthManager::default(),
            uploads: Arc::new(std::env::temp_dir()),
            bark,
            database_path: Arc::new(std::env::temp_dir().join("linkit-test.sqlite3")),
            system_monitor: Arc::new(Mutex::new(SystemMonitor::new())),
            events,
        }
    }

    fn canonical_avatar_png_fixture() -> Vec<u8> {
        let image = image::RgbaImage::from_pixel(4, 2, image::Rgba([255, 0, 0, 128]));
        let mut bytes = Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(image)
            .write_to(&mut bytes, image::ImageFormat::Png)
            .unwrap();
        bytes.into_inner()
    }

    #[test]
    fn trusted_auth_audiences_include_primary_without_duplicates() {
        assert_eq!(
            normalize_trusted_audiences(
                "linkit.ntnl.io",
                vec!["1ex.ntnl.io".to_owned(), "linkit.ntnl.io".to_owned()],
            )
            .unwrap(),
            vec!["linkit.ntnl.io", "1ex.ntnl.io"],
        );
        assert!(
            normalize_trusted_audiences("linkit.ntnl.io", vec!["https://evil.example".to_owned()])
                .is_err()
        );
    }

    #[tokio::test]
    async fn signed_in_api_cors_preflight_allows_bearer_without_credentials() {
        let app = router(test_state(db::connect_memory().await.unwrap()));
        let response = app
            .oneshot(
                axum::http::Request::builder()
                    .method("OPTIONS")
                    .uri("/api/me")
                    .header(header::ORIGIN, "https://1ex.ntnl.io")
                    .header(header::ACCESS_CONTROL_REQUEST_METHOD, "GET")
                    .header(header::ACCESS_CONTROL_REQUEST_HEADERS, "authorization")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
                .unwrap(),
            "*"
        );
        assert!(
            response
                .headers()
                .get(header::ACCESS_CONTROL_ALLOW_CREDENTIALS)
                .is_none()
        );
        assert!(
            response.headers()[header::ACCESS_CONTROL_ALLOW_HEADERS]
                .to_str()
                .unwrap()
                .to_ascii_lowercase()
                .contains("authorization")
        );
    }

    #[tokio::test]
    async fn user_search_requires_bearer_authentication() {
        let app = router(test_state(db::connect_memory().await.unwrap()));
        let response = app
            .oneshot(
                axum::http::Request::builder()
                    .uri("/api/users/search?query=alice")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn user_search_is_bounded_case_insensitive_and_exposes_only_picker_fields() {
        let pool = db::connect_memory().await.unwrap();
        sqlx::query(
            "UPDATE app_meta SET value='https://linkit.example.test' WHERE key='public_origin'",
        )
        .execute(&pool)
        .await
        .unwrap();
        for (id, username, display_name) in [
            ("1", "alice", "Alice"),
            ("2", "albert", "Alicia"),
            ("3", "alex", "Alex"),
            ("4", "alina", "Alina"),
            ("5", "albertine", "Alberta"),
            ("6", "aloysius", "Aloysius"),
            ("7", "bob", "ALPHA"),
        ] {
            sqlx::query("INSERT INTO users(id,created_at) VALUES(?,0)")
                .bind(id)
                .execute(&pool)
                .await
                .unwrap();
            sqlx::query("INSERT INTO profiles(user_id,username,display_name,motto,updated_at) VALUES(?,?,?,'private motto',0)")
                .bind(id)
                .bind(username)
                .bind(display_name)
                .execute(&pool)
                .await
                .unwrap();
        }
        sqlx::query("UPDATE profiles SET avatar_attachment_id='avatar' WHERE user_id='1'")
            .execute(&pool)
            .await
            .unwrap();

        let axum::Json(matches) = search_users(
            State(test_state(pool.clone())),
            Query(UserQuery {
                query: Some("  AL  ".to_owned()),
            }),
        )
        .await
        .unwrap();
        assert_eq!(matches.len(), 5);
        assert_eq!(matches[0].username, "albert");
        let axum::Json(nickname_matches) = search_users(
            State(test_state(pool.clone())),
            Query(UserQuery {
                query: Some("alp".to_owned()),
            }),
        )
        .await
        .unwrap();
        assert_eq!(nickname_matches.len(), 1);
        assert_eq!(nickname_matches[0].display_name, "ALPHA");
        let payload = serde_json::to_value(&matches).unwrap();
        assert!(payload[0].get("motto").is_none());
        assert!(payload[0].get("avatar_attachment_id").is_none());
        assert_eq!(
            matches
                .iter()
                .find(|user| user.user_id == "1")
                .unwrap()
                .avatar_url
                .as_deref(),
            Some("https://linkit.example.test/api/public/profiles/1/avatar?v=0")
        );

        let axum::Json(empty) = search_users(
            State(test_state(pool)),
            Query(UserQuery {
                query: Some("   ".to_owned()),
            }),
        )
        .await
        .unwrap();
        assert!(empty.is_empty());
    }

    #[test]
    fn canonical_avatar_center_crops_and_preserves_alpha() {
        let normalized = canonical_avatar(&canonical_avatar_png_fixture(), "image/png").unwrap();
        let image = ImageReader::new(Cursor::new(normalized))
            .with_guessed_format()
            .unwrap()
            .decode()
            .unwrap();
        assert_eq!((image.width(), image.height()), (AVATAR_EDGE, AVATAR_EDGE));
        assert!(image.color().has_alpha());
    }

    #[tokio::test]
    async fn public_profile_lookup_exposes_only_display_fields_and_a_safe_avatar_url() {
        let pool = db::connect_memory().await.unwrap();
        sqlx::query(
            "UPDATE app_meta SET value='https://linkit.example.test' WHERE key='public_origin'",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO users(id,created_at) VALUES('user /?#',0)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO profiles(user_id,username,display_name,motto,avatar_attachment_id,updated_at) VALUES('user /?#','alice','Alice','private motto','avatar',0)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO attachments(id,owner_user_id,file_name,media_type,byte_size,storage_name,created_at) VALUES('avatar','user /?#','avatar.png','image/png',1,'public-profile-avatar',0)")
            .execute(&pool)
            .await
            .unwrap();

        let profile = public_profile(State(test_state(pool)), Path("user /?#".into()))
            .await
            .unwrap()
            .0;
        let payload = serde_json::to_value(&profile).unwrap();
        assert_eq!(payload["user_id"], "user /?#");
        assert_eq!(payload["username"], "alice");
        assert_eq!(payload["display_name"], "Alice");
        assert_eq!(
            payload["avatar_url"],
            "https://linkit.example.test/api/public/profiles/user%20%2F%3F%23/avatar?v=0"
        );
        assert!(payload.get("motto").is_none());
        assert!(payload.get("avatar_attachment_id").is_none());
    }

    #[tokio::test]
    async fn public_profile_lookup_returns_null_without_an_avatar_and_404_for_unknown_users() {
        let pool = db::connect_memory().await.unwrap();
        sqlx::query(
            "UPDATE app_meta SET value='https://linkit.example.test' WHERE key='public_origin'",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO users(id,created_at) VALUES('alice',0)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO profiles(user_id,username,display_name,motto,updated_at) VALUES('alice','alice','Alice','',0)")
            .execute(&pool)
            .await
            .unwrap();

        let profile = public_profile(State(test_state(pool.clone())), Path("alice".into()))
            .await
            .unwrap()
            .0;
        assert!(profile.avatar_url.is_none());
        let error = public_profile(State(test_state(pool)), Path("unknown".into()))
            .await
            .unwrap_err();
        assert_eq!(error.status, StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn public_profile_avatar_serves_only_the_profile_image_attachment() {
        let pool = db::connect_memory().await.unwrap();
        sqlx::query("INSERT INTO users(id,created_at) VALUES('alice',0),('bob',0)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO profiles(user_id,username,display_name,motto,avatar_attachment_id,updated_at) VALUES('alice','alice','Alice','', 'avatar',0)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO attachments(id,owner_user_id,file_name,media_type,byte_size,storage_name,created_at) VALUES('avatar','alice','avatar.png','image/png',1,'linkit-public-avatar-test',0),('private','bob','private.png','image/png',1,'linkit-private-avatar-test',0)")
            .execute(&pool)
            .await
            .unwrap();
        let uploads = std::env::temp_dir().join(Uuid::new_v4().to_string());
        std::fs::create_dir(&uploads).unwrap();
        std::fs::write(uploads.join("linkit-public-avatar-test"), [7_u8]).unwrap();
        std::fs::write(uploads.join("linkit-private-avatar-test"), [9_u8]).unwrap();
        let mut state = test_state(pool);
        state.uploads = Arc::new(uploads.clone());

        let response = public_profile_avatar(State(state.clone()), Path("alice".into()))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response
                .into_body()
                .collect()
                .await
                .unwrap()
                .to_bytes()
                .as_ref(),
            [7_u8]
        );
        sqlx::query("UPDATE profiles SET avatar_attachment_id='private' WHERE user_id='alice'")
            .execute(&state.db)
            .await
            .unwrap();
        let error = public_profile_avatar(State(state), Path("alice".into()))
            .await
            .unwrap_err();
        assert_eq!(error.status, StatusCode::NOT_FOUND);
        std::fs::remove_dir_all(uploads).unwrap();
    }

    #[test]
    fn direct_key_is_stable_for_both_members() {
        assert_eq!(direct_key("a", "b"), direct_key("b", "a"));
    }

    #[test]
    fn bot_tokens_have_an_unambiguous_public_prefix() {
        assert!(new_bot_token().starts_with("sk-"));
    }

    #[test]
    fn embedded_assets_do_not_include_pwa_manifest_or_service_worker() {
        assert!(Assets::get("manifest.webmanifest").is_none());
        assert!(Assets::get("sw.js").is_none());
    }

    #[tokio::test]
    async fn migration_removes_browser_notification_subscription_storage() {
        let db = db::connect_memory().await.unwrap();
        let exists: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'notification_subscriptions'",
        )
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(exists, 0);
    }

    #[tokio::test]
    async fn migration_adds_urgent_messages_with_a_false_default() {
        let db = db::connect_memory().await.unwrap();
        let default_value: String = sqlx::query_scalar(
            "SELECT dflt_value FROM pragma_table_info('messages') WHERE name = 'urgent'",
        )
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(default_value, "0");
    }

    #[tokio::test]
    async fn urgent_message_state_is_persisted_for_user_and_bot_messages() {
        let db = db::connect_memory().await.unwrap();
        sqlx::query("INSERT INTO users(id,created_at) VALUES('alice',0)")
            .execute(&db)
            .await
            .unwrap();
        sqlx::query("INSERT INTO conversations(id,kind,title,created_by,created_at) VALUES('conversation','direct','', 'alice',0)")
            .execute(&db)
            .await
            .unwrap();
        let urgent = create_message(
            &db,
            NewMessage {
                conversation_id: "conversation",
                sender_kind: "user",
                sender_id: "alice",
                body: "urgent".to_owned(),
                attachment_ids: Vec::new(),
                urgent: true,
                attachment_owner: Some("alice"),
                client_message_id: None,
            },
        )
        .await
        .unwrap();
        let ordinary = create_message(
            &db,
            NewMessage {
                conversation_id: "conversation",
                sender_kind: "bot",
                sender_id: "bot",
                body: "ordinary".to_owned(),
                attachment_ids: Vec::new(),
                urgent: false,
                attachment_owner: None,
                client_message_id: None,
            },
        )
        .await
        .unwrap();
        assert!(urgent.message.urgent);
        assert!(!ordinary.message.urgent);
        let page = messages_for(
            &db,
            "conversation",
            MessagePageQuery {
                before_cursor: None,
                after_cursor: None,
            },
        )
        .await
        .unwrap();
        assert_eq!(page.messages.len(), 2);
        assert!(page.messages.iter().any(|message| message.message.urgent));
    }

    #[test]
    fn bark_conversation_url_uses_the_configured_origin_and_hash_route() {
        assert_eq!(
            bark_conversation_url("https://linkit.test", "conversation"),
            "https://linkit.test/#/conversations/conversation"
        );
        assert_eq!(
            bark_conversation_url("https://linkit.test/", "conversation /?#"),
            "https://linkit.test/#/conversations/conversation%20%2F%3F%23"
        );
    }

    #[test]
    fn bark_notification_body_stays_within_the_apns_payload_budget() {
        let body = "中".repeat(BARK_NOTIFICATION_BODY_MAX_BYTES);
        let shortened = bark_notification_body(&body);
        assert!(shortened.len() <= BARK_NOTIFICATION_BODY_MAX_BYTES);
        assert!(shortened.is_char_boundary(shortened.len()));
    }

    async fn bark_test_state() -> (AppState, Router, String, String) {
        let db = db::connect_memory().await.unwrap();
        for user_id in ["alice", "bob"] {
            sqlx::query("INSERT INTO users(id,created_at) VALUES(?,0)")
                .bind(user_id)
                .execute(&db)
                .await
                .unwrap();
        }
        sqlx::query("UPDATE app_meta SET value='https://linkit.test' WHERE key='public_origin'")
            .execute(&db)
            .await
            .unwrap();
        let state = test_state(db);
        let alice = bark_settings_for(&state, "alice").await.unwrap();
        let bob = bark_settings_for(&state, "bob").await.unwrap();
        let app = router(state.clone());
        (state, app, alice.base_url, bob.base_url)
    }

    #[tokio::test]
    async fn bark_base_url_binds_registration_to_its_user() {
        let (state, app, alice_base, bob_base) = bark_test_state().await;
        assert_ne!(alice_base, bob_base);
        let ping = app
            .clone()
            .oneshot(
                axum::http::Request::builder()
                    .uri(format!("{alice_base}/ping"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(ping.status(), StatusCode::OK);
        let registered = app
            .oneshot(
                axum::http::Request::builder()
                    .uri(format!(
                        "{alice_base}/register?devicetoken=alice-device-token"
                    ))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(registered.status(), StatusCode::OK);
        let devices: Vec<String> =
            sqlx::query_scalar("SELECT user_id FROM bark_user_devices ORDER BY user_id")
                .fetch_all(&state.db)
                .await
                .unwrap();
        assert_eq!(devices, ["alice"]);
    }

    #[tokio::test]
    async fn unknown_bark_capability_never_registers_a_device() {
        let (state, app, _, _) = bark_test_state().await;
        let response = app
            .oneshot(
                axum::http::Request::builder()
                    .uri("/api/bark/b/not-a-real-capability/register?devicetoken=unknown-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM bark_user_devices")
            .fetch_one(&state.db)
            .await
            .unwrap();
        assert_eq!(count, 0);
    }

    #[tokio::test]
    async fn bark_deleted_token_unbinds_its_device() {
        let (state, app, base, _) = bark_test_state().await;
        let registered = app
            .clone()
            .oneshot(
                axum::http::Request::builder()
                    .uri(format!("{base}/register?devicetoken=alice-device-token"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let payload = registered.into_body().collect().await.unwrap().to_bytes();
        let key = serde_json::from_slice::<Value>(&payload).unwrap()["data"]["key"]
            .as_str()
            .unwrap()
            .to_owned();
        let removed = app
            .oneshot(
                axum::http::Request::builder()
                    .uri(format!("{base}/register?key={key}&devicetoken=deleted"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(removed.status(), StatusCode::OK);
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM bark_user_devices")
            .fetch_one(&state.db)
            .await
            .unwrap();
        assert_eq!(count, 0);
    }

    #[tokio::test]
    async fn resetting_a_bark_binding_invalidates_the_old_base_url() {
        let (state, app, base, _) = bark_test_state().await;
        let user = UserIdentity {
            id: "alice".to_owned(),
        };
        let reset = reset_bark_binding(State(state), axum::Extension(user))
            .await
            .unwrap()
            .0;
        assert_ne!(reset.base_url, base);
        let response = app
            .oneshot(
                axum::http::Request::builder()
                    .uri(format!("{base}/ping"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn a_user_cannot_revoke_another_users_bark_device() {
        let (state, _, _, bob_base) = bark_test_state().await;
        let bob = bark_binding_for_capability(&state.db, bob_base.rsplit('/').next().unwrap())
            .await
            .unwrap()
            .unwrap();
        upsert_bark_device(&state.db, &bob.user_id, "", "bob-device-token")
            .await
            .unwrap();
        let device_id: String = sqlx::query_scalar(
            "SELECT id FROM bark_user_devices WHERE device_token='bob-device-token'",
        )
        .fetch_one(&state.db)
        .await
        .unwrap();
        let error = delete_bark_device(
            State(state.clone()),
            axum::Extension(UserIdentity {
                id: "alice".to_owned(),
            }),
            Path(device_id),
        )
        .await
        .unwrap_err();
        assert_eq!(error.status, StatusCode::NOT_FOUND);
        let remaining: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM bark_user_devices")
            .fetch_one(&state.db)
            .await
            .unwrap();
        assert_eq!(remaining, 1);
    }

    #[tokio::test]
    async fn bark_v1_and_v2_push_routes_are_not_exposed() {
        let (_, app, _, _) = bark_test_state().await;
        for path in [
            "/api/bark/push",
            "/api/bark/key/body",
            "/api/bark/key/title/body",
        ] {
            let response = app
                .clone()
                .oneshot(
                    axum::http::Request::builder()
                        .uri(path)
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::NOT_FOUND, "{path}");
        }
    }

    #[tokio::test]
    async fn bark_notifications_select_only_conversation_members_and_skip_the_sender() {
        let db = db::connect_memory().await.unwrap();
        for user_id in ["alice", "bob", "carol"] {
            sqlx::query("INSERT INTO users(id,created_at) VALUES(?,0)")
                .bind(user_id)
                .execute(&db)
                .await
                .unwrap();
        }
        sqlx::query("INSERT INTO conversations(id,kind,title,created_by,created_at) VALUES('conversation','group','Test','alice',0)")
            .execute(&db)
            .await
            .unwrap();
        for user_id in ["alice", "bob"] {
            sqlx::query("INSERT INTO conversation_members(conversation_id,user_id,role,joined_at) VALUES('conversation',?,'member',0)")
                .bind(user_id)
                .execute(&db)
                .await
                .unwrap();
        }
        for (user_id, token) in [
            ("alice", "alice-token"),
            ("bob", "bob-token"),
            ("carol", "carol-token"),
        ] {
            sqlx::query("INSERT INTO bark_user_devices(id,user_id,device_key_hash,device_token,created_at,updated_at) VALUES(?,?,?,?,0,0)")
                .bind(Uuid::new_v4().to_string())
                .bind(user_id)
                .bind(bark::hash_secret(token))
                .bind(token)
                .execute(&db)
                .await
                .unwrap();
        }
        let destinations = bark_notification_destinations(&db, "conversation")
            .await
            .unwrap();
        let recipients = bark_notification_recipients(destinations, Some("alice"));
        assert_eq!(recipients.len(), 1);
        assert_eq!(recipients[0].user_id, "bob");
        assert_eq!(recipients[0].device_token, "bob-token");
    }

    #[test]
    fn bark_request_paths_are_redacted_from_tracing() {
        assert_eq!(
            request_log_path("/api/bark/key/body"),
            "/api/bark/[redacted]"
        );
        assert_eq!(request_log_path("/api/health"), "/api/health");
    }

    #[tokio::test]
    async fn messages_are_paged_in_both_directions_with_stable_cursors() {
        let pool = db::connect_memory().await.unwrap();
        sqlx::query("INSERT INTO users(id,created_at) VALUES('alice',0)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO conversations(id,kind,title,created_by,created_at) VALUES('conversation','group','Test','alice',0)")
            .execute(&pool)
            .await
            .unwrap();
        for sequence in 1..=105 {
            sqlx::query("INSERT INTO message_sequences(sequence) VALUES(?)")
                .bind(sequence)
                .execute(&pool)
                .await
                .unwrap();
            sqlx::query("INSERT INTO messages(id,conversation_id,sender_kind,sender_id,body,created_at,sequence) VALUES(?, 'conversation', 'user', 'alice', ?, 1, ?)")
                .bind(format!("message-{sequence}"))
                .bind(format!("Message {sequence}"))
                .bind(sequence)
                .execute(&pool)
                .await
                .unwrap();
        }

        let latest = messages_for(
            &pool,
            "conversation",
            MessagePageQuery {
                before_cursor: None,
                after_cursor: None,
            },
        )
        .await
        .unwrap();
        assert_eq!(latest.messages.len(), 50);
        assert_eq!(latest.messages.first().unwrap().message.body, "Message 56");
        assert_eq!(latest.messages.last().unwrap().message.body, "Message 105");

        let middle = messages_for(
            &pool,
            "conversation",
            MessagePageQuery {
                before_cursor: latest.older_cursor,
                after_cursor: None,
            },
        )
        .await
        .unwrap();
        assert_eq!(middle.messages.len(), 50);
        assert_eq!(middle.messages.first().unwrap().message.body, "Message 6");
        assert_eq!(middle.messages.last().unwrap().message.body, "Message 55");

        let oldest = messages_for(
            &pool,
            "conversation",
            MessagePageQuery {
                before_cursor: middle.older_cursor,
                after_cursor: None,
            },
        )
        .await
        .unwrap();
        assert_eq!(oldest.messages.len(), 5);
        assert_eq!(oldest.messages.first().unwrap().message.body, "Message 1");
        assert_eq!(oldest.messages.last().unwrap().message.body, "Message 5");

        let forward = messages_for(
            &pool,
            "conversation",
            MessagePageQuery {
                before_cursor: None,
                after_cursor: Some(oldest.messages.last().unwrap().cursor.clone()),
            },
        )
        .await
        .unwrap();
        assert_eq!(forward.messages.len(), 50);
        assert_eq!(forward.messages.first().unwrap().message.body, "Message 6");
        assert_eq!(forward.messages.last().unwrap().message.body, "Message 55");
    }

    #[test]
    fn malformed_message_cursor_is_rejected() {
        assert_eq!(
            parse_message_cursor("not-a-cursor").unwrap_err().status,
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            parse_message_cursor("1:0").unwrap_err().status,
            StatusCode::BAD_REQUEST
        );
    }

    #[tokio::test]
    async fn system_overview_is_limited_to_the_configured_root_user() {
        let pool = db::connect_memory().await.unwrap();
        sqlx::query("UPDATE app_meta SET value=? WHERE key='root_user_id'")
            .bind("root-user")
            .execute(&pool)
            .await
            .unwrap();
        require_root(&pool, "root-user").await.unwrap();
        assert_eq!(
            require_root(&pool, "ordinary-user")
                .await
                .unwrap_err()
                .status,
            StatusCode::FORBIDDEN
        );
    }

    #[tokio::test]
    async fn bark_notification_users_include_only_bound_profiles_without_secrets() {
        let pool = db::connect_memory().await.unwrap();
        for (id, username, display_name) in [
            ("alice", "alice", "Alice"),
            ("bob", "bob", "Bob"),
            ("carol", "carol", "Carol"),
        ] {
            sqlx::query("INSERT INTO users(id,created_at) VALUES(?,0)")
                .bind(id)
                .execute(&pool)
                .await
                .unwrap();
            sqlx::query("INSERT INTO profiles(user_id,username,display_name,motto,updated_at) VALUES(?,?,?,'',0)")
                .bind(id)
                .bind(username)
                .bind(display_name)
                .execute(&pool)
                .await
                .unwrap();
        }
        for (id, user_id, updated_at) in [
            ("alice-device", "alice", 10_i64),
            ("bob-device-1", "bob", 20_i64),
            ("bob-device-2", "bob", 30_i64),
        ] {
            sqlx::query("INSERT INTO bark_user_devices(id,user_id,device_key_hash,device_token,created_at,updated_at) VALUES(?,?,?, ?,0,?)")
                .bind(id)
                .bind(user_id)
                .bind(format!("key-{id}"))
                .bind(format!("token-{id}"))
                .bind(updated_at)
                .execute(&pool)
                .await
                .unwrap();
        }

        let users = list_bark_notification_users(&pool).await.unwrap();
        assert_eq!(users.len(), 2);
        assert_eq!(users[0].display_name, "Bob");
        assert_eq!(users[0].username, "bob");
        assert_eq!(users[0].device_count, 2);
        assert_eq!(users[0].last_device_updated_at, 30);
        assert_eq!(users[1].username, "alice");
        assert_eq!(users[1].device_count, 1);
        let payload = serde_json::to_value(&users).unwrap();
        assert!(payload.pointer("/0/device_token").is_none());
        assert!(payload.pointer("/0/base_url").is_none());
        assert!(payload.pointer("/0/capability").is_none());
    }

    #[tokio::test]
    async fn bark_notification_users_are_limited_to_root() {
        let pool = db::connect_memory().await.unwrap();
        sqlx::query("UPDATE app_meta SET value=? WHERE key='root_user_id'")
            .bind("root-user")
            .execute(&pool)
            .await
            .unwrap();
        let result = bark_notification_users(
            State(test_state(pool)),
            axum::Extension(UserIdentity {
                id: "ordinary-user".into(),
            }),
        )
        .await;
        assert!(result.is_err());
        assert_eq!(result.err().unwrap().status, StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn direct_conversations_include_the_other_participant_name() {
        let pool = db::connect_memory().await.unwrap();
        for (id, username, display_name) in [("alice", "alice", "Alice"), ("bob", "bob", "Bob")] {
            sqlx::query("INSERT INTO users(id,created_at) VALUES(?,0)")
                .bind(id)
                .execute(&pool)
                .await
                .unwrap();
            sqlx::query("INSERT INTO profiles(user_id,username,display_name,motto,avatar_attachment_id,updated_at) VALUES(?,?,?,'',?,0)")
                .bind(id)
                .bind(username)
                .bind(display_name)
                .bind((id == "bob").then_some("bob-avatar"))
                .execute(&pool)
                .await
                .unwrap();
        }
        sqlx::query("INSERT INTO conversations(id,kind,title,direct_key,created_by,created_at) VALUES('direct','direct','','alice:bob','alice',0)")
            .execute(&pool)
            .await
            .unwrap();
        for user_id in ["alice", "bob"] {
            sqlx::query("INSERT INTO conversation_members(conversation_id,user_id,role,joined_at) VALUES('direct',?,'member',0)")
                .bind(user_id)
                .execute(&pool)
                .await
                .unwrap();
        }

        let direct = conversation(&pool, "direct", "alice").await.unwrap();

        assert_eq!(direct.counterpart_name.as_deref(), Some("Bob"));
        assert_eq!(
            direct.counterpart_avatar_attachment_id.as_deref(),
            Some("bob-avatar")
        );
    }

    #[tokio::test]
    async fn deleting_a_bot_keeps_its_messages_and_marks_the_sender_deleted() {
        let pool = db::connect_memory().await.unwrap();
        sqlx::query("INSERT INTO users(id,created_at) VALUES('owner',0)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO bots(id,owner_user_id,name,token_prefix,token_hash,created_at,updated_at) VALUES('bot','owner','Support Bot','sk-support','hash',0,0)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO conversations(id,kind,title,created_by,created_at) VALUES('conversation','group','Support','owner',0)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO conversation_bots(conversation_id,bot_id,added_at) VALUES('conversation','bot',0)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO message_sequences(sequence) VALUES(1)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO messages(id,conversation_id,sender_kind,sender_id,body,created_at,sequence) VALUES('message','conversation','bot','bot','I can help',0,1)")
            .execute(&pool)
            .await
            .unwrap();

        delete_owned_bot(&pool, "bot", "owner").await.unwrap();

        let message_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM messages WHERE id='message'")
                .fetch_one(&pool)
                .await
                .unwrap();
        let group_membership_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM conversation_bots WHERE bot_id='bot'")
                .fetch_one(&pool)
                .await
                .unwrap();
        let messages = messages_for(
            &pool,
            "conversation",
            MessagePageQuery {
                before_cursor: None,
                after_cursor: None,
            },
        )
        .await
        .unwrap();

        assert_eq!(message_count, 1);
        assert_eq!(group_membership_count, 0);
        assert!(messages.messages[0].message.sender_deleted);
    }

    #[tokio::test]
    async fn migration_adds_group_avatar_column() {
        let pool = db::connect_memory().await.unwrap();
        let columns =
            sqlx::query_scalar::<_, String>("SELECT name FROM pragma_table_info('conversations')")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert!(
            columns
                .iter()
                .any(|column| column == "avatar_attachment_id")
        );
    }

    #[tokio::test]
    async fn group_owner_can_rename_a_group_but_members_and_direct_conversations_cannot() {
        let pool = db::connect_memory().await.unwrap();
        for user_id in ["owner", "member"] {
            sqlx::query("INSERT INTO users(id,created_at) VALUES(?,0)")
                .bind(user_id)
                .execute(&pool)
                .await
                .unwrap();
            sqlx::query("INSERT INTO profiles(user_id,username,display_name,motto,updated_at) VALUES(?,?,?,'',0)")
                .bind(user_id)
                .bind(user_id)
                .bind(user_id)
                .execute(&pool)
                .await
                .unwrap();
        }
        for (id, kind, title) in [("group", "group", "Before"), ("direct", "direct", "")] {
            sqlx::query(
                "INSERT INTO conversations(id,kind,title,created_by,created_at) VALUES(?,?,?,?,0)",
            )
            .bind(id)
            .bind(kind)
            .bind(title)
            .bind("owner")
            .execute(&pool)
            .await
            .unwrap();
        }
        sqlx::query("INSERT INTO conversation_members(conversation_id,user_id,role,joined_at) VALUES('group','owner','owner',0),('group','member','member',0),('direct','owner','member',0)")
            .execute(&pool)
            .await
            .unwrap();

        let renamed = update_group_title(
            State(test_state(pool.clone())),
            axum::Extension(UserIdentity { id: "owner".into() }),
            Path("group".into()),
            axum::Json(UpdateGroupInput {
                title: Some("  Renamed  ".into()),
                avatar_attachment_id: None,
            }),
        )
        .await
        .unwrap()
        .0;
        assert_eq!(renamed.title, "Renamed");
        let avatar_bytes = canonical_avatar_png_fixture();
        std::fs::write(
            std::env::temp_dir().join("group-avatar-file"),
            &avatar_bytes,
        )
        .unwrap();
        sqlx::query("INSERT INTO attachments(id,owner_user_id,file_name,media_type,byte_size,storage_name,created_at) VALUES('group-avatar','owner','group.png','image/png',?,'group-avatar-file',0)")
            .bind(avatar_bytes.len() as i64)
            .execute(&pool)
            .await
            .unwrap();
        let with_avatar = update_group_title(
            State(test_state(pool.clone())),
            axum::Extension(UserIdentity { id: "owner".into() }),
            Path("group".into()),
            axum::Json(UpdateGroupInput {
                title: None,
                avatar_attachment_id: Some(Some("group-avatar".into())),
            }),
        )
        .await
        .unwrap()
        .0;
        assert_eq!(
            with_avatar.avatar_attachment_id.as_deref(),
            Some("group-avatar")
        );
        let without_avatar = update_group_title(
            State(test_state(pool.clone())),
            axum::Extension(UserIdentity { id: "owner".into() }),
            Path("group".into()),
            axum::Json(UpdateGroupInput {
                title: None,
                avatar_attachment_id: Some(None),
            }),
        )
        .await
        .unwrap()
        .0;
        assert!(without_avatar.avatar_attachment_id.is_none());

        for (conversation_id, user_id) in [("group", "member"), ("direct", "owner")] {
            let error = match update_group_title(
                State(test_state(pool.clone())),
                axum::Extension(UserIdentity { id: user_id.into() }),
                Path(conversation_id.into()),
                axum::Json(UpdateGroupInput {
                    title: Some("Nope".into()),
                    avatar_attachment_id: None,
                }),
            )
            .await
            {
                Ok(_) => panic!("non-owner update unexpectedly succeeded"),
                Err(error) => error,
            };
            assert_eq!(error.status, StatusCode::FORBIDDEN);
        }

        let error = match update_group_title(
            State(test_state(pool)),
            axum::Extension(UserIdentity { id: "owner".into() }),
            Path("group".into()),
            axum::Json(UpdateGroupInput {
                title: Some("   ".into()),
                avatar_attachment_id: None,
            }),
        )
        .await
        {
            Ok(_) => panic!("blank group name unexpectedly succeeded"),
            Err(error) => error,
        };
        assert_eq!(error.status, StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn profile_avatars_are_available_to_other_conversation_members() {
        let pool = db::connect_memory().await.unwrap();
        for (id, username, display_name, avatar) in [
            ("alice", "alice", "Alice", None),
            ("bob", "bob", "Bob", Some("bob-avatar")),
        ] {
            sqlx::query("INSERT INTO users(id,created_at) VALUES(?,0)")
                .bind(id)
                .execute(&pool)
                .await
                .unwrap();
            sqlx::query("INSERT INTO profiles(user_id,username,display_name,motto,avatar_attachment_id,updated_at) VALUES(?,?,?,'',?,0)")
                .bind(id)
                .bind(username)
                .bind(display_name)
                .bind(avatar)
                .execute(&pool)
                .await
                .unwrap();
        }
        sqlx::query("INSERT INTO conversations(id,kind,title,avatar_attachment_id,created_by,created_at) VALUES('group','group','Team','group-avatar','alice',0)")
            .execute(&pool)
            .await
            .unwrap();
        for user_id in ["alice", "bob"] {
            sqlx::query("INSERT INTO conversation_members(conversation_id,user_id,role,joined_at) VALUES('group',?,'member',0)")
                .bind(user_id)
                .execute(&pool)
                .await
                .unwrap();
        }
        sqlx::query("INSERT INTO attachments(id,owner_user_id,file_name,media_type,byte_size,storage_name,created_at) VALUES('bob-avatar','bob','avatar.png','image/png',1,'avatar-file',0),('group-avatar','alice','group.png','image/png',1,'group-avatar-file',0)")
            .execute(&pool)
            .await
            .unwrap();

        let visible: Option<String> = sqlx::query_scalar("SELECT a.id FROM attachments a WHERE a.id=? AND (a.owner_user_id=? OR EXISTS(SELECT 1 FROM messages m JOIN conversation_members cm ON cm.conversation_id=m.conversation_id WHERE m.id=a.message_id AND cm.user_id=?) OR EXISTS(SELECT 1 FROM profiles p WHERE p.avatar_attachment_id=a.id))")
            .bind("bob-avatar")
            .bind("alice")
            .bind("alice")
            .fetch_optional(&pool)
            .await
            .unwrap();

        assert_eq!(visible.as_deref(), Some("bob-avatar"));
        let group_visible: Option<String> = sqlx::query_scalar("SELECT a.id FROM attachments a WHERE a.id=? AND EXISTS(SELECT 1 FROM conversations c JOIN conversation_members cm ON cm.conversation_id=c.id WHERE c.avatar_attachment_id=a.id AND c.kind='group' AND cm.user_id=?)")
            .bind("group-avatar")
            .bind("bob")
            .fetch_optional(&pool)
            .await
            .unwrap();
        assert_eq!(group_visible.as_deref(), Some("group-avatar"));
    }

    #[tokio::test]
    async fn bark_notification_icons_use_sender_for_direct_messages_and_group_avatar_for_groups() {
        let pool = db::connect_memory().await.unwrap();
        sqlx::query("INSERT INTO users(id,created_at) VALUES('alice',0),('bob',0),('bot',0)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO profiles(user_id,username,display_name,motto,avatar_attachment_id,updated_at) VALUES('alice','alice','Alice','', 'alice-avatar',0)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO attachments(id,owner_user_id,file_name,media_type,byte_size,storage_name,created_at) VALUES('alice-avatar','alice','avatar.png','image/png',1,'alice-avatar-file',0),('group-avatar','alice','group.png','image/png',1,'group-avatar-file',0),('invalid-avatar','alice','invalid.txt','text/plain',1,'invalid-avatar-file',0)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO conversations(id,kind,title,avatar_attachment_id,created_by,created_at) VALUES('direct','direct','',NULL,'alice',0),('group','group','Team','group-avatar','alice',0),('invalid-group','group','Invalid','invalid-avatar','alice',0)")
            .execute(&pool)
            .await
            .unwrap();
        let user_message = Message {
            message: StoredMessage {
                id: "message".into(),
                conversation_id: "direct".into(),
                sender_kind: "user".into(),
                sender_id: "alice".into(),
                sender_name: "Alice".into(),
                sender_deleted: false,
                body: "hello".into(),
                urgent: false,
                created_at: 0,
                sequence: 1,
            },
            attachments: Vec::new(),
            cursor: "0:1".into(),
        };
        let bot_message = Message {
            message: StoredMessage {
                sender_kind: "bot".into(),
                sender_id: "bot".into(),
                ..user_message.message.clone()
            },
            attachments: Vec::new(),
            cursor: "0:1".into(),
        };
        assert_eq!(
            bark_notification_icon(&pool, "https://linkit.test", "direct", &user_message).await,
            "https://linkit.test/api/public/profiles/alice/avatar?v=0"
        );
        assert_eq!(
            bark_notification_icon(&pool, "https://linkit.test", "group", &user_message).await,
            "https://linkit.test/api/public/conversations/group/avatar"
        );
        assert_eq!(
            bark_notification_icon(&pool, "https://linkit.test", "invalid-group", &user_message)
                .await,
            "https://linkit.test/linkit-logo.png"
        );
        assert_eq!(
            bark_notification_icon(&pool, "https://linkit.test", "direct", &bot_message).await,
            "https://linkit.test/linkit-logo.png"
        );
    }

    #[test]
    fn sqlite_bytes_includes_wal_and_shared_memory_files() {
        let directory = std::env::temp_dir().join(Uuid::new_v4().to_string());
        std::fs::create_dir(&directory).unwrap();
        let database = directory.join("linkit.sqlite3");
        std::fs::write(&database, [0; 5]).unwrap();
        std::fs::write(directory.join("linkit.sqlite3-wal"), [0; 7]).unwrap();
        std::fs::write(directory.join("linkit.sqlite3-shm"), [0; 11]).unwrap();
        assert_eq!(sqlite_bytes(&database).unwrap(), 23);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
