use std::sync::Arc;

use auth_mini_axum::{AuthMiniError, AuthMiniLayer, AuthMiniPrincipal, JwksCachePolicy};
use axum::{
    extract::{Request, State},
    middleware::Next,
    response::{IntoResponse, Response},
};
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
    let now = chrono::Utc::now().timestamp();
    if let Err(error) =
        sqlx::query("INSERT INTO users(id,created_at) VALUES(?,?) ON CONFLICT(id) DO NOTHING")
            .bind(&identity.id)
            .bind(now)
            .execute(&state.db)
            .await
    {
        return AppError::from(error).into_response();
    }
    request.extensions_mut().insert(identity);
    next.run(request).await
}

fn bearer_token(headers: &axum::http::HeaderMap) -> Option<&str> {
    headers
        .get(axum::http::header::AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")
        .filter(|token| !token.is_empty())
}
