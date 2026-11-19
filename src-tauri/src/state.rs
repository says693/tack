use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};

use rusqlite::Connection;

use crate::error::{AppError, AppResult};

pub struct AppState {
    pub db: Mutex<Connection>,
    pub data_dir: PathBuf,
    pub guided_cloud: tokio::sync::Mutex<()>,
}

impl AppState {
    pub fn new(conn: Connection, data_dir: PathBuf) -> Self {
        Self {
            db: Mutex::new(conn),
            data_dir,
            guided_cloud: tokio::sync::Mutex::new(()),
        }
    }

    pub fn db(&self) -> AppResult<MutexGuard<'_, Connection>> {
        self.db
            .lock()
            .map_err(|_| AppError::Internal("数据库锁已损坏，请重启应用。".into()))
    }
}
