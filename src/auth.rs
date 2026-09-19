use std::sync::Arc;

use auth_mini_axum::{AuthMiniError, AuthMiniLayer, AuthMiniPrincipal, JwksCachePolicy};
use axum::{
    extract::{Request, State},
    middleware::Next,
    response::{IntoResponse, Response},
};
use sha2::{Digest, Sha256};
use tokio::sync::RwLock;

use crate::{AppError, AppState};

#[derive(Clone, Debug)]
pub struct UserIdentity {
    pub id: String,
}

#[derive(Clone)]
pub struct AuthManager {
    layers: Arc<RwLock<Vec<AuthMiniLayer>>>,
}

impl Default for AuthManager {
    fn default() -> Self {
        Self {
            layers: Arc::new(RwLock::new(Vec::new())),
        }
    }
}

impl AuthManager {
    pub async fn configure(&self, issuer: &str, audiences: &[String]) -> Result<(), AppError> {
        let mut layers = Vec::with_capacity(audiences.len());
        for audience in audiences {
            layers.push(
                AuthMiniLayer::from_issuer(issuer, audience, JwksCachePolicy::default())
                    .await
                    .map_err(auth_error)?,
            );
        }
        *self.layers.write().await = layers;
        Ok(())
    }

    async fn layers(&self) -> Result<Vec<AuthMiniLayer>, AppError> {
        let layers = self.layers.read().await.clone();
        (!layers.is_empty())
            .then_some(layers)
            .ok_or_else(|| AppError::unavailable("Linkit setup is not complete"))
    }
}

fn auth_error(error: AuthMiniError) -> AppError {
    match error {
        AuthMiniError::JwksUnavailable => AppError::unavailable("Auth Mini JWKS is unavailable"),
        AuthMiniError::InvalidIssuer => AppError::bad_request("Auth Mini issuer is not valid"),
        AuthMiniError::InvalidToken => AppError::unauthorized("invalid or expired bearer token"),
    }
}

pub async fn authenticate(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> Response {
    let token = match bearer_token(request.headers()) {
        Some(token) => token,
        None => return AppError::unauthorized("invalid or expired bearer token").into_response(),
    };
    if token.starts_with("sk-") {
        let bot_id = sqlx::query_scalar(
            "SELECT b.id FROM bots b JOIN users u ON u.id=b.id WHERE b.token_hash=? AND u.type='bot'",
        )
        .bind(token_hash(token))
        .fetch_optional(&state.db)
        .await;
        let bot_id: Option<String> = match bot_id {
            Ok(value) => value,
            Err(error) => return AppError::from(error).into_response(),
        };
        let Some(id) = bot_id else {
            return AppError::unauthorized("invalid or expired bearer token").into_response();
        };
        request.extensions_mut().insert(UserIdentity { id });
        return next.run(request).await;
    }
    let layers = match state.auth.layers().await {
        Ok(layers) => layers,
        Err(error) => return error.into_response(),
    };
    let mut jwks_unavailable = false;
    let mut principal = None;
    for layer in layers {
        match layer.verifier().verify(token).await {
            Ok(value) => {
                principal = Some(value);
                break;
            }
            Err(AuthMiniError::JwksUnavailable) => jwks_unavailable = true,
            Err(AuthMiniError::InvalidIssuer | AuthMiniError::InvalidToken) => {}
        }
    }
    let principal: AuthMiniPrincipal = match principal {
        Some(value) => value,
        None if jwks_unavailable => {
            return AppError::unavailable("Auth Mini JWKS is unavailable").into_response();
        }
        None => return AppError::unauthorized("invalid or expired bearer token").into_response(),
    };
    let identity = UserIdentity {
        id: principal.subject,
    };
    if let Err(error) = crate::accounts::ensure(&state.db, &identity.id).await {
        return error.into_response();
    }
    request.extensions_mut().insert(identity);
    next.run(request).await
}

pub(crate) fn token_hash(token: &str) -> String {
    format!("{:x}", Sha256::digest(token.as_bytes()))
}

fn bearer_token(headers: &axum::http::HeaderMap) -> Option<&str> {
    headers
        .get(axum::http::header::AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")
        .filter(|token| !token.is_empty())
}

#[cfg(test)]
mod tests {
    use axum::{
        Router,
        body::Body,
        http::{Request, StatusCode},
        routing::get,
    };
    use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
    use http_body_util::BodyExt;
    use ring::signature::{Ed25519KeyPair, KeyPair};
    use serde_json::{Value, json};
    use tower::ServiceExt;

    use super::*;

    async fn issuer_fixture() -> (AppState, Ed25519KeyPair, String) {
        let key = Ed25519KeyPair::from_seed_unchecked(&[42; 32]).unwrap();
        let jwks = json!({"keys": [{"kid":"test-key","kty":"OKP","crv":"Ed25519","alg":"EdDSA","use":"sig","x":URL_SAFE_NO_PAD.encode(key.public_key().as_ref())}]});
        let server = Router::new().route(
            "/jwks",
            get(move || {
                let document = jwks.clone();
                async move { axum::Json(document) }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let issuer = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move {
            axum::serve(listener, server).await.unwrap();
        });
        let state = crate::tests::test_state(crate::db::connect_memory().await.unwrap());
        state
            .auth
            .configure(&issuer, &["linkit.example.com".to_owned()])
            .await
            .unwrap();
        (state, key, issuer)
    }

    fn claims(issuer: &str, id: &str) -> Value {
        let now = chrono::Utc::now().timestamp();
        json!({"iss":issuer,"aud":"linkit.example.com","sub":id,"sid":"test-session","typ":"access","amr":["ed25519"],"iat":now,"exp":now+300})
    }

    fn token(key: &Ed25519KeyPair, claims: Value) -> String {
        let header = URL_SAFE_NO_PAD.encode(br#"{"alg":"EdDSA","kid":"test-key"}"#);
        let payload = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).unwrap());
        let message = format!("{header}.{payload}");
        format!(
            "{message}.{}",
            URL_SAFE_NO_PAD.encode(key.sign(message.as_bytes()).as_ref())
        )
    }

    async fn call(state: AppState, path: &str, token: &str) -> Response {
        crate::router(state)
            .oneshot(
                Request::builder()
                    .uri(path)
                    .header(axum::http::header::AUTHORIZATION, format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap()
    }

    async fn json_body(response: Response) -> Value {
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap()
    }

    #[tokio::test]
    async fn any_protected_api_provisions_the_verified_subject_without_a_registration_call() {
        let (state, key, issuer) = issuer_fixture().await;
        let id = "550e8400-e29b-41d4-a716-446655440000";
        let jwt = token(&key, claims(&issuer, id));
        let response = call(state.clone(), "/api/users", &jwt).await;
        assert_eq!(response.status(), StatusCode::OK);
        let directory = json_body(response).await;
        assert_eq!(directory.as_array().unwrap().len(), 1);
        assert_eq!(directory[0]["user_id"], id);
        assert!(
            directory[0]["username"]
                .as_str()
                .unwrap()
                .starts_with("user_")
        );
        let me = json_body(call(state.clone(), "/api/me", &jwt).await).await;
        assert_eq!(me["profile"]["username"], directory[0]["username"]);
        assert_eq!(me["profile"]["intro"], "");
        assert!(me["profile"]["avatar_attachment_id"].is_null());
        assert_eq!(me["root"], false);
        sqlx::query(
            "UPDATE profiles SET username='Edited',intro='Keep me',updated_at=123 WHERE user_id=?",
        )
        .bind(id)
        .execute(&state.db)
        .await
        .unwrap();
        let me = json_body(call(state.clone(), "/api/me", &jwt).await).await;
        assert_eq!(me["profile"]["username"], "Edited");
        assert_eq!(me["profile"]["updated_at"], 123);
        // Existing users without a profile are repaired on their next authenticated request too.
        sqlx::query("DELETE FROM profiles WHERE user_id=?")
            .bind(id)
            .execute(&state.db)
            .await
            .unwrap();
        let response = call(state.clone(), "/api/conversations", &jwt).await;
        assert_eq!(response.status(), StatusCode::OK);
        assert!(
            crate::profile_for_user(&state.db, id)
                .await
                .unwrap()
                .is_some()
        );
    }

    #[tokio::test]
    async fn setup_provisions_the_verified_root_profile() {
        let (state, key, issuer) = issuer_fixture().await;
        let id = "550e8400-e29b-41d4-a716-446655440000";
        let jwt = token(&key, claims(&issuer, id));
        let response = crate::router(state.clone()).oneshot(Request::builder().method("POST").uri("/api/setup")
            .header(axum::http::header::AUTHORIZATION, format!("Bearer {jwt}"))
            .header(axum::http::header::CONTENT_TYPE, "application/json")
            .body(Body::from(json!({"root_user_id":id,"auth_issuer":issuer,"auth_audience":"linkit.example.com","public_origin":"https://linkit.example.com"}).to_string())).unwrap()).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let me = json_body(call(state.clone(), "/api/me", &jwt).await).await;
        assert_eq!(me["root"], true);
        assert_eq!(me["profile"]["user_id"], id);
        assert!(
            me["profile"]["username"]
                .as_str()
                .unwrap()
                .starts_with("user_")
        );
    }

    #[tokio::test]
    async fn invalid_jwts_never_provision_accounts_and_valid_jwts_do_not_bypass_authorization() {
        let (state, key, issuer) = issuer_fixture().await;
        let id = "unregistered";
        let valid = claims(&issuer, id);
        let mut expired = valid.clone();
        expired["iat"] = json!(chrono::Utc::now().timestamp() - 500);
        expired["exp"] = json!(chrono::Utc::now().timestamp() - 100);
        let mut wrong_issuer = valid.clone();
        wrong_issuer["iss"] = json!("https://untrusted.example.com");
        let mut wrong_audience = valid.clone();
        wrong_audience["aud"] = json!("other.example.com");
        let other_key = Ed25519KeyPair::from_seed_unchecked(&[43; 32]).unwrap();
        for invalid in [
            String::new(),
            "not-a-jwt".to_owned(),
            token(&key, expired),
            token(&key, wrong_issuer),
            token(&key, wrong_audience),
            token(&other_key, valid.clone()),
        ] {
            assert_eq!(
                call(state.clone(), "/api/me", &invalid).await.status(),
                StatusCode::UNAUTHORIZED
            );
            let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
                .fetch_one(&state.db)
                .await
                .unwrap();
            assert_eq!(count, 0);
        }
        let response = call(state.clone(), "/api/admin/resources", &token(&key, valid)).await;
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert!(
            crate::profile_for_user(&state.db, id)
                .await
                .unwrap()
                .is_some()
        );
    }

    #[tokio::test]
    async fn a_valid_jwt_cannot_take_over_a_bot_and_provisioning_errors_stop_the_request() {
        let (state, key, issuer) = issuer_fixture().await;
        sqlx::query("INSERT INTO users(id,type,created_at) VALUES('bot','bot',1)")
            .execute(&state.db)
            .await
            .unwrap();
        let response = call(
            state.clone(),
            "/api/me",
            &token(&key, claims(&issuer, "bot")),
        )
        .await;
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert!(
            crate::profile_for_user(&state.db, "bot")
                .await
                .unwrap()
                .is_none()
        );
        sqlx::query("CREATE TRIGGER fail_profile BEFORE INSERT ON profiles BEGIN SELECT RAISE(ABORT, 'test failure'); END").execute(&state.db).await.unwrap();
        let response = call(
            state.clone(),
            "/api/conversations",
            &token(&key, claims(&issuer, "new-user")),
        )
        .await;
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE id='new-user'")
            .fetch_one(&state.db)
            .await
            .unwrap();
        assert_eq!(count, 0);
    }
}
