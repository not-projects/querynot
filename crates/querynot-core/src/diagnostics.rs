use crate::ErrorCategory;
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DiagnosticArea {
    Application,
    LocalStore,
    Vault,
    ProfileLifecycle,
    Workspace,
    Export,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct OperationalEvent {
    pub timestamp_ms: i64,
    pub area: DiagnosticArea,
    pub code: String,
    pub error_category: Option<ErrorCategory>,
}

impl OperationalEvent {
    pub fn validate(&self) -> Result<(), DiagnosticError> {
        if self.code.is_empty()
            || self.code.len() > 64
            || !self
                .code
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
        {
            return Err(DiagnosticError::UnsafeEventCode);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct DiagnosticsPreview {
    pub application_version: String,
    pub contract_version: u16,
    pub operating_system: String,
    pub runtime_architecture: String,
    pub events: Vec<OperationalEvent>,
}

#[derive(Clone, Debug, Eq, PartialEq, thiserror::Error)]
pub enum DiagnosticError {
    #[error("diagnostic event code is not from the safe structured alphabet")]
    UnsafeEventCode,
    #[error("local operational logging is unavailable")]
    StorageUnavailable,
    #[error("diagnostic serialization failed")]
    Serialization,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LogWriteOutcome {
    Written,
    Dropped,
}

#[derive(Clone, Debug)]
pub struct LocalOperationalLog {
    path: PathBuf,
    max_bytes: u64,
    retention_ms: i64,
    enabled: bool,
}

impl LocalOperationalLog {
    #[must_use]
    pub fn new(path: PathBuf, max_bytes: u64, retention_days: u16, enabled: bool) -> Self {
        Self {
            path,
            max_bytes,
            retention_ms: i64::from(retention_days) * 24 * 60 * 60 * 1000,
            enabled,
        }
    }

    pub fn append(&self, event: &OperationalEvent, now_ms: i64) -> LogWriteOutcome {
        if !self.enabled || event.validate().is_err() {
            return LogWriteOutcome::Dropped;
        }
        if self.rotate_and_append(event, now_ms).is_err() {
            return LogWriteOutcome::Dropped;
        }
        LogWriteOutcome::Written
    }

    fn rotate_and_append(
        &self,
        event: &OperationalEvent,
        now_ms: i64,
    ) -> Result<(), DiagnosticError> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|_| DiagnosticError::StorageUnavailable)?;
            restrict_directory(parent)?;
        }
        let mut events = self.read_events().unwrap_or_default();
        let oldest = now_ms.saturating_sub(self.retention_ms);
        events.retain(|candidate| candidate.timestamp_ms >= oldest);
        events.push(event.clone());

        let mut encoded = encode_events(&events)?;
        while encoded.len() as u64 > self.max_bytes && events.len() > 1 {
            events.remove(0);
            encoded = encode_events(&events)?;
        }
        if encoded.len() as u64 > self.max_bytes {
            return Err(DiagnosticError::StorageUnavailable);
        }

        let temporary = self.path.with_extension("jsonl.tmp");
        {
            let mut file = OpenOptions::new()
                .create(true)
                .truncate(true)
                .write(true)
                .open(&temporary)
                .map_err(|_| DiagnosticError::StorageUnavailable)?;
            restrict_file(&temporary)?;
            file.write_all(&encoded)
                .and_then(|()| file.sync_all())
                .map_err(|_| DiagnosticError::StorageUnavailable)?;
        }
        fs::rename(&temporary, &self.path).map_err(|_| DiagnosticError::StorageUnavailable)?;
        restrict_file(&self.path)?;
        Ok(())
    }

    pub fn read_events(&self) -> Result<Vec<OperationalEvent>, DiagnosticError> {
        if !self.path.exists() {
            return Ok(Vec::new());
        }
        let content =
            fs::read_to_string(&self.path).map_err(|_| DiagnosticError::StorageUnavailable)?;
        content
            .lines()
            .filter(|line| !line.trim().is_empty())
            .map(|line| serde_json::from_str(line).map_err(|_| DiagnosticError::Serialization))
            .collect()
    }

    pub fn clear(&self) -> Result<(), DiagnosticError> {
        if !self.path.exists() {
            return Ok(());
        }
        let temporary = self.path.with_extension("clear.tmp");
        fs::write(&temporary, []).map_err(|_| DiagnosticError::StorageUnavailable)?;
        restrict_file(&temporary)?;
        fs::rename(temporary, &self.path).map_err(|_| DiagnosticError::StorageUnavailable)
    }

    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl DiagnosticsPreview {
    pub fn write_local_json(&self, path: &Path) -> Result<(), DiagnosticError> {
        let encoded =
            serde_json::to_vec_pretty(self).map_err(|_| DiagnosticError::Serialization)?;
        let temporary = path.with_extension("json.tmp");
        fs::write(&temporary, encoded).map_err(|_| DiagnosticError::StorageUnavailable)?;
        restrict_file(&temporary)?;
        fs::rename(temporary, path).map_err(|_| DiagnosticError::StorageUnavailable)?;
        restrict_file(path)
    }
}

fn encode_events(events: &[OperationalEvent]) -> Result<Vec<u8>, DiagnosticError> {
    let mut bytes = Vec::new();
    for event in events {
        serde_json::to_writer(&mut bytes, event).map_err(|_| DiagnosticError::Serialization)?;
        bytes.push(b'\n');
    }
    Ok(bytes)
}

#[cfg(unix)]
fn restrict_directory(path: &Path) -> Result<(), DiagnosticError> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .map_err(|_| DiagnosticError::StorageUnavailable)
}

#[cfg(not(unix))]
fn restrict_directory(_path: &Path) -> Result<(), DiagnosticError> {
    Ok(())
}

#[cfg(unix)]
fn restrict_file(path: &Path) -> Result<(), DiagnosticError> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|_| DiagnosticError::StorageUnavailable)
}

#[cfg(not(unix))]
fn restrict_file(_path: &Path) -> Result<(), DiagnosticError> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn log_is_structured_bounded_retained_and_contains_no_arbitrary_sensitive_fields() {
        let directory = tempfile::tempdir().unwrap();
        let log = LocalOperationalLog::new(directory.path().join("querynot.jsonl"), 240, 7, true);
        for index in 0..20 {
            assert_eq!(
                log.append(
                    &OperationalEvent {
                        timestamp_ms: 1_000 + index,
                        area: DiagnosticArea::Workspace,
                        code: "draft_saved".to_owned(),
                        error_category: None,
                    },
                    1_020,
                ),
                LogWriteOutcome::Written
            );
        }
        let bytes = fs::read(log.path()).unwrap();
        assert!(bytes.len() <= 240);
        let text = String::from_utf8(bytes).unwrap();
        assert!(!text.contains("password"));
        assert!(!text.contains("endpoint"));
        assert!(!text.contains("select "));

        log.clear().unwrap();
        assert_eq!(fs::read(log.path()).unwrap(), Vec::<u8>::new());
    }

    #[test]
    fn logging_failure_is_non_fatal_and_unsafe_free_text_is_refused() {
        let directory = tempfile::tempdir().unwrap();
        let log = LocalOperationalLog::new(directory.path().join("querynot.jsonl"), 1024, 7, true);
        let outcome = log.append(
            &OperationalEvent {
                timestamp_ms: 1,
                area: DiagnosticArea::Vault,
                code: "password=hunter2".to_owned(),
                error_category: Some(ErrorCategory::Authentication),
            },
            1,
        );
        assert_eq!(outcome, LogWriteOutcome::Dropped);
        assert!(!log.path().exists());
    }
}
