#[cfg(test)]
use crate::history::HistoryEntryInput;
use crate::history::{HistoryEntry, MAX_HISTORY_RESULTS};
use crate::profile::ConnectionProfile;
use crate::settings::AppSettings;
use crate::state::LocalStoreState;
use crate::vault::{SecretVault, VaultError};
use crate::workspace::{WorkspaceSnapshot, WorkspaceTabKind};
use crate::{HistoryEntryId, ProfileId, SecretRef};
use serde::{Deserialize, Serialize};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Connection, Executor, Row, SqliteConnection, SqlitePool};
use std::path::{Path, PathBuf};
use std::str::FromStr;

pub const CURRENT_STORE_VERSION: u32 = 3;

const MIGRATION_1: &[&str] = &[
    "CREATE TABLE profiles (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, metadata_json TEXT NOT NULL, deletion_state TEXT NOT NULL DEFAULT 'active', created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL)",
    "CREATE TABLE settings (singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1), settings_json TEXT NOT NULL, updated_at_ms INTEGER NOT NULL)",
    "CREATE TABLE workspace (singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1), snapshot_json TEXT NOT NULL, updated_at_ms INTEGER NOT NULL)",
    "CREATE TABLE history (id TEXT PRIMARY KEY NOT NULL, profile_id TEXT, profile_label TEXT, metadata_json TEXT NOT NULL)",
    "CREATE TABLE schema_cache (profile_id TEXT NOT NULL, cache_key TEXT NOT NULL, metadata_json TEXT NOT NULL, PRIMARY KEY (profile_id, cache_key))",
];

const MIGRATION_2: &[&str] = &[
    "CREATE TABLE profile_deletions (profile_id TEXT PRIMARY KEY NOT NULL, secret_reference TEXT, delete_history INTEGER NOT NULL, delete_drafts INTEGER NOT NULL, vault_deleted INTEGER NOT NULL DEFAULT 0, requested_at_ms INTEGER NOT NULL)",
    "CREATE INDEX history_profile_idx ON history(profile_id)",
    "CREATE INDEX schema_cache_profile_idx ON schema_cache(profile_id)",
];

const MIGRATION_3: &[&str] = &[
    "ALTER TABLE history ADD COLUMN timestamp_ms INTEGER NOT NULL DEFAULT 0",
    "CREATE INDEX history_timestamp_idx ON history(timestamp_ms DESC, id)",
];

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct MigrationFault {
    pub fail_before_version: Option<u32>,
    pub fail_after_statement: Option<(u32, usize)>,
}

impl MigrationFault {
    #[must_use]
    pub const fn before(version: u32) -> Self {
        Self {
            fail_before_version: Some(version),
            fail_after_statement: None,
        }
    }

    #[must_use]
    pub const fn after_statement(version: u32, statement_count: usize) -> Self {
        Self {
            fail_before_version: None,
            fail_after_statement: Some((version, statement_count)),
        }
    }
}

#[derive(Debug)]
pub struct LocalStoreBootstrap {
    pub store: Option<LocalStore>,
    pub state: LocalStoreState,
    pub safe_message: Option<String>,
}

#[derive(Clone, Debug)]
pub struct LocalStore {
    path: PathBuf,
    pool: SqlitePool,
}

#[derive(Clone, Debug, Eq, PartialEq, thiserror::Error)]
pub enum StoreError {
    #[error("the QueryNot local store is unavailable; the existing file was not replaced")]
    Unavailable,
    #[error("the QueryNot local store migration failed; the last committed schema was preserved")]
    MigrationFailed,
    #[error("stored QueryNot data is invalid; the existing file was not replaced")]
    InvalidData,
    #[error("requested profile was not found")]
    ProfileNotFound,
    #[error("profile deletion has not completed its vault step")]
    VaultStepPending,
}

impl From<StoreError> for crate::QueryNotError {
    fn from(error: StoreError) -> Self {
        crate::QueryNotError::local_storage(error.to_string(), true)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ProfileDeletion {
    pub profile_id: ProfileId,
    pub secret_reference: Option<SecretRef>,
    pub delete_history: bool,
    pub delete_drafts: bool,
    pub vault_deleted: bool,
    pub requested_at_ms: i64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProfileDeletionOutcome {
    Deleted,
    PendingVault(VaultError),
    PendingLocalStore(StoreError),
}

impl LocalStore {
    pub async fn bootstrap(path: impl Into<PathBuf>) -> LocalStoreBootstrap {
        Self::bootstrap_with_fault(path, MigrationFault::default()).await
    }

    pub async fn bootstrap_with_fault(
        path: impl Into<PathBuf>,
        fault: MigrationFault,
    ) -> LocalStoreBootstrap {
        let path = path.into();
        match Self::open(&path, fault).await {
            Ok(store) => LocalStoreBootstrap {
                store: Some(store),
                state: LocalStoreState::Healthy,
                safe_message: None,
            },
            Err(StoreError::MigrationFailed | StoreError::InvalidData) => LocalStoreBootstrap {
                store: None,
                state: LocalStoreState::MigrationFailed,
                safe_message: Some(
                    "QueryNot could not upgrade its local store. The existing store was preserved; profile and draft changes are disabled until recovery."
                        .to_owned(),
                ),
            },
            Err(_) => LocalStoreBootstrap {
                store: None,
                state: LocalStoreState::Degraded,
                safe_message: Some(
                    "QueryNot local storage is unavailable. Existing data was not replaced; profile and draft changes are disabled until recovery."
                        .to_owned(),
                ),
            },
        }
    }

    async fn open(path: &Path, fault: MigrationFault) -> Result<Self, StoreError> {
        if !path.is_absolute() {
            return Err(StoreError::Unavailable);
        }
        let existed = path.exists();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|_| StoreError::Unavailable)?;
            restrict_directory(parent)?;
        }

        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(!existed)
            .foreign_keys(true);
        let mut connection = SqliteConnection::connect_with(&options)
            .await
            .map_err(|_| StoreError::InvalidData)?;
        restrict_file(path)?;

        let quick_check: String = sqlx::query_scalar("PRAGMA quick_check")
            .fetch_one(&mut connection)
            .await
            .map_err(|_| StoreError::InvalidData)?;
        if quick_check != "ok" {
            return Err(StoreError::InvalidData);
        }
        if !existed {
            connection
                .execute("PRAGMA auto_vacuum = INCREMENTAL")
                .await
                .map_err(|_| StoreError::Unavailable)?;
        }

        migrate(&mut connection, fault).await?;
        connection
            .close()
            .await
            .map_err(|_| StoreError::Unavailable)?;

        let pool = SqlitePoolOptions::new()
            .max_connections(4)
            .connect_with(options)
            .await
            .map_err(|_| StoreError::Unavailable)?;
        Ok(Self {
            path: path.to_path_buf(),
            pool,
        })
    }

    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    pub async fn schema_version(&self) -> Result<u32, StoreError> {
        let version: i64 = sqlx::query_scalar("PRAGMA user_version")
            .fetch_one(&self.pool)
            .await
            .map_err(|_| StoreError::Unavailable)?;
        u32::try_from(version).map_err(|_| StoreError::InvalidData)
    }

    pub async fn save_profile(&self, profile: &ConnectionProfile) -> Result<(), StoreError> {
        profile.validate().map_err(|_| StoreError::InvalidData)?;
        let metadata = serde_json::to_string(profile).map_err(|_| StoreError::InvalidData)?;
        sqlx::query(
            "INSERT INTO profiles (id, name, metadata_json, deletion_state, created_at_ms, updated_at_ms) VALUES (?, ?, ?, 'active', ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, metadata_json = excluded.metadata_json, updated_at_ms = excluded.updated_at_ms",
        )
        .bind(profile.id.to_string())
        .bind(&profile.name)
        .bind(metadata)
        .bind(profile.created_at_ms)
        .bind(profile.updated_at_ms)
        .execute(&self.pool)
        .await
        .map_err(|_| StoreError::Unavailable)?;
        Ok(())
    }

    pub async fn profile(&self, profile_id: ProfileId) -> Result<ConnectionProfile, StoreError> {
        let metadata: Option<String> =
            sqlx::query_scalar("SELECT metadata_json FROM profiles WHERE id = ?")
                .bind(profile_id.to_string())
                .fetch_optional(&self.pool)
                .await
                .map_err(|_| StoreError::Unavailable)?;
        let metadata = metadata.ok_or(StoreError::ProfileNotFound)?;
        serde_json::from_str(&metadata).map_err(|_| StoreError::InvalidData)
    }

    pub async fn list_profiles(&self) -> Result<Vec<ConnectionProfile>, StoreError> {
        let rows: Vec<String> = sqlx::query_scalar(
            "SELECT metadata_json FROM profiles ORDER BY lower(name), created_at_ms, id",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|_| StoreError::Unavailable)?;
        rows.into_iter()
            .map(|metadata| serde_json::from_str(&metadata).map_err(|_| StoreError::InvalidData))
            .collect()
    }

    pub async fn save_settings(
        &self,
        settings: &AppSettings,
        now_ms: i64,
    ) -> Result<(), StoreError> {
        settings.validate().map_err(|_| StoreError::InvalidData)?;
        let serialized = serde_json::to_string(settings).map_err(|_| StoreError::InvalidData)?;
        sqlx::query(
            "INSERT INTO settings (singleton, settings_json, updated_at_ms) VALUES (1, ?, ?) ON CONFLICT(singleton) DO UPDATE SET settings_json = excluded.settings_json, updated_at_ms = excluded.updated_at_ms",
        )
        .bind(serialized)
        .bind(now_ms)
        .execute(&self.pool)
        .await
        .map_err(|_| StoreError::Unavailable)?;
        Ok(())
    }

    pub async fn load_settings(&self) -> Result<AppSettings, StoreError> {
        let serialized: Option<String> =
            sqlx::query_scalar("SELECT settings_json FROM settings WHERE singleton = 1")
                .fetch_optional(&self.pool)
                .await
                .map_err(|_| StoreError::Unavailable)?;
        match serialized {
            Some(serialized) => {
                let settings: AppSettings =
                    serde_json::from_str(&serialized).map_err(|_| StoreError::InvalidData)?;
                settings.validate().map_err(|_| StoreError::InvalidData)?;
                Ok(settings)
            }
            None => Ok(AppSettings::default()),
        }
    }

    pub async fn save_workspace(
        &self,
        snapshot: &WorkspaceSnapshot,
        now_ms: i64,
    ) -> Result<(), StoreError> {
        snapshot.validate().map_err(|_| StoreError::InvalidData)?;
        let serialized = serde_json::to_string(snapshot).map_err(|_| StoreError::InvalidData)?;
        sqlx::query(
            "INSERT INTO workspace (singleton, snapshot_json, updated_at_ms) VALUES (1, ?, ?) ON CONFLICT(singleton) DO UPDATE SET snapshot_json = excluded.snapshot_json, updated_at_ms = excluded.updated_at_ms",
        )
        .bind(serialized)
        .bind(now_ms)
        .execute(&self.pool)
        .await
        .map_err(|_| StoreError::Unavailable)?;
        Ok(())
    }

    pub async fn load_workspace(&self) -> Result<WorkspaceSnapshot, StoreError> {
        let serialized: Option<String> =
            sqlx::query_scalar("SELECT snapshot_json FROM workspace WHERE singleton = 1")
                .fetch_optional(&self.pool)
                .await
                .map_err(|_| StoreError::Unavailable)?;
        match serialized {
            Some(serialized) => {
                let snapshot: WorkspaceSnapshot =
                    serde_json::from_str(&serialized).map_err(|_| StoreError::InvalidData)?;
                snapshot.validate().map_err(|_| StoreError::InvalidData)?;
                Ok(snapshot.restore_offline())
            }
            None => Ok(WorkspaceSnapshot::default()),
        }
    }

    pub async fn clear_workspace(&self) -> Result<bool, StoreError> {
        Ok(sqlx::query("DELETE FROM workspace WHERE singleton = 1")
            .execute(&self.pool)
            .await
            .map_err(|_| StoreError::Unavailable)?
            .rows_affected()
            == 1)
    }

    pub async fn save_history_entry(&self, entry: &HistoryEntry) -> Result<(), StoreError> {
        entry.validate().map_err(|_| StoreError::InvalidData)?;
        let metadata = serde_json::to_string(entry).map_err(|_| StoreError::InvalidData)?;
        sqlx::query(
            "INSERT INTO history (id, profile_id, profile_label, metadata_json, timestamp_ms) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(entry.id.to_string())
        .bind(entry.profile_id.map(|id| id.to_string()))
        .bind(&entry.profile_label)
        .bind(metadata)
        .bind(entry.timestamp_ms)
        .execute(&self.pool)
        .await
        .map_err(|_| StoreError::Unavailable)?;
        Ok(())
    }

    pub async fn list_history(
        &self,
        search: &str,
        limit: usize,
    ) -> Result<Vec<HistoryEntry>, StoreError> {
        if search.len() > 4_096 || search.bytes().any(|byte| byte == 0) {
            return Err(StoreError::InvalidData);
        }
        let limit = limit.clamp(1, MAX_HISTORY_RESULTS) as i64;
        let pattern = format!(
            "%{}%",
            search
                .replace('\\', "\\\\")
                .replace('%', "\\%")
                .replace('_', "\\_")
        );
        let rows = sqlx::query(
            "SELECT profile_id, profile_label, metadata_json FROM history WHERE ? = '' OR metadata_json LIKE ? ESCAPE '\\' ORDER BY timestamp_ms DESC, id DESC LIMIT ?",
        )
        .bind(search)
        .bind(pattern)
        .bind(limit)
        .fetch_all(&self.pool)
        .await
        .map_err(|_| StoreError::Unavailable)?;
        rows.into_iter()
            .map(|row| {
                let metadata: String = row
                    .try_get("metadata_json")
                    .map_err(|_| StoreError::InvalidData)?;
                let mut entry: HistoryEntry =
                    serde_json::from_str(&metadata).map_err(|_| StoreError::InvalidData)?;
                entry.profile_id = row
                    .try_get::<Option<String>, _>("profile_id")
                    .map_err(|_| StoreError::InvalidData)?
                    .map(|value| ProfileId::from_str(&value).map_err(|_| StoreError::InvalidData))
                    .transpose()?;
                entry.profile_label = row
                    .try_get("profile_label")
                    .map_err(|_| StoreError::InvalidData)?;
                entry.validate().map_err(|_| StoreError::InvalidData)?;
                Ok(entry)
            })
            .collect()
    }

    pub async fn delete_history_entry(&self, id: HistoryEntryId) -> Result<bool, StoreError> {
        let deleted = sqlx::query("DELETE FROM history WHERE id = ?")
            .bind(id.to_string())
            .execute(&self.pool)
            .await
            .map_err(|_| StoreError::Unavailable)?
            .rows_affected()
            == 1;
        if deleted {
            let _ = self.compact_history().await;
        }
        Ok(deleted)
    }

    pub async fn clear_history(&self) -> Result<u64, StoreError> {
        let deleted = sqlx::query("DELETE FROM history")
            .execute(&self.pool)
            .await
            .map_err(|_| StoreError::Unavailable)?
            .rows_affected();
        if deleted > 0 {
            let _ = self.compact_history().await;
        }
        Ok(deleted)
    }

    pub async fn prune_history(&self, cutoff_ms: i64) -> Result<u64, StoreError> {
        if cutoff_ms < 0 {
            return Err(StoreError::InvalidData);
        }
        let deleted = sqlx::query("DELETE FROM history WHERE timestamp_ms < ?")
            .bind(cutoff_ms)
            .execute(&self.pool)
            .await
            .map_err(|_| StoreError::Unavailable)?
            .rows_affected();
        if deleted > 0 {
            let _ = self.compact_history().await;
        }
        Ok(deleted)
    }

    async fn compact_history(&self) -> Result<(), StoreError> {
        sqlx::query("PRAGMA optimize")
            .execute(&self.pool)
            .await
            .map_err(|_| StoreError::Unavailable)?;
        sqlx::query("PRAGMA incremental_vacuum(128)")
            .execute(&self.pool)
            .await
            .map_err(|_| StoreError::Unavailable)?;
        Ok(())
    }

    pub async fn save_schema_cache<T: serde::Serialize>(
        &self,
        profile_id: ProfileId,
        cache_key: &str,
        metadata: &T,
    ) -> Result<(), StoreError> {
        if cache_key.is_empty() || cache_key.len() > 1_024 {
            return Err(StoreError::InvalidData);
        }
        let serialized = serde_json::to_string(metadata).map_err(|_| StoreError::InvalidData)?;
        if serialized.len() > 16 * 1024 * 1024 {
            return Err(StoreError::InvalidData);
        }
        sqlx::query(
            "INSERT INTO schema_cache (profile_id, cache_key, metadata_json) VALUES (?, ?, ?) ON CONFLICT(profile_id, cache_key) DO UPDATE SET metadata_json = excluded.metadata_json",
        )
        .bind(profile_id.to_string())
        .bind(cache_key)
        .bind(serialized)
        .execute(&self.pool)
        .await
        .map_err(|_| StoreError::Unavailable)?;
        Ok(())
    }

    pub async fn load_schema_cache<T: serde::de::DeserializeOwned>(
        &self,
        profile_id: ProfileId,
        cache_key: &str,
    ) -> Result<Option<T>, StoreError> {
        if cache_key.is_empty() || cache_key.len() > 1_024 {
            return Err(StoreError::InvalidData);
        }
        let serialized: Option<String> = sqlx::query_scalar(
            "SELECT metadata_json FROM schema_cache WHERE profile_id = ? AND cache_key = ?",
        )
        .bind(profile_id.to_string())
        .bind(cache_key)
        .fetch_optional(&self.pool)
        .await
        .map_err(|_| StoreError::Unavailable)?;
        serialized
            .map(|metadata| serde_json::from_str(&metadata).map_err(|_| StoreError::InvalidData))
            .transpose()
    }

    pub async fn begin_profile_deletion(
        &self,
        profile_id: ProfileId,
        delete_history: bool,
        delete_drafts: bool,
        now_ms: i64,
    ) -> Result<ProfileDeletion, StoreError> {
        if let Some(operation) = self.profile_deletion(profile_id).await? {
            return Ok(operation);
        }
        let profile = self.profile(profile_id).await?;
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| StoreError::Unavailable)?;
        sqlx::query("UPDATE profiles SET deletion_state = 'pending' WHERE id = ?")
            .bind(profile_id.to_string())
            .execute(&mut *transaction)
            .await
            .map_err(|_| StoreError::Unavailable)?;
        sqlx::query(
            "INSERT INTO profile_deletions (profile_id, secret_reference, delete_history, delete_drafts, vault_deleted, requested_at_ms) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(profile_id.to_string())
        .bind(profile.secret_reference.map(|reference| reference.to_string()))
        .bind(delete_history)
        .bind(delete_drafts)
        .bind(profile.secret_reference.is_none())
        .bind(now_ms)
        .execute(&mut *transaction)
        .await
        .map_err(|_| StoreError::Unavailable)?;
        transaction
            .commit()
            .await
            .map_err(|_| StoreError::Unavailable)?;
        self.profile_deletion(profile_id)
            .await?
            .ok_or(StoreError::InvalidData)
    }

    pub async fn profile_deletion(
        &self,
        profile_id: ProfileId,
    ) -> Result<Option<ProfileDeletion>, StoreError> {
        let row = sqlx::query(
            "SELECT secret_reference, delete_history, delete_drafts, vault_deleted, requested_at_ms FROM profile_deletions WHERE profile_id = ?",
        )
        .bind(profile_id.to_string())
        .fetch_optional(&self.pool)
        .await
        .map_err(|_| StoreError::Unavailable)?;
        row.map(|row| {
            let secret_reference = row
                .try_get::<Option<String>, _>("secret_reference")
                .map_err(|_| StoreError::InvalidData)?
                .map(|reference| {
                    SecretRef::from_str(&reference).map_err(|_| StoreError::InvalidData)
                })
                .transpose()?;
            Ok(ProfileDeletion {
                profile_id,
                secret_reference,
                delete_history: row
                    .try_get("delete_history")
                    .map_err(|_| StoreError::InvalidData)?,
                delete_drafts: row
                    .try_get("delete_drafts")
                    .map_err(|_| StoreError::InvalidData)?,
                vault_deleted: row
                    .try_get("vault_deleted")
                    .map_err(|_| StoreError::InvalidData)?,
                requested_at_ms: row
                    .try_get("requested_at_ms")
                    .map_err(|_| StoreError::InvalidData)?,
            })
        })
        .transpose()
    }

    pub async fn mark_profile_vault_deleted(
        &self,
        profile_id: ProfileId,
    ) -> Result<(), StoreError> {
        let result =
            sqlx::query("UPDATE profile_deletions SET vault_deleted = 1 WHERE profile_id = ?")
                .bind(profile_id.to_string())
                .execute(&self.pool)
                .await
                .map_err(|_| StoreError::Unavailable)?;
        if result.rows_affected() != 1 {
            return Err(StoreError::ProfileNotFound);
        }
        Ok(())
    }

    pub async fn finalize_profile_deletion(&self, profile_id: ProfileId) -> Result<(), StoreError> {
        let operation = self
            .profile_deletion(profile_id)
            .await?
            .ok_or(StoreError::ProfileNotFound)?;
        if !operation.vault_deleted {
            return Err(StoreError::VaultStepPending);
        }
        let profile = self.profile(profile_id).await?;
        let mut workspace = self.load_workspace().await?;
        let profile_label = format!("Deleted profile: {}", profile.name);
        if operation.delete_drafts {
            workspace
                .tabs
                .retain(|tab| tab.profile_id != Some(profile_id));
        } else {
            workspace.tabs.retain(|tab| {
                tab.profile_id != Some(profile_id) || tab.kind == WorkspaceTabKind::Query
            });
            for tab in &mut workspace.tabs {
                if tab.profile_id == Some(profile_id) {
                    tab.profile_id = None;
                    tab.profile_label = Some(profile_label.clone());
                    tab.reconnectable = false;
                }
            }
        }
        if workspace
            .active_tab_id
            .is_some_and(|active| !workspace.tabs.iter().any(|tab| tab.id == active))
        {
            workspace.active_tab_id = workspace.tabs.first().map(|tab| tab.id);
        }
        for (position, tab) in workspace.tabs.iter_mut().enumerate() {
            tab.position = position as u16;
        }
        workspace.validate().map_err(|_| StoreError::InvalidData)?;

        let serialized_workspace =
            serde_json::to_string(&workspace).map_err(|_| StoreError::InvalidData)?;
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| StoreError::Unavailable)?;
        sqlx::query(
            "INSERT INTO workspace (singleton, snapshot_json, updated_at_ms) VALUES (1, ?, ?) ON CONFLICT(singleton) DO UPDATE SET snapshot_json = excluded.snapshot_json, updated_at_ms = excluded.updated_at_ms",
        )
        .bind(serialized_workspace)
        .bind(unix_time_ms())
        .execute(&mut *transaction)
        .await
        .map_err(|_| StoreError::Unavailable)?;
        if operation.delete_history {
            sqlx::query("DELETE FROM history WHERE profile_id = ?")
                .bind(profile_id.to_string())
                .execute(&mut *transaction)
                .await
                .map_err(|_| StoreError::Unavailable)?;
        } else {
            let retained = sqlx::query(
                "SELECT id, metadata_json FROM history WHERE profile_id = ? ORDER BY id",
            )
            .bind(profile_id.to_string())
            .fetch_all(&mut *transaction)
            .await
            .map_err(|_| StoreError::Unavailable)?;
            for row in retained {
                let id: String = row.try_get("id").map_err(|_| StoreError::InvalidData)?;
                let metadata: String = row
                    .try_get("metadata_json")
                    .map_err(|_| StoreError::InvalidData)?;
                let mut entry: HistoryEntry =
                    serde_json::from_str(&metadata).map_err(|_| StoreError::InvalidData)?;
                entry.profile_id = None;
                entry.profile_label = profile_label.clone();
                entry.validate().map_err(|_| StoreError::InvalidData)?;
                let metadata =
                    serde_json::to_string(&entry).map_err(|_| StoreError::InvalidData)?;
                sqlx::query(
                    "UPDATE history SET profile_id = NULL, profile_label = ?, metadata_json = ? WHERE id = ? AND profile_id = ?",
                )
                .bind(&profile_label)
                .bind(metadata)
                .bind(id)
                .bind(profile_id.to_string())
                .execute(&mut *transaction)
                .await
                .map_err(|_| StoreError::Unavailable)?;
            }
        }
        sqlx::query("DELETE FROM schema_cache WHERE profile_id = ?")
            .bind(profile_id.to_string())
            .execute(&mut *transaction)
            .await
            .map_err(|_| StoreError::Unavailable)?;
        sqlx::query("DELETE FROM profiles WHERE id = ?")
            .bind(profile_id.to_string())
            .execute(&mut *transaction)
            .await
            .map_err(|_| StoreError::Unavailable)?;
        sqlx::query("DELETE FROM profile_deletions WHERE profile_id = ?")
            .bind(profile_id.to_string())
            .execute(&mut *transaction)
            .await
            .map_err(|_| StoreError::Unavailable)?;
        transaction
            .commit()
            .await
            .map_err(|_| StoreError::Unavailable)?;
        if operation.delete_history {
            let _ = self.compact_history().await;
        }
        Ok(())
    }
}

pub async fn delete_profile_two_step<V: SecretVault + ?Sized>(
    store: &LocalStore,
    vault: &V,
    profile_id: ProfileId,
    delete_history: bool,
    delete_drafts: bool,
    now_ms: i64,
) -> ProfileDeletionOutcome {
    let operation = match store
        .begin_profile_deletion(profile_id, delete_history, delete_drafts, now_ms)
        .await
    {
        Ok(operation) => operation,
        Err(error) => return ProfileDeletionOutcome::PendingLocalStore(error),
    };

    if !operation.vault_deleted {
        if let Some(reference) = operation.secret_reference
            && let Err(error) = vault.delete(reference)
        {
            return ProfileDeletionOutcome::PendingVault(error);
        }
        if let Err(error) = store.mark_profile_vault_deleted(profile_id).await {
            return ProfileDeletionOutcome::PendingLocalStore(error);
        }
    }

    match store.finalize_profile_deletion(profile_id).await {
        Ok(()) => ProfileDeletionOutcome::Deleted,
        Err(error) => ProfileDeletionOutcome::PendingLocalStore(error),
    }
}

async fn migrate(
    connection: &mut SqliteConnection,
    fault: MigrationFault,
) -> Result<(), StoreError> {
    let current: i64 = sqlx::query_scalar("PRAGMA user_version")
        .fetch_one(&mut *connection)
        .await
        .map_err(|_| StoreError::MigrationFailed)?;
    let current = u32::try_from(current).map_err(|_| StoreError::InvalidData)?;
    if current > CURRENT_STORE_VERSION {
        return Err(StoreError::InvalidData);
    }
    for version in current + 1..=CURRENT_STORE_VERSION {
        if fault.fail_before_version == Some(version) {
            return Err(StoreError::MigrationFailed);
        }
        let statements = match version {
            1 => MIGRATION_1,
            2 => MIGRATION_2,
            3 => MIGRATION_3,
            _ => return Err(StoreError::MigrationFailed),
        };
        let mut transaction = connection
            .begin()
            .await
            .map_err(|_| StoreError::MigrationFailed)?;
        for (index, statement) in statements.iter().enumerate() {
            sqlx::query(*statement)
                .execute(&mut *transaction)
                .await
                .map_err(|_| StoreError::MigrationFailed)?;
            if fault.fail_after_statement == Some((version, index + 1)) {
                return Err(StoreError::MigrationFailed);
            }
        }
        let version_statement = match version {
            1 => "PRAGMA user_version = 1",
            2 => "PRAGMA user_version = 2",
            3 => "PRAGMA user_version = 3",
            _ => return Err(StoreError::MigrationFailed),
        };
        sqlx::query(version_statement)
            .execute(&mut *transaction)
            .await
            .map_err(|_| StoreError::MigrationFailed)?;
        transaction
            .commit()
            .await
            .map_err(|_| StoreError::MigrationFailed)?;
    }
    Ok(())
}

#[must_use]
pub fn unix_time_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_millis()).ok())
        .unwrap_or(0)
}

#[cfg(unix)]
fn restrict_directory(path: &Path) -> Result<(), StoreError> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
        .map_err(|_| StoreError::Unavailable)
}

#[cfg(not(unix))]
fn restrict_directory(_path: &Path) -> Result<(), StoreError> {
    Ok(())
}

#[cfg(unix)]
fn restrict_file(path: &Path) -> Result<(), StoreError> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
        .map_err(|_| StoreError::Unavailable)
}

#[cfg(not(unix))]
fn restrict_file(_path: &Path) -> Result<(), StoreError> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::history::HistoryStatus;
    use crate::profile::{ConnectionTarget, TlsMode};
    use crate::vault::{VaultError, VaultFailureKind};
    use crate::workspace::{PanelSizes, WorkspaceTab};
    use secrecy::SecretString;
    use std::sync::Mutex;

    fn profile(now_ms: i64) -> ConnectionProfile {
        ConnectionProfile::new(
            "Fixture",
            ConnectionTarget::MysqlFamily {
                host: "db.invalid".to_owned(),
                port: 3306,
                default_database: Some("fixture".to_owned()),
                username: "fixture".to_owned(),
                tls_mode: TlsMode::VerifyIdentity,
                tls_ca_path: None,
                tls_client_certificate_path: None,
                tls_client_key_path: None,
            },
            15,
            now_ms,
        )
        .unwrap()
    }

    #[tokio::test]
    async fn migrations_are_forward_only_transactional_and_preserve_last_valid_version() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("querynot.sqlite3");
        let interrupted =
            LocalStore::bootstrap_with_fault(&path, MigrationFault::after_statement(2, 1)).await;
        assert_eq!(interrupted.state, LocalStoreState::MigrationFailed);
        assert!(interrupted.store.is_none());

        let options = SqliteConnectOptions::new().filename(&path);
        let mut connection = SqliteConnection::connect_with(&options).await.unwrap();
        let version: i64 = sqlx::query_scalar("PRAGMA user_version")
            .fetch_one(&mut connection)
            .await
            .unwrap();
        assert_eq!(version, 1);
        let deletion_table: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'profile_deletions'",
        )
        .fetch_one(&mut connection)
        .await
        .unwrap();
        assert_eq!(deletion_table, 0);
        connection.close().await.unwrap();

        let recovered = LocalStore::bootstrap(&path).await;
        assert_eq!(recovered.state, LocalStoreState::Healthy);
        assert_eq!(
            recovered
                .store
                .as_ref()
                .unwrap()
                .schema_version()
                .await
                .unwrap(),
            CURRENT_STORE_VERSION
        );

        let phase_four_path = directory.path().join("querynot-phase4.sqlite3");
        let interrupted_phase_four =
            LocalStore::bootstrap_with_fault(&phase_four_path, MigrationFault::before(3)).await;
        assert_eq!(
            interrupted_phase_four.state,
            LocalStoreState::MigrationFailed
        );
        assert!(interrupted_phase_four.store.is_none());
        let options = SqliteConnectOptions::new().filename(&phase_four_path);
        let mut connection = SqliteConnection::connect_with(&options).await.unwrap();
        let version: i64 = sqlx::query_scalar("PRAGMA user_version")
            .fetch_one(&mut connection)
            .await
            .unwrap();
        assert_eq!(version, 2);
        let timestamp_columns: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM pragma_table_info('history') WHERE name = 'timestamp_ms'",
        )
        .fetch_one(&mut connection)
        .await
        .unwrap();
        assert_eq!(timestamp_columns, 0);
        connection.close().await.unwrap();

        let recovered_phase_four = LocalStore::bootstrap(&phase_four_path).await;
        assert_eq!(recovered_phase_four.state, LocalStoreState::Healthy);
        assert_eq!(
            recovered_phase_four
                .store
                .as_ref()
                .unwrap()
                .schema_version()
                .await
                .unwrap(),
            CURRENT_STORE_VERSION
        );
    }

    #[tokio::test]
    async fn corruption_never_causes_replacement_with_a_fresh_store() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("querynot.sqlite3");
        let original = b"not a sqlite database but still user data";
        std::fs::write(&path, original).unwrap();
        let bootstrap = LocalStore::bootstrap(&path).await;
        assert_eq!(bootstrap.state, LocalStoreState::MigrationFailed);
        assert!(bootstrap.store.is_none());
        assert_eq!(std::fs::read(path).unwrap(), original);
    }

    #[tokio::test]
    async fn settings_profiles_and_offline_workspace_round_trip() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("querynot.sqlite3");
        let store = LocalStore::bootstrap(path).await.store.unwrap();
        let profile = profile(100);
        store.save_profile(&profile).await.unwrap();
        assert_eq!(store.list_profiles().await.unwrap(), vec![profile.clone()]);

        let settings = AppSettings {
            ui_scale_percent: 125,
            ..AppSettings::default()
        };
        store.save_settings(&settings, 101).await.unwrap();
        assert_eq!(store.load_settings().await.unwrap(), settings);

        let tab_id = crate::TabId::new();
        let workspace = WorkspaceSnapshot {
            tabs: vec![WorkspaceTab {
                id: tab_id,
                title: "Draft".to_owned(),
                kind: crate::workspace::WorkspaceTabKind::Query,
                pinned: false,
                profile_id: Some(profile.id),
                profile_label: Some(profile.name.clone()),
                context_label: Some("fixture".to_owned()),
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
            }],
            active_tab_id: Some(tab_id),
            panel_sizes: PanelSizes {
                explorer_percent: 20.0,
                results_percent: 35.0,
                sidebar_connections_percent: 50.0,
            },
        };
        store.save_workspace(&workspace, 102).await.unwrap();
        assert_eq!(store.load_workspace().await.unwrap(), workspace);

        let reset = AppSettings::reset();
        store.save_settings(&reset, 103).await.unwrap();
        assert_eq!(store.load_settings().await.unwrap(), reset);
        assert_eq!(store.profile(profile.id).await.unwrap(), profile);
        assert_eq!(store.load_workspace().await.unwrap(), workspace);
    }

    #[tokio::test]
    async fn history_search_delete_retention_and_clear_are_immediate() {
        let directory = tempfile::tempdir().unwrap();
        let store = LocalStore::bootstrap(directory.path().join("querynot.sqlite3"))
            .await
            .store
            .unwrap();
        let auto_vacuum: i64 = sqlx::query_scalar("PRAGMA auto_vacuum")
            .fetch_one(&store.pool)
            .await
            .unwrap();
        assert_eq!(auto_vacuum, 2);
        let profile = profile(100);
        let first = HistoryEntry::new(HistoryEntryInput {
            sql: "select alpha".to_owned(),
            timestamp_ms: 100,
            profile_id: profile.id,
            profile_label: profile.name.clone(),
            engine: "fixture-engine".to_owned(),
            context: "fixture".to_owned(),
            duration_ms: 5,
            status: HistoryStatus::Succeeded,
            affected_rows: 0,
            received_rows: 1,
            error_category: None,
        });
        let second = HistoryEntry::new(HistoryEntryInput {
            sql: "update beta set value = 1".to_owned(),
            timestamp_ms: 200,
            profile_id: profile.id,
            profile_label: profile.name.clone(),
            engine: "fixture-engine".to_owned(),
            context: "fixture".to_owned(),
            duration_ms: 8,
            status: HistoryStatus::Failed,
            affected_rows: 0,
            received_rows: 0,
            error_category: Some(crate::ErrorCategory::Constraint),
        });
        store.save_history_entry(&first).await.unwrap();
        store.save_history_entry(&second).await.unwrap();

        assert_eq!(
            store
                .list_history("", 10)
                .await
                .unwrap()
                .into_iter()
                .map(|entry| entry.id)
                .collect::<Vec<_>>(),
            vec![second.id, first.id]
        );
        assert_eq!(
            store.list_history("alpha", 10).await.unwrap(),
            vec![first.clone()]
        );
        assert!(store.delete_history_entry(first.id).await.unwrap());
        assert_eq!(store.prune_history(201).await.unwrap(), 1);
        assert!(store.list_history("", 10).await.unwrap().is_empty());

        store.save_history_entry(&second).await.unwrap();
        assert_eq!(store.clear_history().await.unwrap(), 1);
        assert!(store.list_history("", 10).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn schema_cache_is_typed_bounded_and_removed_with_its_profile() {
        let directory = tempfile::tempdir().unwrap();
        let store = LocalStore::bootstrap(directory.path().join("querynot.sqlite3"))
            .await
            .store
            .unwrap();
        let profile = profile(100);
        store.save_profile(&profile).await.unwrap();
        let cache_key = "sqlite:3.50.4:main:objects";
        let cached = vec!["table_one".to_owned(), "view_two".to_owned()];

        store
            .save_schema_cache(profile.id, cache_key, &cached)
            .await
            .unwrap();
        assert_eq!(
            store
                .load_schema_cache::<Vec<String>>(profile.id, cache_key)
                .await
                .unwrap(),
            Some(cached)
        );
        assert_eq!(
            store
                .save_schema_cache(profile.id, "", &Vec::<String>::new())
                .await,
            Err(StoreError::InvalidData)
        );

        let vault = DeletionVault::default();
        assert_eq!(
            delete_profile_two_step(&store, &vault, profile.id, false, false, 101).await,
            ProfileDeletionOutcome::Deleted
        );
        assert_eq!(
            store
                .load_schema_cache::<Vec<String>>(profile.id, cache_key)
                .await
                .unwrap(),
            None
        );
    }

    #[tokio::test]
    async fn local_store_contains_only_an_opaque_reference_never_secret_material() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("querynot.sqlite3");
        let store = LocalStore::bootstrap(&path).await.store.unwrap();
        let mut profile = profile(100);
        profile.attach_secret_reference(SecretRef::new(), 101);
        store.save_profile(&profile).await.unwrap();
        store.pool.close().await;

        let persisted = std::fs::read(path).unwrap();
        assert!(
            !persisted
                .windows(b"vault-only-password".len())
                .any(|window| window == b"vault-only-password")
        );
        assert!(
            persisted
                .windows(profile.secret_reference.unwrap().to_string().len())
                .any(|window| window == profile.secret_reference.unwrap().to_string().as_bytes())
        );
    }

    #[derive(Default)]
    struct DeletionVault {
        reject_delete: Mutex<bool>,
    }

    impl SecretVault for DeletionVault {
        fn store(&self, _reference: SecretRef, _secret: &SecretString) -> Result<(), VaultError> {
            Ok(())
        }

        fn retrieve(&self, _reference: SecretRef) -> Result<SecretString, VaultError> {
            unreachable!()
        }

        fn delete(&self, _reference: SecretRef) -> Result<(), VaultError> {
            if *self.reject_delete.lock().unwrap() {
                Err(VaultError {
                    kind: VaultFailureKind::Locked,
                    safe_message: "vault locked".to_owned(),
                    session_only_available: true,
                })
            } else {
                Ok(())
            }
        }
    }

    #[tokio::test]
    async fn deletion_is_recoverable_retriable_and_relabels_retained_drafts() {
        let directory = tempfile::tempdir().unwrap();
        let store = LocalStore::bootstrap(directory.path().join("querynot.sqlite3"))
            .await
            .store
            .unwrap();
        let mut profile = profile(100);
        profile.attach_secret_reference(SecretRef::new(), 101);
        store.save_profile(&profile).await.unwrap();
        let history = HistoryEntry::new(HistoryEntryInput {
            sql: "select retained_history".to_owned(),
            timestamp_ms: 101,
            profile_id: profile.id,
            profile_label: profile.name.clone(),
            engine: "fixture-engine".to_owned(),
            context: "fixture".to_owned(),
            duration_ms: 1,
            status: HistoryStatus::Succeeded,
            affected_rows: 0,
            received_rows: 1,
            error_category: None,
        });
        store.save_history_entry(&history).await.unwrap();
        let tab_id = crate::TabId::new();
        let table_tab_id = crate::TabId::new();
        store
            .save_workspace(
                &WorkspaceSnapshot {
                    tabs: vec![
                        WorkspaceTab {
                            id: tab_id,
                            title: "Retained".to_owned(),
                            kind: crate::workspace::WorkspaceTabKind::Query,
                            pinned: false,
                            profile_id: Some(profile.id),
                            profile_label: Some(profile.name.clone()),
                            context_label: Some("fixture".to_owned()),
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
                            id: table_tab_id,
                            title: "Ephemeral table data".to_owned(),
                            kind: crate::workspace::WorkspaceTabKind::TableData,
                            pinned: false,
                            profile_id: Some(profile.id),
                            profile_label: Some(profile.name.clone()),
                            context_label: Some("fixture".to_owned()),
                            sql: String::new(),
                            dirty: false,
                            position: 1,
                            source_file_path: None,
                            source_file_modified_ms: None,
                            source_file_size: None,
                            source_file_identity: None,
                            table_namespace: Some("fixture".to_owned()),
                            table_name: Some("items".to_owned()),
                            reconnectable: true,
                        },
                    ],
                    active_tab_id: Some(table_tab_id),
                    panel_sizes: PanelSizes::default(),
                },
                102,
            )
            .await
            .unwrap();
        let vault = DeletionVault::default();
        *vault.reject_delete.lock().unwrap() = true;

        let first = delete_profile_two_step(&store, &vault, profile.id, false, false, 103).await;
        assert!(matches!(first, ProfileDeletionOutcome::PendingVault(_)));
        assert!(store.profile(profile.id).await.is_ok());
        assert!(
            !store
                .profile_deletion(profile.id)
                .await
                .unwrap()
                .unwrap()
                .vault_deleted
        );

        *vault.reject_delete.lock().unwrap() = false;
        let retry = delete_profile_two_step(&store, &vault, profile.id, false, false, 104).await;
        assert_eq!(retry, ProfileDeletionOutcome::Deleted);
        assert_eq!(
            store.profile(profile.id).await,
            Err(StoreError::ProfileNotFound)
        );
        let workspace = store.load_workspace().await.unwrap();
        assert_eq!(workspace.tabs.len(), 1);
        assert_eq!(workspace.active_tab_id, Some(tab_id));
        assert_eq!(workspace.tabs[0].profile_id, None);
        assert_eq!(
            workspace.tabs[0].profile_label.as_deref(),
            Some("Deleted profile: Fixture")
        );
        assert!(!workspace.tabs[0].reconnectable);
        let retained_history = store.list_history("retained_history", 10).await.unwrap();
        assert_eq!(retained_history[0].profile_id, None);
        assert_eq!(
            retained_history[0].profile_label,
            "Deleted profile: Fixture"
        );
        assert!(
            store
                .list_history("\"profile_id\":\"", 10)
                .await
                .unwrap()
                .is_empty()
        );
    }
}
