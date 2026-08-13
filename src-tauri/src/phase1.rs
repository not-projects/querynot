use querynot_core::diagnostics::{
    DiagnosticArea, DiagnosticsPreview, LocalOperationalLog, OperationalEvent,
};
use querynot_core::generated::contracts::*;
use querynot_core::ownership::OwnershipRegistry;
use querynot_core::profile::{ConnectionProfile, ConnectionTarget, TlsMode};
use querynot_core::settings::{AppSettings, ThemePreference};
use querynot_core::state::LocalStoreState;
use querynot_core::store::{
    LocalStore, ProfileDeletionOutcome, delete_profile_two_step, unix_time_ms,
};
use querynot_core::vault::{KeyringVault, SecretVault, SessionSecretStore};
use querynot_core::workspace::{PanelSizes, WorkspaceSnapshot, WorkspaceTab};
use querynot_core::{ErrorCategory, FileGrantId, ProfileId, QueryNotError, TabId, WindowId};
use secrecy::SecretString;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::{Mutex, MutexGuard};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

const MAX_SQL_FILE_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum FilePurpose {
    SqlDraft,
    SqliteDatabase,
}

#[derive(Clone, Debug)]
struct GrantedFile {
    path: PathBuf,
    purpose: FilePurpose,
}

pub(crate) struct AppRuntimeState {
    store: Option<LocalStore>,
    store_state: LocalStoreState,
    store_message: Option<String>,
    settings: Mutex<AppSettings>,
    vault: KeyringVault,
    session_secrets: Mutex<SessionSecretStore>,
    file_grants: Mutex<HashMap<FileGrantId, GrantedFile>>,
    ownership: Mutex<OwnershipRegistry>,
    operational_log: Mutex<LocalOperationalLog>,
    data_dir: PathBuf,
    window_id: WindowId,
}

impl AppRuntimeState {
    pub(crate) async fn initialize(app: AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let data_dir = app.path().app_data_dir()?;
        let bootstrap = LocalStore::bootstrap(data_dir.join("querynot.sqlite3")).await;
        let settings = match &bootstrap.store {
            Some(store) => store.load_settings().await.unwrap_or_default(),
            None => AppSettings::default(),
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
            store_message: bootstrap.safe_message,
            settings: Mutex::new(settings),
            vault: KeyringVault,
            session_secrets: Mutex::new(SessionSecretStore::default()),
            file_grants: Mutex::new(HashMap::new()),
            ownership: Mutex::new(ownership),
            operational_log: Mutex::new(operational_log),
            data_dir,
            window_id,
        })
    }

    pub(crate) fn cleanup_window(&self) {
        if let Ok(mut ownership) = self.ownership.lock() {
            let _ = ownership.cleanup_window(self.window_id);
        }
        if let Ok(mut secrets) = self.session_secrets.lock() {
            secrets.clear();
        }
        if let Ok(mut grants) = self.file_grants.lock() {
            grants.clear();
        }
    }
}

#[tauri::command]
pub(crate) async fn bootstrap_workspace(
    state: State<'_, AppRuntimeState>,
) -> Result<BootstrapWorkspaceResponse, QueryNotError> {
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
        phase: "phase_1_secure_local_foundation".to_owned(),
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
    if lock(&state.ownership)?.has_active_profile_resources(profile_id) {
        return Err(QueryNotError::authorization(
            "Disconnect this profile and resolve active jobs, transactions, and staged edits before deletion.",
        ));
    }
    let store = available_store(&state)?;
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
            lock(&state.ownership)?.unregister_profile(profile_id)?;
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
    if request.secret.is_empty() || request.secret.len() > 16 * 1024 {
        return Err(QueryNotError::authorization(
            "Credential must contain between 1 and 16,384 bytes.",
        ));
    }
    let secret = SecretString::new(request.secret.into_boxed_str());
    if request.session_only {
        lock(&state.session_secrets)?.replace(profile_id, secret);
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
        profile_id: profile.as_ref().map(|profile| profile.id.to_string()),
        profile_label: profile.as_ref().map(|profile| profile.name.clone()),
        context_label: None,
        sql: String::new(),
        dirty: false,
        position: 0,
        source_file_grant_id: None,
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
    let grant_id = grant_file(&state, path.clone(), FilePurpose::SqlDraft)?;
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
pub(crate) async fn pick_sqlite_file(
    app: AppHandle,
    state: State<'_, AppRuntimeState>,
) -> Result<FilePickerResponse, QueryNotError> {
    let selected = app
        .dialog()
        .file()
        .add_filter("SQLite databases", &["sqlite", "sqlite3", "db"])
        .set_title("Choose SQLite database")
        .blocking_pick_file();
    let Some(selected) = selected else {
        return Ok(cancelled_file_picker());
    };
    let path = selected.into_path().map_err(|_| {
        QueryNotError::authorization("Only local filesystem SQLite files are supported.")
    })?;
    let metadata = std::fs::metadata(&path).map_err(|_| {
        QueryNotError::local_storage("The selected SQLite file is unavailable.", true)
    })?;
    if !metadata.is_file() {
        return Err(QueryNotError::authorization(
            "The selected SQLite path is not a regular file.",
        ));
    }
    let grant_id = grant_file(&state, path.clone(), FilePurpose::SqliteDatabase)?;
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

fn profile_from_input(
    state: &AppRuntimeState,
    input: ProfileInput,
    existing: Option<&ConnectionProfile>,
    now_ms: i64,
) -> Result<ConnectionProfile, QueryNotError> {
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
        "mysql_family" => {
            if input.file_grant_id.is_some() {
                return Err(QueryNotError::authorization(
                    "A network profile cannot consume a local-file grant.",
                ));
            }
            ConnectionTarget::MysqlFamily {
                host: input.host.unwrap_or_default(),
                port: input.port.unwrap_or(3306),
                default_database: input.default_database,
                username: input.username.unwrap_or_default(),
                tls_mode: match input.tls_mode.as_deref() {
                    Some("required") => TlsMode::Required,
                    Some("verify_identity") | None => TlsMode::VerifyIdentity,
                    _ => {
                        return Err(QueryNotError::authorization(
                            "Unsupported TLS mode. QueryNot does not offer a verification-disabled mode.",
                        ));
                    }
                },
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
        } => ProfileView {
            id: profile.id.to_string(),
            name: profile.name.clone(),
            kind: "mysql_family".to_owned(),
            file_name: None,
            read_only: false,
            host: Some(host.clone()),
            port: Some(*port),
            default_database: default_database.clone(),
            username: Some(username.clone()),
            tls_mode: Some(
                match tls_mode {
                    TlsMode::Required => "required",
                    TlsMode::VerifyIdentity => "verify_identity",
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
    Ok(AppSettings {
        theme,
        ui_scale_percent: view.ui_scale_percent,
        editor_word_wrap: view.editor_word_wrap,
        formatter_uppercase_keywords: view.formatter_uppercase_keywords,
        formatter_indent_spaces: view.formatter_indent_spaces,
        connection_timeout_seconds: view.connection_timeout_seconds,
        result_tranche_rows: view.result_tranche_rows,
        table_page_rows: view.table_page_rows,
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
                grants.insert(
                    grant_id,
                    GrantedFile {
                        path: PathBuf::from(path),
                        purpose: FilePurpose::SqlDraft,
                    },
                );
                grant_id.to_string()
            });
            WorkspaceTabView {
                id: tab.id.to_string(),
                title: tab.title,
                profile_id: tab.profile_id.map(|id| id.to_string()),
                profile_label: tab.profile_label,
                context_label: tab.context_label,
                sql: tab.sql,
                dirty: tab.dirty,
                position: tab.position,
                source_file_grant_id,
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
            let source_file_path = tab
                .source_file_grant_id
                .as_deref()
                .map(|grant| resolve_grant(state, grant, FilePurpose::SqlDraft))
                .transpose()?
                .map(|path| path.to_string_lossy().into_owned());
            let tab_id = parse_id::<TabId>(&tab.id)?;
            lock(&state.ownership)?.authorize_tab(state.window_id, profile_id, tab_id)?;
            Ok(WorkspaceTab {
                id: tab_id,
                title: tab.title,
                profile_id,
                profile_label: tab.profile_label,
                context_label: tab.context_label,
                sql: tab.sql,
                dirty: tab.dirty,
                position: tab.position,
                source_file_path,
                source_file_modified_ms: None,
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
    lock(&state.file_grants)?.insert(grant_id, GrantedFile { path, purpose });
    Ok(grant_id)
}

fn resolve_grant(
    state: &AppRuntimeState,
    grant: &str,
    expected_purpose: FilePurpose,
) -> Result<PathBuf, QueryNotError> {
    let grant_id = parse_id::<FileGrantId>(grant)?;
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
    Ok(granted.path.clone())
}

fn available_store(state: &AppRuntimeState) -> Result<&LocalStore, QueryNotError> {
    state.store.as_ref().ok_or_else(|| {
        QueryNotError::local_storage(
            state.store_message.clone().unwrap_or_else(|| {
                "The QueryNot local store is in recoverable degraded mode.".to_owned()
            }),
            true,
        )
    })
}

fn lock<T>(mutex: &Mutex<T>) -> Result<MutexGuard<'_, T>, QueryNotError> {
    mutex
        .lock()
        .map_err(|_| QueryNotError::internal("Native state lock is unavailable."))
}

fn parse_id<T>(value: &str) -> Result<T, QueryNotError>
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

fn display_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("selected file")
        .to_owned()
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
}
