use crate::{ProfileId, SecretRef};
use serde::{Deserialize, Serialize};

pub const MAX_PROFILE_NAME_CHARS: usize = 100;
pub const MAX_ENDPOINT_CHARS: usize = 255;
pub const MIN_CONNECTION_TIMEOUT_SECONDS: u16 = 5;
pub const MAX_CONNECTION_TIMEOUT_SECONDS: u16 = 120;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TlsMode {
    Required,
    VerifyIdentity,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ConnectionTarget {
    Sqlite {
        file_path: String,
        read_only: bool,
    },
    MysqlFamily {
        host: String,
        port: u16,
        default_database: Option<String>,
        username: String,
        tls_mode: TlsMode,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ConnectionProfile {
    pub id: ProfileId,
    pub name: String,
    pub target: ConnectionTarget,
    pub secret_reference: Option<SecretRef>,
    pub connection_timeout_seconds: u16,
    pub automatic_reconnect: bool,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Clone, Debug, Eq, PartialEq, thiserror::Error)]
pub enum ProfileValidationError {
    #[error("profile name must contain 1 to {MAX_PROFILE_NAME_CHARS} characters")]
    InvalidName,
    #[error("SQLite profiles require an absolute file path granted by a native file chooser")]
    InvalidSqlitePath,
    #[error("network host must contain 1 to {MAX_ENDPOINT_CHARS} characters")]
    InvalidHost,
    #[error("network username must not exceed {MAX_ENDPOINT_CHARS} characters")]
    InvalidUsername,
    #[error("default database must not exceed {MAX_ENDPOINT_CHARS} characters")]
    InvalidDatabase,
    #[error("network port must be non-zero")]
    InvalidPort,
    #[error("connection timeout must be between 5 and 120 seconds")]
    InvalidTimeout,
    #[error("automatic reconnect requires a saved credential")]
    ReconnectWithoutSavedSecret,
}

impl From<ProfileValidationError> for crate::QueryNotError {
    fn from(error: ProfileValidationError) -> Self {
        crate::QueryNotError::authorization(error.to_string())
    }
}

impl ConnectionProfile {
    pub fn new(
        name: impl Into<String>,
        target: ConnectionTarget,
        connection_timeout_seconds: u16,
        now_ms: i64,
    ) -> Result<Self, ProfileValidationError> {
        let profile = Self {
            id: ProfileId::new(),
            name: name.into(),
            target,
            secret_reference: None,
            connection_timeout_seconds,
            automatic_reconnect: false,
            created_at_ms: now_ms,
            updated_at_ms: now_ms,
        };
        profile.validate()?;
        Ok(profile)
    }

    pub fn validate(&self) -> Result<(), ProfileValidationError> {
        let name_chars = self.name.trim().chars().count();
        if !(1..=MAX_PROFILE_NAME_CHARS).contains(&name_chars) {
            return Err(ProfileValidationError::InvalidName);
        }
        if !(MIN_CONNECTION_TIMEOUT_SECONDS..=MAX_CONNECTION_TIMEOUT_SECONDS)
            .contains(&self.connection_timeout_seconds)
        {
            return Err(ProfileValidationError::InvalidTimeout);
        }
        if self.automatic_reconnect && self.secret_reference.is_none() {
            return Err(ProfileValidationError::ReconnectWithoutSavedSecret);
        }
        match &self.target {
            ConnectionTarget::Sqlite { file_path, .. } => {
                if file_path.is_empty() || !std::path::Path::new(file_path).is_absolute() {
                    return Err(ProfileValidationError::InvalidSqlitePath);
                }
            }
            ConnectionTarget::MysqlFamily {
                host,
                port,
                default_database,
                username,
                ..
            } => {
                if host.trim().is_empty() || host.chars().count() > MAX_ENDPOINT_CHARS {
                    return Err(ProfileValidationError::InvalidHost);
                }
                if *port == 0 {
                    return Err(ProfileValidationError::InvalidPort);
                }
                if username.chars().count() > MAX_ENDPOINT_CHARS {
                    return Err(ProfileValidationError::InvalidUsername);
                }
                if default_database
                    .as_ref()
                    .is_some_and(|database| database.chars().count() > MAX_ENDPOINT_CHARS)
                {
                    return Err(ProfileValidationError::InvalidDatabase);
                }
            }
        }
        Ok(())
    }

    #[must_use]
    pub fn duplicate(&self, now_ms: i64) -> Self {
        Self {
            id: ProfileId::new(),
            name: format!("{} copy", self.name),
            target: self.target.clone(),
            secret_reference: None,
            connection_timeout_seconds: self.connection_timeout_seconds,
            automatic_reconnect: false,
            created_at_ms: now_ms,
            updated_at_ms: now_ms,
        }
    }

    pub fn attach_secret_reference(&mut self, secret_reference: SecretRef, now_ms: i64) {
        self.secret_reference = Some(secret_reference);
        self.updated_at_ms = now_ms;
    }

    pub fn remove_secret_reference(&mut self, now_ms: i64) {
        self.secret_reference = None;
        self.automatic_reconnect = false;
        self.updated_at_ms = now_ms;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn network_profile() -> ConnectionProfile {
        ConnectionProfile::new(
            "Local MySQL",
            ConnectionTarget::MysqlFamily {
                host: "127.0.0.1".to_owned(),
                port: 3306,
                default_database: Some("fixture".to_owned()),
                username: "querynot".to_owned(),
                tls_mode: TlsMode::VerifyIdentity,
            },
            15,
            100,
        )
        .unwrap()
    }

    #[test]
    fn duplicate_never_copies_secret_reference_or_reconnect() {
        let mut source = network_profile();
        source.attach_secret_reference(SecretRef::new(), 101);
        source.automatic_reconnect = true;

        let duplicate = source.duplicate(200);

        assert_ne!(duplicate.id, source.id);
        assert_eq!(duplicate.target, source.target);
        assert_eq!(duplicate.secret_reference, None);
        assert!(!duplicate.automatic_reconnect);
    }

    #[test]
    fn validation_rejects_unproven_relative_paths_and_unsafe_reconnect() {
        let relative = ConnectionProfile::new(
            "Relative",
            ConnectionTarget::Sqlite {
                file_path: "private.db".to_owned(),
                read_only: false,
            },
            15,
            100,
        );
        assert_eq!(
            relative.unwrap_err(),
            ProfileValidationError::InvalidSqlitePath
        );

        let mut network = network_profile();
        network.automatic_reconnect = true;
        assert_eq!(
            network.validate(),
            Err(ProfileValidationError::ReconnectWithoutSavedSecret)
        );
    }
}
