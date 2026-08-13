use crate::{ProfileId, TabId};
use serde::{Deserialize, Serialize};

pub const MAX_DRAFT_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_OPEN_TABS: usize = 256;

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceTabKind {
    #[default]
    Query,
    TableData,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct WorkspaceTab {
    pub id: TabId,
    pub title: String,
    #[serde(default)]
    pub kind: WorkspaceTabKind,
    #[serde(default)]
    pub pinned: bool,
    pub profile_id: Option<ProfileId>,
    pub profile_label: Option<String>,
    pub context_label: Option<String>,
    pub sql: String,
    pub dirty: bool,
    pub position: u16,
    pub source_file_path: Option<String>,
    pub source_file_modified_ms: Option<i64>,
    #[serde(default)]
    pub source_file_size: Option<u64>,
    #[serde(default)]
    pub source_file_identity: Option<String>,
    #[serde(default)]
    pub table_namespace: Option<String>,
    #[serde(default)]
    pub table_name: Option<String>,
    pub reconnectable: bool,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct PanelSizes {
    pub explorer_percent: f64,
    pub results_percent: f64,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct WorkspaceSnapshot {
    pub tabs: Vec<WorkspaceTab>,
    pub active_tab_id: Option<TabId>,
    pub panel_sizes: PanelSizes,
}

#[derive(Clone, Debug, Eq, PartialEq, thiserror::Error)]
pub enum WorkspaceValidationError {
    #[error("workspace exceeds the tab limit")]
    TooManyTabs,
    #[error("draft exceeds the per-tab byte limit")]
    DraftTooLarge,
    #[error("workspace contains duplicate tab identifiers or positions")]
    DuplicateTab,
    #[error("active tab does not exist")]
    UnknownActiveTab,
    #[error("workspace tab metadata is invalid")]
    InvalidTab,
}

impl WorkspaceSnapshot {
    pub fn validate(&self) -> Result<(), WorkspaceValidationError> {
        if self.tabs.len() > MAX_OPEN_TABS {
            return Err(WorkspaceValidationError::TooManyTabs);
        }
        let mut ids = std::collections::HashSet::new();
        let mut positions = std::collections::HashSet::new();
        for tab in &self.tabs {
            if tab.sql.len() > MAX_DRAFT_BYTES {
                return Err(WorkspaceValidationError::DraftTooLarge);
            }
            if tab.title.is_empty()
                || tab.title.len() > 256
                || tab.title.bytes().any(|byte| byte == 0)
                || matches!(
                    (
                        &tab.source_file_modified_ms,
                        &tab.source_file_size,
                        &tab.source_file_identity
                    ),
                    (Some(_), None, _)
                        | (Some(_), _, None)
                        | (None, Some(_), _)
                        | (None, _, Some(_))
                )
                || (tab.kind == WorkspaceTabKind::TableData
                    && (tab.profile_id.is_none()
                        || tab.context_label.is_none()
                        || tab.table_namespace.is_none()
                        || tab.table_name.is_none()
                        || tab.source_file_path.is_some()
                        || tab.dirty))
                || (tab.kind == WorkspaceTabKind::Query
                    && (tab.table_namespace.is_some() || tab.table_name.is_some()))
            {
                return Err(WorkspaceValidationError::InvalidTab);
            }
            if !ids.insert(tab.id) || !positions.insert(tab.position) {
                return Err(WorkspaceValidationError::DuplicateTab);
            }
        }
        if self
            .active_tab_id
            .is_some_and(|active| !ids.contains(&active))
        {
            return Err(WorkspaceValidationError::UnknownActiveTab);
        }
        Ok(())
    }

    #[must_use]
    pub fn restore_offline(mut self) -> Self {
        for tab in &mut self.tabs {
            tab.reconnectable = tab.profile_id.is_some() && tab.reconnectable;
        }
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restoration_preserves_drafts_binding_order_and_context_without_execution_state() {
        let profile = ProfileId::new();
        let first = TabId::new();
        let second = TabId::new();
        let snapshot = WorkspaceSnapshot {
            tabs: vec![
                WorkspaceTab {
                    id: first,
                    title: "fixture query".to_owned(),
                    kind: WorkspaceTabKind::Query,
                    pinned: false,
                    profile_id: Some(profile),
                    profile_label: Some("Local fixture".to_owned()),
                    context_label: Some("main".to_owned()),
                    sql: "select 1".to_owned(),
                    dirty: true,
                    position: 0,
                    source_file_path: None,
                    source_file_modified_ms: None,
                    source_file_size: None,
                    source_file_identity: None,
                    table_namespace: None,
                    table_name: None,
                    reconnectable: true,
                },
                WorkspaceTab {
                    id: second,
                    title: "offline.sql".to_owned(),
                    kind: WorkspaceTabKind::Query,
                    pinned: true,
                    profile_id: None,
                    profile_label: None,
                    context_label: None,
                    sql: "select 2".to_owned(),
                    dirty: false,
                    position: 1,
                    source_file_path: Some("/fixture/offline.sql".to_owned()),
                    source_file_modified_ms: Some(10),
                    source_file_size: Some(8),
                    source_file_identity: Some("fixture".to_owned()),
                    table_namespace: None,
                    table_name: None,
                    reconnectable: false,
                },
            ],
            active_tab_id: Some(second),
            panel_sizes: PanelSizes {
                explorer_percent: 22.0,
                results_percent: 36.0,
            },
        };
        snapshot.validate().unwrap();
        let restored = snapshot.restore_offline();
        assert_eq!(restored.tabs[0].sql, "select 1");
        assert_eq!(restored.tabs[0].profile_id, Some(profile));
        assert_eq!(restored.tabs[0].context_label.as_deref(), Some("main"));
        assert_eq!(restored.active_tab_id, Some(second));
    }
}
