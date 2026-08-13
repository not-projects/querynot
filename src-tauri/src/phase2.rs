use crate::phase1::{AppRuntimeState, available_store, lock, parse_id};
use base64::Engine;
use querynot_core::export::{ExportFormat, ExportOptions, NoExportFault, write_received_rows};
use querynot_core::generated::contracts::*;
use querynot_core::history::{HistoryEntry, HistoryEntryInput, HistoryStatus};
use querynot_core::result::{MAX_RETAINED_ROWS, ResultRegistry, RetainedResult};
use querynot_core::sql::{
    SafetyReason, SqlDialect, execution_is_provably_read_only, plan_execution_for_dialect,
};
use querynot_core::sqlite::{
    ExecutionControl, SchemaObjectDetail, SchemaObjectKind, SqliteConnectionInfo,
    SqliteExecutionEvent, SqliteTransactionState, TransactionCertainty,
};
use querynot_core::store::{LocalStore, unix_time_ms};
use querynot_core::table::{
    BrowseInput, FilterOperator, MutationCell, MutationCellMode, MutationInput, MutationKind,
    MutationPlan, SortDirection, TableDefinition, TableDialect, TableEditorKind, TableFilter,
    TablePage, TableSort, plan_mutations, quote_identifier,
};
use querynot_core::{AdapterSession, CompatibilityStatus};
use querynot_core::{
    ErrorCategory, ExecutionId, MutationPlanId, NativeSessionId, ProfileId, QueryNotError,
    ResultSetId, TabId, TaggedValue,
};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tokio::sync::{mpsc, watch};

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
enum ConnectionAttemptKind {
    Test,
    Connect,
}

type ConnectionAttemptKey = (ProfileId, ConnectionAttemptKind);
type ConnectionAttemptRegistry = HashMap<ConnectionAttemptKey, watch::Sender<bool>>;

#[derive(Clone)]
struct ConnectedProfile {
    profile_name: String,
    metadata: AdapterSession,
    info: SqliteConnectionInfo,
}

#[derive(Clone)]
struct TabSessionResource {
    profile_id: ProfileId,
    tab_id: TabId,
    session: AdapterSession,
    context: String,
}

#[derive(Clone)]
struct ExecutionResource {
    profile_id: ProfileId,
    tab_id: TabId,
    session_id: NativeSessionId,
    session: AdapterSession,
    controls: mpsc::Sender<ExecutionControl>,
}

#[derive(Clone, Copy)]
struct ResultOwner {
    execution_id: ExecutionId,
    profile_id: ProfileId,
    tab_id: TabId,
    session_id: NativeSessionId,
}

#[derive(Clone)]
struct PendingApproval {
    profile_id: ProfileId,
    tab_id: TabId,
    session_id: NativeSessionId,
    plan_fingerprint: String,
}

struct HistoryCapture {
    store: LocalStore,
    warning: Arc<Mutex<Option<String>>>,
    sql: String,
    timestamp_ms: i64,
    profile_id: ProfileId,
    profile_label: String,
    engine: String,
    context: String,
    started_at: Instant,
}

#[derive(Clone)]
struct MutationPlanResource {
    profile_id: ProfileId,
    tab_id: TabId,
    session_id: NativeSessionId,
    context: String,
    plan: MutationPlan,
}

struct ExecutionBridgeContext {
    app: AppHandle,
    runtime: Phase2Runtime,
    ownership: Arc<Mutex<querynot_core::ownership::OwnershipRegistry>>,
    window_id: querynot_core::WindowId,
    lifecycle_epoch: u64,
    owner: ResultOwner,
    history_capture: Option<HistoryCapture>,
}

#[derive(Clone, Default)]
pub(crate) struct Phase2Runtime {
    connected: Arc<Mutex<HashMap<ProfileId, ConnectedProfile>>>,
    sessions: Arc<Mutex<HashMap<NativeSessionId, TabSessionResource>>>,
    executions: Arc<Mutex<HashMap<ExecutionId, ExecutionResource>>>,
    results: Arc<Mutex<ResultRegistry>>,
    result_owners: Arc<Mutex<HashMap<ResultSetId, ResultOwner>>>,
    pending_approvals: Arc<Mutex<HashMap<String, PendingApproval>>>,
    connection_attempts: Arc<Mutex<ConnectionAttemptRegistry>>,
    mutation_plans: Arc<Mutex<HashMap<MutationPlanId, MutationPlanResource>>>,
    lifecycle_epoch: Arc<Mutex<u64>>,
}

impl Phase2Runtime {
    pub(crate) fn profile_is_connected(&self, profile_id: ProfileId) -> bool {
        self.connected
            .lock()
            .is_ok_and(|connected| connected.contains_key(&profile_id))
    }

    pub(crate) fn cleanup(&self) {
        let Ok(mut epoch) = self.lifecycle_epoch.lock() else {
            return;
        };
        *epoch = epoch.wrapping_add(1);
        if let Ok(executions) = self.executions.lock() {
            for execution in executions.values() {
                execution.session.request_cancel();
                let _ = execution.controls.try_send(ExecutionControl::Cancel);
            }
        }
        if let Ok(mut executions) = self.executions.lock() {
            executions.clear();
        }
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.clear();
        }
        if let Ok(mut connected) = self.connected.lock() {
            connected.clear();
        }
        if let Ok(mut results) = self.results.lock() {
            *results = ResultRegistry::default();
        }
        if let Ok(mut owners) = self.result_owners.lock() {
            owners.clear();
        }
        if let Ok(mut approvals) = self.pending_approvals.lock() {
            approvals.clear();
        }
        if let Ok(mut attempts) = self.connection_attempts.lock() {
            for cancel in attempts.values() {
                let _ = cancel.send(true);
            }
            attempts.clear();
        }
        if let Ok(mut plans) = self.mutation_plans.lock() {
            plans.clear();
        }
    }

    fn begin_connection_attempt(
        &self,
        profile_id: ProfileId,
        kind: ConnectionAttemptKind,
    ) -> Result<watch::Receiver<bool>, QueryNotError> {
        let mut attempts = lock(&self.connection_attempts)?;
        if attempts.contains_key(&(profile_id, kind)) {
            return Err(QueryNotError::database(
                ErrorCategory::Connectivity,
                "This connection action is already in progress.",
                false,
            ));
        }
        let (cancel, receiver) = watch::channel(false);
        attempts.insert((profile_id, kind), cancel);
        Ok(receiver)
    }

    fn finish_connection_attempt(&self, profile_id: ProfileId, kind: ConnectionAttemptKind) {
        if let Ok(mut attempts) = self.connection_attempts.lock() {
            attempts.remove(&(profile_id, kind));
        }
    }

    fn cancel_connection_attempt(
        &self,
        profile_id: ProfileId,
        kind: ConnectionAttemptKind,
    ) -> Result<bool, QueryNotError> {
        let attempts = lock(&self.connection_attempts)?;
        Ok(attempts
            .get(&(profile_id, kind))
            .is_some_and(|cancel| cancel.send(true).is_ok()))
    }

    fn issue_approval(
        &self,
        profile_id: ProfileId,
        tab_id: TabId,
        session_id: NativeSessionId,
        plan_fingerprint: String,
    ) -> Result<String, QueryNotError> {
        let token = ExecutionId::new().to_string();
        let mut approvals = lock(&self.pending_approvals)?;
        approvals.retain(|_, pending| pending.tab_id != tab_id);
        approvals.insert(
            token.clone(),
            PendingApproval {
                profile_id,
                tab_id,
                session_id,
                plan_fingerprint,
            },
        );
        Ok(token)
    }

    fn consume_approval(
        &self,
        token: &str,
        profile_id: ProfileId,
        tab_id: TabId,
        session_id: NativeSessionId,
        plan_fingerprint: &str,
    ) -> Result<bool, QueryNotError> {
        let pending = lock(&self.pending_approvals)?.remove(token);
        Ok(pending.is_some_and(|pending| {
            pending.profile_id == profile_id
                && pending.tab_id == tab_id
                && pending.session_id == session_id
                && pending.plan_fingerprint == plan_fingerprint
        }))
    }
}

#[tauri::command]
pub(crate) async fn test_profile_connection(
    state: State<'_, AppRuntimeState>,
    request: ProfileIdRequest,
) -> Result<ConnectionInfoView, QueryNotError> {
    let profile_id = parse_id::<ProfileId>(&request.profile_id)?;
    lock(&state.ownership)?.authorize_profile(state.window_id, profile_id)?;
    let profile = available_store(&state)?.profile(profile_id).await?;
    let secrets = state.connection_secrets(&profile).await?;
    let mut cancel = state
        .phase2
        .begin_connection_attempt(profile_id, ConnectionAttemptKind::Test)?;
    let result = tokio::select! {
        biased;
        changed = cancel.changed() => match changed {
            Ok(()) if *cancel.borrow() => Err(cancelled_connection_error()),
            _ => Err(cancelled_connection_error()),
        },
        result = tokio::time::timeout(
            Duration::from_secs(profile.connection_timeout_seconds.into()),
            AdapterSession::test_connection(&profile, &secrets),
        ) => result.map_err(|_| connection_timeout_error(true)).and_then(|value| value),
    };
    state
        .phase2
        .finish_connection_attempt(profile_id, ConnectionAttemptKind::Test);
    let info = result?;
    Ok(connection_view(profile.id, &profile.name, &info))
}

#[tauri::command]
pub(crate) async fn connect_profile(
    state: State<'_, AppRuntimeState>,
    request: ProfileIdRequest,
) -> Result<ConnectionInfoView, QueryNotError> {
    let profile_id = parse_id::<ProfileId>(&request.profile_id)?;
    lock(&state.ownership)?.authorize_profile(state.window_id, profile_id)?;
    if let Some(connected) = lock(&state.phase2.connected)?.get(&profile_id).cloned() {
        return Ok(connection_view(
            profile_id,
            &connected.profile_name,
            &connected.info,
        ));
    }
    let profile = available_store(&state)?.profile(profile_id).await?;
    let secrets = state.connection_secrets(&profile).await?;
    let mut cancel = state
        .phase2
        .begin_connection_attempt(profile_id, ConnectionAttemptKind::Connect)?;
    let connecting = async {
        let session = AdapterSession::open(&profile, &secrets).await?;
        let info = session.connection_info(&profile).await?;
        Ok::<_, QueryNotError>((session, info))
    };
    let result = tokio::select! {
        biased;
        changed = cancel.changed() => match changed {
            Ok(()) if *cancel.borrow() => Err(cancelled_connection_error()),
            _ => Err(cancelled_connection_error()),
        },
        result = tokio::time::timeout(
            Duration::from_secs(profile.connection_timeout_seconds.into()),
            connecting,
        ) => result.map_err(|_| connection_timeout_error(false)).and_then(|value| value),
    };
    state
        .phase2
        .finish_connection_attempt(profile_id, ConnectionAttemptKind::Connect);
    let (session, info) = result?;
    lock(&state.phase2.connected)?.insert(
        profile_id,
        ConnectedProfile {
            profile_name: profile.name.clone(),
            metadata: session,
            info: info.clone(),
        },
    );
    Ok(connection_view(profile_id, &profile.name, &info))
}

#[tauri::command]
pub(crate) fn cancel_profile_connection(
    state: State<'_, AppRuntimeState>,
    request: CancelConnectionRequest,
) -> Result<FileActionResponse, QueryNotError> {
    let profile_id = parse_id::<ProfileId>(&request.profile_id)?;
    lock(&state.ownership)?.authorize_profile(state.window_id, profile_id)?;
    let kind = match request.action.as_str() {
        "test" => ConnectionAttemptKind::Test,
        "connect" => ConnectionAttemptKind::Connect,
        _ => {
            return Err(QueryNotError::database(
                ErrorCategory::UnsupportedCapability,
                "The requested connection action cannot be cancelled.",
                false,
            ));
        }
    };
    let cancelled = state.phase2.cancel_connection_attempt(profile_id, kind)?;
    Ok(FileActionResponse {
        completed: cancelled,
        cancelled,
        message: if cancelled {
            "Cancellation was requested; partially opened native resources are being closed."
        } else {
            "No matching connection action is still running."
        }
        .to_owned(),
    })
}

fn cancelled_connection_error() -> QueryNotError {
    QueryNotError::database(
        ErrorCategory::Cancelled,
        "The connection action was cancelled and partial native resources were closed.",
        false,
    )
}

fn connection_timeout_error(testing: bool) -> QueryNotError {
    QueryNotError::database(
        ErrorCategory::Timeout,
        if testing {
            "Database connection testing reached the configured timeout; partial native resources were closed."
        } else {
            "Database connection setup reached the configured timeout; partial native resources were closed."
        },
        true,
    )
}

#[tauri::command]
pub(crate) async fn disconnect_profile(
    state: State<'_, AppRuntimeState>,
    request: ProfileIdRequest,
) -> Result<FileActionResponse, QueryNotError> {
    let profile_id = parse_id::<ProfileId>(&request.profile_id)?;
    lock(&state.ownership)?.authorize_profile(state.window_id, profile_id)?;
    if lock(&state.phase2.sessions)?
        .values()
        .any(|session| session.profile_id == profile_id)
    {
        return Err(QueryNotError::database(
            ErrorCategory::Transaction,
            "Disconnect the profile's tab sessions and resolve active work first.",
            false,
        ));
    }
    state.clear_session_secret(profile_id)?;
    let removed = lock(&state.phase2.connected)?.remove(&profile_id).is_some();
    Ok(FileActionResponse {
        completed: removed,
        cancelled: false,
        message: if removed {
            "The metadata session was disconnected. Offline tabs and drafts were preserved."
        } else {
            "This profile was already disconnected. Offline tabs and drafts were preserved."
        }
        .to_owned(),
    })
}

#[tauri::command]
pub(crate) async fn open_tab_session(
    state: State<'_, AppRuntimeState>,
    request: ProfileTabRequest,
) -> Result<SessionView, QueryNotError> {
    let profile_id = parse_id::<ProfileId>(&request.profile_id)?;
    let tab_id = parse_id::<TabId>(&request.tab_id)?;
    lock(&state.ownership)?.authorize_tab(state.window_id, Some(profile_id), tab_id)?;
    if !lock(&state.phase2.connected)?.contains_key(&profile_id) {
        return Err(QueryNotError::database(
            ErrorCategory::Connectivity,
            "Connect the profile before opening this tab session.",
            true,
        ));
    }
    let existing = {
        let sessions = lock(&state.phase2.sessions)?;
        sessions
            .iter()
            .find(|(_, resource)| resource.profile_id == profile_id && resource.tab_id == tab_id)
            .map(|(id, resource)| (*id, resource.clone()))
    };
    if let Some((session_id, resource)) = existing {
        return Ok(session_view(
            profile_id,
            tab_id,
            session_id,
            &resource.context,
            resource.session.transaction_state().await,
        ));
    }
    let profile = available_store(&state)?.profile(profile_id).await?;
    let secrets = state.connection_secrets(&profile).await?;
    let session = AdapterSession::open(&profile, &secrets).await?;
    let context = session.connection_info(&profile).await?.context;
    let session_id = NativeSessionId::new();
    lock(&state.ownership)?.register_session(state.window_id, profile_id, tab_id, session_id)?;
    lock(&state.phase2.sessions)?.insert(
        session_id,
        TabSessionResource {
            profile_id,
            tab_id,
            session: session.clone(),
            context: context.clone(),
        },
    );
    Ok(session_view(
        profile_id,
        tab_id,
        session_id,
        &context,
        session.transaction_state().await,
    ))
}

#[tauri::command]
pub(crate) async fn close_tab_session(
    state: State<'_, AppRuntimeState>,
    request: SessionRequest,
) -> Result<FileActionResponse, QueryNotError> {
    let (profile_id, tab_id, session_id) = session_ids(&request)?;
    lock(&state.ownership)?.authorize_session(state.window_id, profile_id, tab_id, session_id)?;
    let resource = session_resource(&state, profile_id, tab_id, session_id)?;
    ensure_session_idle(&state, session_id)?;
    if lock(&state.phase2.mutation_plans)?
        .values()
        .any(|plan| plan.session_id == session_id)
    {
        return Err(QueryNotError::database(
            ErrorCategory::Transaction,
            "Apply or discard the staged table preview before disconnecting this session.",
            false,
        ));
    }
    let transaction = resource.session.transaction_state().await;
    if transaction.certainty != TransactionCertainty::Clean {
        return Err(QueryNotError::database(
            ErrorCategory::Transaction,
            "Commit or roll back the tab transaction before disconnecting this session.",
            false,
        ));
    }
    lock(&state.ownership)?.unregister_session(state.window_id, profile_id, tab_id, session_id)?;
    lock(&state.phase2.sessions)?.remove(&session_id);
    dispose_tab_results(&state.phase2, tab_id);
    Ok(FileActionResponse {
        completed: true,
        cancelled: false,
        message: "The dedicated tab session was disconnected; editor content remains offline."
            .to_owned(),
    })
}

#[tauri::command]
pub(crate) async fn load_schema_namespaces(
    state: State<'_, AppRuntimeState>,
    request: ProfileIdRequest,
) -> Result<SchemaNamespacesResponse, QueryNotError> {
    let profile_id = parse_id::<ProfileId>(&request.profile_id)?;
    lock(&state.ownership)?.authorize_profile(state.window_id, profile_id)?;
    invalidate_profile_mutation_plans(&state, profile_id)?;
    let connected = connected_profile(&state, profile_id)?;
    let cache_key = schema_cache_key(&connected.info, "namespaces", &[])?;
    match connected.metadata.namespaces().await {
        Ok(namespaces) => {
            let response = SchemaNamespacesResponse {
                profile_id: profile_id.to_string(),
                namespaces: namespaces
                    .into_iter()
                    .map(|namespace| SchemaNamespaceView {
                        name: namespace.name,
                        state: "loaded".to_owned(),
                    })
                    .collect(),
                stale: false,
            };
            available_store(&state)?
                .save_schema_cache(profile_id, &cache_key, &response)
                .await?;
            Ok(response)
        }
        Err(error) => match available_store(&state)?
            .load_schema_cache::<SchemaNamespacesResponse>(profile_id, &cache_key)
            .await?
        {
            Some(mut cached) => {
                cached.stale = true;
                for namespace in &mut cached.namespaces {
                    namespace.state = "stale".to_owned();
                }
                Ok(cached)
            }
            None => Err(error),
        },
    }
}

#[tauri::command]
pub(crate) async fn load_schema_objects(
    state: State<'_, AppRuntimeState>,
    request: SchemaNamespaceRequest,
) -> Result<SchemaObjectsResponse, QueryNotError> {
    let profile_id = parse_id::<ProfileId>(&request.profile_id)?;
    lock(&state.ownership)?.authorize_profile(state.window_id, profile_id)?;
    invalidate_profile_mutation_plans(&state, profile_id)?;
    let connected = connected_profile(&state, profile_id)?;
    let cache_key = schema_cache_key(&connected.info, "objects", &[&request.namespace])?;
    match connected.metadata.objects(&request.namespace).await {
        Ok(objects) => {
            let response = SchemaObjectsResponse {
                profile_id: profile_id.to_string(),
                namespace: request.namespace,
                objects: objects.into_iter().map(schema_object_view).collect(),
                stale: false,
            };
            available_store(&state)?
                .save_schema_cache(profile_id, &cache_key, &response)
                .await?;
            Ok(response)
        }
        Err(error) => match available_store(&state)?
            .load_schema_cache::<SchemaObjectsResponse>(profile_id, &cache_key)
            .await?
        {
            Some(mut cached) => {
                cached.stale = true;
                Ok(cached)
            }
            None => Err(error),
        },
    }
}

#[tauri::command]
pub(crate) async fn load_schema_object_detail(
    state: State<'_, AppRuntimeState>,
    request: SchemaObjectRequest,
) -> Result<SchemaObjectDetailView, QueryNotError> {
    let profile_id = parse_id::<ProfileId>(&request.profile_id)?;
    lock(&state.ownership)?.authorize_profile(state.window_id, profile_id)?;
    invalidate_profile_mutation_plans(&state, profile_id)?;
    let connected = connected_profile(&state, profile_id)?;
    let cache_key = schema_cache_key(
        &connected.info,
        "object_detail",
        &[&request.namespace, &request.object_name],
    )?;
    match connected
        .metadata
        .object_detail(&request.namespace, &request.object_name)
        .await
    {
        Ok(detail) => {
            let response = schema_detail_view(detail, false);
            available_store(&state)?
                .save_schema_cache(profile_id, &cache_key, &response)
                .await?;
            Ok(response)
        }
        Err(error) => match available_store(&state)?
            .load_schema_cache::<SchemaObjectDetailView>(profile_id, &cache_key)
            .await?
        {
            Some(mut cached) => {
                cached.stale = true;
                Ok(cached)
            }
            None => Err(error),
        },
    }
}

#[tauri::command]
pub(crate) async fn qualified_schema_name(
    state: State<'_, AppRuntimeState>,
    request: SchemaObjectRequest,
) -> Result<SchemaTextResponse, QueryNotError> {
    let profile_id = parse_id::<ProfileId>(&request.profile_id)?;
    lock(&state.ownership)?.authorize_profile(state.window_id, profile_id)?;
    let connected = connected_profile(&state, profile_id)?;
    let dialect = table_dialect(&connected.info.dialect)?;
    let detail = connected
        .metadata
        .object_detail(&request.namespace, &request.object_name)
        .await?;
    Ok(SchemaTextResponse {
        text: format!(
            "{}.{}",
            quote_identifier(dialect, &detail.object.namespace),
            quote_identifier(dialect, &detail.object.name)
        ),
        message: "The adapter quoted the qualified metadata name; it was not interpreted as a command or path."
            .to_owned(),
    })
}

#[tauri::command]
pub(crate) async fn starter_query(
    state: State<'_, AppRuntimeState>,
    request: SchemaObjectRequest,
) -> Result<SchemaTextResponse, QueryNotError> {
    let profile_id = parse_id::<ProfileId>(&request.profile_id)?;
    lock(&state.ownership)?.authorize_profile(state.window_id, profile_id)?;
    let connected = connected_profile(&state, profile_id)?;
    let dialect = table_dialect(&connected.info.dialect)?;
    let detail = connected
        .metadata
        .object_detail(&request.namespace, &request.object_name)
        .await?;
    if !matches!(
        detail.object.kind,
        SchemaObjectKind::Table | SchemaObjectKind::View
    ) {
        return Err(QueryNotError::database(
            ErrorCategory::UnsupportedCapability,
            "Starter queries are available for tables and views.",
            false,
        ));
    }
    let qualified = format!(
        "{}.{}",
        quote_identifier(dialect, &detail.object.namespace),
        quote_identifier(dialect, &detail.object.name)
    );
    Ok(SchemaTextResponse {
        text: format!("SELECT *\nFROM {qualified}\nLIMIT 100;"),
        message:
            "Created an offline starter draft with adapter-quoted identifiers; it was not executed."
                .to_owned(),
    })
}

#[tauri::command]
pub(crate) async fn browse_table(
    state: State<'_, AppRuntimeState>,
    request: TableBrowseRequest,
) -> Result<TablePageView, QueryNotError> {
    let profile_id = parse_id::<ProfileId>(&request.profile_id)?;
    let tab_id = parse_id::<TabId>(&request.tab_id)?;
    let session_id = parse_id::<NativeSessionId>(&request.session_id)?;
    let resource = session_resource_from_parts(
        &state,
        &request.profile_id,
        &request.tab_id,
        &request.session_id,
    )?;
    if request.namespace != resource.context {
        return Err(QueryNotError::authorization(
            "The table namespace no longer matches this tab's confirmed context.",
        ));
    }
    ensure_session_idle(&state, session_id)?;
    let input = BrowseInput {
        filters: request
            .filters
            .into_iter()
            .map(table_filter_from_view)
            .collect::<Result<Vec<_>, _>>()?,
        sorts: request
            .sorts
            .into_iter()
            .map(table_sort_from_view)
            .collect::<Result<Vec<_>, _>>()?,
        cursor: request
            .cursor
            .into_iter()
            .map(tagged_value_from_view)
            .collect::<Result<Vec<_>, _>>()?,
        offset: request.offset,
        page_size: request.page_size,
    };
    let result = resource
        .session
        .browse_table(&request.namespace, &request.table, &input)
        .await;
    close_lost_session_if_needed(&state, profile_id, tab_id, session_id, &result);
    let page = result?;
    Ok(table_page_view(page))
}

#[tauri::command]
pub(crate) async fn preview_table_mutations(
    state: State<'_, AppRuntimeState>,
    request: PreviewTableMutationsRequest,
) -> Result<MutationPreviewView, QueryNotError> {
    let profile_id = parse_id::<ProfileId>(&request.profile_id)?;
    let tab_id = parse_id::<TabId>(&request.tab_id)?;
    let session_id = parse_id::<NativeSessionId>(&request.session_id)?;
    lock(&state.ownership)?.authorize_session(state.window_id, profile_id, tab_id, session_id)?;
    let resource = session_resource(&state, profile_id, tab_id, session_id)?;
    if request.namespace != resource.context {
        return Err(QueryNotError::authorization(
            "The staged table namespace no longer matches this tab's confirmed context.",
        ));
    }
    ensure_session_idle(&state, session_id)?;
    let transaction = resource.session.transaction_state().await;
    if !transaction.automatic || transaction.certainty != TransactionCertainty::Clean {
        return Err(QueryNotError::database(
            ErrorCategory::Transaction,
            "Previewing table changes requires a clean auto-commit table session.",
            false,
        ));
    }
    let connected = connected_profile(&state, profile_id)?;
    let detail_result = resource
        .session
        .object_detail(&request.namespace, &request.table)
        .await;
    close_lost_session_if_needed(&state, profile_id, tab_id, session_id, &detail_result);
    let detail = detail_result?;
    let definition = TableDefinition::from_detail(
        &detail,
        resource.session.read_only(),
        connected.info.capabilities.safe_table_mutations,
    );
    let dialect = table_dialect(&connected.info.dialect)?;
    let inputs = request
        .operations
        .into_iter()
        .map(mutation_from_view)
        .collect::<Result<Vec<_>, _>>()?;
    let plan = plan_mutations(&definition, dialect, request.staging_revision, &inputs)?;
    let preview = mutation_preview_view(&plan);
    let plan_id = plan.id;
    let mut plans = lock(&state.phase2.mutation_plans)?;
    plans.retain(|_, existing| existing.tab_id != tab_id);
    plans.insert(
        plan_id,
        MutationPlanResource {
            profile_id,
            tab_id,
            session_id,
            context: resource.context,
            plan,
        },
    );
    Ok(preview)
}

#[tauri::command]
pub(crate) async fn apply_table_mutations(
    state: State<'_, AppRuntimeState>,
    request: ApplyTableMutationsRequest,
) -> Result<MutationApplyResponse, QueryNotError> {
    let profile_id = parse_id::<ProfileId>(&request.profile_id)?;
    let tab_id = parse_id::<TabId>(&request.tab_id)?;
    let session_id = parse_id::<NativeSessionId>(&request.session_id)?;
    let plan_id = parse_id::<MutationPlanId>(&request.plan_id)?;
    lock(&state.ownership)?.authorize_session(state.window_id, profile_id, tab_id, session_id)?;
    ensure_session_idle(&state, session_id)?;
    let resource = session_resource(&state, profile_id, tab_id, session_id)?;
    let planned = {
        let mut plans = lock(&state.phase2.mutation_plans)?;
        let planned = plans.get(&plan_id).ok_or_else(|| {
            QueryNotError::authorization("The one-use mutation preview is unknown or invalidated.")
        })?;
        if planned.profile_id != profile_id
            || planned.tab_id != tab_id
            || planned.session_id != session_id
            || planned.context != resource.context
            || planned.plan.staging_revision != request.staging_revision
        {
            return Err(QueryNotError::authorization(
                "The mutation preview no longer matches the tab, context, session, or staged revision.",
            ));
        }
        plans
            .remove(&plan_id)
            .expect("the validated mutation preview remains present while locked")
    };
    let result = resource.session.apply_table_mutations(&planned.plan).await;
    close_lost_session_if_needed(&state, profile_id, tab_id, session_id, &result);
    let result = result?;
    Ok(MutationApplyResponse {
        affected_rows: result.affected_rows,
        refreshed: result.refreshed,
        message: format!(
            "Applied {} staged operations atomically, then requested a server refresh for generated and coerced values. Inserted or changed rows may move outside the current page after refresh.",
            planned.plan.operations.len()
        ),
    })
}

#[tauri::command]
pub(crate) fn discard_mutation_plan(
    state: State<'_, AppRuntimeState>,
    request: MutationPlanIdRequest,
) -> Result<FileActionResponse, QueryNotError> {
    let profile_id = parse_id::<ProfileId>(&request.profile_id)?;
    let tab_id = parse_id::<TabId>(&request.tab_id)?;
    let session_id = parse_id::<NativeSessionId>(&request.session_id)?;
    let plan_id = parse_id::<MutationPlanId>(&request.plan_id)?;
    lock(&state.ownership)?.authorize_session(state.window_id, profile_id, tab_id, session_id)?;
    let removed = {
        let mut plans = lock(&state.phase2.mutation_plans)?;
        match plans.get(&plan_id) {
            Some(plan)
                if plan.profile_id == profile_id
                    && plan.tab_id == tab_id
                    && plan.session_id == session_id =>
            {
                plans.remove(&plan_id);
                true
            }
            _ => false,
        }
    };
    Ok(FileActionResponse {
        completed: removed,
        cancelled: false,
        message: if removed {
            "The immutable mutation preview was invalidated; no database change was made."
        } else {
            "The mutation preview was already absent or invalidated."
        }
        .to_owned(),
    })
}

#[tauri::command]
pub(crate) async fn change_tab_context(
    state: State<'_, AppRuntimeState>,
    request: ChangeTabContextRequest,
) -> Result<SessionContextResponse, QueryNotError> {
    let profile_id = parse_id::<ProfileId>(&request.profile_id)?;
    let tab_id = parse_id::<TabId>(&request.tab_id)?;
    let session_id = parse_id::<NativeSessionId>(&request.session_id)?;
    lock(&state.ownership)?.authorize_session(state.window_id, profile_id, tab_id, session_id)?;
    ensure_session_idle(&state, session_id)?;
    if lock(&state.phase2.mutation_plans)?
        .values()
        .any(|plan| plan.session_id == session_id)
    {
        return Err(QueryNotError::database(
            ErrorCategory::Transaction,
            "Discard or apply the staged table preview before changing context.",
            false,
        ));
    }
    let resource = session_resource(&state, profile_id, tab_id, session_id)?;
    let transaction = resource.session.transaction_state().await;
    if transaction.certainty != TransactionCertainty::Clean {
        return Err(QueryNotError::database(
            ErrorCategory::Transaction,
            "Commit, roll back, or reconnect before changing this tab's context.",
            false,
        ));
    }
    let result = resource.session.change_context(&request.context).await;
    close_lost_session_if_needed(&state, profile_id, tab_id, session_id, &result);
    let confirmed = result?;
    let mut sessions = lock(&state.phase2.sessions)?;
    let stored = sessions.get_mut(&session_id).ok_or_else(|| {
        QueryNotError::authorization("The tab session was invalidated during context change.")
    })?;
    if stored.profile_id != profile_id || stored.tab_id != tab_id {
        return Err(QueryNotError::authorization(
            "The tab session owner changed unexpectedly.",
        ));
    }
    stored.context = confirmed.clone();
    Ok(SessionContextResponse {
        context: confirmed.clone(),
        message: format!(
            "The adapter confirmed {confirmed} for this tab only; no SQL was executed from the editor."
        ),
    })
}

#[tauri::command]
pub(crate) fn format_sql(
    state: State<'_, AppRuntimeState>,
    request: FormatSqlRequest,
) -> Result<FormatSqlResponse, QueryNotError> {
    let settings = lock(&state.settings)?.clone();
    format_sql_request(request, &settings)
}

fn format_sql_request(
    request: FormatSqlRequest,
    settings: &querynot_core::settings::AppSettings,
) -> Result<FormatSqlResponse, QueryNotError> {
    if request.sql.len() > 4 * 1024 * 1024 {
        return Err(QueryNotError::authorization(
            "SQL formatting is limited to a 4 MiB document.",
        ));
    }
    let options = sqlformat::FormatOptions {
        uppercase: Some(settings.formatter_uppercase_keywords),
        indent: sqlformat::Indent::Spaces(settings.formatter_indent_spaces),
        ..sqlformat::FormatOptions::default()
    };
    let selection = match (request.selection_start, request.selection_end) {
        (Some(start), Some(end)) if start < end => Some((start as usize, end as usize)),
        (None, None) | (Some(_), Some(_)) => None,
        _ => {
            return Err(QueryNotError::authorization(
                "Formatting selection boundaries are incomplete.",
            ));
        }
    };
    if let Some((start, end)) = selection {
        if end > request.sql.len()
            || !request.sql.is_char_boundary(start)
            || !request.sql.is_char_boundary(end)
        {
            return Err(QueryNotError::authorization(
                "Formatting selection boundaries are invalid.",
            ));
        }
        let formatted = sqlformat::format(
            &request.sql[start..end],
            &sqlformat::QueryParams::None,
            &options,
        );
        let mut sql = request.sql;
        sql.replace_range(start..end, &formatted);
        return Ok(FormatSqlResponse {
            sql,
            selection_start: Some(start as u32),
            selection_end: Some((start + formatted.len()) as u32),
        });
    }
    Ok(FormatSqlResponse {
        sql: sqlformat::format(&request.sql, &sqlformat::QueryParams::None, &options),
        selection_start: None,
        selection_end: None,
    })
}

#[tauri::command]
pub(crate) async fn start_execution(
    app: AppHandle,
    state: State<'_, AppRuntimeState>,
    request: StartExecutionRequest,
) -> Result<ExecutionStartResponse, QueryNotError> {
    let profile_id = parse_id::<ProfileId>(&request.profile_id)?;
    let tab_id = parse_id::<TabId>(&request.tab_id)?;
    let session_id = parse_id::<NativeSessionId>(&request.session_id)?;
    lock(&state.ownership)?.authorize_session(state.window_id, profile_id, tab_id, session_id)?;
    if lock(&state.phase2.executions)?
        .values()
        .any(|execution| execution.session_id == session_id)
    {
        return Err(QueryNotError::database(
            ErrorCategory::Transaction,
            "This tab already has an active execution.",
            false,
        ));
    }
    let resource = session_resource(&state, profile_id, tab_id, session_id)?;
    let selection = match (request.selection_start, request.selection_end) {
        (Some(start), Some(end)) if start != end => Some((start as usize, end as usize)),
        (None, None) | (Some(_), Some(_)) => None,
        _ => {
            return Err(QueryNotError::authorization(
                "Execution selection boundaries are incomplete.",
            ));
        }
    };
    let connected = connected_profile(&state, profile_id)?;
    let dialect = match connected.info.dialect.as_str() {
        "sqlite" => SqlDialect::Sqlite,
        "mysql" => SqlDialect::MySql,
        _ => {
            return Err(QueryNotError::internal(
                "The adapter reported an unknown SQL dialect.",
            ));
        }
    };
    let plan = plan_execution_for_dialect(
        &request.sql,
        selection,
        request.cursor as usize,
        request.run_all,
        dialect,
        &request.profile_id,
        &request.session_id,
        &resource.context,
    )
    .map_err(|error| QueryNotError::database(ErrorCategory::Syntax, error.to_string(), false))?;
    if resource.session.read_only() && !execution_is_provably_read_only(&plan) {
        return Err(QueryNotError::database(
            ErrorCategory::UnsupportedCapability,
            "Possible writes are disabled for this read-only or out-of-matrix connection.",
            false,
        ));
    }
    if resource.session.transaction_state().await.certainty == TransactionCertainty::Unknown
        && !execution_is_provably_read_only(&plan)
    {
        return Err(QueryNotError::database(
            ErrorCategory::Transaction,
            "This tab's transaction state is unknown. Reconnect or safely reconcile it before another possible write.",
            false,
        ));
    }
    let safety_flags = plan
        .safety_flags
        .iter()
        .map(|flag| SafetyFlagView {
            statement_index: flag.statement_index,
            start: flag.start as u32,
            end: flag.end as u32,
            statement_type: flag.statement_type.clone(),
            object_name: flag.object_name.clone(),
            reason: safety_reason_name(flag.reason).to_owned(),
        })
        .collect::<Vec<_>>();
    if safety_flags.is_empty() {
        if request.approval_fingerprint.is_some() {
            return Err(QueryNotError::authorization(
                "The one-time destructive approval is no longer valid for this SQL.",
            ));
        }
    } else {
        match request.approval_fingerprint.as_deref() {
            Some(token)
                if state.phase2.consume_approval(
                    token,
                    profile_id,
                    tab_id,
                    session_id,
                    &plan.fingerprint,
                )? => {}
            Some(_) => {
                return Err(QueryNotError::authorization(
                    "The one-time destructive approval expired or no longer matches the exact SQL and context.",
                ));
            }
            None => {
                let token = state.phase2.issue_approval(
                    profile_id,
                    tab_id,
                    session_id,
                    plan.fingerprint,
                )?;
                return Ok(ExecutionStartResponse {
                    status: "confirmation_required".to_owned(),
                    execution_id: None,
                    fingerprint: Some(token),
                    safety_flags,
                    message: "Review every flagged statement range. Approval applies once to this exact text, profile, session, and context."
                        .to_owned(),
                });
            }
        }
    }

    let history_capture = if lock(&state.settings)?.history_enabled {
        state.store.clone().map(|store| HistoryCapture {
            store,
            warning: Arc::clone(&state.history_warning),
            sql: plan
                .statements
                .iter()
                .map(|statement| statement.sql.as_str())
                .collect::<Vec<_>>()
                .join(";\n"),
            timestamp_ms: unix_time_ms(),
            profile_id,
            profile_label: connected.profile_name.clone(),
            engine: format!(
                "{} {}",
                connected.info.identity.product, connected.info.identity.exact_version
            ),
            context: resource.context.clone(),
            started_at: Instant::now(),
        })
    } else {
        None
    };
    let execution_id = ExecutionId::new();
    dispose_tab_results(&state.phase2, tab_id);
    lock(&state.ownership)?.register_execution(
        state.window_id,
        profile_id,
        tab_id,
        session_id,
        execution_id,
    )?;
    let (control_tx, control_rx) = mpsc::channel(32);
    let (event_tx, event_rx) = mpsc::channel(32);
    lock(&state.phase2.executions)?.insert(
        execution_id,
        ExecutionResource {
            profile_id,
            tab_id,
            session_id,
            session: resource.session.clone(),
            controls: control_tx,
        },
    );
    let tranche_rows = lock(&state.settings)?.result_tranche_rows as usize;
    let running_session = resource.session;
    tokio::spawn(async move {
        running_session
            .execute(execution_id, plan, tranche_rows, control_rx, event_tx)
            .await;
    });
    let runtime = state.phase2.clone();
    let lifecycle_epoch = *lock(&state.phase2.lifecycle_epoch)?;
    let ownership = Arc::clone(&state.ownership);
    let window_id = state.window_id;
    tokio::spawn(async move {
        bridge_execution_events(
            ExecutionBridgeContext {
                app,
                runtime,
                ownership,
                window_id,
                lifecycle_epoch,
                owner: ResultOwner {
                    execution_id,
                    profile_id,
                    tab_id,
                    session_id,
                },
                history_capture,
            },
            event_rx,
        )
        .await;
    });
    Ok(ExecutionStartResponse {
        status: "started".to_owned(),
        execution_id: Some(execution_id.to_string()),
        fingerprint: None,
        safety_flags,
        message: "Execution started on this tab's dedicated native database session.".to_owned(),
    })
}

#[tauri::command]
pub(crate) async fn ack_result_batch(
    state: State<'_, AppRuntimeState>,
    request: ResultBatchControlRequest,
) -> Result<FileActionResponse, QueryNotError> {
    let execution_id = parse_id::<ExecutionId>(&request.execution_id)?;
    let result_set_id = parse_id::<ResultSetId>(&request.result_set_id)?;
    let execution = execution_resource(&state, execution_id)?;
    authorize_live_execution(&state, execution_id, &execution)?;
    authorize_result_owner(&state, execution_id, result_set_id, &execution)?;
    execution
        .controls
        .send(ExecutionControl::Acknowledge {
            result_set_id,
            sequence: request.sequence,
        })
        .await
        .map_err(|_| {
            QueryNotError::cancelled("The execution no longer accepts batch acknowledgement.")
        })?;
    Ok(action_completed(
        "Result batch acknowledged; native streaming may continue.",
    ))
}

#[tauri::command]
pub(crate) async fn load_more_results(
    state: State<'_, AppRuntimeState>,
    request: ResultControlRequest,
) -> Result<FileActionResponse, QueryNotError> {
    send_result_control(&state, request, true).await
}

#[tauri::command]
pub(crate) async fn discard_result(
    state: State<'_, AppRuntimeState>,
    request: ResultControlRequest,
) -> Result<FileActionResponse, QueryNotError> {
    send_result_control(&state, request, false).await
}

#[tauri::command]
pub(crate) async fn cancel_execution(
    state: State<'_, AppRuntimeState>,
    request: ExecutionIdRequest,
) -> Result<FileActionResponse, QueryNotError> {
    let execution_id = parse_id::<ExecutionId>(&request.execution_id)?;
    let execution = execution_resource(&state, execution_id)?;
    authorize_live_execution(&state, execution_id, &execution)?;
    let requested = execution.session.request_cancel();
    let _ = execution.controls.send(ExecutionControl::Cancel).await;
    Ok(FileActionResponse {
        completed: requested,
        cancelled: false,
        message: if requested {
            "Cancellation was requested through SQLite's native progress handler; confirmation is pending."
        } else {
            "The execution had already reached a terminal state."
        }
        .to_owned(),
    })
}

#[tauri::command]
pub(crate) async fn set_transaction_mode(
    state: State<'_, AppRuntimeState>,
    request: TransactionModeRequest,
) -> Result<TransactionStateView, QueryNotError> {
    let profile_id = parse_id::<ProfileId>(&request.profile_id)?;
    let tab_id = parse_id::<TabId>(&request.tab_id)?;
    let session_id = parse_id::<NativeSessionId>(&request.session_id)?;
    let session = session_resource_from_parts(
        &state,
        &request.profile_id,
        &request.tab_id,
        &request.session_id,
    )?;
    let result = session.session.set_automatic(request.automatic).await;
    close_lost_session_if_needed(&state, profile_id, tab_id, session_id, &result);
    Ok(transaction_view(result?))
}

#[tauri::command]
pub(crate) async fn commit_transaction(
    state: State<'_, AppRuntimeState>,
    request: SessionRequest,
) -> Result<TransactionStateView, QueryNotError> {
    let (profile_id, tab_id, session_id) = session_ids(&request)?;
    lock(&state.ownership)?.authorize_session(state.window_id, profile_id, tab_id, session_id)?;
    let session = session_resource(&state, profile_id, tab_id, session_id)?;
    let result = session.session.commit().await;
    close_lost_session_if_needed(&state, profile_id, tab_id, session_id, &result);
    Ok(transaction_view(result?))
}

#[tauri::command]
pub(crate) async fn rollback_transaction(
    state: State<'_, AppRuntimeState>,
    request: SessionRequest,
) -> Result<TransactionStateView, QueryNotError> {
    let (profile_id, tab_id, session_id) = session_ids(&request)?;
    lock(&state.ownership)?.authorize_session(state.window_id, profile_id, tab_id, session_id)?;
    let session = session_resource(&state, profile_id, tab_id, session_id)?;
    let result = session.session.rollback().await;
    close_lost_session_if_needed(&state, profile_id, tab_id, session_id, &result);
    Ok(transaction_view(result?))
}

#[tauri::command]
pub(crate) async fn export_result(
    app: AppHandle,
    state: State<'_, AppRuntimeState>,
    request: ExportResultRequest,
) -> Result<ExportResultResponse, QueryNotError> {
    let execution_id = parse_id::<ExecutionId>(&request.execution_id)?;
    let result_set_id = parse_id::<ResultSetId>(&request.result_set_id)?;
    let owner = lock(&state.phase2.result_owners)?
        .get(&result_set_id)
        .copied()
        .filter(|owner| owner.execution_id == execution_id)
        .ok_or_else(|| QueryNotError::authorization("Result resource is unknown or expired."))?;
    lock(&state.ownership)?.authorize_session(
        state.window_id,
        owner.profile_id,
        owner.tab_id,
        owner.session_id,
    )?;
    if !matches!(request.view_label.as_str(), "server_order" | "current_view") {
        return Err(QueryNotError::authorization(
            "Export view must be server order or the current loaded-row view.",
        ));
    }
    if request.null_token.len() > 64 || request.null_token.contains(['\r', '\n', ',', '"', '\0']) {
        return Err(QueryNotError::authorization(
            "The CSV null token must be at most 64 characters and contain no comma, quote, line break, or NUL.",
        ));
    }
    let format = match request.format.as_str() {
        "csv" => ExportFormat::Csv,
        "json" => ExportFormat::Json,
        _ => {
            return Err(QueryNotError::authorization(
                "Export format must be CSV or JSON.",
            ));
        }
    };
    let extension = if format == ExportFormat::Csv {
        "csv"
    } else {
        "json"
    };
    let result = lock(&state.phase2.results)?
        .get(result_set_id)
        .map_err(|_| QueryNotError::authorization("Result resource is unknown or expired."))?
        .clone();
    let row_indexes = request
        .row_indexes
        .iter()
        .map(|index| *index as usize)
        .collect::<Vec<_>>();
    if row_indexes.len() > MAX_RETAINED_ROWS
        || row_indexes.iter().any(|index| *index >= result.rows.len())
        || row_indexes.iter().copied().collect::<HashSet<_>>().len() != row_indexes.len()
    {
        return Err(QueryNotError::authorization(
            "Export selection is oversized, duplicated, or outside the retained result.",
        ));
    }
    if format == ExportFormat::Csv
        && request.null_token.is_empty()
        && !app
            .dialog()
            .message("An empty CSV NULL token makes NULL and empty text ambiguous. Continue with this explicit choice?")
            .title("Confirm ambiguous CSV NULL representation")
            .buttons(MessageDialogButtons::OkCancelCustom(
                "Continue with empty token".to_owned(),
                "Cancel".to_owned(),
            ))
            .blocking_show()
    {
        return Ok(ExportResultResponse {
            completed: false,
            cancelled: true,
            rows_written: 0,
            message: "CSV export was cancelled before choosing a destination.".to_owned(),
        });
    }
    let cap_label = if result.capped {
        "hard cap reached"
    } else {
        "not capped"
    };
    let null_label = if format == ExportFormat::Csv {
        format!("; NULL token {:?}", request.null_token)
    } else {
        String::new()
    };
    let selected = app
        .dialog()
        .file()
        .add_filter(extension.to_ascii_uppercase(), &[extension])
        .set_file_name(format!("querynot-result.{extension}"))
        .set_title(format!(
            "Export {} received rows from statement {} ({}; {cap_label}{null_label})",
            row_indexes.len(),
            result.statement_index + 1,
            request.view_label.replace('_', " "),
        ))
        .blocking_save_file();
    let Some(selected) = selected else {
        return Ok(ExportResultResponse {
            completed: false,
            cancelled: true,
            rows_written: 0,
            message: "Export was cancelled; no file was written.".to_owned(),
        });
    };
    let path = selected.into_path().map_err(|_| {
        QueryNotError::authorization("Export requires a local path selected in the native dialog.")
    })?;
    let overwrite_confirmed = if path.exists() {
        app.dialog()
            .message("This file already exists. Replace it atomically with the received rows shown in QueryNot?")
            .title("Confirm result export overwrite")
            .buttons(MessageDialogButtons::OkCancelCustom(
                "Replace file".to_owned(),
                "Cancel".to_owned(),
            ))
            .blocking_show()
    } else {
        false
    };
    if path.exists() && !overwrite_confirmed {
        return Ok(ExportResultResponse {
            completed: false,
            cancelled: true,
            rows_written: 0,
            message: "Export overwrite was cancelled; the existing file is unchanged.".to_owned(),
        });
    }
    let null_token = request.null_token;
    let rows_written = tokio::task::spawn_blocking(move || {
        write_received_rows(
            &path,
            &result,
            &row_indexes,
            &ExportOptions {
                format,
                null_token,
                overwrite_confirmed,
            },
            &NoExportFault,
        )
    })
    .await
    .map_err(|_| QueryNotError::internal("The export worker did not complete."))?
    .map_err(|error| {
        QueryNotError::database(
            ErrorCategory::LocalStorage,
            format!("Export failed safely: {error}"),
            true,
        )
    })?;
    Ok(ExportResultResponse {
        completed: true,
        cancelled: false,
        rows_written: rows_written as u32,
        message: format!(
            "Exported {rows_written} received rows from the {} without re-executing SQL or fetching hidden rows.",
            request.view_label.replace('_', " ")
        ),
    })
}

async fn send_result_control(
    state: &State<'_, AppRuntimeState>,
    request: ResultControlRequest,
    load_more: bool,
) -> Result<FileActionResponse, QueryNotError> {
    let execution_id = parse_id::<ExecutionId>(&request.execution_id)?;
    let result_set_id = parse_id::<ResultSetId>(&request.result_set_id)?;
    let execution = execution_resource(state, execution_id)?;
    authorize_live_execution(state, execution_id, &execution)?;
    authorize_result_owner(state, execution_id, result_set_id, &execution)?;
    let control = if load_more {
        if let Ok(mut results) = state.phase2.results.lock()
            && let Ok(result) = results.get_mut(result_set_id)
        {
            result
                .acknowledge_more(std::time::Instant::now())
                .map_err(|_| {
                    QueryNotError::cancelled("The paused result cursor already expired.")
                })?;
        }
        ExecutionControl::LoadMore { result_set_id }
    } else {
        ExecutionControl::Discard { result_set_id }
    };
    execution.controls.send(control).await.map_err(|_| {
        QueryNotError::cancelled("The result cursor no longer accepts this action.")
    })?;
    Ok(action_completed(if load_more {
        "One additional configured result tranche was authorized."
    } else {
        "The unreceived remainder was discarded without re-executing SQL."
    }))
}

async fn bridge_execution_events(
    context: ExecutionBridgeContext,
    mut events: mpsc::Receiver<SqliteExecutionEvent>,
) {
    let ExecutionBridgeContext {
        app,
        runtime,
        ownership,
        window_id,
        lifecycle_epoch,
        owner,
        history_capture,
    } = context;
    let mut history_status = None;
    let mut history_error_category = None;
    let mut affected_rows = 0_u64;
    let mut received_rows = 0_u64;
    let mut connection_lost = false;
    while let Some(event) = events.recv().await {
        let Ok(epoch) = runtime.lifecycle_epoch.lock() else {
            break;
        };
        if *epoch != lifecycle_epoch {
            break;
        }
        if !retain_execution_event(&runtime, &event, owner) {
            if let Ok(executions) = runtime.executions.lock()
                && let Some(execution) = executions.get(&owner.execution_id)
            {
                execution.session.request_cancel();
            }
            let mut failure = empty_execution_event();
            failure.event_type = "failed".to_owned();
            failure.execution_id = owner.execution_id.to_string();
            failure.profile_id = owner.profile_id.to_string();
            failure.tab_id = owner.tab_id.to_string();
            failure.session_id = owner.session_id.to_string();
            failure.error_category = Some("internal".to_owned());
            failure.error = Some(
                "A result event failed native sequence or retention validation; the execution was cancelled."
                    .to_owned(),
            );
            let _ = app.emit("query_execution", failure);
            break;
        }
        match &event {
            SqliteExecutionEvent::Batch(batch) => {
                received_rows = received_rows.saturating_add(batch.rows.len() as u64);
            }
            SqliteExecutionEvent::StatementMessage { rows_affected, .. } => {
                affected_rows = affected_rows.saturating_add(*rows_affected);
            }
            SqliteExecutionEvent::Finished {
                received_rows: total,
                ..
            } => {
                received_rows = *total as u64;
                history_status = Some(HistoryStatus::Succeeded);
            }
            SqliteExecutionEvent::Failed { error, .. } => {
                history_status = Some(HistoryStatus::Failed);
                history_error_category = Some(error.category);
                connection_lost = error.category == ErrorCategory::Connectivity;
            }
            SqliteExecutionEvent::Cancelled { .. } => {
                history_status = Some(HistoryStatus::Cancelled);
                history_error_category = Some(ErrorCategory::Cancelled);
            }
            _ => {}
        }
        let terminal = matches!(
            event,
            SqliteExecutionEvent::Finished { .. }
                | SqliteExecutionEvent::Failed { .. }
                | SqliteExecutionEvent::Cancelled { .. }
        );
        let mut view = execution_event_view(event);
        view.profile_id = owner.profile_id.to_string();
        view.tab_id = owner.tab_id.to_string();
        view.session_id = owner.session_id.to_string();
        if app.emit("query_execution", view).is_err()
            && let Ok(executions) = runtime.executions.lock()
            && let Some(execution) = executions.get(&owner.execution_id)
        {
            execution.session.request_cancel();
        }
        if terminal {
            break;
        }
    }
    if let Ok(mut executions) = runtime.executions.lock() {
        executions.remove(&owner.execution_id);
    }
    if let Ok(mut ownership) = ownership.lock() {
        let _ = ownership.mark_execution_terminal(
            window_id,
            owner.profile_id,
            owner.tab_id,
            owner.session_id,
            owner.execution_id,
        );
        if connection_lost {
            let _ = ownership.unregister_session(
                window_id,
                owner.profile_id,
                owner.tab_id,
                owner.session_id,
            );
        }
    }
    if connection_lost {
        if let Ok(mut sessions) = runtime.sessions.lock() {
            sessions.remove(&owner.session_id);
        }
        if let Ok(mut plans) = runtime.mutation_plans.lock() {
            plans.retain(|_, plan| plan.session_id != owner.session_id);
        }
        dispose_tab_results(&runtime, owner.tab_id);
    }
    if let (Some(capture), Some(status)) = (history_capture, history_status) {
        let entry = HistoryEntry::new(HistoryEntryInput {
            sql: capture.sql,
            timestamp_ms: capture.timestamp_ms,
            profile_id: capture.profile_id,
            profile_label: capture.profile_label,
            engine: capture.engine,
            context: capture.context,
            duration_ms: capture.started_at.elapsed().as_millis() as u64,
            status,
            affected_rows,
            received_rows,
            error_category: history_error_category,
        });
        if capture.store.save_history_entry(&entry).await.is_err()
            && let Ok(mut warning) = capture.warning.lock()
        {
            *warning = Some(
                "Query history could not be persisted. Execution completed and current in-memory work remains available."
                    .to_owned(),
            );
        }
    }
}

fn retain_execution_event(
    runtime: &Phase2Runtime,
    event: &SqliteExecutionEvent,
    owner: ResultOwner,
) -> bool {
    match event {
        SqliteExecutionEvent::Batch(batch) => {
            let Ok(mut results) = runtime.results.lock() else {
                return false;
            };
            if results.get(batch.result_set_id).is_err()
                && results
                    .insert(RetainedResult::new(
                        batch.execution_id,
                        batch.result_set_id,
                        batch.statement_index,
                    ))
                    .is_err()
            {
                return false;
            }
            if results
                .get_mut(batch.result_set_id)
                .and_then(|result| result.accept_batch(batch.clone()))
                .is_err()
            {
                return false;
            }
            drop(results);
            runtime
                .result_owners
                .lock()
                .map(|mut owners| {
                    owners.insert(batch.result_set_id, owner);
                })
                .is_ok()
        }
        SqliteExecutionEvent::ResultTerminal(terminal) => runtime
            .results
            .lock()
            .ok()
            .and_then(|mut results| {
                results
                    .get_mut(terminal.result_set_id)
                    .ok()
                    .and_then(|result| result.accept_terminal(terminal).ok())
            })
            .is_some(),
        SqliteExecutionEvent::Paused { result_set_id, .. } => runtime
            .results
            .lock()
            .ok()
            .and_then(|mut results| {
                results
                    .get_mut(*result_set_id)
                    .ok()
                    .and_then(|result| result.mark_paused(std::time::Instant::now()).ok())
            })
            .is_some(),
        _ => true,
    }
}

fn execution_event_view(event: SqliteExecutionEvent) -> ExecutionEventView {
    let mut view = empty_execution_event();
    match event {
        SqliteExecutionEvent::Started {
            execution_id,
            statement_count,
            ..
        } => {
            view.event_type = "started".to_owned();
            view.execution_id = execution_id.to_string();
            view.statement_count = Some(statement_count as u32);
        }
        SqliteExecutionEvent::Batch(batch) => {
            view.event_type = "batch".to_owned();
            view.execution_id = batch.execution_id.to_string();
            view.result_set_id = Some(batch.result_set_id.to_string());
            view.sequence = Some(batch.sequence);
            view.statement_index = Some(batch.statement_index);
            view.columns = batch
                .columns
                .unwrap_or_default()
                .into_iter()
                .map(|column| ResultColumnView {
                    name: column.name,
                    declared_type: column.declared_type,
                    nullable: column.nullable,
                })
                .collect();
            view.received_rows = batch.rows.len() as u32;
            view.retained_bytes = batch.encoded_bytes as u64;
            view.rows = batch
                .rows
                .into_iter()
                .map(|values| ResultRowView {
                    values: values.into_iter().map(tagged_value_view).collect(),
                })
                .collect();
        }
        SqliteExecutionEvent::Paused {
            execution_id,
            result_set_id,
            sequence,
            received_rows,
            retained_bytes,
        } => {
            view.event_type = "paused".to_owned();
            view.execution_id = execution_id.to_string();
            view.result_set_id = Some(result_set_id.to_string());
            view.sequence = Some(sequence);
            view.received_rows = received_rows as u32;
            view.retained_bytes = retained_bytes as u64;
        }
        SqliteExecutionEvent::StatementMessage {
            execution_id,
            statement_index,
            rows_affected,
            duration,
            transaction,
        } => {
            view.event_type = "statement_message".to_owned();
            view.execution_id = execution_id.to_string();
            view.statement_index = Some(statement_index);
            view.rows_affected = Some(rows_affected);
            view.duration_ms = Some(duration.as_millis() as u64);
            view.transaction = Some(transaction_view(transaction));
        }
        SqliteExecutionEvent::ResultTerminal(terminal) => {
            view.event_type = "result_terminal".to_owned();
            view.execution_id = terminal.execution_id.to_string();
            view.result_set_id = Some(terminal.result_set_id.to_string());
            view.sequence = Some(terminal.sequence);
            view.received_rows = terminal.received_rows as u32;
            view.retained_bytes = terminal.retained_bytes as u64;
            view.terminal_state = Some(format!("{:?}", terminal.state).to_ascii_lowercase());
            view.capped = terminal.capped;
        }
        SqliteExecutionEvent::Finished {
            execution_id,
            statements_completed,
            received_rows,
            transaction,
        } => {
            view.event_type = "finished".to_owned();
            view.execution_id = execution_id.to_string();
            view.statements_completed = Some(statements_completed as u32);
            view.received_rows = received_rows as u32;
            view.transaction = Some(transaction_view(transaction));
        }
        SqliteExecutionEvent::Failed {
            execution_id,
            statement_index,
            statement_start,
            statement_end,
            error,
            transaction,
        } => {
            view.event_type = "failed".to_owned();
            view.execution_id = execution_id.to_string();
            view.statement_index = statement_index;
            view.statement_start = statement_start.map(|start| start as u32);
            view.statement_end = statement_end.map(|end| end as u32);
            view.error_category = Some(error_category_name(error.category).to_owned());
            view.retryable = Some(error.retryable);
            view.error = Some(error.safe_message);
            view.transaction = Some(transaction_view(transaction));
        }
        SqliteExecutionEvent::Cancelled {
            execution_id,
            confirmed,
            transaction,
        } => {
            view.event_type = "cancelled".to_owned();
            view.execution_id = execution_id.to_string();
            view.cancel_confirmed = Some(confirmed);
            view.transaction = Some(transaction_view(transaction));
        }
    }
    view
}

fn authorize_result_owner(
    state: &State<'_, AppRuntimeState>,
    execution_id: ExecutionId,
    result_set_id: ResultSetId,
    execution: &ExecutionResource,
) -> Result<(), QueryNotError> {
    let owned = lock(&state.phase2.result_owners)?
        .get(&result_set_id)
        .is_some_and(|owner| {
            owner.execution_id == execution_id
                && owner.profile_id == execution.profile_id
                && owner.tab_id == execution.tab_id
                && owner.session_id == execution.session_id
        });
    if owned {
        Ok(())
    } else {
        Err(QueryNotError::authorization(
            "Result resource is unknown or does not belong to this execution.",
        ))
    }
}

fn empty_execution_event() -> ExecutionEventView {
    ExecutionEventView {
        event_type: String::new(),
        execution_id: String::new(),
        profile_id: String::new(),
        tab_id: String::new(),
        session_id: String::new(),
        result_set_id: None,
        sequence: None,
        statement_index: None,
        statement_start: None,
        statement_end: None,
        statement_count: None,
        statements_completed: None,
        columns: Vec::new(),
        rows: Vec::new(),
        received_rows: 0,
        retained_bytes: 0,
        rows_affected: None,
        duration_ms: None,
        terminal_state: None,
        capped: false,
        transaction: None,
        error: None,
        error_category: None,
        retryable: None,
        cancel_confirmed: None,
    }
}

fn tagged_value_view(value: TaggedValue) -> TaggedValueView {
    match value {
        TaggedValue::Null => value_view("null", None, None, None, None),
        TaggedValue::Text(value) => value_view("text", Some(value), None, None, None),
        TaggedValue::Bytes(value) => value_view(
            "bytes",
            None,
            None,
            Some(base64::engine::general_purpose::STANDARD.encode(value)),
            None,
        ),
        TaggedValue::SignedInteger(value) => {
            value_view("signed_integer", Some(value), None, None, None)
        }
        TaggedValue::UnsignedInteger(value) => {
            value_view("unsigned_integer", Some(value), None, None, None)
        }
        TaggedValue::Decimal(value) => value_view("decimal", Some(value), None, None, None),
        TaggedValue::Float(value) => {
            let text = if value.is_nan() {
                "NaN".to_owned()
            } else if value == f64::INFINITY {
                "Infinity".to_owned()
            } else if value == f64::NEG_INFINITY {
                "-Infinity".to_owned()
            } else {
                value.to_string()
            };
            value_view("float", Some(text), None, None, None)
        }
        TaggedValue::Boolean(value) => value_view("boolean", None, Some(value), None, None),
        TaggedValue::DateTime {
            raw,
            timezone_or_offset,
        } => value_view("date_time", Some(raw), None, None, timezone_or_offset),
        TaggedValue::AdapterSpecific { type_name, raw } => {
            value_view(&format!("adapter:{type_name}"), Some(raw), None, None, None)
        }
    }
}

fn value_view(
    value_type: &str,
    text: Option<String>,
    boolean: Option<bool>,
    bytes_base64: Option<String>,
    timezone_or_offset: Option<String>,
) -> TaggedValueView {
    TaggedValueView {
        value_type: value_type.to_owned(),
        text,
        boolean,
        bytes_base64,
        timezone_or_offset,
    }
}

fn tagged_value_from_view(view: TaggedValueView) -> Result<TaggedValue, QueryNotError> {
    let invalid = || QueryNotError::authorization("A tagged table value is malformed.");
    match view.value_type.as_str() {
        "null"
            if view.text.is_none()
                && view.boolean.is_none()
                && view.bytes_base64.is_none()
                && view.timezone_or_offset.is_none() =>
        {
            Ok(TaggedValue::Null)
        }
        "text" => Ok(TaggedValue::Text(view.text.ok_or_else(invalid)?)),
        "bytes" => {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(view.bytes_base64.ok_or_else(invalid)?)
                .map_err(|_| invalid())?;
            if bytes.len() > 4 * 1024 * 1024 {
                return Err(QueryNotError::authorization(
                    "A staged binary value exceeds the 4 MiB command boundary.",
                ));
            }
            Ok(TaggedValue::Bytes(bytes))
        }
        "signed_integer" => Ok(TaggedValue::SignedInteger(view.text.ok_or_else(invalid)?)),
        "unsigned_integer" => Ok(TaggedValue::UnsignedInteger(view.text.ok_or_else(invalid)?)),
        "decimal" => Ok(TaggedValue::Decimal(view.text.ok_or_else(invalid)?)),
        "float" => Ok(TaggedValue::Float(
            view.text
                .ok_or_else(invalid)?
                .parse::<f64>()
                .map_err(|_| invalid())?,
        )),
        "boolean" => Ok(TaggedValue::Boolean(view.boolean.ok_or_else(invalid)?)),
        "date_time" => Ok(TaggedValue::DateTime {
            raw: view.text.ok_or_else(invalid)?,
            timezone_or_offset: view.timezone_or_offset,
        }),
        value_type if value_type.starts_with("adapter:") && value_type.len() <= 256 => {
            let type_name = value_type.trim_start_matches("adapter:");
            if type_name.is_empty() {
                return Err(invalid());
            }
            Ok(TaggedValue::AdapterSpecific {
                type_name: type_name.to_owned(),
                raw: view.text.ok_or_else(invalid)?,
            })
        }
        _ => Err(invalid()),
    }
}

fn table_filter_from_view(view: TableFilterView) -> Result<TableFilter, QueryNotError> {
    let operator = match view.operator.as_str() {
        "equal" => FilterOperator::Equal,
        "not_equal" => FilterOperator::NotEqual,
        "less_than" => FilterOperator::LessThan,
        "less_or_equal" => FilterOperator::LessOrEqual,
        "greater_than" => FilterOperator::GreaterThan,
        "greater_or_equal" => FilterOperator::GreaterOrEqual,
        "contains" => FilterOperator::Contains,
        "starts_with" => FilterOperator::StartsWith,
        "is_null" => FilterOperator::IsNull,
        "is_not_null" => FilterOperator::IsNotNull,
        _ => {
            return Err(QueryNotError::authorization(
                "The structured table filter operator is unsupported.",
            ));
        }
    };
    Ok(TableFilter {
        column: view.column,
        operator,
        value: view.value.map(tagged_value_from_view).transpose()?,
    })
}

fn table_sort_from_view(view: TableSortView) -> Result<TableSort, QueryNotError> {
    let direction = match view.direction.as_str() {
        "ascending" => SortDirection::Ascending,
        "descending" => SortDirection::Descending,
        _ => {
            return Err(QueryNotError::authorization(
                "The structured table sort direction is unsupported.",
            ));
        }
    };
    Ok(TableSort {
        column: view.column,
        direction,
    })
}

fn mutation_from_view(view: TableMutationView) -> Result<MutationInput, QueryNotError> {
    let kind = match view.kind.as_str() {
        "insert" => MutationKind::Insert,
        "update" => MutationKind::Update,
        "delete" => MutationKind::Delete,
        _ => {
            return Err(QueryNotError::authorization(
                "The staged table operation is unsupported.",
            ));
        }
    };
    Ok(MutationInput {
        kind,
        original: view
            .original
            .into_iter()
            .map(tagged_value_from_view)
            .collect::<Result<Vec<_>, _>>()?,
        cells: view
            .cells
            .into_iter()
            .map(|cell| {
                let mode = match (cell.mode.as_str(), cell.value) {
                    ("value", Some(value)) => {
                        MutationCellMode::Value(tagged_value_from_view(value)?)
                    }
                    ("database_default", None) => MutationCellMode::DatabaseDefault,
                    _ => {
                        return Err(QueryNotError::authorization(
                            "A staged mutation cell mode and value do not match.",
                        ));
                    }
                };
                Ok(MutationCell {
                    column: cell.column,
                    mode,
                })
            })
            .collect::<Result<Vec<_>, QueryNotError>>()?,
    })
}

fn table_dialect(dialect: &str) -> Result<TableDialect, QueryNotError> {
    match dialect {
        "sqlite" => Ok(TableDialect::Sqlite),
        "mysql" => Ok(TableDialect::MySql),
        _ => Err(QueryNotError::internal(
            "The adapter reported an unknown table-mutation dialect.",
        )),
    }
}

fn table_page_view(page: TablePage) -> TablePageView {
    TablePageView {
        definition: table_definition_view(page.definition),
        rows: page
            .rows
            .into_iter()
            .map(|values| TableRowView {
                values: values.into_iter().map(tagged_value_view).collect(),
            })
            .collect(),
        has_more: page.has_more,
        next_cursor: page
            .next_cursor
            .into_iter()
            .map(tagged_value_view)
            .collect(),
        next_offset: page.next_offset,
        unstable: page.unstable,
        message: if page.unstable {
            "This object has no usable declared identity. Paging is capped, offset-based, read-only, and may be unstable during concurrent changes."
        } else {
            "Rows were loaded with deterministic keyset paging and typed bound filters."
        }
        .to_owned(),
    }
}

fn table_definition_view(definition: TableDefinition) -> TableDefinitionView {
    let (identity_source, identity_columns) =
        definition.identity.map_or((None, Vec::new()), |identity| {
            (Some(identity.source), identity.columns)
        });
    TableDefinitionView {
        namespace: definition.namespace,
        table: definition.table,
        columns: definition
            .columns
            .into_iter()
            .map(|column| TableColumnView {
                name: column.name,
                declared_type: column.declared_type,
                nullable: column.nullable,
                primary_key_position: column.primary_key_position,
                has_default: column.has_default,
                generated: column.generated,
                editor: match column.editor {
                    TableEditorKind::Text => "text",
                    TableEditorKind::Integer => "integer",
                    TableEditorKind::Decimal => "decimal",
                    TableEditorKind::Float => "float",
                    TableEditorKind::Boolean => "boolean",
                    TableEditorKind::DateTime => "date_time",
                    TableEditorKind::EnumLike => "enum_like",
                    TableEditorKind::ReadOnly => "read_only",
                }
                .to_owned(),
                editable: column.editable,
                read_only_reason: column.read_only_reason,
            })
            .collect(),
        identity_source,
        identity_columns,
        editable: definition.editable,
        read_only_reason: definition.read_only_reason,
    }
}

fn mutation_preview_view(plan: &MutationPlan) -> MutationPreviewView {
    MutationPreviewView {
        plan_id: plan.id.to_string(),
        staging_revision: plan.staging_revision,
        target: format!("{}.{}", plan.namespace, plan.table),
        affected_row_count: plan.operations.len() as u32,
        operations: plan
            .operations
            .iter()
            .map(|operation| MutationOperationPreviewView {
                kind: mutation_kind_name(operation.kind).to_owned(),
                sql_template: operation.sql.clone(),
                parameters: operation
                    .parameters
                    .iter()
                    .map(mutation_parameter_preview)
                    .collect(),
                expected_rows: operation.expected_rows,
            })
            .collect(),
        message: "This one-use immutable native plan is the exact operation batch that Apply will execute. Parameter values are separate from SQL templates."
            .to_owned(),
    }
}

fn mutation_kind_name(kind: MutationKind) -> &'static str {
    match kind {
        MutationKind::Insert => "insert",
        MutationKind::Update => "update",
        MutationKind::Delete => "delete",
    }
}

fn mutation_parameter_preview(value: &TaggedValue) -> MutationParameterPreviewView {
    let (value_type, raw) = match value {
        TaggedValue::Null => ("null", "NULL".to_owned()),
        TaggedValue::Text(value) => ("text", value.clone()),
        TaggedValue::Bytes(value) => ("bytes", format!("<{} bytes>", value.len())),
        TaggedValue::SignedInteger(value) => ("signed_integer", value.clone()),
        TaggedValue::UnsignedInteger(value) => ("unsigned_integer", value.clone()),
        TaggedValue::Decimal(value) => ("decimal", value.clone()),
        TaggedValue::Float(value) => ("float", value.to_string()),
        TaggedValue::Boolean(value) => ("boolean", value.to_string()),
        TaggedValue::DateTime { raw, .. } => ("date_time", raw.clone()),
        TaggedValue::AdapterSpecific { type_name, raw } => (type_name.as_str(), raw.clone()),
    };
    let truncated = raw.chars().count() > 120;
    let display = if truncated {
        format!("{}…", raw.chars().take(120).collect::<String>())
    } else {
        raw
    };
    MutationParameterPreviewView {
        value_type: value_type.to_owned(),
        display,
        truncated,
    }
}

fn ensure_session_idle(
    state: &State<'_, AppRuntimeState>,
    session_id: NativeSessionId,
) -> Result<(), QueryNotError> {
    if lock(&state.phase2.executions)?
        .values()
        .any(|execution| execution.session_id == session_id)
    {
        Err(QueryNotError::database(
            ErrorCategory::Transaction,
            "This tab already has an active database operation.",
            false,
        ))
    } else {
        Ok(())
    }
}

fn connected_profile(
    state: &State<'_, AppRuntimeState>,
    profile_id: ProfileId,
) -> Result<ConnectedProfile, QueryNotError> {
    lock(&state.phase2.connected)?
        .get(&profile_id)
        .cloned()
        .ok_or_else(|| {
            QueryNotError::database(
                ErrorCategory::Connectivity,
                "The metadata session is disconnected or stale.",
                true,
            )
        })
}

fn session_ids(
    request: &SessionRequest,
) -> Result<(ProfileId, TabId, NativeSessionId), QueryNotError> {
    Ok((
        parse_id(&request.profile_id)?,
        parse_id(&request.tab_id)?,
        parse_id(&request.session_id)?,
    ))
}

fn invalidate_profile_mutation_plans(
    state: &AppRuntimeState,
    profile_id: ProfileId,
) -> Result<(), QueryNotError> {
    lock(&state.phase2.mutation_plans)?.retain(|_, plan| plan.profile_id != profile_id);
    Ok(())
}

fn close_lost_session_if_needed<T>(
    state: &AppRuntimeState,
    profile_id: ProfileId,
    tab_id: TabId,
    session_id: NativeSessionId,
    result: &Result<T, QueryNotError>,
) {
    if !result
        .as_ref()
        .is_err_and(|error| error.category == ErrorCategory::Connectivity)
    {
        return;
    }
    if let Ok(mut ownership) = state.ownership.lock() {
        let _ = ownership.unregister_session(state.window_id, profile_id, tab_id, session_id);
    }
    if let Ok(mut sessions) = state.phase2.sessions.lock() {
        sessions.remove(&session_id);
    }
    if let Ok(mut plans) = state.phase2.mutation_plans.lock() {
        plans.retain(|_, plan| plan.session_id != session_id);
    }
    if let Ok(mut approvals) = state.phase2.pending_approvals.lock() {
        approvals.retain(|_, approval| approval.session_id != session_id);
    }
    dispose_tab_results(&state.phase2, tab_id);
}

fn session_resource_from_parts(
    state: &State<'_, AppRuntimeState>,
    profile_id: &str,
    tab_id: &str,
    session_id: &str,
) -> Result<TabSessionResource, QueryNotError> {
    let profile_id = parse_id(profile_id)?;
    let tab_id = parse_id(tab_id)?;
    let session_id = parse_id(session_id)?;
    lock(&state.ownership)?.authorize_session(state.window_id, profile_id, tab_id, session_id)?;
    session_resource(state, profile_id, tab_id, session_id)
}

fn session_resource(
    state: &State<'_, AppRuntimeState>,
    profile_id: ProfileId,
    tab_id: TabId,
    session_id: NativeSessionId,
) -> Result<TabSessionResource, QueryNotError> {
    lock(&state.phase2.sessions)?
        .get(&session_id)
        .filter(|resource| resource.profile_id == profile_id && resource.tab_id == tab_id)
        .cloned()
        .ok_or_else(|| QueryNotError::authorization("Tab session is unknown or not owned."))
}

fn execution_resource(
    state: &State<'_, AppRuntimeState>,
    execution_id: ExecutionId,
) -> Result<ExecutionResource, QueryNotError> {
    lock(&state.phase2.executions)?
        .get(&execution_id)
        .cloned()
        .ok_or_else(|| QueryNotError::cancelled("Execution is already terminal or unknown."))
}

fn authorize_live_execution(
    state: &State<'_, AppRuntimeState>,
    execution_id: ExecutionId,
    execution: &ExecutionResource,
) -> Result<(), QueryNotError> {
    lock(&state.ownership)?.authorize_execution(
        state.window_id,
        execution.profile_id,
        execution.tab_id,
        execution.session_id,
        execution_id,
    )?;
    Ok(())
}

fn connection_view(
    profile_id: ProfileId,
    profile_name: &str,
    info: &SqliteConnectionInfo,
) -> ConnectionInfoView {
    ConnectionInfoView {
        profile_id: profile_id.to_string(),
        profile_name: profile_name.to_owned(),
        engine: info.identity.product.clone(),
        exact_version: info.identity.exact_version.clone(),
        dialect: info.dialect.clone(),
        context: info.context.clone(),
        read_only: info.read_only,
        compatibility_status: match info.compatibility_status {
            CompatibilityStatus::Supported => "supported",
            CompatibilityStatus::QueryOnly => "query_only",
        }
        .to_owned(),
        compatibility_warning: info.compatibility_warning.clone(),
        legacy: info.identity.legacy,
        capabilities: AdapterCapabilitiesView {
            metadata: info.capabilities.metadata,
            streaming: info.capabilities.streaming,
            cancellation: info.capabilities.cancellation,
            transactions: info.capabilities.transactions,
            multiple_results: info.capabilities.multiple_results,
            safe_table_mutations: info.capabilities.safe_table_mutations,
        },
    }
}

fn session_view(
    profile_id: ProfileId,
    tab_id: TabId,
    session_id: NativeSessionId,
    context: &str,
    transaction: SqliteTransactionState,
) -> SessionView {
    SessionView {
        profile_id: profile_id.to_string(),
        tab_id: tab_id.to_string(),
        session_id: session_id.to_string(),
        state: "ready".to_owned(),
        context: context.to_owned(),
        transaction: transaction_view(transaction),
    }
}

fn transaction_view(transaction: SqliteTransactionState) -> TransactionStateView {
    TransactionStateView {
        automatic: transaction.automatic,
        certainty: match transaction.certainty {
            TransactionCertainty::Clean => "clean",
            TransactionCertainty::Active => "active",
            TransactionCertainty::Unknown => "unknown",
        }
        .to_owned(),
    }
}

fn schema_object_view(object: querynot_core::sqlite::SchemaObject) -> SchemaObjectView {
    SchemaObjectView {
        namespace: object.namespace,
        name: object.name,
        kind: match object.kind {
            SchemaObjectKind::Table => "table",
            SchemaObjectKind::View => "view",
            SchemaObjectKind::Routine => "routine",
        }
        .to_owned(),
    }
}

fn schema_detail_view(detail: SchemaObjectDetail, stale: bool) -> SchemaObjectDetailView {
    SchemaObjectDetailView {
        object: schema_object_view(detail.object),
        columns: detail
            .columns
            .into_iter()
            .map(|column| SchemaColumnView {
                name: column.name,
                declared_type: column.declared_type,
                nullable: column.nullable,
                primary_key_position: column.primary_key_position,
                default_expression: column.default_expression,
                generated: column.generated,
            })
            .collect(),
        foreign_keys: detail
            .foreign_keys
            .into_iter()
            .map(|foreign_key| SchemaForeignKeyView {
                id: foreign_key.id,
                sequence: foreign_key.sequence,
                referenced_table: foreign_key.referenced_table,
                from_column: foreign_key.from_column,
                to_column: foreign_key.to_column,
                on_update: foreign_key.on_update,
                on_delete: foreign_key.on_delete,
            })
            .collect(),
        indexes: detail
            .indexes
            .into_iter()
            .map(|index| SchemaIndexView {
                name: index.name,
                unique: index.unique,
                origin: index.origin,
                columns: index.columns,
            })
            .collect(),
        definition: detail.definition,
        routines_supported: detail.routines_supported,
        stale,
    }
}

fn schema_cache_key(
    info: &SqliteConnectionInfo,
    kind: &str,
    parts: &[&str],
) -> Result<String, QueryNotError> {
    let mut key = format!("{}:{}:{kind}", info.dialect, info.identity.exact_version);
    for part in parts {
        key.push(':');
        key.push_str(&base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(part.as_bytes()));
    }
    if key.len() > 1_024 {
        return Err(QueryNotError::authorization(
            "Database metadata identifiers exceed the cache safety boundary.",
        ));
    }
    Ok(key)
}

fn safety_reason_name(reason: SafetyReason) -> &'static str {
    match reason {
        SafetyReason::Drop => "drop",
        SafetyReason::Truncate => "truncate",
        SafetyReason::MissingPredicate => "missing_predicate",
        SafetyReason::IneffectivePredicate => "ineffective_predicate",
        SafetyReason::UncertainPredicate => "uncertain_predicate",
        SafetyReason::AmbiguousBoundaries => "ambiguous_boundaries",
    }
}

fn error_category_name(category: ErrorCategory) -> &'static str {
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
}

fn action_completed(message: &str) -> FileActionResponse {
    FileActionResponse {
        completed: true,
        cancelled: false,
        message: message.to_owned(),
    }
}

fn dispose_tab_results(runtime: &Phase2Runtime, tab_id: TabId) {
    if let Ok(mut approvals) = runtime.pending_approvals.lock() {
        approvals.retain(|_, pending| pending.tab_id != tab_id);
    }
    let result_ids = runtime
        .result_owners
        .lock()
        .map(|owners| {
            owners
                .iter()
                .filter_map(|(result_id, owner)| (owner.tab_id == tab_id).then_some(*result_id))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if let Ok(mut results) = runtime.results.lock() {
        for result_id in &result_ids {
            let _ = results.dispose(*result_id);
        }
    }
    if let Ok(mut owners) = runtime.result_owners.lock() {
        for result_id in result_ids {
            owners.remove(&result_id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use querynot_core::result::{ResultBatch, ResultColumn};

    #[test]
    fn destructive_approval_is_exact_single_use_and_cleanup_invalidates_it() {
        let runtime = Phase2Runtime::default();
        let profile_id = ProfileId::new();
        let tab_id = TabId::new();
        let session_id = NativeSessionId::new();
        let token = runtime
            .issue_approval(profile_id, tab_id, session_id, "fingerprint-a".to_owned())
            .unwrap();
        assert!(
            runtime
                .consume_approval(&token, profile_id, tab_id, session_id, "fingerprint-a")
                .unwrap()
        );
        assert!(
            !runtime
                .consume_approval(&token, profile_id, tab_id, session_id, "fingerprint-a")
                .unwrap()
        );

        let invalidated = runtime
            .issue_approval(profile_id, tab_id, session_id, "fingerprint-b".to_owned())
            .unwrap();
        runtime.cleanup();
        assert!(
            !runtime
                .consume_approval(
                    &invalidated,
                    profile_id,
                    tab_id,
                    session_id,
                    "fingerprint-b"
                )
                .unwrap()
        );
    }

    #[test]
    fn bridge_retention_rejects_duplicate_events_and_cleanup_releases_rows() {
        let runtime = Phase2Runtime::default();
        let execution_id = ExecutionId::new();
        let result_set_id = ResultSetId::new();
        let owner = ResultOwner {
            execution_id,
            profile_id: ProfileId::new(),
            tab_id: TabId::new(),
            session_id: NativeSessionId::new(),
        };
        let batch = SqliteExecutionEvent::Batch(ResultBatch {
            execution_id,
            result_set_id,
            sequence: 0,
            statement_index: 0,
            columns: Some(vec![ResultColumn {
                name: "value".to_owned(),
                declared_type: "TEXT".to_owned(),
                nullable: None,
            }]),
            rows: vec![vec![TaggedValue::Text("retained".to_owned())]],
            encoded_bytes: 24,
        });
        assert!(retain_execution_event(&runtime, &batch, owner));
        assert!(!retain_execution_event(&runtime, &batch, owner));
        assert!(runtime.results.lock().unwrap().get(result_set_id).is_ok());
        runtime.cleanup();
        assert!(runtime.results.lock().unwrap().get(result_set_id).is_err());
        assert!(runtime.result_owners.lock().unwrap().is_empty());
    }

    #[test]
    fn connection_attempts_are_single_owner_cancellable_and_cleanup_safe() {
        let runtime = Phase2Runtime::default();
        let profile_id = ProfileId::new();
        let receiver = runtime
            .begin_connection_attempt(profile_id, ConnectionAttemptKind::Connect)
            .unwrap();
        assert!(
            runtime
                .begin_connection_attempt(profile_id, ConnectionAttemptKind::Connect)
                .is_err()
        );
        assert!(
            runtime
                .cancel_connection_attempt(profile_id, ConnectionAttemptKind::Connect)
                .unwrap()
        );
        assert!(*receiver.borrow());
        runtime.finish_connection_attempt(profile_id, ConnectionAttemptKind::Connect);
        assert!(
            !runtime
                .cancel_connection_attempt(profile_id, ConnectionAttemptKind::Connect)
                .unwrap()
        );

        let cleanup_receiver = runtime
            .begin_connection_attempt(profile_id, ConnectionAttemptKind::Test)
            .unwrap();
        runtime.cleanup();
        assert!(*cleanup_receiver.borrow());
    }

    #[test]
    fn formatting_preserves_comments_and_only_replaces_the_requested_selection() {
        let settings = querynot_core::settings::AppSettings::default();
        let document = "prefix\nselect a,b -- keep this comment\nfrom sample\nsuffix";
        let start = document.find("select").unwrap();
        let end = document.find("\nsuffix").unwrap();
        let response = format_sql_request(
            FormatSqlRequest {
                sql: document.to_owned(),
                selection_start: Some(start as u32),
                selection_end: Some(end as u32),
            },
            &settings,
        )
        .unwrap();

        assert!(response.sql.starts_with("prefix\n"));
        assert!(response.sql.ends_with("\nsuffix"));
        assert!(response.sql.contains("-- keep this comment"));
        assert_eq!(response.selection_start, Some(start as u32));
        assert!(
            response
                .selection_end
                .is_some_and(|value| value > start as u32)
        );
    }
}
