use querynot_core::diagnostics::{
    DiagnosticArea, DiagnosticsPreview, LocalOperationalLog, OperationalEvent,
};
use querynot_core::export::write_local_bytes_atomically;
use querynot_core::generated::contracts::*;
use querynot_core::history::{HistoryEntry, HistoryStatus};
use querynot_core::ownership::OwnershipRegistry;
use querynot_core::profile::{ConnectionProfile, ConnectionTarget, TlsMode};
use querynot_core::settings::{AppSettings, TableFontPreference, ThemePreference};
use querynot_core::sqlite::test_sqlite_connection;
use querynot_core::state::LocalStoreState;
use querynot_core::store::{
    LocalStore, ProfileDeletionOutcome, delete_profile_two_step, unix_time_ms,
};
use querynot_core::vault::{ConnectionSecrets, KeyringVault, SecretVault, SessionSecretStore};
use querynot_core::workspace::{PanelSizes, WorkspaceSnapshot, WorkspaceTab, WorkspaceTabKind};
use querynot_core::{
    ErrorCategory, FileGrantId, HistoryEntryId, ProfileId, QueryNotError, TabId, WindowId,
};
use std::collections::HashMap;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::{Arc, Mutex, MutexGuard};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

const MAX_SQL_FILE_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum FilePurpose {
    SqlDraft,
    SqliteDatabase,
    TlsCa,
    TlsClientCertificate,
    TlsClientKey,
}

#[derive(Clone, Debug)]
struct GrantedFile {
    path: PathBuf,
    purpose: FilePurpose,
    stamp: Option<SqlFileStamp>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct SqlFileStamp {
    modified_ms: i64,
    size: u64,
    identity: String,
}

pub(crate) struct AppRuntimeState {
    pub(crate) store: Option<LocalStore>,
    store_state: LocalStoreState,
    store_message: Option<String>,
    pub(crate) settings: Mutex<AppSettings>,
    vault: KeyringVault,
    session_secrets: Mutex<SessionSecretStore>,
    file_grants: Mutex<HashMap<FileGrantId, GrantedFile>>,
    pending_file_opens: Mutex<Vec<FilePickerResponse>>,
    pub(crate) ownership: Arc<Mutex<OwnershipRegistry>>,
    pub(crate) phase2: crate::phase2::Phase2Runtime,
    operational_log: Mutex<LocalOperationalLog>,
    pub(crate) history_warning: Arc<Mutex<Option<String>>>,
    last_history_cleanup_ms: Mutex<i64>,
    data_dir: PathBuf,
    pub(crate) window_id: WindowId,
    pub(crate) pending_update: Mutex<Option<tauri_plugin_updater::Update>>,
}

impl AppRuntimeState {
    pub(crate) async fn initialize(app: AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let data_dir = app.path().app_data_dir()?;
        let bootstrap = LocalStore::bootstrap(data_dir.join("querynot.sqlite3")).await;
        let settings = match &bootstrap.store {
            Some(store) => store.load_settings().await.unwrap_or_default(),
            None => AppSettings::default(),
        };
        let now_ms = unix_time_ms();
        let mut store_message = bootstrap.safe_message;
        let last_history_cleanup_ms = {
            if let Some(store) = &bootstrap.store {
                let cutoff_ms = history_cutoff_ms(now_ms, settings.history_retention_days);
                if store.prune_history(cutoff_ms).await.is_err() {
                    store_message = Some(
                        "Query history retention cleanup could not be persisted. Current database and editor work remain available."
                            .to_owned(),
                    );
                }
            }
            now_ms
        };
        let window_id = WindowId::new();
        let mut ownership = OwnershipRegistry::default();
        if let Some(store) = &bootstrap.store
            && let Ok(profiles) = store.list_profiles().await
        {
            for profile in profiles {
                let _ = ownership.register_profile(window_id, profile.id);
            }
            if let Ok(workspace) = store.load_workspace().await {
                for tab in workspace.tabs {
                    let _ = ownership.register_tab(window_id, tab.profile_id, tab.id);
                }
            }
        }
        let operational_log = operational_log(&data_dir, &settings);
        operational_log.append(
            &OperationalEvent {
                timestamp_ms: unix_time_ms(),
                area: DiagnosticArea::Application,
                code: "application_started".to_owned(),
                error_category: None,
            },
            unix_time_ms(),
        );

        Ok(Self {
            store: bootstrap.store,
            store_state: bootstrap.state,
            store_message,
            settings: Mutex::new(settings),
            vault: KeyringVault,
            session_secrets: Mutex::new(SessionSecretStore::default()),
            file_grants: Mutex::new(HashMap::new()),
            pending_file_opens: Mutex::new(Vec::new()),
            ownership: Arc::new(Mutex::new(ownership)),
            phase2: crate::phase2::Phase2Runtime::default(),
            operational_log: Mutex::new(operational_log),
            history_warning: Arc::new(Mutex::new(None)),
            last_history_cleanup_ms: Mutex::new(last_history_cleanup_ms),
            data_dir,
            window_id,
            pending_update: Mutex::new(None),
        })
    }

    pub(crate) fn cleanup_window(&self) {
        self.phase2.cleanup();
        if let Ok(mut ownership) = self.ownership.lock() {
            let _ = ownership.cleanup_window(self.window_id);
        }
        if let Ok(mut secrets) = self.session_secrets.lock() {
            secrets.clear();
        }
        if let Ok(mut grants) = self.file_grants.lock() {
            grants.clear();
        }
        if let Ok(mut pending) = self.pending_file_opens.lock() {
            pending.clear();
        }
        if let Ok(mut update) = self.pending_update.lock() {
            *update = None;
        }
    }

    pub(crate) async fn connection_secrets(
        &self,
        profile: &ConnectionProfile,
    ) -> Result<ConnectionSecrets, QueryNotError> {
        if let Some(secret) = lock(&self.session_secrets)?.get(profile.id) {
            return Ok(secret.clone());
        }
        let Some(reference) = profile.secret_reference else {
            return Ok(ConnectionSecrets::empty());
        };
        let vault = self.vault.clone();
        let value = tokio::task::spawn_blocking(move || vault.retrieve(reference))
            .await
            .map_err(|_| QueryNotError::internal("Credential-vault task did not complete."))?
            .map_err(vault_error)?;
        ConnectionSecrets::decode_from_vault(value).map_err(vault_error)
    }

    pub(crate) fn clear_session_secret(&self, profile_id: ProfileId) -> Result<(), QueryNotError> {
        lock(&self.session_secrets)?.remove(profile_id);
        Ok(())
    }
}

#[tauri::command]
pub(crate) async fn bootstrap_workspace(
    state: State<'_, AppRuntimeState>,
) -> Result<BootstrapWorkspaceResponse, QueryNotError> {
    // Bootstrap is also the frontend-reload boundary. Invalidate native jobs,
    // cursors, sessions, and metadata resources before rebuilding ownership.
    state.phase2.cleanup();
    let (profiles, workspace) = match &state.store {
        Some(store) => (store.list_profiles().await?, store.load_workspace().await?),
        None => (Vec::new(), WorkspaceSnapshot::default()),
    };
    {
        let mut ownership = lock(&state.ownership)?;
        let _ = ownership.cleanup_window(state.window_id);
        for profile in &profiles {
            ownership.register_profile(state.window_id, profile.id)?;
        }
        for tab in &workspace.tabs {
            ownership.register_tab(state.window_id, tab.profile_id, tab.id)?;
        }
    }
    lock(&state.file_grants)?.clear();
    let settings = lock(&state.settings)?.clone();
    let workspace = workspace_to_view(&state, workspace)?;
    Ok(BootstrapWorkspaceResponse {
        contract_version: CONTRACT_VERSION,
        phase: "phase_4_productivity_and_safe_data_editing".to_owned(),
        store_state: store_state_name(state.store_state).to_owned(),
        store_message: state.store_message.clone(),
        profiles: profiles.iter().map(profile_to_view).collect(),
        settings: settings_to_view(&settings),
        workspace,
    })
}

#[tauri::command]
pub(crate) async fn create_profile(
    state: State<'_, AppRuntimeState>,
    request: ProfileInput,
) -> Result<ProfileView, QueryNotError> {
    let store = available_store(&state)?;
    let now = unix_time_ms();
    let profile = profile_from_input(&state, request, None, now)?;
    store.save_profile(&profile).await?;
    lock(&state.ownership)?.register_profile(state.window_id, profile.id)?;
    log_event(
        &state,
        DiagnosticArea::ProfileLifecycle,
        "profile_created",
        None,
    );
    Ok(profile_to_view(&profile))
}

#[tauri::command]
pub(crate) async fn update_profile(
    state: State<'_, AppRuntimeState>,
    request: UpdateProfileRequest,
) -> Result<ProfileView, QueryNotError> {
    let store = available_store(&state)?;
    let profile_id = parse_id::<ProfileId>(&request.profile_id)?;
    if state.phase2.profile_is_connected(profile_id)
        || lock(&state.ownership)?.has_active_profile_resources(profile_id)
    {
        return Err(QueryNotError::authorization(
            "Disconnect this profile's metadata and tab sessions before editing it.",
        ));
    }
    let existing = store.profile(profile_id).await?;
    let profile = profile_from_input(&state, request.profile, Some(&existing), unix_time_ms())?;
    store.save_profile(&profile).await?;
    log_event(
        &state,
        DiagnosticArea::ProfileLifecycle,
        "profile_updated",
        None,
    );
    Ok(profile_to_view(&profile))
}

#[tauri::command]
pub(crate) async fn duplicate_profile(
    state: State<'_, AppRuntimeState>,
    request: ProfileIdRequest,
) -> Result<ProfileView, QueryNotError> {
    let store = available_store(&state)?;
    let profile_id = parse_id::<ProfileId>(&request.profile_id)?;
    let duplicate = store.profile(profile_id).await?.duplicate(unix_time_ms());
    duplicate.validate().map_err(validation_error)?;
    store.save_profile(&duplicate).await?;
    lock(&state.ownership)?.register_profile(state.window_id, duplicate.id)?;
    log_event(
        &state,
        DiagnosticArea::ProfileLifecycle,
        "profile_duplicated",
        None,
    );
    Ok(profile_to_view(&duplicate))
}

#[tauri::command]
pub(crate) async fn delete_profile(
    state: State<'_, AppRuntimeState>,
    request: DeleteProfileRequest,
) -> Result<DeleteProfileResponse, QueryNotError> {
    if !request.confirmed {
        return Err(QueryNotError::authorization(
            "Profile deletion requires explicit confirmation.",
        ));
    }
    let profile_id = parse_id::<ProfileId>(&request.profile_id)?;
    if state.phase2.profile_is_connected(profile_id)
        || lock(&state.ownership)?.has_active_profile_resources(profile_id)
    {
        return Err(QueryNotError::authorization(
            "Disconnect this profile and resolve active jobs, transactions, and staged edits before deletion.",
        ));
    }
    let store = available_store(&state)?;
    let workspace = store.load_workspace().await?;
    let stored_profile_tabs = workspace
        .tabs
        .iter()
        .filter_map(|tab| (tab.profile_id == Some(profile_id)).then_some(tab.id))
        .collect::<std::collections::HashSet<_>>();
    if lock(&state.ownership)?.profile_tab_ids(profile_id) != stored_profile_tabs {
        return Err(QueryNotError::local_storage(
            "Save the current draft recovery snapshot before deleting this profile.",
            true,
        ));
    }
    let retained_tabs = workspace
        .tabs
        .iter()
        .filter_map(|tab| {
            (!request.delete_drafts
                && tab.profile_id == Some(profile_id)
                && tab.kind == WorkspaceTabKind::Query)
                .then_some(tab.id)
        })
        .collect::<std::collections::HashSet<_>>();
    let outcome = delete_profile_two_step(
        store,
        &state.vault,
        profile_id,
        request.delete_history,
        request.delete_drafts,
        unix_time_ms(),
    )
    .await;
    match outcome {
        ProfileDeletionOutcome::Deleted => {
            lock(&state.session_secrets)?.remove(profile_id);
            lock(&state.ownership)?.unregister_profile(profile_id, &retained_tabs)?;
            log_event(
                &state,
                DiagnosticArea::ProfileLifecycle,
                "profile_deleted",
                None,
            );
            Ok(DeleteProfileResponse {
                status: "deleted".to_owned(),
                message: "Profile metadata, cache, and saved credential were removed. No database file was deleted."
                    .to_owned(),
            })
        }
        ProfileDeletionOutcome::PendingVault(error) => {
            log_event(
                &state,
                DiagnosticArea::Vault,
                "profile_delete_vault_pending",
                Some(ErrorCategory::Authorization),
            );
            Ok(DeleteProfileResponse {
                status: "pending_vault".to_owned(),
                message: format!(
                    "{} Profile metadata was preserved and deletion can be retried safely.",
                    error.safe_message
                ),
            })
        }
        ProfileDeletionOutcome::PendingLocalStore(_) => {
            log_event(
                &state,
                DiagnosticArea::LocalStore,
                "profile_delete_store_pending",
                Some(ErrorCategory::LocalStorage),
            );
            Ok(DeleteProfileResponse {
                status: "pending_local_store".to_owned(),
                message: "The vault step completed but local metadata cleanup did not. The recoverable deletion remains pending and can be retried safely."
                    .to_owned(),
            })
        }
    }
}

#[tauri::command]
pub(crate) async fn save_profile_secret(
    state: State<'_, AppRuntimeState>,
    request: SaveProfileSecretRequest,
) -> Result<SecretActionResponse, QueryNotError> {
    let profile_id = parse_id::<ProfileId>(&request.profile_id)?;
    if (request.database_password.is_empty() && request.client_key_passphrase.is_empty())
        || request.database_password.len() > 16 * 1024
        || request.client_key_passphrase.len() > 16 * 1024
    {
        return Err(QueryNotError::authorization(
            "At least one credential is required and each must not exceed 16,384 bytes.",
        ));
    }
    let secrets = ConnectionSecrets::new(request.database_password, request.client_key_passphrase);
    if request.session_only {
        lock(&state.session_secrets)?.replace(profile_id, secrets);
        log_event(
            &state,
            DiagnosticArea::Vault,
            "session_secret_accepted",
            None,
        );
        return Ok(SecretActionResponse {
            saved: false,
            session_only: true,
            message: "Credential is held only in native process memory until disconnect or exit."
                .to_owned(),
        });
    }

    let store = available_store(&state)?;
    let mut profile = store.profile(profile_id).await?;
    let existing_reference = profile.secret_reference;
    let reference = existing_reference.unwrap_or_default();
    let secret = secrets.encode_for_vault().map_err(vault_error)?;
    let vault = state.vault.clone();
    let write = tokio::task::spawn_blocking(move || vault.store(reference, &secret))
        .await
        .map_err(|_| QueryNotError::internal("Credential-vault task did not complete."))?;
    if let Err(error) = write {
        log_event(
            &state,
            DiagnosticArea::Vault,
            "vault_write_failed",
            Some(ErrorCategory::Authorization),
        );
        return Ok(SecretActionResponse {
            saved: false,
            session_only: false,
            message: format!(
                "{} You can choose session-only use; no plaintext fallback was written.",
                error.safe_message
            ),
        });
    }

    profile.attach_secret_reference(reference, unix_time_ms());
    if let Err(error) = store.save_profile(&profile).await {
        if existing_reference.is_none() {
            let vault = state.vault.clone();
            let _ = tokio::task::spawn_blocking(move || vault.delete(reference)).await;
        }
        return Err(error.into());
    }
    lock(&state.session_secrets)?.remove(profile_id);
    log_event(&state, DiagnosticArea::Vault, "vault_write_succeeded", None);
    Ok(SecretActionResponse {
        saved: true,
        session_only: false,
        message: "Credential was saved through the operating-system vault.".to_owned(),
    })
}

#[tauri::command]
pub(crate) async fn remove_profile_secret(
    state: State<'_, AppRuntimeState>,
    request: ProfileIdRequest,
) -> Result<SecretActionResponse, QueryNotError> {
    let store = available_store(&state)?;
    let profile_id = parse_id::<ProfileId>(&request.profile_id)?;
    let mut profile = store.profile(profile_id).await?;
    if let Some(reference) = profile.secret_reference {
        let vault = state.vault.clone();
        tokio::task::spawn_blocking(move || vault.delete(reference))
            .await
            .map_err(|_| QueryNotError::internal("Credential-vault task did not complete."))?
            .map_err(vault_error)?;
    }
    profile.remove_secret_reference(unix_time_ms());
    store.save_profile(&profile).await?;
    lock(&state.session_secrets)?.remove(profile_id);
    log_event(&state, DiagnosticArea::Vault, "vault_item_removed", None);
    Ok(SecretActionResponse {
        saved: false,
        session_only: false,
        message: "Saved and session-only credentials were removed for this profile.".to_owned(),
    })
}

#[tauri::command]
pub(crate) async fn save_settings(
    state: State<'_, AppRuntimeState>,
    request: SettingsView,
) -> Result<SettingsView, QueryNotError> {
    let settings = settings_from_view(request)?;
    settings.validate().map_err(validation_error)?;
    available_store(&state)?
        .save_settings(&settings, unix_time_ms())
        .await?;
    *lock(&state.settings)? = settings.clone();
    *lock(&state.operational_log)? = operational_log(&state.data_dir, &settings);
    log_event(&state, DiagnosticArea::Application, "settings_saved", None);
    Ok(settings_to_view(&settings))
}

#[tauri::command]
pub(crate) async fn reset_settings(
    state: State<'_, AppRuntimeState>,
    request: ConfirmedActionRequest,
) -> Result<SettingsView, QueryNotError> {
    if !request.confirmed {
        return Err(QueryNotError::authorization(
            "Resetting settings requires explicit confirmation.",
        ));
    }
    let settings = AppSettings::reset();
    available_store(&state)?
        .save_settings(&settings, unix_time_ms())
        .await?;
    *lock(&state.settings)? = settings.clone();
    *lock(&state.operational_log)? = operational_log(&state.data_dir, &settings);
    log_event(&state, DiagnosticArea::Application, "settings_reset", None);
    Ok(settings_to_view(&settings))
}

#[tauri::command]
pub(crate) async fn save_workspace(
    state: State<'_, AppRuntimeState>,
    request: WorkspaceView,
) -> Result<WorkspaceSaveResponse, QueryNotError> {
    let settings = lock(&state.settings)?.clone();
    if !settings.session_restoration_enabled {
        return Ok(WorkspaceSaveResponse {
            saved: false,
            message:
                "Session restoration is disabled; the draft remains in the current window only."
                    .to_owned(),
        });
    }
    let workspace = workspace_from_view(&state, request)?;
    available_store(&state)?
        .save_workspace(&workspace, unix_time_ms())
        .await?;
    log_event(&state, DiagnosticArea::Workspace, "workspace_saved", None);
    Ok(WorkspaceSaveResponse {
        saved: true,
        message: "Drafts and offline tab bindings were saved locally without execution.".to_owned(),
    })
}

#[tauri::command]
pub(crate) async fn clear_saved_workspace(
    state: State<'_, AppRuntimeState>,
    request: ConfirmedActionRequest,
) -> Result<FileActionResponse, QueryNotError> {
    if !request.confirmed {
        return Err(QueryNotError::authorization(
            "Clearing saved draft recovery requires explicit confirmation.",
        ));
    }
    let cleared = available_store(&state)?.clear_workspace().await?;
    Ok(FileActionResponse {
        completed: true,
        cancelled: false,
        message: if cleared {
            "Cleared saved workspace recovery data. Current in-memory tabs remain open; disable restoration to prevent a later edit from saving them again."
        } else {
            "No saved workspace recovery snapshot was present. Current in-memory tabs remain open."
        }
        .to_owned(),
    })
}

#[tauri::command]
pub(crate) async fn create_offline_tab(
    state: State<'_, AppRuntimeState>,
    request: NewOfflineTabRequest,
) -> Result<WorkspaceTabView, QueryNotError> {
    let profile = match request.profile_id {
        Some(profile_id) => {
            let profile_id = parse_id::<ProfileId>(&profile_id)?;
            lock(&state.ownership)?.authorize_profile(state.window_id, profile_id)?;
            Some(available_store(&state)?.profile(profile_id).await?)
        }
        None => None,
    };
    let tab_id = TabId::new();
    lock(&state.ownership)?.register_tab(
        state.window_id,
        profile.as_ref().map(|profile| profile.id),
        tab_id,
    )?;
    Ok(WorkspaceTabView {
        id: tab_id.to_string(),
        title: "Untitled query".to_owned(),
        kind: "query".to_owned(),
        pinned: false,
        profile_id: profile.as_ref().map(|profile| profile.id.to_string()),
        profile_label: profile.as_ref().map(|profile| profile.name.clone()),
        context_label: None,
        sql: String::new(),
        dirty: false,
        position: 0,
        source_file_grant_id: None,
        table_namespace: None,
        table_name: None,
        reconnectable: profile.is_some(),
    })
}

#[tauri::command]
pub(crate) async fn close_offline_tab(
    state: State<'_, AppRuntimeState>,
    request: TabIdRequest,
) -> Result<WorkspaceSaveResponse, QueryNotError> {
    let tab_id = parse_id::<TabId>(&request.tab_id)?;
    lock(&state.ownership)?.unregister_tab(state.window_id, tab_id)?;
    Ok(WorkspaceSaveResponse {
        saved: true,
        message: "Offline tab resources were released.".to_owned(),
    })
}

#[tauri::command]
pub(crate) async fn pick_sql_file(
    app: AppHandle,
    state: State<'_, AppRuntimeState>,
) -> Result<FilePickerResponse, QueryNotError> {
    let selected = app
        .dialog()
        .file()
        .add_filter("SQL files", &["sql"])
        .set_title("Open SQL file offline")
        .blocking_pick_file();
    let Some(selected) = selected else {
        return Ok(cancelled_file_picker());
    };
    let path = selected.into_path().map_err(|_| {
        QueryNotError::authorization("Only local filesystem SQL files are supported.")
    })?;
    if !is_sql_path(&path) {
        return Err(QueryNotError::authorization(
            "Only files with the .sql extension can be opened as SQL source files.",
        ));
    }
    let metadata = std::fs::metadata(&path)
        .map_err(|_| QueryNotError::local_storage("The selected SQL file is unavailable.", true))?;
    if !metadata.is_file() || metadata.len() > MAX_SQL_FILE_BYTES {
        return Err(QueryNotError::authorization(
            "The selected SQL file must be a regular UTF-8 file no larger than 4 MiB.",
        ));
    }
    let content = std::fs::read_to_string(&path).map_err(|_| {
        QueryNotError::local_storage(
            "The selected SQL file could not be read as UTF-8; no data was changed.",
            false,
        )
    })?;
    validate_sql_file_content(&content)?;
    let path = std::fs::canonicalize(&path).map_err(|_| {
        QueryNotError::local_storage("The selected SQL file identity is unavailable.", true)
    })?;
    let stamp = sql_file_stamp(&path, content.as_bytes())?;
    let grant_id = grant_sql_file(&state, path.clone(), stamp)?;
    let tab_id = TabId::new();
    lock(&state.ownership)?.register_tab(state.window_id, None, tab_id)?;
    log_event(&state, DiagnosticArea::Workspace, "sql_file_opened", None);
    Ok(FilePickerResponse {
        cancelled: false,
        file_grant_id: Some(grant_id.to_string()),
        tab_id: Some(tab_id.to_string()),
        display_name: Some(display_name(&path)),
        content: Some(content),
    })
}

#[tauri::command]
pub(crate) async fn save_sql_file(
    state: State<'_, AppRuntimeState>,
    request: SaveSqlFileRequest,
) -> Result<SqlFileActionResponse, QueryNotError> {
    authorize_file_tab(&state, request.profile_id.as_deref(), &request.tab_id)?;
    validate_sql_file_content(&request.content)?;
    let grant_id = parse_id::<FileGrantId>(&request.file_grant_id)?;
    let granted = resolve_granted(&state, grant_id, FilePurpose::SqlDraft)?;
    let expected = granted.stamp.ok_or_else(|| {
        QueryNotError::authorization("The SQL-file grant has no saved identity state.")
    })?;
    let current_bytes = match std::fs::read(&granted.path) {
        Ok(bytes) => bytes,
        Err(_) => {
            return Ok(external_file_change_response(
                "The opened SQL file moved or became unavailable. Review, Save as, or cancel; nothing was overwritten.",
            ));
        }
    };
    let current = sql_file_stamp(&granted.path, &current_bytes)?;
    if current != expected {
        return Ok(external_file_change_response(
            "The opened SQL file changed outside QueryNot. Review, Save as, or cancel; nothing was overwritten.",
        ));
    }
    write_sql_file(&granted.path, &request.content, true)?;
    let updated = sql_file_stamp(&granted.path, request.content.as_bytes())?;
    update_sql_grant(&state, grant_id, updated)?;
    log_event(&state, DiagnosticArea::Workspace, "sql_file_saved", None);
    Ok(SqlFileActionResponse {
        status: "saved".to_owned(),
        cancelled: false,
        file_grant_id: Some(grant_id.to_string()),
        display_name: Some(display_name(&granted.path)),
        message: "The SQL file was replaced atomically after its last-known identity and modification state matched."
            .to_owned(),
    })
}

#[tauri::command]
pub(crate) async fn save_sql_file_as(
    app: AppHandle,
    state: State<'_, AppRuntimeState>,
    request: SaveSqlFileAsRequest,
) -> Result<SqlFileActionResponse, QueryNotError> {
    authorize_file_tab(&state, request.profile_id.as_deref(), &request.tab_id)?;
    validate_sql_file_content(&request.content)?;
    let suggested = if request.suggested_name.ends_with(".sql")
        && !request.suggested_name.contains(['/', '\\', '\0'])
        && request.suggested_name.len() <= 255
    {
        request.suggested_name
    } else {
        "query.sql".to_owned()
    };
    let selected = app
        .dialog()
        .file()
        .add_filter("SQL files", &["sql"])
        .set_file_name(suggested)
        .set_title("Save SQL file as")
        .blocking_save_file();
    let Some(selected) = selected else {
        return Ok(SqlFileActionResponse {
            status: "cancelled".to_owned(),
            cancelled: true,
            file_grant_id: None,
            display_name: None,
            message: "Save as was cancelled; no file was written.".to_owned(),
        });
    };
    let mut path = selected.into_path().map_err(|_| {
        QueryNotError::authorization("SQL files can only be saved to a local path you choose.")
    })?;
    if !is_sql_path(&path) {
        return Err(QueryNotError::authorization(
            "SQL source files must use the .sql extension.",
        ));
    }
    if path.exists() {
        path = std::fs::canonicalize(&path).map_err(|_| {
            QueryNotError::local_storage(
                "The selected SQL destination identity is unavailable; nothing was written.",
                true,
            )
        })?;
    }
    write_sql_file(&path, &request.content, path.exists())?;
    let stamp = sql_file_stamp(&path, request.content.as_bytes())?;
    let grant_id = grant_sql_file(&state, path.clone(), stamp)?;
    log_event(&state, DiagnosticArea::Workspace, "sql_file_saved_as", None);
    Ok(SqlFileActionResponse {
        status: "saved".to_owned(),
        cancelled: false,
        file_grant_id: Some(grant_id.to_string()),
        display_name: Some(display_name(&path)),
        message: "The SQL file was saved through the native chooser and is now tracked for external changes."
            .to_owned(),
    })
}

#[tauri::command]
pub(crate) fn review_sql_file(
    state: State<'_, AppRuntimeState>,
    request: ReviewSqlFileRequest,
) -> Result<FilePickerResponse, QueryNotError> {
    authorize_file_tab(&state, request.profile_id.as_deref(), &request.tab_id)?;
    let grant_id = parse_id::<FileGrantId>(&request.file_grant_id)?;
    let granted = resolve_granted(&state, grant_id, FilePurpose::SqlDraft)?;
    let metadata = std::fs::metadata(&granted.path).map_err(|_| {
        QueryNotError::local_storage(
            "The external SQL file is unavailable. Your in-memory draft remains unchanged.",
            true,
        )
    })?;
    if !metadata.is_file() || metadata.len() > MAX_SQL_FILE_BYTES {
        return Err(QueryNotError::authorization(
            "The external SQL file is no longer a regular UTF-8 file within the 4 MiB limit.",
        ));
    }
    let content = std::fs::read_to_string(&granted.path).map_err(|_| {
        QueryNotError::local_storage(
            "The external SQL file could not be reviewed as UTF-8. Your draft remains unchanged.",
            false,
        )
    })?;
    validate_sql_file_content(&content)?;
    Ok(FilePickerResponse {
        cancelled: false,
        file_grant_id: Some(grant_id.to_string()),
        tab_id: None,
        display_name: Some(display_name(&granted.path)),
        content: Some(content),
    })
}

#[tauri::command]
pub(crate) fn take_pending_sql_files(
    state: State<'_, AppRuntimeState>,
) -> Result<PendingSqlFilesResponse, QueryNotError> {
    Ok(PendingSqlFilesResponse {
        files: std::mem::take(&mut *lock(&state.pending_file_opens)?),
    })
}

pub(crate) fn route_sql_file_paths(app: &AppHandle, paths: impl IntoIterator<Item = PathBuf>) {
    let state = app.state::<AppRuntimeState>();
    let mut added = false;
    for path in paths {
        let is_sql = path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("sql"));
        if !is_sql {
            continue;
        }
        let Ok(path) = std::fs::canonicalize(path) else {
            continue;
        };
        let Ok(metadata) = std::fs::metadata(&path) else {
            continue;
        };
        if !metadata.is_file() || metadata.len() > MAX_SQL_FILE_BYTES {
            continue;
        }
        let Ok(content) = std::fs::read_to_string(&path) else {
            continue;
        };
        if validate_sql_file_content(&content).is_err() {
            continue;
        }
        let Ok(stamp) = sql_file_stamp(&path, content.as_bytes()) else {
            continue;
        };
        let grant_id = FileGrantId::new();
        let tab_id = TabId::new();
        let registered = state.ownership.lock().ok().is_some_and(|mut ownership| {
            ownership
                .register_tab(state.window_id, None, tab_id)
                .is_ok()
        });
        if !registered {
            continue;
        }
        let grant_inserted = state.file_grants.lock().ok().is_some_and(|mut grants| {
            grants.insert(
                grant_id,
                GrantedFile {
                    path: path.clone(),
                    purpose: FilePurpose::SqlDraft,
                    stamp: Some(stamp),
                },
            );
            true
        });
        if !grant_inserted {
            if let Ok(mut ownership) = state.ownership.lock() {
                let _ = ownership.unregister_tab(state.window_id, tab_id);
            }
            continue;
        }
        let response = FilePickerResponse {
            cancelled: false,
            file_grant_id: Some(grant_id.to_string()),
            tab_id: Some(tab_id.to_string()),
            display_name: Some(display_name(&path)),
            content: Some(content),
        };
        let queued = if let Ok(mut pending) = state.pending_file_opens.lock() {
            pending.push(response);
            added = true;
            true
        } else {
            false
        };
        if !queued {
            if let Ok(mut grants) = state.file_grants.lock() {
                grants.remove(&grant_id);
            }
            if let Ok(mut ownership) = state.ownership.lock() {
                let _ = ownership.unregister_tab(state.window_id, tab_id);
            }
        }
    }
    if added {
        let _ = app.emit(
            "querynot_open_files",
            PendingSqlFilesSignal { queued: true },
        );
    }
}

#[tauri::command]
pub(crate) async fn pick_connection_file(
    app: AppHandle,
    state: State<'_, AppRuntimeState>,
) -> Result<ConnectionFilePickerResponse, QueryNotError> {
    let selected = app
        .dialog()
        .file()
        .set_title("Choose database file")
        .blocking_pick_file();
    let Some(selected) = selected else {
        return Ok(cancelled_connection_file_picker());
    };
    let path = selected.into_path().map_err(|_| {
        QueryNotError::authorization("Only local filesystem database files are supported.")
    })?;
    let metadata = std::fs::metadata(&path).map_err(|_| {
        QueryNotError::local_storage("The selected SQLite file is unavailable.", true)
    })?;
    if !metadata.is_file() {
        return Err(QueryNotError::authorization(
            "The selected SQLite path is not a regular file.",
        ));
    }
    test_sqlite_connection(&path, true).await.map_err(|_| {
        QueryNotError::authorization(
            "The selected file is not a supported SQLite database. QueryNot left it unchanged.",
        )
    })?;
    let grant_id = grant_file(&state, path.clone(), FilePurpose::SqliteDatabase)?;
    log_event(
        &state,
        DiagnosticArea::Workspace,
        "connection_file_detected",
        None,
    );
    Ok(ConnectionFilePickerResponse {
        cancelled: false,
        file_grant_id: Some(grant_id.to_string()),
        display_name: Some(display_name(&path)),
        detected_kind: Some("sqlite".to_owned()),
    })
}

#[tauri::command]
pub(crate) async fn pick_tls_ca_file(
    app: AppHandle,
    state: State<'_, AppRuntimeState>,
) -> Result<FilePickerResponse, QueryNotError> {
    pick_tls_file(
        &app,
        &state,
        FilePurpose::TlsCa,
        "Choose trusted CA certificate",
        &["pem", "crt", "cer"],
    )
}

#[tauri::command]
pub(crate) async fn pick_tls_client_certificate_file(
    app: AppHandle,
    state: State<'_, AppRuntimeState>,
) -> Result<FilePickerResponse, QueryNotError> {
    pick_tls_file(
        &app,
        &state,
        FilePurpose::TlsClientCertificate,
        "Choose client certificate",
        &["pem", "crt", "cer"],
    )
}

#[tauri::command]
pub(crate) async fn pick_tls_client_key_file(
    app: AppHandle,
    state: State<'_, AppRuntimeState>,
) -> Result<FilePickerResponse, QueryNotError> {
    pick_tls_file(
        &app,
        &state,
        FilePurpose::TlsClientKey,
        "Choose client private key",
        &["pem", "key"],
    )
}

fn pick_tls_file(
    app: &AppHandle,
    state: &AppRuntimeState,
    purpose: FilePurpose,
    title: &str,
    extensions: &[&str],
) -> Result<FilePickerResponse, QueryNotError> {
    let selected = app
        .dialog()
        .file()
        .add_filter("PEM certificate material", extensions)
        .set_title(title)
        .blocking_pick_file();
    let Some(selected) = selected else {
        return Ok(cancelled_file_picker());
    };
    let path = selected
        .into_path()
        .map_err(|_| QueryNotError::authorization("Only local certificate files are supported."))?;
    let metadata = std::fs::metadata(&path).map_err(|_| {
        QueryNotError::local_storage("The selected certificate file is unavailable.", true)
    })?;
    if !metadata.is_file() || metadata.len() > 1024 * 1024 {
        return Err(QueryNotError::authorization(
            "Certificate material must be a regular file no larger than 1 MiB.",
        ));
    }
    let grant_id = grant_file(state, path.clone(), purpose)?;
    Ok(FilePickerResponse {
        cancelled: false,
        file_grant_id: Some(grant_id.to_string()),
        tab_id: None,
        display_name: Some(display_name(&path)),
        content: None,
    })
}

#[tauri::command]
pub(crate) async fn diagnostics_preview(
    state: State<'_, AppRuntimeState>,
) -> Result<DiagnosticsPreviewView, QueryNotError> {
    let preview = build_diagnostics_preview(&state)?;
    Ok(diagnostics_to_view(preview))
}

#[tauri::command]
pub(crate) async fn export_diagnostics(
    app: AppHandle,
    state: State<'_, AppRuntimeState>,
    request: DiagnosticsPreviewView,
) -> Result<FileActionResponse, QueryNotError> {
    let _untrusted_preview = request;
    let selected = app
        .dialog()
        .file()
        .add_filter("JSON", &["json"])
        .set_file_name("querynot-diagnostics.json")
        .set_title("Export redacted diagnostics")
        .blocking_save_file();
    let Some(selected) = selected else {
        return Ok(FileActionResponse {
            completed: false,
            cancelled: true,
            message: "Diagnostics export was cancelled; nothing was written.".to_owned(),
        });
    };
    let path = selected.into_path().map_err(|_| {
        QueryNotError::authorization("Diagnostics can only be written to a local file you choose.")
    })?;
    build_diagnostics_preview(&state)?
        .write_local_json(&path)
        .map_err(|_| {
            QueryNotError::local_storage(
                "Diagnostics could not be written. Existing local application data was not changed.",
                true,
            )
        })?;
    log_event(&state, DiagnosticArea::Export, "diagnostics_exported", None);
    Ok(FileActionResponse {
        completed: true,
        cancelled: false,
        message: "Redacted diagnostics were written locally. QueryNot did not upload them."
            .to_owned(),
    })
}

#[tauri::command]
pub(crate) async fn clear_operational_log(
    state: State<'_, AppRuntimeState>,
    request: ConfirmedActionRequest,
) -> Result<FileActionResponse, QueryNotError> {
    if !request.confirmed {
        return Err(QueryNotError::authorization(
            "Clearing the local operational log requires explicit confirmation.",
        ));
    }
    lock(&state.operational_log)?.clear().map_err(|_| {
        QueryNotError::local_storage("The local operational log could not be cleared.", true)
    })?;
    Ok(FileActionResponse {
        completed: true,
        cancelled: false,
        message: "The redacted local operational log was cleared.".to_owned(),
    })
}

#[tauri::command]
pub(crate) async fn list_history(
    state: State<'_, AppRuntimeState>,
    request: HistoryQueryRequest,
) -> Result<HistoryResponse, QueryNotError> {
    if request.limit == 0 || request.limit > 1_000 {
        return Err(QueryNotError::authorization(
            "History requests are limited to 1,000 entries.",
        ));
    }
    let settings = lock(&state.settings)?.clone();
    maybe_prune_history(&state, &settings).await;
    let entries = available_store(&state)?
        .list_history(&request.search, request.limit as usize)
        .await?
        .into_iter()
        .map(history_to_view)
        .collect();
    let mut warning = lock(&state.history_warning)?.take();
    if !settings.history_enabled && warning.is_none() {
        warning = Some(
            "Query history is paused. Existing entries remain local until you delete or clear them."
                .to_owned(),
        );
    }
    Ok(HistoryResponse { entries, warning })
}

#[tauri::command]
pub(crate) async fn delete_history_entry(
    state: State<'_, AppRuntimeState>,
    request: DeleteHistoryEntryRequest,
) -> Result<FileActionResponse, QueryNotError> {
    let history_id = parse_id::<HistoryEntryId>(&request.history_id)?;
    let deleted = available_store(&state)?
        .delete_history_entry(history_id)
        .await?;
    Ok(FileActionResponse {
        completed: deleted,
        cancelled: false,
        message: if deleted {
            "The history entry was removed from QueryNot's active local store. Operating-system backups, snapshots, and storage forensics are outside this deletion guarantee."
        } else {
            "The history entry was already absent."
        }
        .to_owned(),
    })
}

#[tauri::command]
pub(crate) async fn clear_history(
    state: State<'_, AppRuntimeState>,
    request: ConfirmedActionRequest,
) -> Result<FileActionResponse, QueryNotError> {
    if !request.confirmed {
        return Err(QueryNotError::authorization(
            "Clearing all query history requires explicit confirmation.",
        ));
    }
    let deleted = available_store(&state)?.clear_history().await?;
    Ok(FileActionResponse {
        completed: true,
        cancelled: false,
        message: format!(
            "Removed {deleted} history entries from QueryNot's active local store. Operating-system backups, snapshots, and storage forensics are outside this deletion guarantee."
        ),
    })
}

fn profile_from_input(
    state: &AppRuntimeState,
    input: ProfileInput,
    existing: Option<&ConnectionProfile>,
    now_ms: i64,
) -> Result<ConnectionProfile, QueryNotError> {
    if let Some(existing) = existing
        && !profile_kind_matches_target(&input.kind, &existing.target)
    {
        return Err(QueryNotError::authorization(
            "A saved connection's file/server type and server engine cannot change. Create a new profile instead.",
        ));
    }
    let target = match input.kind.as_str() {
        "sqlite" => {
            let path = if let Some(grant) = input.file_grant_id {
                resolve_grant(state, &grant, FilePurpose::SqliteDatabase)?
            } else if let Some(ConnectionProfile {
                target: ConnectionTarget::Sqlite { file_path, .. },
                ..
            }) = existing
            {
                PathBuf::from(file_path)
            } else {
                return Err(QueryNotError::authorization(
                    "Creating a SQLite profile requires a native file-chooser grant.",
                ));
            };
            ConnectionTarget::Sqlite {
                file_path: path.to_string_lossy().into_owned(),
                read_only: input.read_only,
            }
        }
        "mysql_family" | "postgres" => {
            let postgres = input.kind == "postgres";
            if input.file_grant_id.is_some() {
                return Err(QueryNotError::authorization(
                    "A network profile cannot consume a local-file grant.",
                ));
            }
            let tls_mode = match input.tls_mode.as_deref() {
                Some("disabled") => TlsMode::Disabled,
                Some("required") => TlsMode::Required,
                Some("verify_identity") | None => TlsMode::VerifyIdentity,
                Some("custom_ca") => TlsMode::CustomCa,
                _ => {
                    return Err(QueryNotError::authorization(
                        "Unsupported TLS mode. Verification is never downgraded implicitly.",
                    ));
                }
            };
            let existing_tls = match existing.map(|profile| &profile.target) {
                Some(ConnectionTarget::MysqlFamily {
                    tls_ca_path,
                    tls_client_certificate_path,
                    tls_client_key_path,
                    ..
                })
                | Some(ConnectionTarget::Postgres {
                    tls_ca_path,
                    tls_client_certificate_path,
                    tls_client_key_path,
                    ..
                }) => (
                    tls_ca_path.clone(),
                    tls_client_certificate_path.clone(),
                    tls_client_key_path.clone(),
                ),
                _ => (None, None, None),
            };
            let mut tls_ca_path = resolve_optional_grant(
                state,
                input.tls_ca_grant_id.as_deref(),
                FilePurpose::TlsCa,
                existing_tls.0,
            )?;
            let mut tls_client_certificate_path = resolve_optional_grant(
                state,
                input.tls_client_certificate_grant_id.as_deref(),
                FilePurpose::TlsClientCertificate,
                existing_tls.1,
            )?;
            let mut tls_client_key_path = resolve_optional_grant(
                state,
                input.tls_client_key_grant_id.as_deref(),
                FilePurpose::TlsClientKey,
                existing_tls.2,
            )?;
            if input.clear_tls_ca || tls_mode != TlsMode::CustomCa {
                tls_ca_path = None;
            }
            if input.clear_tls_client_identity
                || !matches!(tls_mode, TlsMode::VerifyIdentity | TlsMode::CustomCa)
            {
                tls_client_certificate_path = None;
                tls_client_key_path = None;
            }
            let host = input.host.unwrap_or_default();
            let port = input.port.unwrap_or(if postgres { 5432 } else { 3306 });
            let default_database = input.default_database;
            let username = input.username.unwrap_or_default();
            if postgres {
                ConnectionTarget::Postgres {
                    host,
                    port,
                    default_database,
                    username,
                    tls_mode,
                    tls_ca_path,
                    tls_client_certificate_path,
                    tls_client_key_path,
                }
            } else {
                ConnectionTarget::MysqlFamily {
                    host,
                    port,
                    default_database,
                    username,
                    tls_mode,
                    tls_ca_path,
                    tls_client_certificate_path,
                    tls_client_key_path,
                }
            }
        }
        _ => {
            return Err(QueryNotError::authorization(
                "Unsupported profile kind. Profiles must be configured manually.",
            ));
        }
    };

    let mut profile = match existing {
        Some(existing) => ConnectionProfile {
            id: existing.id,
            name: input.name,
            target,
            secret_reference: existing.secret_reference,
            connection_timeout_seconds: input.connection_timeout_seconds,
            automatic_reconnect: input.automatic_reconnect,
            created_at_ms: existing.created_at_ms,
            updated_at_ms: now_ms,
        },
        None => {
            let mut profile = ConnectionProfile::new(
                input.name,
                target,
                input.connection_timeout_seconds,
                now_ms,
            )?;
            profile.automatic_reconnect = input.automatic_reconnect;
            profile
        }
    };
    profile.updated_at_ms = now_ms;
    profile.validate().map_err(validation_error)?;
    Ok(profile)
}

fn profile_kind_matches_target(kind: &str, target: &ConnectionTarget) -> bool {
    matches!(
        (kind, target),
        ("sqlite", ConnectionTarget::Sqlite { .. })
            | ("mysql_family", ConnectionTarget::MysqlFamily { .. })
            | ("postgres", ConnectionTarget::Postgres { .. })
    )
}

fn profile_to_view(profile: &ConnectionProfile) -> ProfileView {
    match &profile.target {
        ConnectionTarget::Sqlite {
            file_path,
            read_only,
        } => ProfileView {
            id: profile.id.to_string(),
            name: profile.name.clone(),
            kind: "sqlite".to_owned(),
            file_name: Some(display_name(Path::new(file_path))),
            tls_ca_file_name: None,
            tls_client_certificate_file_name: None,
            tls_client_key_file_name: None,
            read_only: *read_only,
            host: None,
            port: None,
            default_database: None,
            username: None,
            tls_mode: None,
            has_saved_secret: profile.secret_reference.is_some(),
            connection_timeout_seconds: profile.connection_timeout_seconds,
            automatic_reconnect: profile.automatic_reconnect,
        },
        ConnectionTarget::MysqlFamily {
            host,
            port,
            default_database,
            username,
            tls_mode,
            tls_ca_path,
            tls_client_certificate_path,
            tls_client_key_path,
        } => ProfileView {
            id: profile.id.to_string(),
            name: profile.name.clone(),
            kind: "mysql_family".to_owned(),
            file_name: None,
            tls_ca_file_name: tls_ca_path.as_deref().map(Path::new).map(display_name),
            tls_client_certificate_file_name: tls_client_certificate_path
                .as_deref()
                .map(Path::new)
                .map(display_name),
            tls_client_key_file_name: tls_client_key_path
                .as_deref()
                .map(Path::new)
                .map(display_name),
            read_only: false,
            host: Some(host.clone()),
            port: Some(*port),
            default_database: default_database.clone(),
            username: Some(username.clone()),
            tls_mode: Some(
                match tls_mode {
                    TlsMode::Disabled => "disabled",
                    TlsMode::Required => "required",
                    TlsMode::VerifyIdentity => "verify_identity",
                    TlsMode::CustomCa => "custom_ca",
                }
                .to_owned(),
            ),
            has_saved_secret: profile.secret_reference.is_some(),
            connection_timeout_seconds: profile.connection_timeout_seconds,
            automatic_reconnect: profile.automatic_reconnect,
        },
        ConnectionTarget::Postgres {
            host,
            port,
            default_database,
            username,
            tls_mode,
            tls_ca_path,
            tls_client_certificate_path,
            tls_client_key_path,
        } => ProfileView {
            id: profile.id.to_string(),
            name: profile.name.clone(),
            kind: "postgres".to_owned(),
            file_name: None,
            tls_ca_file_name: tls_ca_path.as_deref().map(Path::new).map(display_name),
            tls_client_certificate_file_name: tls_client_certificate_path
                .as_deref()
                .map(Path::new)
                .map(display_name),
            tls_client_key_file_name: tls_client_key_path
                .as_deref()
                .map(Path::new)
                .map(display_name),
            read_only: false,
            host: Some(host.clone()),
            port: Some(*port),
            default_database: default_database.clone(),
            username: Some(username.clone()),
            tls_mode: Some(
                match tls_mode {
                    TlsMode::Disabled => "disabled",
                    TlsMode::Required => "required",
                    TlsMode::VerifyIdentity => "verify_identity",
                    TlsMode::CustomCa => "custom_ca",
                }
                .to_owned(),
            ),
            has_saved_secret: profile.secret_reference.is_some(),
            connection_timeout_seconds: profile.connection_timeout_seconds,
            automatic_reconnect: profile.automatic_reconnect,
        },
    }
}

fn settings_to_view(settings: &AppSettings) -> SettingsView {
    SettingsView {
        theme: match settings.theme {
            ThemePreference::System => "system",
            ThemePreference::Light => "light",
            ThemePreference::Dark => "dark",
            ThemePreference::Forest => "forest",
        }
        .to_owned(),
        ui_scale_percent: settings.ui_scale_percent,
        editor_word_wrap: settings.editor_word_wrap,
        formatter_uppercase_keywords: settings.formatter_uppercase_keywords,
        formatter_indent_spaces: settings.formatter_indent_spaces,
        connection_timeout_seconds: settings.connection_timeout_seconds,
        result_tranche_rows: settings.result_tranche_rows,
        table_page_rows: settings.table_page_rows,
        table_font_family: match settings.table_font_family {
            TableFontPreference::System => "system",
            TableFontPreference::Monospace => "monospace",
        }
        .to_owned(),
        table_font_size_px: settings.table_font_size_px,
        history_enabled: settings.history_enabled,
        history_retention_days: settings.history_retention_days,
        session_restoration_enabled: settings.session_restoration_enabled,
        automatic_reconnect_default: settings.automatic_reconnect_default,
        operational_log_enabled: settings.operational_log_enabled,
        operational_log_max_bytes: settings.operational_log_max_bytes,
        operational_log_retention_days: settings.operational_log_retention_days,
    }
}

fn settings_from_view(view: SettingsView) -> Result<AppSettings, QueryNotError> {
    let theme = match view.theme.as_str() {
        "system" => ThemePreference::System,
        "light" => ThemePreference::Light,
        "dark" => ThemePreference::Dark,
        "forest" => ThemePreference::Forest,
        _ => return Err(QueryNotError::authorization("Unsupported theme value.")),
    };
    let table_font_family = match view.table_font_family.as_str() {
        "system" => TableFontPreference::System,
        "monospace" => TableFontPreference::Monospace,
        _ => {
            return Err(QueryNotError::authorization(
                "Unsupported table font value.",
            ));
        }
    };
    Ok(AppSettings {
        theme,
        ui_scale_percent: view.ui_scale_percent,
        editor_word_wrap: view.editor_word_wrap,
        formatter_uppercase_keywords: view.formatter_uppercase_keywords,
        formatter_indent_spaces: view.formatter_indent_spaces,
        connection_timeout_seconds: view.connection_timeout_seconds,
        result_tranche_rows: view.result_tranche_rows,
        table_page_rows: view.table_page_rows,
        table_font_family,
        table_font_size_px: view.table_font_size_px,
        history_enabled: view.history_enabled,
        history_retention_days: view.history_retention_days,
        session_restoration_enabled: view.session_restoration_enabled,
        automatic_reconnect_default: view.automatic_reconnect_default,
        operational_log_enabled: view.operational_log_enabled,
        operational_log_max_bytes: view.operational_log_max_bytes,
        operational_log_retention_days: view.operational_log_retention_days,
    })
}

fn workspace_to_view(
    state: &AppRuntimeState,
    snapshot: WorkspaceSnapshot,
) -> Result<WorkspaceView, QueryNotError> {
    let mut grants = lock(&state.file_grants)?;
    let tabs = snapshot
        .tabs
        .into_iter()
        .map(|tab| {
            let source_file_grant_id = tab.source_file_path.map(|path| {
                let grant_id = FileGrantId::new();
                let stamp = match (
                    tab.source_file_modified_ms,
                    tab.source_file_size,
                    tab.source_file_identity.clone(),
                ) {
                    (Some(modified_ms), Some(size), Some(identity)) => Some(SqlFileStamp {
                        modified_ms,
                        size,
                        identity,
                    }),
                    _ => None,
                };
                grants.insert(
                    grant_id,
                    GrantedFile {
                        path: PathBuf::from(path),
                        purpose: FilePurpose::SqlDraft,
                        stamp,
                    },
                );
                grant_id.to_string()
            });
            WorkspaceTabView {
                id: tab.id.to_string(),
                title: tab.title,
                kind: match tab.kind {
                    WorkspaceTabKind::Query => "query",
                    WorkspaceTabKind::TableData => "table_data",
                }
                .to_owned(),
                pinned: tab.pinned,
                profile_id: tab.profile_id.map(|id| id.to_string()),
                profile_label: tab.profile_label,
                context_label: tab.context_label,
                sql: tab.sql,
                dirty: tab.dirty,
                position: tab.position,
                source_file_grant_id,
                table_namespace: tab.table_namespace,
                table_name: tab.table_name,
                reconnectable: tab.reconnectable,
            }
        })
        .collect();
    Ok(WorkspaceView {
        tabs,
        active_tab_id: snapshot.active_tab_id.map(|id| id.to_string()),
        panel_sizes: PanelSizesView {
            explorer_percent: snapshot.panel_sizes.explorer_percent,
            results_percent: snapshot.panel_sizes.results_percent,
            sidebar_connections_percent: snapshot.panel_sizes.sidebar_connections_percent,
        },
    })
}

fn workspace_from_view(
    state: &AppRuntimeState,
    view: WorkspaceView,
) -> Result<WorkspaceSnapshot, QueryNotError> {
    let tabs = view
        .tabs
        .into_iter()
        .map(|tab| {
            let profile_id = tab
                .profile_id
                .as_deref()
                .map(parse_id::<ProfileId>)
                .transpose()?;
            let source_file = tab
                .source_file_grant_id
                .as_deref()
                .map(|grant| {
                    let grant_id = parse_id::<FileGrantId>(grant)?;
                    resolve_granted(state, grant_id, FilePurpose::SqlDraft)
                })
                .transpose()?;
            let source_file_path = source_file
                .as_ref()
                .map(|granted| granted.path.to_string_lossy().into_owned());
            let source_stamp = source_file.and_then(|granted| granted.stamp);
            let tab_id = parse_id::<TabId>(&tab.id)?;
            lock(&state.ownership)?.authorize_tab(state.window_id, profile_id, tab_id)?;
            Ok(WorkspaceTab {
                id: tab_id,
                title: tab.title,
                kind: match tab.kind.as_str() {
                    "query" => WorkspaceTabKind::Query,
                    "table_data" => WorkspaceTabKind::TableData,
                    _ => {
                        return Err(QueryNotError::authorization(
                            "Workspace tab kind is unsupported.",
                        ));
                    }
                },
                pinned: tab.pinned,
                profile_id,
                profile_label: tab.profile_label,
                context_label: tab.context_label,
                sql: tab.sql,
                dirty: tab.dirty,
                position: tab.position,
                source_file_path,
                source_file_modified_ms: source_stamp.as_ref().map(|stamp| stamp.modified_ms),
                source_file_size: source_stamp.as_ref().map(|stamp| stamp.size),
                source_file_identity: source_stamp.map(|stamp| stamp.identity),
                table_namespace: tab.table_namespace,
                table_name: tab.table_name,
                reconnectable: profile_id.is_some() && tab.reconnectable,
            })
        })
        .collect::<Result<Vec<_>, QueryNotError>>()?;
    let snapshot = WorkspaceSnapshot {
        tabs,
        active_tab_id: view
            .active_tab_id
            .as_deref()
            .map(parse_id::<TabId>)
            .transpose()?,
        panel_sizes: PanelSizes {
            explorer_percent: view.panel_sizes.explorer_percent,
            results_percent: view.panel_sizes.results_percent,
            sidebar_connections_percent: view.panel_sizes.sidebar_connections_percent,
        },
    };
    snapshot.validate().map_err(validation_error)?;
    Ok(snapshot)
}

fn build_diagnostics_preview(state: &AppRuntimeState) -> Result<DiagnosticsPreview, QueryNotError> {
    let events = lock(&state.operational_log)?
        .read_events()
        .unwrap_or_default();
    Ok(DiagnosticsPreview {
        application_version: env!("CARGO_PKG_VERSION").to_owned(),
        contract_version: CONTRACT_VERSION,
        operating_system: std::env::consts::OS.to_owned(),
        runtime_architecture: std::env::consts::ARCH.to_owned(),
        events,
    })
}

fn diagnostics_to_view(preview: DiagnosticsPreview) -> DiagnosticsPreviewView {
    DiagnosticsPreviewView {
        application_version: preview.application_version,
        contract_version: preview.contract_version,
        operating_system: preview.operating_system,
        runtime_architecture: preview.runtime_architecture,
        events: preview
            .events
            .into_iter()
            .map(|event| DiagnosticEventView {
                timestamp_ms: event.timestamp_ms,
                area: diagnostic_area_name(event.area).to_owned(),
                code: event.code,
                error_category: event.error_category.map(error_category_name),
            })
            .collect(),
    }
}

fn grant_file(
    state: &AppRuntimeState,
    path: PathBuf,
    purpose: FilePurpose,
) -> Result<FileGrantId, QueryNotError> {
    let grant_id = FileGrantId::new();
    lock(&state.file_grants)?.insert(
        grant_id,
        GrantedFile {
            path,
            purpose,
            stamp: None,
        },
    );
    Ok(grant_id)
}

fn grant_sql_file(
    state: &AppRuntimeState,
    path: PathBuf,
    stamp: SqlFileStamp,
) -> Result<FileGrantId, QueryNotError> {
    let grant_id = FileGrantId::new();
    lock(&state.file_grants)?.insert(
        grant_id,
        GrantedFile {
            path,
            purpose: FilePurpose::SqlDraft,
            stamp: Some(stamp),
        },
    );
    Ok(grant_id)
}

fn resolve_granted(
    state: &AppRuntimeState,
    grant_id: FileGrantId,
    expected_purpose: FilePurpose,
) -> Result<GrantedFile, QueryNotError> {
    let grants = lock(&state.file_grants)?;
    let granted = grants.get(&grant_id).ok_or_else(|| {
        QueryNotError::authorization(
            "The local-file grant is unknown or expired. Choose the file again.",
        )
    })?;
    if granted.purpose != expected_purpose || !granted.path.is_absolute() {
        return Err(QueryNotError::authorization(
            "The local-file grant does not authorize this operation.",
        ));
    }
    Ok(granted.clone())
}

fn resolve_grant(
    state: &AppRuntimeState,
    grant: &str,
    expected_purpose: FilePurpose,
) -> Result<PathBuf, QueryNotError> {
    let grant_id = parse_id::<FileGrantId>(grant)?;
    resolve_granted(state, grant_id, expected_purpose).map(|granted| granted.path)
}

fn update_sql_grant(
    state: &AppRuntimeState,
    grant_id: FileGrantId,
    stamp: SqlFileStamp,
) -> Result<(), QueryNotError> {
    let mut grants = lock(&state.file_grants)?;
    let granted = grants.get_mut(&grant_id).ok_or_else(|| {
        QueryNotError::authorization("The SQL-file grant expired before save completed.")
    })?;
    if granted.purpose != FilePurpose::SqlDraft {
        return Err(QueryNotError::authorization(
            "The local-file grant does not authorize SQL-file saving.",
        ));
    }
    granted.stamp = Some(stamp);
    Ok(())
}

fn authorize_file_tab(
    state: &AppRuntimeState,
    profile_id: Option<&str>,
    tab_id: &str,
) -> Result<(), QueryNotError> {
    let profile_id = profile_id.map(parse_id::<ProfileId>).transpose()?;
    let tab_id = parse_id::<TabId>(tab_id)?;
    lock(&state.ownership)?.authorize_tab(state.window_id, profile_id, tab_id)?;
    Ok(())
}

fn validate_sql_file_content(content: &str) -> Result<(), QueryNotError> {
    if content.len() > MAX_SQL_FILE_BYTES as usize || content.bytes().any(|byte| byte == 0) {
        return Err(QueryNotError::authorization(
            "SQL file content must be UTF-8 without NUL and no larger than 4 MiB.",
        ));
    }
    Ok(())
}

fn sql_file_stamp(path: &Path, bytes: &[u8]) -> Result<SqlFileStamp, QueryNotError> {
    let metadata = std::fs::metadata(path).map_err(|_| {
        QueryNotError::local_storage("The SQL file identity could not be read.", true)
    })?;
    if !metadata.is_file() || metadata.len() > MAX_SQL_FILE_BYTES {
        return Err(QueryNotError::authorization(
            "The SQL file must remain a regular file no larger than 4 MiB.",
        ));
    }
    let modified_ms = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
        .and_then(|duration| i64::try_from(duration.as_millis()).ok())
        .unwrap_or(0);
    let mut hasher = DefaultHasher::new();
    bytes.hash(&mut hasher);
    metadata.len().hash(&mut hasher);
    std::fs::canonicalize(path)
        .unwrap_or_else(|_| path.to_path_buf())
        .hash(&mut hasher);
    if let Ok(created) = metadata.created()
        && let Ok(duration) = created.duration_since(std::time::UNIX_EPOCH)
    {
        duration.as_nanos().hash(&mut hasher);
    }
    Ok(SqlFileStamp {
        modified_ms,
        size: metadata.len(),
        identity: format!("v1:{:016x}", hasher.finish()),
    })
}

fn write_sql_file(path: &Path, content: &str, overwrite: bool) -> Result<(), QueryNotError> {
    write_local_bytes_atomically(path, content.as_bytes(), overwrite).map_err(|_| {
        QueryNotError::local_storage(
            "The SQL file could not be written atomically. Existing content was preserved when possible.",
            true,
        )
    })
}

fn external_file_change_response(message: &str) -> SqlFileActionResponse {
    SqlFileActionResponse {
        status: "external_change".to_owned(),
        cancelled: false,
        file_grant_id: None,
        display_name: None,
        message: message.to_owned(),
    }
}

fn resolve_optional_grant(
    state: &AppRuntimeState,
    grant: Option<&str>,
    purpose: FilePurpose,
    existing: Option<String>,
) -> Result<Option<String>, QueryNotError> {
    grant
        .map(|grant| {
            resolve_grant(state, grant, purpose).map(|path| path.to_string_lossy().into_owned())
        })
        .transpose()
        .map(|resolved| resolved.or(existing))
}

pub(crate) fn available_store(state: &AppRuntimeState) -> Result<&LocalStore, QueryNotError> {
    state.store.as_ref().ok_or_else(|| {
        QueryNotError::local_storage(
            state.store_message.clone().unwrap_or_else(|| {
                "The QueryNot local store is in recoverable degraded mode.".to_owned()
            }),
            true,
        )
    })
}

pub(crate) fn lock<T>(mutex: &Mutex<T>) -> Result<MutexGuard<'_, T>, QueryNotError> {
    mutex
        .lock()
        .map_err(|_| QueryNotError::internal("Native state lock is unavailable."))
}

pub(crate) fn parse_id<T>(value: &str) -> Result<T, QueryNotError>
where
    T: FromStr,
{
    T::from_str(value).map_err(|_| QueryNotError::authorization("Resource identifier is invalid."))
}

fn log_event(
    state: &AppRuntimeState,
    area: DiagnosticArea,
    code: &str,
    category: Option<ErrorCategory>,
) {
    if let Ok(log) = state.operational_log.lock() {
        let now = unix_time_ms();
        let _ = log.append(
            &OperationalEvent {
                timestamp_ms: now,
                area,
                code: code.to_owned(),
                error_category: category,
            },
            now,
        );
    }
}

fn operational_log(data_dir: &Path, settings: &AppSettings) -> LocalOperationalLog {
    LocalOperationalLog::new(
        data_dir.join("querynot-operational.jsonl"),
        settings.operational_log_max_bytes,
        settings.operational_log_retention_days,
        settings.operational_log_enabled,
    )
}

fn cancelled_file_picker() -> FilePickerResponse {
    FilePickerResponse {
        cancelled: true,
        file_grant_id: None,
        tab_id: None,
        display_name: None,
        content: None,
    }
}

fn cancelled_connection_file_picker() -> ConnectionFilePickerResponse {
    ConnectionFilePickerResponse {
        cancelled: true,
        file_grant_id: None,
        display_name: None,
        detected_kind: None,
    }
}

fn display_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("selected file")
        .to_owned()
}

fn is_sql_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("sql"))
}

fn history_to_view(entry: HistoryEntry) -> HistoryEntryView {
    HistoryEntryView {
        id: entry.id.to_string(),
        sql: entry.sql,
        timestamp_ms: entry.timestamp_ms,
        profile_id: entry.profile_id.map(|id| id.to_string()),
        profile_label: entry.profile_label,
        engine: entry.engine,
        context: entry.context,
        duration_ms: entry.duration_ms,
        status: match entry.status {
            HistoryStatus::Succeeded => "succeeded",
            HistoryStatus::Failed => "failed",
            HistoryStatus::Cancelled => "cancelled",
        }
        .to_owned(),
        operation_kind: match entry.operation_kind {
            querynot_core::history::HistoryOperationKind::Query => "query",
            querynot_core::history::HistoryOperationKind::Explain => "explain",
        }
        .to_owned(),
        affected_rows: entry.affected_rows,
        received_rows: entry.received_rows,
        error_category: entry.error_category.map(error_category_name),
    }
}

const HISTORY_CLEANUP_INTERVAL_MS: i64 = 24 * 60 * 60 * 1_000;

fn history_cutoff_ms(now_ms: i64, retention_days: u16) -> i64 {
    now_ms.saturating_sub(i64::from(retention_days) * HISTORY_CLEANUP_INTERVAL_MS)
}

async fn maybe_prune_history(state: &AppRuntimeState, settings: &AppSettings) {
    let now_ms = unix_time_ms();
    let should_prune = match state.last_history_cleanup_ms.lock() {
        Ok(mut last_cleanup)
            if now_ms.saturating_sub(*last_cleanup) >= HISTORY_CLEANUP_INTERVAL_MS =>
        {
            *last_cleanup = now_ms;
            true
        }
        _ => false,
    };
    if should_prune
        && let Some(store) = &state.store
        && store
            .prune_history(history_cutoff_ms(now_ms, settings.history_retention_days))
            .await
            .is_err()
        && let Ok(mut warning) = state.history_warning.lock()
    {
        *warning = Some(
            "Query history retention cleanup could not be persisted. Current database and editor work remain available."
                .to_owned(),
        );
    }
}

pub(crate) async fn run_history_maintenance(state: &AppRuntimeState) {
    let settings = match state.settings.lock() {
        Ok(settings) => settings.clone(),
        Err(_) => return,
    };
    maybe_prune_history(state, &settings).await;
}

fn store_state_name(state: LocalStoreState) -> &'static str {
    match state {
        LocalStoreState::Healthy => "healthy",
        LocalStoreState::Degraded => "degraded",
        LocalStoreState::MigrationFailed => "migration_failed",
    }
}

fn diagnostic_area_name(area: DiagnosticArea) -> &'static str {
    match area {
        DiagnosticArea::Application => "application",
        DiagnosticArea::LocalStore => "local_store",
        DiagnosticArea::Vault => "vault",
        DiagnosticArea::ProfileLifecycle => "profile_lifecycle",
        DiagnosticArea::Workspace => "workspace",
        DiagnosticArea::Export => "export",
    }
}

fn error_category_name(category: ErrorCategory) -> String {
    match category {
        ErrorCategory::Authentication => "authentication",
        ErrorCategory::Authorization => "authorization",
        ErrorCategory::Connectivity => "connectivity",
        ErrorCategory::Tls => "tls",
        ErrorCategory::Timeout => "timeout",
        ErrorCategory::Cancelled => "cancelled",
        ErrorCategory::Syntax => "syntax",
        ErrorCategory::Constraint => "constraint",
        ErrorCategory::Transaction => "transaction",
        ErrorCategory::UnsupportedCapability => "unsupported_capability",
        ErrorCategory::LocalStorage => "local_storage",
        ErrorCategory::Internal => "internal",
    }
    .to_owned()
}

fn validation_error(error: impl std::fmt::Display) -> QueryNotError {
    QueryNotError::authorization(error.to_string())
}

fn vault_error(error: impl std::fmt::Display) -> QueryNotError {
    QueryNotError::authorization(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sqlite_profile_view_exposes_only_file_name_not_native_path() {
        let profile = ConnectionProfile::new(
            "Fixture",
            ConnectionTarget::Sqlite {
                file_path: "/private/user/fixture.sqlite3".to_owned(),
                read_only: true,
            },
            15,
            100,
        )
        .unwrap();
        let view = profile_to_view(&profile);
        assert_eq!(view.file_name.as_deref(), Some("fixture.sqlite3"));
        assert!(!serde_json::to_string(&view).unwrap().contains("/private"));
    }

    #[test]
    fn diagnostics_view_has_no_fields_for_endpoints_sql_paths_or_values() {
        let view = diagnostics_to_view(DiagnosticsPreview {
            application_version: "0.0.0".to_owned(),
            contract_version: 1,
            operating_system: "linux".to_owned(),
            runtime_architecture: "x86_64".to_owned(),
            events: vec![OperationalEvent {
                timestamp_ms: 1,
                area: DiagnosticArea::Vault,
                code: "vault_write_failed".to_owned(),
                error_category: Some(ErrorCategory::Authorization),
            }],
        });
        let serialized = serde_json::to_string(&view).unwrap();
        for excluded in ["password", "host", "database", "sql", "path", "value"] {
            assert!(!serialized.contains(excluded));
        }
    }

    #[test]
    fn sql_file_stamp_detects_external_changes_before_atomic_overwrite() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("fixture.sql");
        write_sql_file(&path, "select 1", false).unwrap();
        let expected = sql_file_stamp(&path, b"select 1").unwrap();

        std::fs::write(&path, b"select 2 -- external").unwrap();
        let external = std::fs::read(&path).unwrap();
        let current = sql_file_stamp(&path, &external).unwrap();
        assert_ne!(current, expected);
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "select 2 -- external"
        );

        write_sql_file(&path, "select 3", true).unwrap();
        assert_eq!(std::fs::read_to_string(path).unwrap(), "select 3");
    }

    #[test]
    fn history_cleanup_cutoff_is_bounded_and_day_based() {
        assert_eq!(
            history_cutoff_ms(10 * HISTORY_CLEANUP_INTERVAL_MS, 3),
            7 * HISTORY_CLEANUP_INTERVAL_MS
        );
    }

    #[test]
    fn saved_profile_kind_is_immutable_across_file_and_server_adapters() {
        let mysql = ConnectionTarget::MysqlFamily {
            host: "127.0.0.1".to_owned(),
            port: 3306,
            default_database: None,
            username: "fixture".to_owned(),
            tls_mode: TlsMode::VerifyIdentity,
            tls_ca_path: None,
            tls_client_certificate_path: None,
            tls_client_key_path: None,
        };
        let postgres = ConnectionTarget::Postgres {
            host: "127.0.0.1".to_owned(),
            port: 5432,
            default_database: None,
            username: "fixture".to_owned(),
            tls_mode: TlsMode::VerifyIdentity,
            tls_ca_path: None,
            tls_client_certificate_path: None,
            tls_client_key_path: None,
        };

        assert!(profile_kind_matches_target("mysql_family", &mysql));
        assert!(profile_kind_matches_target("postgres", &postgres));
        assert!(!profile_kind_matches_target("postgres", &mysql));
        assert!(!profile_kind_matches_target("mysql_family", &postgres));
        assert!(!profile_kind_matches_target("sqlite", &postgres));
    }
}
