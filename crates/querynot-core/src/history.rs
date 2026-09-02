use crate::{ErrorCategory, HistoryEntryId, ProfileId};
use serde::{Deserialize, Serialize};

pub const MAX_HISTORY_SQL_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_HISTORY_RESULTS: usize = 1_000;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct HistoryEntry {
    pub id: HistoryEntryId,
    pub sql: String,
    pub timestamp_ms: i64,
    pub profile_id: Option<ProfileId>,
    pub profile_label: String,
    pub engine: String,
    pub context: String,
    pub duration_ms: u64,
    pub status: HistoryStatus,
    #[serde(default)]
    pub operation_kind: HistoryOperationKind,
    pub affected_rows: u64,
    pub received_rows: u64,
    pub error_category: Option<ErrorCategory>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HistoryEntryInput {
    pub sql: String,
    pub timestamp_ms: i64,
    pub profile_id: ProfileId,
    pub profile_label: String,
    pub engine: String,
    pub context: String,
    pub duration_ms: u64,
    pub status: HistoryStatus,
    pub operation_kind: HistoryOperationKind,
    pub affected_rows: u64,
    pub received_rows: u64,
    pub error_category: Option<ErrorCategory>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum HistoryStatus {
    Succeeded,
    Failed,
    Cancelled,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum HistoryOperationKind {
    #[default]
    Query,
    Explain,
}

impl HistoryEntry {
    #[must_use]
    pub fn new(input: HistoryEntryInput) -> Self {
        Self {
            id: HistoryEntryId::new(),
            sql: input.sql,
            timestamp_ms: input.timestamp_ms,
            profile_id: Some(input.profile_id),
            profile_label: input.profile_label,
            engine: input.engine,
            context: input.context,
            duration_ms: input.duration_ms,
            status: input.status,
            operation_kind: input.operation_kind,
            affected_rows: input.affected_rows,
            received_rows: input.received_rows,
            error_category: input.error_category,
        }
    }

    pub fn validate(&self) -> Result<(), HistoryValidationError> {
        if self.sql.is_empty() || self.sql.len() > MAX_HISTORY_SQL_BYTES {
            return Err(HistoryValidationError::Sql);
        }
        if self.timestamp_ms < 0
            || self.profile_label.is_empty()
            || self.profile_label.len() > 1_024
            || self.engine.is_empty()
            || self.engine.len() > 256
            || self.context.len() > 1_024
            || self
                .profile_label
                .bytes()
                .chain(self.engine.bytes())
                .chain(self.context.bytes())
                .any(|byte| byte == 0)
        {
            return Err(HistoryValidationError::Metadata);
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum HistoryValidationError {
    #[error("history SQL is empty or exceeds the safe local boundary")]
    Sql,
    #[error("history metadata is invalid")]
    Metadata,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn history_schema_contains_only_the_allowlisted_execution_summary() {
        let entry = HistoryEntry::new(HistoryEntryInput {
            sql: "select 1".to_owned(),
            timestamp_ms: 10,
            profile_id: ProfileId::new(),
            profile_label: "fixture".to_owned(),
            engine: "SQLite 3.50.4".to_owned(),
            context: "main".to_owned(),
            duration_ms: 5,
            status: HistoryStatus::Succeeded,
            operation_kind: HistoryOperationKind::Query,
            affected_rows: 0,
            received_rows: 1,
            error_category: None,
        });
        entry.validate().unwrap();
        let json = serde_json::to_value(entry).unwrap();
        let object = json.as_object().unwrap();
        assert!(!object.contains_key("rows"));
        assert!(!object.contains_key("password"));
        assert!(!object.contains_key("driver_detail"));
        assert!(!object.contains_key("staged_edits"));
        assert!(!object.contains_key("raw_payload"));
    }

    #[test]
    fn missing_operation_kind_defaults_to_query() {
        let json = r#"{"id":"00000000-0000-4000-8000-000000000001","sql":"select 1","timestamp_ms":10,"profile_id":null,"profile_label":"fixture","engine":"SQLite","context":"main","duration_ms":1,"status":"succeeded","affected_rows":0,"received_rows":1,"error_category":null}"#;
        let entry: HistoryEntry = serde_json::from_str(json).unwrap();
        assert_eq!(entry.operation_kind, HistoryOperationKind::Query);
    }

    #[test]
    fn explain_history_contains_only_sql_and_outcome_metadata() {
        let entry = HistoryEntry::new(HistoryEntryInput {
            sql: "select * from fixture".to_owned(),
            timestamp_ms: 11,
            profile_id: ProfileId::new(),
            profile_label: "fixture".to_owned(),
            engine: "MariaDB 11.4.12".to_owned(),
            context: "fixture".to_owned(),
            duration_ms: 7,
            status: HistoryStatus::Succeeded,
            operation_kind: HistoryOperationKind::Explain,
            affected_rows: 0,
            received_rows: 0,
            error_category: None,
        });
        let json = serde_json::to_string(&entry).unwrap();
        assert!(json.contains("\"operation_kind\":\"explain\""));
        assert!(!json.contains("raw_payload"));
        assert!(!json.contains("nodes"));
    }
}
