use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCategory {
    Authentication,
    Authorization,
    Connectivity,
    Tls,
    Timeout,
    Cancelled,
    Syntax,
    Constraint,
    Transaction,
    UnsupportedCapability,
    LocalStorage,
    Internal,
}

#[derive(Debug, Error)]
#[error("{safe_message}")]
pub struct QueryNotError {
    pub category: ErrorCategory,
    pub safe_message: String,
    pub retryable: bool,
}

impl QueryNotError {
    #[must_use]
    pub fn fixture(message: impl Into<String>) -> Self {
        Self {
            category: ErrorCategory::Authorization,
            safe_message: message.into(),
            retryable: false,
        }
    }
}
