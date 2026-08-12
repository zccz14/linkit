use std::{convert::Infallible, sync::Arc};

use auth_mini_axum::{AuthMiniError, AuthMiniLayer, AuthMiniPrincipal, JwksCachePolicy};
use axum::{
    extract::{Request, State},
    middleware::Next,
    response::{IntoResponse, Response},
};
use tokio::sync::RwLock;
use tower::{Layer, ServiceExt, service_fn};

use crate::{AppError, AppState};

#[derive(Clone, Debug)]
pub struct UserIdentity {
    pub id: String,
}

#[derive(Clone)]
pub struct AuthManager {
    layer: Arc<RwLock<Option<AuthMiniLayer>>>,
}

impl Default for AuthManager {
    fn default() -> Self {
        Self {
            layer: Arc::new(RwLock::new(None)),
        }
    }
}

impl AuthManager {
    pub async fn configure(&self, issuer: &str, audience: &str) -> Result<(), AppError> {
        let layer = AuthMiniLayer::from_issuer(issuer, audience, JwksCachePolicy::default())
            .await
            .map_err(auth_error)?;
        *self.layer.write().await = Some(layer);
        Ok(())
    }

    async fn layer(&self) -> Result<AuthMiniLayer, AppError> {
        self.layer
            .read()
            .await
            .clone()
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

pub async fn authenticate(State(state): State<AppState>, request: Request, next: Next) -> Response {
    let layer = match state.auth.layer().await {
        Ok(layer) => layer,
        Err(error) => return error.into_response(),
    };
    let service = layer.layer(service_fn(move |mut request: Request| {
        let state = state.clone();
        let next = next.clone();
        async move {
            let principal = request
                .extensions()
                .get::<AuthMiniPrincipal>()
                .cloned()
                .expect("Auth Mini layer inserts a verified principal");
            let identity = UserIdentity {
                id: principal.subject,
            };
            let now = chrono::Utc::now().timestamp();
            let result = sqlx::query(
                "INSERT INTO users(id,created_at) VALUES(?,?) ON CONFLICT(id) DO NOTHING",
            )
            .bind(&identity.id)
            .bind(now)
            .execute(&state.db)
            .await;
            if let Err(error) = result {
                return Ok::<_, Infallible>(AppError::from(error).into_response());
            }
            request.extensions_mut().insert(identity);
            Ok::<_, Infallible>(next.run(request).await)
        }
    }));
    match service.oneshot(request).await {
        Ok(response) => response,
        Err(never) => match never {},
    }
}
