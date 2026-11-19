use serde::ser::{Serialize, SerializeStruct, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{message}")]
    User { code: String, message: String },
    #[error("数据库操作失败：{0}")]
    Db(#[from] rusqlite::Error),
    #[error("数据格式错误：{0}")]
    Json(#[from] serde_json::Error),
    #[error("网络请求失败：{0}")]
    Http(String),
    #[error("文件操作失败：{0}")]
    Io(#[from] std::io::Error),
    #[error("内部错误：{0}")]
    Internal(String),
}

impl AppError {
    pub fn user(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self::User {
            code: code.into(),
            message: message.into(),
        }
    }

    pub fn code(&self) -> &str {
        match self {
            Self::User { code, .. } => code,
            Self::Db(_) => "database_error",
            Self::Json(_) => "data_error",
            Self::Http(_) => "network_error",
            Self::Io(_) => "io_error",
            Self::Internal(_) => "internal_error",
        }
    }

    pub fn message(&self) -> String {
        match self {
            Self::User { message, .. } => message.clone(),
            Self::Db(e) => format!("数据库操作失败：{e}"),
            Self::Json(e) => format!("数据格式错误：{e}"),
            Self::Http(e) => format!("网络请求失败：{e}"),
            Self::Io(e) => format!("文件操作失败：{e}"),
            Self::Internal(e) => format!("内部错误：{e}"),
        }
    }
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut state = serializer.serialize_struct("AppError", 2)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", &self.message())?;
        state.end()
    }
}

impl From<reqwest::Error> for AppError {
    fn from(value: reqwest::Error) -> Self {
        let message = if value.is_timeout() {
            "请求超时。内容已保留，可稍后重试。".to_string()
        } else if value.is_connect() {
            "无法连接模型服务。请检查网络和 Base URL。".to_string()
        } else {
            format!("模型服务请求失败（{}）。", value.status().map(|s| s.as_u16().to_string()).unwrap_or_else(|| "无响应".into()))
        };
        Self::Http(message)
    }
}

pub type AppResult<T> = Result<T, AppError>;
