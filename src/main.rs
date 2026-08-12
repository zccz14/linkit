use anyhow::Result;
use linkit::{AppState, config::BootstrapConfig, db, router};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("linkit=info,tower_http=info")),
        )
        .init();
    let bootstrap = BootstrapConfig::load()?;
    let listen = bootstrap.listen;
    let pool = db::connect(&bootstrap.database_path).await?;
    let state = AppState::new(bootstrap, pool).await?;
    let listener = tokio::net::TcpListener::bind(listen).await?;
    tracing::info!(%listen, "Linkit listening");
    axum::serve(
        listener,
        router(state).into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .await?;
    Ok(())
}
