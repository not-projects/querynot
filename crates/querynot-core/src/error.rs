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

#[derive(Clone, Debug, Deserialize, Error, Eq, PartialEq, Serialize)]
#[error("{safe_message}")]
pub struct QueryNotError {
    pub category: ErrorCategory,
    pub safe_message: String,
    pub retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub safe_detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<String>,
}

impl QueryNotError {
    #[must_use]
    pub fn fixture(message: impl Into<String>) -> Self {
        Self {
            category: ErrorCategory::Authorization,
            safe_message: message.into(),
            retryable: false,
            safe_detail: None,
            context: None,
        }
    }

    #[must_use]
    pub fn local_storage(message: impl Into<String>, retryable: bool) -> Self {
        Self {
            category: ErrorCategory::LocalStorage,
            safe_message: message.into(),
            retryable,
            safe_detail: None,
            context: None,
        }
    }

    #[must_use]
    pub fn authorization(message: impl Into<String>) -> Self {
        Self {
            category: ErrorCategory::Authorization,
            safe_message: message.into(),
            retryable: false,
            safe_detail: None,
            context: None,
        }
    }

    #[must_use]
    pub fn internal(message: impl Into<String>) -> Self {
        Self {
            category: ErrorCategory::Internal,
            safe_message: message.into(),
            retryable: false,
            safe_detail: None,
            context: None,
        }
    }

    #[must_use]
    pub fn database(category: ErrorCategory, message: impl Into<String>, retryable: bool) -> Self {
        Self {
            category,
            safe_message: message.into(),
            retryable,
            safe_detail: None,
            context: None,
        }
    }

    /// Ephemeral statement feedback only; history and diagnostics retain categories.
    #[must_use]
    pub fn statement_message(&self) -> String {
        match &self.safe_detail {
            Some(detail) => format!("{}\n{detail}", self.safe_message),
            None => self.safe_message.clone(),
        }
    }

    #[must_use]
    pub fn cancelled(message: impl Into<String>) -> Self {
        Self::database(ErrorCategory::Cancelled, message, false)
    }
}

/// Bound query diagnostics before presenting them as plain text in the workbench.
/// Callers must select statement-syntax/name-resolution errors, never credential,
/// transport, or constraint messages that can contain secrets or row values.
pub(crate) fn bounded_statement_diagnostic(message: &str) -> String {
    let mut characters = message
        .chars()
        .filter(|character| !character.is_control() || matches!(character, '\n' | '\t'));
    let mut bounded: String = characters.by_ref().take(4096).collect();
    if characters.next().is_some() {
        bounded.push('…');
    }
    bounded
}
