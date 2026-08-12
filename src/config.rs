use std::{
    fs,
    net::{IpAddr, Ipv4Addr, SocketAddr},
    path::PathBuf,
};

use anyhow::{Context, Result};

pub const DEFAULT_LISTEN: SocketAddr = SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), 8080);

#[derive(Clone, Debug)]
pub struct BootstrapConfig {
    pub listen: SocketAddr,
    pub data_dir: PathBuf,
    pub database_path: PathBuf,
    pub upload_dir: PathBuf,
}

impl BootstrapConfig {
    pub fn load() -> Result<Self> {
        let home =
            dirs::home_dir().context("cannot determine the current user's home directory")?;
        Self::in_data_dir(home.join(".linkit"), DEFAULT_LISTEN)
    }

    pub fn in_data_dir(data_dir: PathBuf, listen: SocketAddr) -> Result<Self> {
        let upload_dir = data_dir.join("uploads");
        fs::create_dir_all(&upload_dir)
            .with_context(|| format!("failed to create {}", upload_dir.display()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&data_dir, fs::Permissions::from_mode(0o700))?;
            fs::set_permissions(&upload_dir, fs::Permissions::from_mode(0o700))?;
        }
        Ok(Self {
            listen,
            database_path: data_dir.join("linkit.sqlite3"),
            data_dir,
            upload_dir,
        })
    }
}
