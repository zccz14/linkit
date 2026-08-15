pub mod auth;
pub mod bark;
pub mod config;
pub mod db;

use std::{
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
use rand::{Rng, distr::Alphanumeric};
use rust_embed::RustEmbed;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use sqlx::{FromRow, SqlitePool};
use sysinfo::{Disks, Networks, System};
use tower_http::{compression::CompressionLayer, limit::RequestBodyLimitLayer, trace::TraceLayer};
use uuid::Uuid;

use crate::{
    auth::{AuthManager, UserIdentity},
    config::BootstrapConfig,
};

const MAX_UPLOAD_BYTES: usize = 52_428_800;
const MESSAGE_PAGE_SIZE: i64 = 50;
const LIST_CONVERSATIONS_QUERY: &str = "SELECT c.id,c.kind,c.title,c.created_by,c.created_at,CASE WHEN c.kind='direct' THEN COALESCE((SELECT p.display_name FROM conversation_members cm_peer JOIN profiles p ON p.user_id=cm_peer.user_id WHERE cm_peer.conversation_id=c.id AND cm_peer.user_id<>? LIMIT 1),(SELECT b.name FROM conversation_bots cb JOIN bots b ON b.id=cb.bot_id WHERE cb.conversation_id=c.id LIMIT 1)) END counterpart_name,CASE WHEN c.kind='direct' THEN (SELECT p.avatar_attachment_id FROM conversation_members cm_peer JOIN profiles p ON p.user_id=cm_peer.user_id WHERE cm_peer.conversation_id=c.id AND cm_peer.user_id<>? LIMIT 1) END counterpart_avatar_attachment_id,(SELECT body FROM messages WHERE conversation_id=c.id ORDER BY created_at DESC LIMIT 1) latest_body,(SELECT created_at FROM messages WHERE conversation_id=c.id ORDER BY created_at DESC LIMIT 1) latest_at,(SELECT COUNT(*) FROM messages WHERE conversation_id=c.id AND created_at>cm.last_read_at AND sender_id<>?) unread_count FROM conversations c JOIN conversation_members cm ON cm.conversation_id=c.id WHERE cm.user_id=? ORDER BY COALESCE(latest_at,c.created_at) DESC";
const CONVERSATION_QUERY: &str = "SELECT c.id,c.kind,c.title,c.created_by,c.created_at,CASE WHEN c.kind='direct' THEN COALESCE((SELECT p.display_name FROM conversation_members cm_peer JOIN profiles p ON p.user_id=cm_peer.user_id WHERE cm_peer.conversation_id=c.id AND cm_peer.user_id<>? LIMIT 1),(SELECT b.name FROM conversation_bots cb JOIN bots b ON b.id=cb.bot_id WHERE cb.conversation_id=c.id LIMIT 1)) END counterpart_name,CASE WHEN c.kind='direct' THEN (SELECT p.avatar_attachment_id FROM conversation_members cm_peer JOIN profiles p ON p.user_id=cm_peer.user_id WHERE cm_peer.conversation_id=c.id AND cm_peer.user_id<>? LIMIT 1) END counterpart_avatar_attachment_id,(SELECT body FROM messages WHERE conversation_id=c.id ORDER BY created_at DESC LIMIT 1) latest_body,(SELECT created_at FROM messages WHERE conversation_id=c.id ORDER BY created_at DESC LIMIT 1) latest_at,(SELECT COUNT(*) FROM messages WHERE conversation_id=c.id AND created_at>cm.last_read_at AND sender_id<>?) unread_count FROM conversations c JOIN conversation_members cm ON cm.conversation_id=c.id WHERE c.id=? AND cm.user_id=?";

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
            let audience = meta(&db, "auth_audience").await?;
            auth.configure(&issuer, &audience).await?;
        }
        let (events, _) = tokio::sync::broadcast::channel(256);
        let bark = bark::BarkGateway::load().unwrap_or_else(|error| {
            tracing::error!(%error, "Bark gateway disabled because its APNs configuration is invalid");
            bark::BarkGateway::disabled()
        });
        Ok(Self {
            db,
            auth,
            uploads: Arc::new(bootstrap.upload_dir),
            bark,
            database_path: Arc::new(bootstrap.database_path),
            system_monitor: Arc::new(Mutex::new(SystemMonitor::new())),
            events,
        })
    }
}

pub fn router(state: AppState) -> Router {
    let signed_in = Router::new()
        .route("/api/me", get(me))
        .route("/api/admin/system", get(system_overview))
        .route("/api/events", get(events))
        .route("/api/profile", put(update_profile))
        .route("/api/users", get(list_users))
        .route("/api/users/{username}", get(read_user))
        .route(
            "/api/conversations",
            get(list_conversations).post(create_group),
        )
        .route("/api/conversations/{id}", get(conversation_detail))
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
        .route("/api/bots", get(list_bots).post(create_bot))
        .route("/api/bots/{id}", patch(update_bot).delete(delete_bot))
        .route(
            "/api/bots/{id}/groups/{conversation_id}",
            post(add_bot_to_group).delete(remove_bot_from_group),
        )
        .route(
            "/api/notification-subscriptions",
            post(save_notification_subscription),
        )
        .route_layer(from_fn_with_state(state.clone(), auth::authenticate));

    Router::new()
        .route("/api/health", get(health))
        .route("/api/config", get(public_config))
        .route("/api/setup", get(setup_status).post(setup))
        .route("/api/bark/ping", get(bark_ping))
        .route(
            "/api/bark/register",
            get(bark_register).post(bark_register_json),
        )
        .route("/api/bark/register/{key}", get(bark_register_check))
        .route(
            "/api/bark/push",
            post(bark_push).layer(RequestBodyLimitLayer::new(16 * 1024)),
        )
        .route("/api/bark/{device_key}", get(bark_push_url))
        .route(
            "/api/bark/{device_key}/{body}",
            get(bark_push_url_with_body),
        )
        .route(
            "/api/bark/{device_key}/{title}/{body}",
            get(bark_push_url_with_title_and_body),
        )
        .route(
            "/api/bark/{device_key}/{title}/{subtitle}/{body}",
            get(bark_push_url_with_title_subtitle_and_body),
        )
        .route("/bot/v1/messages", post(bot_send_message))
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

fn bark_response(
    status: StatusCode,
    message: impl Into<String>,
    data: Option<serde_json::Value>,
) -> Response {
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

fn bark_unavailable(state: &AppState) -> Option<Response> {
    (!state.bark.configured()).then(|| {
        bark_response(
            StatusCode::SERVICE_UNAVAILABLE,
            "Bark APNs is not configured",
            None,
        )
    })
}

async fn bark_ping(State(state): State<AppState>) -> Response {
    bark_unavailable(&state).unwrap_or_else(|| bark_response(StatusCode::OK, "pong", None))
}

async fn bark_register(
    State(state): State<AppState>,
    Query(input): Query<bark::RegisterInput>,
) -> Response {
    register_bark_device(state, input).await
}

async fn bark_register_json(
    State(state): State<AppState>,
    axum::Json(input): axum::Json<bark::RegisterInput>,
) -> Response {
    register_bark_device(state, input).await
}

async fn register_bark_device(state: AppState, input: bark::RegisterInput) -> Response {
    if let Some(response) = bark_unavailable(&state) {
        return response;
    }
    if bark::validate_device_token(&input.device_token).is_err() {
        return bark_response(StatusCode::BAD_REQUEST, "device token is invalid", None);
    }
    match bark::register_device(&state.db, &input.key, &input.device_token).await {
        Ok(key) => bark_response(
            StatusCode::OK,
            "success",
            Some(json!({
                "key": key.clone(),
                "device_key": key,
                "device_token": input.device_token,
            })),
        ),
        Err(_) => bark_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "device registration failed",
            None,
        ),
    }
}

async fn bark_register_check(State(state): State<AppState>, Path(key): Path<String>) -> Response {
    if let Some(response) = bark_unavailable(&state) {
        return response;
    }
    match bark::device_token_for_key(&state.db, &key).await {
        Ok(Some(_)) => bark_response(StatusCode::OK, "success", None),
        Ok(None) => bark_response(StatusCode::BAD_REQUEST, "device key is invalid", None),
        Err(_) => bark_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "device lookup failed",
            None,
        ),
    }
}

#[derive(Debug, Deserialize)]
struct BarkUrlPushQuery {
    #[serde(default)]
    title: String,
    #[serde(default)]
    subtitle: String,
    #[serde(default)]
    body: String,
    sound: Option<String>,
    group: Option<String>,
    badge: Option<i64>,
    id: Option<String>,
    #[serde(rename = "delete")]
    delete_notification: Option<String>,
    #[serde(rename = "device_key", default)]
    _device_key: String,
    #[serde(flatten)]
    extra: std::collections::HashMap<String, String>,
}

impl BarkUrlPushQuery {
    fn into_push(
        self,
        device_key: String,
        path_title: Option<String>,
        path_subtitle: Option<String>,
        path_body: Option<String>,
    ) -> bark::PushInput {
        bark::PushInput {
            device_key,
            title: path_title.unwrap_or(self.title),
            subtitle: path_subtitle.unwrap_or(self.subtitle),
            body: path_body.unwrap_or(self.body),
            sound: self.sound,
            group: self.group,
            badge: self.badge,
            id: self.id,
            delete_notification: self.delete_notification.map(Value::String),
            extra: self
                .extra
                .into_iter()
                .map(|(key, value)| (key, Value::String(value)))
                .collect::<Map<_, _>>(),
        }
    }
}

async fn bark_push(
    State(state): State<AppState>,
    axum::Json(input): axum::Json<bark::PushInput>,
) -> Response {
    deliver_bark_push(state, input).await
}

async fn bark_push_url(
    State(state): State<AppState>,
    Path(device_key): Path<String>,
    Query(input): Query<BarkUrlPushQuery>,
) -> Response {
    deliver_bark_push(state, input.into_push(device_key, None, None, None)).await
}

async fn bark_push_url_with_body(
    State(state): State<AppState>,
    Path((device_key, body)): Path<(String, String)>,
    Query(input): Query<BarkUrlPushQuery>,
) -> Response {
    deliver_bark_push(state, input.into_push(device_key, None, None, Some(body))).await
}

async fn bark_push_url_with_title_and_body(
    State(state): State<AppState>,
    Path((device_key, title, body)): Path<(String, String, String)>,
    Query(input): Query<BarkUrlPushQuery>,
) -> Response {
    deliver_bark_push(
        state,
        input.into_push(device_key, Some(title), None, Some(body)),
    )
    .await
}

async fn bark_push_url_with_title_subtitle_and_body(
    State(state): State<AppState>,
    Path((device_key, title, subtitle, body)): Path<(String, String, String, String)>,
    Query(input): Query<BarkUrlPushQuery>,
) -> Response {
    deliver_bark_push(
        state,
        input.into_push(device_key, Some(title), Some(subtitle), Some(body)),
    )
    .await
}

async fn deliver_bark_push(state: AppState, input: bark::PushInput) -> Response {
    if let Some(response) = bark_unavailable(&state) {
        return response;
    }
    if input.validate().is_err() {
        return bark_response(StatusCode::BAD_REQUEST, "push payload is invalid", None);
    }
    let device_token = match bark::device_token_for_key(&state.db, &input.device_key).await {
        Ok(Some(token)) => token,
        Ok(None) => return bark_response(StatusCode::BAD_REQUEST, "device key is invalid", None),
        Err(_) => {
            return bark_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                "device lookup failed",
                None,
            );
        }
    };
    match state.bark.deliver(&device_token, &input).await {
        Ok(bark::Delivery::Delivered) => bark_response(StatusCode::OK, "success", None),
        Ok(bark::Delivery::InvalidDeviceToken) => {
            let _ = bark::forget_device_key(&state.db, &input.device_key).await;
            bark_response(StatusCode::GONE, "device token is invalid", None)
        }
        Err(_) => bark_response(StatusCode::BAD_GATEWAY, "APNs delivery failed", None),
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
    state.auth.configure(&issuer, &audience).await?;
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
        &id,
        "user",
        &user.id,
        input.body,
        input.attachment_ids,
        Some(&user.id),
    )
    .await?;
    let _ = state.events.send(ConversationEvent {
        conversation_id: id,
        sender_id: user.id,
        message: message.clone(),
    });
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
    let row: Option<(String, String, String, Option<String>)> = sqlx::query_as("SELECT a.storage_name,a.file_name,a.media_type,a.message_id FROM attachments a WHERE a.id=? AND (a.owner_user_id=? OR EXISTS(SELECT 1 FROM messages m JOIN conversation_members cm ON cm.conversation_id=m.conversation_id WHERE m.id=a.message_id AND cm.user_id=?) OR EXISTS(SELECT 1 FROM profiles p WHERE p.avatar_attachment_id=a.id))").bind(&id).bind(&user.id).bind(&user.id).fetch_optional(&state.db).await?;
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
        &conversation_id,
        "bot",
        &bot.id,
        input.body,
        input.attachment_ids.unwrap_or_default(),
        None,
    )
    .await?;
    let _ = state.events.send(ConversationEvent {
        conversation_id,
        sender_id: bot.id,
        message: message.clone(),
    });
    Ok(axum::Json(message))
}

#[derive(Deserialize)]
struct NotificationInput {
    endpoint: String,
    subscription: serde_json::Value,
}

async fn save_notification_subscription(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<UserIdentity>,
    axum::Json(input): axum::Json<NotificationInput>,
) -> Result<StatusCode, AppError> {
    let endpoint = nonempty(&input.endpoint, "endpoint", 4096)?;
    sqlx::query("INSERT INTO notification_subscriptions(id,user_id,endpoint,subscription_json,created_at) VALUES(?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,subscription_json=excluded.subscription_json,created_at=excluded.created_at").bind(Uuid::new_v4().to_string()).bind(user.id).bind(endpoint).bind(serde_json::to_string(&input.subscription).map_err(|_| AppError::bad_request("subscription is invalid"))?).bind(chrono::Utc::now().timestamp()).execute(&state.db).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn create_message(
    db: &SqlitePool,
    conversation_id: &str,
    sender_kind: &str,
    sender_id: &str,
    body: String,
    attachment_ids: Vec<String>,
    attachment_owner: Option<&str>,
) -> Result<Message, AppError> {
    let body = bounded(&body, "body", 10_000)?;
    if body.trim().is_empty() && attachment_ids.is_empty() {
        return Err(AppError::bad_request(
            "a message needs text or an attachment",
        ));
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
    sqlx::query("INSERT INTO messages(id,conversation_id,sender_kind,sender_id,body,created_at,sequence) VALUES(?,?,?,?,?,?,?)").bind(&id).bind(conversation_id).bind(sender_kind).bind(sender_id).bind(body).bind(now).bind(sequence).execute(&mut *tx).await?;
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
        let rows = sqlx::query_as("SELECT m.id,m.conversation_id,m.sender_kind,m.sender_id,COALESCE(p.display_name,b.name,m.sender_id) sender_name,(m.sender_kind='bot' AND b.id IS NULL) sender_deleted,m.body,m.created_at,m.sequence FROM messages m LEFT JOIN profiles p ON m.sender_kind='user' AND p.user_id=m.sender_id LEFT JOIN bots b ON m.sender_kind='bot' AND b.id=m.sender_id WHERE m.conversation_id=? AND (m.created_at<? OR (m.created_at=? AND m.sequence<?)) ORDER BY m.created_at DESC,m.sequence DESC LIMIT ?")
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
        let rows = sqlx::query_as("SELECT m.id,m.conversation_id,m.sender_kind,m.sender_id,COALESCE(p.display_name,b.name,m.sender_id) sender_name,(m.sender_kind='bot' AND b.id IS NULL) sender_deleted,m.body,m.created_at,m.sequence FROM messages m LEFT JOIN profiles p ON m.sender_kind='user' AND p.user_id=m.sender_id LEFT JOIN bots b ON m.sender_kind='bot' AND b.id=m.sender_id WHERE m.conversation_id=? AND (m.created_at>? OR (m.created_at=? AND m.sequence>?)) ORDER BY m.created_at,m.sequence LIMIT ?")
                .bind(conversation_id)
                .bind(created_at)
                .bind(created_at)
                .bind(sequence)
                .bind(MESSAGE_PAGE_SIZE + 1)
                .fetch_all(db)
                .await?;
        (rows, PageDirection::Newer)
    } else {
        let rows = sqlx::query_as("SELECT m.id,m.conversation_id,m.sender_kind,m.sender_id,COALESCE(p.display_name,b.name,m.sender_id) sender_name,(m.sender_kind='bot' AND b.id IS NULL) sender_deleted,m.body,m.created_at,m.sequence FROM messages m LEFT JOIN profiles p ON m.sender_kind='user' AND p.user_id=m.sender_id LEFT JOIN bots b ON m.sender_kind='bot' AND b.id=m.sender_id WHERE m.conversation_id=? ORDER BY m.created_at DESC,m.sequence DESC LIMIT ?")
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
    let row: StoredMessage = sqlx::query_as("SELECT m.id,m.conversation_id,m.sender_kind,m.sender_id,COALESCE(p.display_name,b.name,m.sender_id) sender_name,(m.sender_kind='bot' AND b.id IS NULL) sender_deleted,m.body,m.created_at,m.sequence FROM messages m LEFT JOIN profiles p ON m.sender_kind='user' AND p.user_id=m.sender_id LEFT JOIN bots b ON m.sender_kind='bot' AND b.id=m.sender_id WHERE m.id=?").bind(id).fetch_optional(db).await?.ok_or_else(|| AppError::not_found("message not found"))?;
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
            "only the Root User can view system resources",
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
                    Some("webmanifest") => "application/manifest+json",
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
        let (events, _) = tokio::sync::broadcast::channel(1);
        AppState {
            db,
            auth: AuthManager::default(),
            uploads: Arc::new(std::env::temp_dir()),
            bark: bark::BarkGateway::test_gateway(),
            database_path: Arc::new(std::env::temp_dir().join("linkit-test.sqlite3")),
            system_monitor: Arc::new(Mutex::new(SystemMonitor::new())),
            events,
        }
    }

    #[test]
    fn direct_key_is_stable_for_both_members() {
        assert_eq!(direct_key("a", "b"), direct_key("b", "a"));
    }

    #[test]
    fn bot_tokens_have_an_unambiguous_public_prefix() {
        assert!(new_bot_token().starts_with("sk-"));
    }

    #[tokio::test]
    async fn migrations_create_setup_defaults() {
        let pool = db::connect_memory().await.unwrap();
        assert_eq!(meta(&pool, "setup_complete").await.unwrap(), "false");
    }

    #[tokio::test]
    async fn bark_app_registration_protocol_is_public_and_compatible() {
        let app = router(test_state(db::connect_memory().await.unwrap()));
        let ping = app
            .clone()
            .oneshot(
                axum::http::Request::builder()
                    .uri("/api/bark/ping")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(ping.status(), StatusCode::OK);
        let registered = app
            .clone()
            .oneshot(
                axum::http::Request::builder()
                    .uri("/api/bark/register?devicetoken=aabbccdd")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(registered.status(), StatusCode::OK);
        let body = registered.into_body().collect().await.unwrap().to_bytes();
        let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let key = value["data"]["key"].as_str().unwrap();
        assert_eq!(key.len(), 32);
        let checked = app
            .oneshot(
                axum::http::Request::builder()
                    .uri(format!("/api/bark/register/{key}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(checked.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn bark_v1_url_push_is_routed_and_supports_query_options() {
        let app = router(test_state(db::connect_memory().await.unwrap()));
        let response = app
            .oneshot(
                axum::http::Request::builder()
                    .uri("/api/bark/not-a-device-key/%E6%B5%8B%E8%AF%95?group=alerts&sound=alarm&badge=3&url=https%3A%2F%2Flinkit.ntnl.io%2F")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(value["message"], "device key is invalid");
    }

    #[test]
    fn bark_v1_path_fields_override_query_fields() {
        let push = BarkUrlPushQuery {
            title: "query title".to_owned(),
            subtitle: "query subtitle".to_owned(),
            body: "query body".to_owned(),
            sound: Some("alarm".to_owned()),
            group: Some("alerts".to_owned()),
            badge: Some(3),
            id: None,
            delete_notification: None,
            _device_key: String::new(),
            extra: [("level".to_owned(), "timeSensitive".to_owned())].into(),
        }
        .into_push(
            "key".to_owned(),
            Some("path title".to_owned()),
            None,
            Some("path body".to_owned()),
        );
        assert_eq!(push.title, "path title");
        assert_eq!(push.subtitle, "query subtitle");
        assert_eq!(push.body, "path body");
        assert_eq!(
            push.extra["level"],
            Value::String("timeSensitive".to_owned())
        );
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
        sqlx::query("INSERT INTO conversations(id,kind,title,created_by,created_at) VALUES('group','group','Team','alice',0)")
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
        sqlx::query("INSERT INTO attachments(id,owner_user_id,file_name,media_type,byte_size,storage_name,created_at) VALUES('bob-avatar','bob','avatar.png','image/png',1,'avatar-file',0)")
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
