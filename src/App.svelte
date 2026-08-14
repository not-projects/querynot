<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { Attachment } from 'svelte/attachments';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';

  import type {
    BootstrapWorkspaceResponse,
    ConnectionInfoView,
    DiagnosticsPreviewView,
    ExecutionEventView,
    ExecutionStartResponse,
    FilePickerResponse,
    HistoryEntryView,
    MutationApplyResponse,
    MutationPreviewView,
    PendingSqlFilesSignal,
    ProfileInput,
    ProfileView,
    ResultColumnView,
    ResultRowView,
    SchemaNamespaceView,
    SchemaObjectDetailView,
    SchemaObjectView,
    SessionView,
    SettingsView,
    StartExecutionRequest,
    TableColumnView,
    TableFilterView,
    TablePageView,
    TableSortView,
    TaggedValueView,
    WorkspaceTabView,
    WorkspaceView
  } from './lib/generated/contracts';
  import ResultGrid from './lib/components/ResultGrid.svelte';
  import TableDataGrid from './lib/components/TableDataGrid.svelte';
  import SqlEditor, {
    type EditorRunRequest,
    type SqlEditorApi
  } from './lib/components/SqlEditor.svelte';
  import { hasNativeRuntime, invokeCommand } from './lib/native';
  import {
    executionElapsedMs,
    isExecutionActive,
    setExecutionState,
    type ExecutionUi
  } from './lib/execution-ui';
  import { requiresWindowCloseDecision } from './lib/window-close';
  import {
    localMutationErrors,
    nativeMutationOperations,
    type StagedMutationCell,
    type StagedTableMutation
  } from './lib/table-staging';

  type ModalName =
    | 'profile'
    | 'delete-profile'
    | 'settings'
    | 'diagnostics'
    | 'file-review'
    | 'close-tab'
    | 'close-window'
    | 'destructive'
    | null;

  type ResultUi = {
    id: string;
    executionId: string;
    statementIndex: number;
    columns: ResultColumnView[];
    rows: ResultRowView[];
    receivedRows: number;
    retainedBytes: number;
    paused: boolean;
    capped: boolean;
    terminalState: string | null;
    durationMs: number | null;
    nextSequence: number;
  };

  type TablePosition = {
    cursor: TaggedValueView[];
    offset: number;
  };

  type TableUi = {
    page: TablePageView | null;
    filters: TableFilterView[];
    sorts: TableSortView[];
    cursor: TaggedValueView[];
    offset: number;
    back: TablePosition[];
    staged: StagedTableMutation[];
    stagingRevision: number;
    preview: MutationPreviewView | null;
    error: string | null;
  };

  type ProfileForm = ProfileInput & {
    password: string;
    client_key_passphrase: string;
    secret_mode: 'none' | 'vault' | 'session';
  };

  type SchemaLoadState =
    | 'disconnected'
    | 'loading'
    | 'loaded'
    | 'empty'
    | 'stale'
    | 'permission-denied'
    | 'error';

  const defaultSettings = (): SettingsView => ({
    theme: 'system',
    ui_scale_percent: 100,
    editor_word_wrap: false,
    formatter_uppercase_keywords: true,
    formatter_indent_spaces: 2,
    connection_timeout_seconds: 15,
    result_tranche_rows: 10_000,
    table_page_rows: 200,
    history_enabled: true,
    history_retention_days: 90,
    session_restoration_enabled: true,
    automatic_reconnect_default: false,
    operational_log_enabled: true,
    operational_log_max_bytes: 5 * 1024 * 1024,
    operational_log_retention_days: 7
  });

  const emptyWorkspace = (): WorkspaceView => ({
    tabs: [],
    active_tab_id: null,
    panel_sizes: { explorer_percent: 22, results_percent: 35 }
  });

  const defaultProfileForm = (): ProfileForm => ({
    name: '',
    kind: 'mysql_family',
    file_grant_id: null,
    tls_ca_grant_id: null,
    tls_client_certificate_grant_id: null,
    tls_client_key_grant_id: null,
    clear_tls_ca: false,
    clear_tls_client_identity: false,
    read_only: false,
    host: '127.0.0.1',
    port: 3306,
    default_database: null,
    username: '',
    tls_mode: 'verify_identity',
    connection_timeout_seconds: 15,
    automatic_reconnect: false,
    password: '',
    client_key_passphrase: '',
    secret_mode: 'none'
  });

  let profiles = $state<ProfileView[]>([]);
  let settings = $state<SettingsView>(defaultSettings());
  let settingsDraft = $state<SettingsView>(defaultSettings());
  let workspace = $state<WorkspaceView>(emptyWorkspace());
  let storeState = $state('starting');
  let storeMessage = $state<string | null>(null);
  let statusMessage = $state('Starting the secure local workspace…');
  let nowMs = $state(Date.now());
  let busy = $state(false);
  let modal = $state<ModalName>(null);
  let profileForm = $state<ProfileForm>(defaultProfileForm());
  let editingProfileId = $state<string | null>(null);
  let selectedSqliteName = $state<string | null>(null);
  let selectedTlsCaName = $state<string | null>(null);
  let selectedTlsClientCertificateName = $state<string | null>(null);
  let selectedTlsClientKeyName = $state<string | null>(null);
  let deleteProfileId = $state<string | null>(null);
  let deleteHistory = $state(false);
  let deleteDrafts = $state(false);
  let closeTabId = $state<string | null>(null);
  let diagnostics = $state<DiagnosticsPreviewView | null>(null);
  let resetConfirmation = $state(false);
  let clearLogConfirmation = $state(false);
  let clearHistoryConfirmation = $state(false);
  let clearDraftConfirmation = $state(false);
  let dialogElement = $state<HTMLElement>();
  let previousFocus: HTMLElement | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let connections = $state<Record<string, ConnectionInfoView>>({});
  let connectionOperations = $state<Record<string, 'test' | 'connect'>>({});
  let sessions = $state<Record<string, SessionView>>({});
  let executions = $state<Record<string, ExecutionUi>>({});
  let results = $state<Record<string, ResultUi[]>>({});
  let resultViewIndexes = $state<Record<string, number[]>>({});
  let schemaNamespaces = $state<Record<string, SchemaNamespaceView[]>>({});
  let schemaObjects = $state<Record<string, SchemaObjectView[]>>({});
  let schemaStates = $state<Record<string, SchemaLoadState>>({});
  let selectedSchemaObject = $state<SchemaObjectDetailView | null>(null);
  let expandedNamespaces = $state<Record<string, boolean>>({});
  let schemaFilter = $state('');
  let editorApi = $state<SqlEditorApi | null>(null);
  let pendingExecution = $state<{
    request: StartExecutionRequest;
    response: ExecutionStartResponse;
  } | null>(null);
  let tableTabs = $state<Record<string, TableUi>>({});
  let historyOpen = $state(false);
  let historySearch = $state('');
  let historyEntries = $state<HistoryEntryView[]>([]);
  let historyWarning = $state<string | null>(null);
  let workspaceRecoveryWarning = $state<string | null>(null);
  let fileReview = $state<{
    tabId: string;
    displayName: string;
    draft: string;
    external: string;
  } | null>(null);
  let nativeBootstrapComplete = false;
  let pendingFileDrainRequested = false;
  let pendingFileDrainPromise: Promise<void> | null = null;

  const activeTab = $derived(
    workspace.tabs.find((tab) => tab.id === workspace.active_tab_id) ?? null
  );
  const activeProfile = $derived(
    profiles.find((profile) => profile.id === activeTab?.profile_id) ?? null
  );
  const activeConnection = $derived(
    activeProfile ? (connections[activeProfile.id] ?? null) : null
  );
  const activeSession = $derived(
    activeTab ? (sessions[activeTab.id] ?? null) : null
  );
  const activeExecution = $derived(
    activeTab ? (executions[activeTab.id] ?? null) : null
  );
  const activeResults = $derived(
    activeTab ? (results[activeTab.id] ?? []) : []
  );
  const activeTableUi = $derived(
    activeTab?.kind === 'table_data' ? (tableTabs[activeTab.id] ?? null) : null
  );
  const activeSchemaState = $derived<SchemaLoadState>(
    activeProfile
      ? (schemaStates[activeProfile.id] ??
          (activeConnection ? 'loading' : 'disconnected'))
      : 'disconnected'
  );
  const completionSchema = $derived.by(() => {
    const profileId = activeProfile?.id;
    if (!profileId) return {} as Record<string, readonly string[]>;
    const schema: Record<string, string[]> = {};
    for (const object of schemaObjects[profileId] ?? []) {
      const columns =
        selectedSchemaObject?.object.name === object.name &&
        selectedSchemaObject.object.namespace === object.namespace
          ? selectedSchemaObject.columns.map((column) => column.name)
          : [];
      schema[object.name] = columns;
      schema[`${object.namespace}.${object.name}`] = columns;
      schema[object.namespace] = [
        ...new Set([...(schema[object.namespace] ?? []), object.name])
      ];
    }
    return schema;
  });
  const visibleSchemaObjects = $derived.by(() => {
    const profileId = activeProfile?.id;
    const query = schemaFilter.toLocaleLowerCase();
    return (profileId ? (schemaObjects[profileId] ?? []) : []).filter(
      (object) => !query || object.name.toLocaleLowerCase().includes(query)
    );
  });

  function denseMetadataText(value: string, maximum = 160): string {
    return value.length > maximum ? `${value.slice(0, maximum)}…` : value;
  }
  const displayedSettings = $derived(
    modal === 'settings' ? settingsDraft : settings
  );
  const diagnosticsText = $derived(
    diagnostics?.events.length
      ? diagnostics.events
          .slice(-20)
          .map(
            (event) =>
              `${event.timestamp_ms} · ${event.area} · ${event.code} · ${event.error_category ?? 'ok'}`
          )
          .join('\n')
      : 'No retained lifecycle events.'
  );

  onMount(() => {
    void bootstrap();
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    let unlistenExecution: UnlistenFn | undefined;
    let unlistenOpenFiles: UnlistenFn | undefined;
    const elapsedTimer = window.setInterval(() => {
      nowMs = Date.now();
    }, 250);
    if (hasNativeRuntime()) {
      void listen<ExecutionEventView>('query_execution', (event) => {
        void handleExecutionEvent(event.payload);
      }).then((removeListener) => {
        if (disposed) removeListener();
        else unlistenExecution = removeListener;
      });
      void listen<PendingSqlFilesSignal>('querynot_open_files', (event) => {
        if (event.payload.queued) void requestPendingSqlFileDrain();
      }).then((removeListener) => {
        if (disposed) removeListener();
        else unlistenOpenFiles = removeListener;
      });
      void getCurrentWindow()
        .onCloseRequested(async (event) => {
          if (
            requiresWindowCloseDecision({
              busy,
              connectionOperationCount:
                Object.keys(connectionOperations).length,
              dirtyTabCount: workspace.tabs.filter((tab) => tab.dirty).length,
              stagedTableChangeCount: Object.values(tableTabs).filter(
                (table) => table.staged.length > 0
              ).length,
              sessionCount: Object.keys(sessions).length,
              activeExecutionCount: Object.values(executions).filter(
                (execution) => isExecutionActive(execution.state)
              ).length,
              workspaceSavePending: workspaceRecoveryWarning !== null
            })
          ) {
            event.preventDefault();
            await openModal('close-window');
            statusMessage =
              'Window close paused so offline draft changes can be preserved.';
          }
        })
        .then((removeListener) => {
          if (disposed) removeListener();
          else unlisten = removeListener;
        });
    }
    return () => {
      disposed = true;
      unlisten?.();
      unlistenExecution?.();
      unlistenOpenFiles?.();
      window.clearInterval(elapsedTimer);
      if (saveTimer) clearTimeout(saveTimer);
    };
  });

  async function bootstrap() {
    if (!hasNativeRuntime()) {
      applyBootstrap({
        contract_version: 1,
        phase: 'phase_4_productivity_and_safe_data_editing',
        store_state: 'preview',
        store_message: null,
        profiles: [],
        settings: defaultSettings(),
        workspace: emptyWorkspace()
      });
      statusMessage = 'Desktop preview: native persistence is unavailable.';
      return;
    }
    await runAction(async () => {
      applyBootstrap(await invokeCommand('bootstrap_workspace', null));
      statusMessage =
        workspace.tabs.length > 0
          ? `Restored ${workspace.tabs.length} offline tab${workspace.tabs.length === 1 ? '' : 's'} without reconnecting or executing.`
          : 'No database connection is active.';
      nativeBootstrapComplete = true;
      await requestPendingSqlFileDrain();
    });
    for (const profile of profiles.filter(
      (candidate) => candidate.automatic_reconnect && candidate.has_saved_secret
    )) {
      try {
        const info = await invokeCommand('connect_profile', {
          profile_id: profile.id
        });
        connections[profile.id] = info;
        await loadSchemaNamespaces(profile.id);
        statusMessage = `${profile.name} reconnected through its explicit saved-credential preference. Restored tabs remain offline until opened.`;
      } catch (error) {
        statusMessage = `${profile.name} automatic reconnect failed safely: ${safeErrorMessage(error)}`;
      }
    }
  }

  function applyBootstrap(response: BootstrapWorkspaceResponse) {
    profiles = response.profiles;
    settings = response.settings;
    settingsDraft = structuredClone(response.settings);
    workspace = response.workspace;
    connections = {};
    connectionOperations = {};
    sessions = {};
    executions = {};
    results = {};
    tableTabs = {};
    storeState = response.store_state;
    storeMessage = response.store_message;
  }

  async function runAction(action: () => Promise<void>) {
    if (busy) return;
    busy = true;
    try {
      await action();
    } catch (error) {
      statusMessage = safeErrorMessage(error);
    } finally {
      busy = false;
    }
  }

  function safeErrorMessage(error: unknown): string {
    if (typeof error === 'string') return error;
    if (error instanceof Error && error.message) return error.message;
    if (error && typeof error === 'object' && 'safe_message' in error) {
      const safeMessage = (error as { safe_message?: unknown }).safe_message;
      if (typeof safeMessage === 'string') return safeMessage;
    }
    return 'The operation did not complete. Existing local data was preserved.';
  }

  function safeErrorCategory(error: unknown): string | null {
    if (error && typeof error === 'object' && 'category' in error) {
      const category = (error as { category?: unknown }).category;
      if (typeof category === 'string') return category;
    }
    return null;
  }

  function retainTableStagingAfterConnectionLoss(tabId: string) {
    delete sessions[tabId];
    delete executions[tabId];
    delete results[tabId];
    const table = tableTabs[tabId];
    if (table) {
      table.preview = null;
      if (table.staged.length > 0) {
        table.error =
          'The connection was lost. Native resources were closed; staged edits remain visible in memory for review but cannot be replayed automatically.';
      } else {
        table.page = null;
        table.back = [];
        table.cursor = [];
        table.offset = 0;
        table.error =
          'The connection was lost and native table resources were closed. Reconnect to load a fresh page.';
      }
    }
  }

  function markTabOffline(tabId: string, message: string) {
    delete sessions[tabId];
    delete executions[tabId];
    delete results[tabId];
    const table = tableTabs[tabId];
    if (table) {
      table.preview = null;
      table.page = null;
      table.back = [];
      table.cursor = [];
      table.offset = 0;
      table.error = message;
    }
  }

  function focusProfileSafetyBlocker(profileId: string): boolean {
    const stagedTab = stagedTableTabForProfile(profileId);
    if (stagedTab) {
      workspace.active_tab_id = stagedTab.id;
      statusMessage =
        'Apply, discard, or cancel staged table changes before disconnecting this profile.';
      return true;
    }
    const runningTab = workspace.tabs.find(
      (tab) =>
        tab.profile_id === profileId &&
        ['queued', 'running', 'paused', 'cancelling'].includes(
          executions[tab.id]?.state ?? ''
        )
    );
    if (runningTab) {
      workspace.active_tab_id = runningTab.id;
      statusMessage =
        'Cancel the active query and wait for its terminal state before disconnecting this profile.';
      return true;
    }
    const transactionTab = workspace.tabs.find(
      (tab) =>
        tab.profile_id === profileId &&
        sessions[tab.id]?.transaction.certainty !== undefined &&
        sessions[tab.id].transaction.certainty !== 'clean'
    );
    if (transactionTab) {
      workspace.active_tab_id = transactionTab.id;
      statusMessage =
        'Commit or roll back this tab transaction before disconnecting its profile.';
      return true;
    }
    return false;
  }

  async function closeProfileSessions(profileId: string) {
    const owned = Object.values(sessions).filter(
      (session) => session.profile_id === profileId
    );
    for (const session of owned) {
      await invokeCommand('close_tab_session', {
        profile_id: session.profile_id,
        tab_id: session.tab_id,
        session_id: session.session_id
      });
      markTabOffline(
        session.tab_id,
        'This table tab was disconnected cleanly. Reconnect to load a fresh page.'
      );
    }
  }

  function schemaFailureState(error: unknown): SchemaLoadState {
    if (
      error &&
      typeof error === 'object' &&
      'category' in error &&
      (error as { category?: unknown }).category === 'authorization'
    ) {
      return 'permission-denied';
    }
    return 'error';
  }

  async function loadSchemaNamespaces(profileId: string) {
    invalidateProfileTablePreviews(profileId);
    schemaStates[profileId] = 'loading';
    try {
      const response = await invokeCommand('load_schema_namespaces', {
        profile_id: profileId
      });
      schemaNamespaces[profileId] = response.namespaces;
      schemaStates[profileId] = response.stale
        ? 'stale'
        : response.namespaces.length
          ? 'loaded'
          : 'empty';
      return response;
    } catch (error) {
      schemaStates[profileId] = schemaFailureState(error);
      throw error;
    }
  }

  async function loadSchemaNamespaceObjects(
    profileId: string,
    namespace: string
  ) {
    invalidateProfileTablePreviews(profileId);
    const namespaceView = schemaNamespaces[profileId]?.find(
      (candidate) => candidate.name === namespace
    );
    if (namespaceView) namespaceView.state = 'loading';
    try {
      const response = await invokeCommand('load_schema_objects', {
        profile_id: profileId,
        namespace
      });
      const others = (schemaObjects[profileId] ?? []).filter(
        (object) => object.namespace !== namespace
      );
      schemaObjects[profileId] = [...others, ...response.objects];
      if (namespaceView) {
        namespaceView.state = response.stale
          ? 'stale'
          : response.objects.length
            ? 'loaded'
            : 'empty';
      }
      if (response.stale) schemaStates[profileId] = 'stale';
      return response;
    } catch (error) {
      if (namespaceView) namespaceView.state = schemaFailureState(error);
      throw error;
    }
  }

  function invalidateProfileTablePreviews(profileId: string) {
    for (const tab of workspace.tabs.filter(
      (candidate) =>
        candidate.profile_id === profileId && candidate.kind === 'table_data'
    )) {
      invalidateTablePreview(tab.id);
    }
  }

  async function openModal(name: Exclude<ModalName, null>) {
    previousFocus = document.activeElement as HTMLElement | null;
    modal = name;
    await tick();
    dialogElement
      ?.querySelector<HTMLElement>(
        'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])'
      )
      ?.focus();
  }

  async function closeModal() {
    if (busy) return;
    await dismissModal();
  }

  async function closeCompletedModal() {
    await dismissModal();
  }

  async function dismissModal() {
    if (modal === 'destructive') pendingExecution = null;
    if (modal === 'file-review') fileReview = null;
    modal = null;
    profileForm.password = '';
    profileForm.client_key_passphrase = '';
    resetConfirmation = false;
    clearLogConfirmation = false;
    await tick();
    previousFocus?.focus();
  }

  function handleDialogKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      void closeModal();
      return;
    }
    if (event.key !== 'Tab') return;
    if (!dialogElement) return;
    const focusable = Array.from(
      dialogElement.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const captureDialog: Attachment<HTMLElement> = (element) => {
    dialogElement = element;
    return () => {
      if (dialogElement === element) dialogElement = undefined;
    };
  };

  function openNetworkProfile() {
    profileForm = defaultProfileForm();
    profileForm.connection_timeout_seconds =
      settings.connection_timeout_seconds;
    editingProfileId = null;
    selectedSqliteName = null;
    selectedTlsCaName = null;
    selectedTlsClientCertificateName = null;
    selectedTlsClientKeyName = null;
    void openModal('profile');
  }

  async function chooseSqliteProfile() {
    if (!hasNativeRuntime()) {
      statusMessage =
        'SQLite file selection is available in the desktop runtime.';
      return;
    }
    await runAction(async () => {
      const picked = await invokeCommand('pick_sqlite_file', null);
      if (picked.cancelled) {
        statusMessage = 'SQLite file selection was cancelled.';
        return;
      }
      profileForm = {
        ...defaultProfileForm(),
        name:
          picked.display_name?.replace(/\.(sqlite3?|db)$/i, '') ||
          'SQLite database',
        kind: 'sqlite',
        file_grant_id: picked.file_grant_id,
        connection_timeout_seconds: settings.connection_timeout_seconds
      };
      editingProfileId = null;
      selectedSqliteName = picked.display_name;
      await openModal('profile');
    });
  }

  async function chooseNewSqliteProfile() {
    if (!hasNativeRuntime()) {
      statusMessage =
        'SQLite file creation is available in the desktop runtime.';
      return;
    }
    await runAction(async () => {
      const picked = await invokeCommand('pick_new_sqlite_file', null);
      if (picked.cancelled) {
        statusMessage =
          'SQLite file creation was cancelled; no file was created.';
        return;
      }
      profileForm = {
        ...defaultProfileForm(),
        name:
          picked.display_name?.replace(/\.(sqlite3?|db)$/i, '') ||
          'SQLite database',
        kind: 'sqlite',
        file_grant_id: picked.file_grant_id,
        connection_timeout_seconds: settings.connection_timeout_seconds
      };
      editingProfileId = null;
      selectedSqliteName = picked.display_name;
      statusMessage =
        'Created an empty SQLite file. Save its profile to make it available in the workspace.';
      await openModal('profile');
    });
  }

  async function testProfile(profile: ProfileView) {
    if (!hasNativeRuntime()) return;
    await runAction(async () => {
      connectionOperations[profile.id] = 'test';
      try {
        statusMessage = `Testing ${profile.name}…`;
        const info = await invokeCommand('test_profile_connection', {
          profile_id: profile.id
        });
        statusMessage = `${profile.name} test succeeded with ${info.engine} ${info.exact_version}${info.read_only ? ' in read-only mode' : ''}. The test resource was closed.`;
        if (info.compatibility_warning) {
          statusMessage += ` ${info.compatibility_warning}`;
        }
      } finally {
        delete connectionOperations[profile.id];
      }
    });
  }

  async function connectProfile(profile: ProfileView) {
    if (!hasNativeRuntime()) return;
    const stagedTab = stagedTableTabForProfile(profile.id);
    if (stagedTab) {
      workspace.active_tab_id = stagedTab.id;
      statusMessage =
        'Discard the in-memory staged edits from the lost table session before reconnecting this profile; QueryNot will not replay them automatically.';
      return;
    }
    await runAction(async () => {
      connectionOperations[profile.id] = 'connect';
      try {
        statusMessage = `Connecting ${profile.name}…`;
        const info = await invokeCommand('connect_profile', {
          profile_id: profile.id
        });
        connections[profile.id] = info;
        const schema = await loadSchemaNamespaces(profile.id);
        statusMessage = `${profile.name} connected to ${info.engine} ${info.exact_version}. Metadata uses a separate native session.`;
        if (info.compatibility_warning) {
          statusMessage += ` ${info.compatibility_warning}`;
        }
        if (schema.stale) {
          statusMessage +=
            ' Cached metadata is shown as stale because refresh failed.';
        }
      } finally {
        delete connectionOperations[profile.id];
      }
    });
  }

  async function cancelProfileConnection(profile: ProfileView) {
    const action = connectionOperations[profile.id];
    if (!action || !hasNativeRuntime()) return;
    try {
      const response = await invokeCommand('cancel_profile_connection', {
        profile_id: profile.id,
        action
      });
      statusMessage = response.message;
    } catch (error) {
      statusMessage = safeErrorMessage(error);
    }
  }

  async function disconnectProfile(profile: ProfileView) {
    if (!hasNativeRuntime()) return;
    if (focusProfileSafetyBlocker(profile.id)) return;
    await runAction(async () => {
      await closeProfileSessions(profile.id);
      const result = await invokeCommand('disconnect_profile', {
        profile_id: profile.id
      });
      delete connections[profile.id];
      delete schemaNamespaces[profile.id];
      delete schemaObjects[profile.id];
      schemaStates[profile.id] = 'disconnected';
      selectedSchemaObject = null;
      statusMessage = result.message;
    });
  }

  function editProfile(profile: ProfileView) {
    editingProfileId = profile.id;
    selectedSqliteName = profile.file_name;
    selectedTlsCaName = profile.tls_ca_file_name;
    selectedTlsClientCertificateName = profile.tls_client_certificate_file_name;
    selectedTlsClientKeyName = profile.tls_client_key_file_name;
    profileForm = {
      name: profile.name,
      kind: profile.kind,
      file_grant_id: null,
      tls_ca_grant_id: null,
      tls_client_certificate_grant_id: null,
      tls_client_key_grant_id: null,
      clear_tls_ca: false,
      clear_tls_client_identity: false,
      read_only: profile.read_only,
      host: profile.host,
      port: profile.port,
      default_database: profile.default_database,
      username: profile.username,
      tls_mode: profile.tls_mode,
      connection_timeout_seconds: profile.connection_timeout_seconds,
      automatic_reconnect: profile.automatic_reconnect,
      password: '',
      client_key_passphrase: '',
      secret_mode: 'none'
    };
    void openModal('profile');
  }

  async function submitProfile(event: SubmitEvent) {
    event.preventDefault();
    if (!hasNativeRuntime()) {
      statusMessage =
        'Profile persistence is available in the desktop runtime.';
      await closeCompletedModal();
      return;
    }
    await runAction(async () => {
      const password = profileForm.password;
      const clientKeyPassphrase = profileForm.client_key_passphrase;
      const secretMode = profileForm.secret_mode;
      const request: ProfileInput = {
        name: profileForm.name,
        kind: profileForm.kind,
        file_grant_id: profileForm.file_grant_id,
        tls_ca_grant_id: profileForm.tls_ca_grant_id,
        tls_client_certificate_grant_id:
          profileForm.tls_client_certificate_grant_id,
        tls_client_key_grant_id: profileForm.tls_client_key_grant_id,
        clear_tls_ca: profileForm.clear_tls_ca,
        clear_tls_client_identity: profileForm.clear_tls_client_identity,
        read_only: profileForm.read_only,
        host: profileForm.host || null,
        port: profileForm.port,
        default_database: profileForm.default_database || null,
        username: profileForm.username || null,
        tls_mode: profileForm.tls_mode,
        connection_timeout_seconds: profileForm.connection_timeout_seconds,
        automatic_reconnect: profileForm.automatic_reconnect
      };
      const saved = editingProfileId
        ? await invokeCommand('update_profile', {
            profile_id: editingProfileId,
            profile: request
          })
        : await invokeCommand('create_profile', request);

      const index = profiles.findIndex((profile) => profile.id === saved.id);
      if (index >= 0) profiles[index] = saved;
      else profiles.push(saved);

      let message = editingProfileId
        ? 'Profile updated.'
        : 'Profile created offline.';
      if ((password || clientKeyPassphrase) && secretMode !== 'none') {
        profileForm.password = '';
        profileForm.client_key_passphrase = '';
        const secretResult = await invokeCommand('save_profile_secret', {
          profile_id: saved.id,
          database_password: password,
          client_key_passphrase: clientKeyPassphrase,
          session_only: secretMode === 'session'
        });
        message = secretResult.message;
        if (secretResult.saved) {
          profiles[index >= 0 ? index : profiles.length - 1].has_saved_secret =
            true;
        } else if (!secretResult.session_only) {
          profileForm.secret_mode = 'session';
          statusMessage = `${secretResult.message} Re-enter the credential to use the preselected session-only fallback.`;
          return;
        }
      }
      statusMessage = `${message} No connection was started.`;
      await closeCompletedModal();
    });
    profileForm.password = '';
    profileForm.client_key_passphrase = '';
  }

  async function removeSavedSecret() {
    if (!editingProfileId || !hasNativeRuntime()) return;
    await runAction(async () => {
      const result = await invokeCommand('remove_profile_secret', {
        profile_id: editingProfileId!
      });
      const profile = profiles.find(
        (candidate) => candidate.id === editingProfileId
      );
      if (profile) {
        profile.has_saved_secret = false;
        profile.automatic_reconnect = false;
      }
      profileForm.automatic_reconnect = false;
      statusMessage = result.message;
    });
  }

  async function chooseTlsFile(
    command:
      | 'pick_tls_ca_file'
      | 'pick_tls_client_certificate_file'
      | 'pick_tls_client_key_file'
  ) {
    if (!hasNativeRuntime()) return;
    await runAction(async () => {
      const picked = await invokeCommand(command, null);
      if (picked.cancelled) {
        statusMessage = 'TLS file selection was cancelled.';
        return;
      }
      if (command === 'pick_tls_ca_file') {
        profileForm.tls_ca_grant_id = picked.file_grant_id;
        profileForm.clear_tls_ca = false;
        selectedTlsCaName = picked.display_name;
      } else if (command === 'pick_tls_client_certificate_file') {
        profileForm.tls_client_certificate_grant_id = picked.file_grant_id;
        profileForm.clear_tls_client_identity = false;
        selectedTlsClientCertificateName = picked.display_name;
      } else {
        profileForm.tls_client_key_grant_id = picked.file_grant_id;
        profileForm.clear_tls_client_identity = false;
        selectedTlsClientKeyName = picked.display_name;
      }
      statusMessage = 'TLS file was granted to the native profile boundary.';
    });
  }

  function clearTlsCa() {
    profileForm.tls_ca_grant_id = null;
    profileForm.clear_tls_ca = true;
    selectedTlsCaName = null;
  }

  function clearTlsClientIdentity() {
    profileForm.tls_client_certificate_grant_id = null;
    profileForm.tls_client_key_grant_id = null;
    profileForm.clear_tls_client_identity = true;
    selectedTlsClientCertificateName = null;
    selectedTlsClientKeyName = null;
  }

  async function duplicateProfile(profile: ProfileView) {
    if (!hasNativeRuntime()) return;
    await runAction(async () => {
      const duplicate = await invokeCommand('duplicate_profile', {
        profile_id: profile.id
      });
      profiles.push(duplicate);
      statusMessage = `Duplicated ${profile.name} without its saved credential.`;
    });
  }

  function confirmDeleteProfile(profile: ProfileView) {
    if (focusProfileSafetyBlocker(profile.id)) return;
    deleteProfileId = profile.id;
    deleteHistory = false;
    deleteDrafts = false;
    void openModal('delete-profile');
  }

  async function deleteProfile() {
    if (!deleteProfileId || !hasNativeRuntime()) return;
    const profileId = deleteProfileId;
    const deletedProfile = profiles.find((profile) => profile.id === profileId);
    const shouldDeleteDrafts = deleteDrafts;
    await runAction(async () => {
      await closeProfileSessions(profileId);
      await invokeCommand('disconnect_profile', { profile_id: profileId });
      if (!(await saveWorkspaceNow())) {
        throw new Error(
          'Draft recovery must be saved before profile deletion can continue.'
        );
      }
      const result = await invokeCommand('delete_profile', {
        profile_id: profileId,
        delete_history: deleteHistory,
        delete_drafts: deleteDrafts,
        confirmed: true
      });
      statusMessage = result.message;
      if (result.status === 'deleted') {
        profiles = profiles.filter((profile) => profile.id !== profileId);
        delete connections[profileId];
        delete schemaNamespaces[profileId];
        delete schemaObjects[profileId];
        schemaStates[profileId] = 'disconnected';
        const removedTableIds = workspace.tabs
          .filter(
            (tab) => tab.profile_id === profileId && tab.kind === 'table_data'
          )
          .map((tab) => tab.id);
        for (const tabId of removedTableIds) {
          delete tableTabs[tabId];
          delete results[tabId];
          delete executions[tabId];
        }
        if (shouldDeleteDrafts) {
          workspace.tabs = workspace.tabs.filter(
            (tab) => tab.profile_id !== profileId
          );
          if (
            workspace.active_tab_id &&
            !workspace.tabs.some((tab) => tab.id === workspace.active_tab_id)
          ) {
            workspace.active_tab_id = workspace.tabs[0]?.id ?? null;
          }
        } else {
          workspace.tabs = workspace.tabs.filter(
            (tab) => tab.profile_id !== profileId || tab.kind === 'query'
          );
          for (const tab of workspace.tabs) {
            if (tab.profile_id === profileId) {
              tab.profile_id = null;
              tab.profile_label = `Deleted profile: ${deletedProfile?.name ?? 'Unknown'}`;
              tab.reconnectable = false;
            }
          }
        }
        workspace.tabs.forEach((tab, position) => (tab.position = position));
        if (
          workspace.active_tab_id &&
          !workspace.tabs.some((tab) => tab.id === workspace.active_tab_id)
        ) {
          workspace.active_tab_id = workspace.tabs[0]?.id ?? null;
        }
        selectedSchemaObject = null;
        await closeCompletedModal();
      }
    });
  }

  async function createOfflineTab(profileId: string | null = null) {
    if (!hasNativeRuntime()) {
      statusMessage =
        'Offline tab allocation is available in the desktop runtime.';
      return;
    }
    await runAction(async () => {
      const tab = await invokeCommand('create_offline_tab', {
        profile_id: profileId
      });
      tab.position = workspace.tabs.length;
      if (profileId && connections[profileId]) {
        await openConnectedTabSession(tab, profileId);
        statusMessage =
          'Opened a query tab with its own dedicated native database session.';
      } else {
        statusMessage = profileId
          ? 'Opened a profile-bound offline draft. Connect the profile to create a dedicated session.'
          : 'Opened an offline draft.';
      }
      workspace.tabs.push(tab);
      workspace.active_tab_id = tab.id;
      await saveWorkspaceNow();
      await tick();
      document.getElementById('sql-editor')?.focus();
    });
  }

  async function openSqlFile() {
    if (!hasNativeRuntime()) {
      statusMessage = 'SQL file selection is available in the desktop runtime.';
      return;
    }
    await runAction(async () => {
      const picked = await invokeCommand('pick_sql_file', null);
      if (picked.cancelled) {
        statusMessage = 'SQL file selection was cancelled.';
        return;
      }
      const tab = appendOpenedSqlFile(picked);
      statusMessage = `${tab.title} opened offline without execution.`;
      await saveWorkspaceNow();
    });
  }

  function appendOpenedSqlFile(picked: FilePickerResponse): WorkspaceTabView {
    if (!picked.tab_id || !picked.file_grant_id) {
      throw new Error('Native SQL-file allocation failed.');
    }
    const existing = workspace.tabs.find((tab) => tab.id === picked.tab_id);
    if (existing) return existing;
    const tab: WorkspaceTabView = {
      id: picked.tab_id,
      title: picked.display_name ?? 'Offline SQL file',
      kind: 'query',
      pinned: false,
      profile_id: null,
      profile_label: null,
      context_label: null,
      sql: picked.content ?? '',
      dirty: false,
      position: workspace.tabs.length,
      source_file_grant_id: picked.file_grant_id,
      table_namespace: null,
      table_name: null,
      reconnectable: false
    };
    workspace.tabs.push(tab);
    workspace.active_tab_id = tab.id;
    return tab;
  }

  function requestPendingSqlFileDrain(): Promise<void> {
    pendingFileDrainRequested = true;
    if (!nativeBootstrapComplete || !hasNativeRuntime()) {
      return Promise.resolve();
    }
    if (!pendingFileDrainPromise) {
      pendingFileDrainPromise = (async () => {
        while (pendingFileDrainRequested) {
          pendingFileDrainRequested = false;
          try {
            const pending = await invokeCommand('take_pending_sql_files', null);
            const opened = pending.files.map(appendOpenedSqlFile);
            if (opened.length > 0) {
              statusMessage = `${opened.length} SQL file${opened.length === 1 ? '' : 's'} routed into offline draft tabs without connecting or executing.`;
              await saveWorkspaceNow();
              await tick();
              document.getElementById('sql-editor')?.focus();
            }
          } catch (error) {
            statusMessage = `SQL-file routing failed safely: ${safeErrorMessage(error)}`;
          }
        }
      })().finally(() => {
        pendingFileDrainPromise = null;
        if (pendingFileDrainRequested) void requestPendingSqlFileDrain();
      });
    }
    return pendingFileDrainPromise;
  }

  async function saveActiveSqlFile(saveAs = false) {
    if (!activeTab || activeTab.kind !== 'query' || !hasNativeRuntime()) return;
    const tab = activeTab;
    await runAction(async () => {
      const response =
        !saveAs && tab.source_file_grant_id
          ? await invokeCommand('save_sql_file', {
              profile_id: tab.profile_id,
              tab_id: tab.id,
              file_grant_id: tab.source_file_grant_id,
              content: tab.sql
            })
          : await invokeCommand('save_sql_file_as', {
              profile_id: tab.profile_id,
              tab_id: tab.id,
              suggested_name: tab.title.endsWith('.sql')
                ? tab.title
                : `${tab.title}.sql`,
              content: tab.sql
            });
      statusMessage = response.message;
      if (response.status === 'saved') {
        tab.source_file_grant_id = response.file_grant_id;
        tab.title = response.display_name ?? tab.title;
        tab.dirty = false;
        await saveWorkspaceNow();
      }
    });
  }

  async function reviewActiveSqlFile() {
    if (!activeTab?.source_file_grant_id || !hasNativeRuntime()) return;
    const tab = activeTab;
    await runAction(async () => {
      const response = await invokeCommand('review_sql_file', {
        profile_id: tab.profile_id,
        tab_id: tab.id,
        file_grant_id: tab.source_file_grant_id!
      });
      fileReview = {
        tabId: tab.id,
        displayName: response.display_name ?? 'External SQL file',
        draft: tab.sql,
        external: response.content ?? ''
      };
      statusMessage = `Loaded ${fileReview.displayName} for review without replacing the in-memory draft.`;
      await openModal('file-review');
    });
  }

  function renameTab(tab: WorkspaceTabView, title: string) {
    const normalized = title.trim();
    if (!normalized || normalized.length > 256) {
      statusMessage = 'Tab names must contain 1–256 characters.';
      return;
    }
    tab.title = normalized;
    queueWorkspaceSave();
  }

  function moveTab(tabId: string, direction: -1 | 1) {
    const index = workspace.tabs.findIndex((tab) => tab.id === tabId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= workspace.tabs.length) return;
    const [tab] = workspace.tabs.splice(index, 1);
    workspace.tabs.splice(target, 0, tab);
    queueWorkspaceSave();
  }

  function togglePinTab(tab: WorkspaceTabView) {
    tab.pinned = !tab.pinned;
    workspace.tabs = [
      ...workspace.tabs.filter((candidate) => candidate.pinned),
      ...workspace.tabs.filter((candidate) => !candidate.pinned)
    ];
    queueWorkspaceSave();
  }

  async function duplicateQueryTab(tab: WorkspaceTabView) {
    if (tab.kind !== 'query' || !hasNativeRuntime()) return;
    await runAction(async () => {
      const duplicate = await invokeCommand('create_offline_tab', {
        profile_id: tab.profile_id
      });
      duplicate.title = `${tab.title} copy`;
      duplicate.sql = tab.sql;
      duplicate.dirty = true;
      duplicate.pinned = tab.pinned;
      duplicate.context_label = tab.context_label;
      duplicate.position = workspace.tabs.length;
      workspace.tabs.push(duplicate);
      workspace.active_tab_id = duplicate.id;
      statusMessage =
        'Duplicated the query draft and non-secret binding without sharing its file grant, native session, transaction, results, or running job.';
      await saveWorkspaceNow();
    });
  }

  function newTableUi(): TableUi {
    return {
      page: null,
      filters: [],
      sorts: [],
      cursor: [],
      offset: 0,
      back: [],
      staged: [],
      stagingRevision: 0,
      preview: null,
      error: null
    };
  }

  async function openTableData(object: SchemaObjectView) {
    if (!activeProfile || !activeConnection || !hasNativeRuntime()) return;
    const profile = activeProfile;
    await runAction(async () => {
      const tab = await invokeCommand('create_offline_tab', {
        profile_id: profile.id
      });
      tab.kind = 'table_data';
      tab.title = `${object.name} data`;
      tab.context_label = object.namespace;
      tab.table_namespace = object.namespace;
      tab.table_name = object.name;
      tab.sql = '';
      tab.dirty = false;
      tab.position = workspace.tabs.length;
      workspace.tabs.push(tab);
      workspace.active_tab_id = tab.id;
      try {
        const session = await invokeCommand('open_tab_session', {
          profile_id: profile.id,
          tab_id: tab.id
        });
        sessions[tab.id] = session;
        if (session.context !== object.namespace) {
          const changed = await invokeCommand('change_tab_context', {
            profile_id: profile.id,
            tab_id: tab.id,
            session_id: session.session_id,
            context: object.namespace
          });
          session.context = changed.context;
        }
        tab.context_label = session.context;
        tableTabs[tab.id] = newTableUi();
        await loadTablePage(tab.id, [], 0, false);
        await saveWorkspaceNow();
      } catch (error) {
        if (safeErrorCategory(error) === 'connectivity')
          delete sessions[tab.id];
        statusMessage = safeErrorMessage(error);
      }
    });
  }

  async function loadTablePage(
    tabId: string,
    cursor: TaggedValueView[],
    offset: number,
    rememberCurrent: boolean
  ) {
    const tab = workspace.tabs.find((candidate) => candidate.id === tabId);
    const session = sessions[tabId];
    const ui = tableTabs[tabId];
    if (!tab || !session || !ui || !tab.table_namespace || !tab.table_name)
      return;
    if (ui.staged.length) {
      statusMessage =
        'Apply, discard, or cancel staged table changes before changing the loaded page.';
      return;
    }
    if (rememberCurrent) {
      ui.back.push({ cursor: structuredClone(ui.cursor), offset: ui.offset });
    }
    try {
      ui.error = null;
      ui.page = await invokeCommand('browse_table', {
        profile_id: session.profile_id,
        tab_id: session.tab_id,
        session_id: session.session_id,
        namespace: tab.table_namespace,
        table: tab.table_name,
        filters: structuredClone($state.snapshot(ui.filters)),
        sorts: structuredClone($state.snapshot(ui.sorts)),
        cursor: structuredClone(cursor),
        offset,
        page_size: settings.table_page_rows
      });
      ui.cursor = structuredClone(cursor);
      ui.offset = offset;
      statusMessage = ui.page.message;
    } catch (error) {
      if (safeErrorCategory(error) === 'connectivity') {
        retainTableStagingAfterConnectionLoss(tabId);
        statusMessage = tableTabs[tabId]?.error ?? safeErrorMessage(error);
      } else {
        ui.error = safeErrorMessage(error);
        statusMessage = ui.error;
      }
    }
  }

  function sameTableRow(left: TaggedValueView[], right: TaggedValueView[]) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function invalidateTablePreview(tabId: string) {
    const ui = tableTabs[tabId];
    const session = sessions[tabId];
    if (!ui?.preview || !session) return;
    const planId = ui.preview.plan_id;
    ui.preview = null;
    void invokeCommand('discard_mutation_plan', {
      profile_id: session.profile_id,
      tab_id: session.tab_id,
      session_id: session.session_id,
      plan_id: planId
    }).catch(() => undefined);
  }

  function stageTableUpdate(
    rowIndex: number,
    column: TableColumnView,
    cell: StagedMutationCell
  ) {
    const page = activeTableUi?.page;
    if (!activeTab || !activeTableUi || !page) return;
    const ui = activeTableUi;
    const original = page.rows[rowIndex]?.values;
    if (!original) return;
    invalidateTablePreview(activeTab.id);
    let update = ui.staged.find(
      (operation) =>
        operation.kind === 'update' &&
        sameTableRow(operation.original, original)
    );
    if (!update) {
      update = { kind: 'update', original, cells: [] };
      ui.staged.push(update);
    }
    const existingCell = update.cells.find(
      (candidate) => candidate.column === column.name
    );
    if (existingCell) {
      Object.assign(existingCell, cell);
    } else {
      update.cells.push(cell);
    }
    ui.stagingRevision += 1;
    statusMessage =
      'Cell update staged locally. No database write occurs until preview and Apply.';
  }

  function stageTableDelete(rowIndex: number) {
    const page = activeTableUi?.page;
    if (!activeTab || !activeTableUi || !page) return;
    const ui = activeTableUi;
    const original = page.rows[rowIndex]?.values;
    if (!original) return;
    invalidateTablePreview(activeTab.id);
    const existing = ui.staged.findIndex(
      (operation) =>
        operation.kind === 'delete' &&
        sameTableRow(operation.original, original)
    );
    ui.staged = ui.staged.filter(
      (operation) =>
        operation.kind !== 'update' ||
        !sameTableRow(operation.original, original)
    );
    if (existing >= 0) {
      ui.staged = ui.staged.filter(
        (operation) =>
          operation.kind !== 'delete' ||
          !sameTableRow(operation.original, original)
      );
      statusMessage = 'Staged row deletion was undone.';
    } else {
      ui.staged.push({ kind: 'delete', original, cells: [] });
      statusMessage =
        'Row deletion staged locally and remains visible until Apply.';
    }
    ui.stagingRevision += 1;
  }

  function stageTableInsert(cells: StagedMutationCell[]) {
    if (!activeTab || !activeTableUi) return;
    invalidateTablePreview(activeTab.id);
    activeTableUi.staged.push({ kind: 'insert', original: [], cells });
    activeTableUi.stagingRevision += 1;
    statusMessage =
      'New row staged locally with explicit value/NULL/default modes.';
  }

  function unstageTableOperation(operationIndex: number) {
    if (!activeTab || !activeTableUi) return;
    invalidateTablePreview(activeTab.id);
    if (operationIndex < 0 || operationIndex >= activeTableUi.staged.length)
      return;
    activeTableUi.staged.splice(operationIndex, 1);
    activeTableUi.stagingRevision += 1;
    statusMessage =
      'Removed the staged operation without writing to the database.';
  }

  async function discardTableChanges(tabId = activeTab?.id ?? '') {
    const ui = tableTabs[tabId];
    if (!ui) return;
    invalidateTablePreview(tabId);
    ui.staged = [];
    ui.stagingRevision += 1;
    statusMessage =
      'Discarded staged table changes; no database write was made.';
  }

  function returnToTableEditing() {
    if (!activeTab || !activeTableUi?.preview) return;
    invalidateTablePreview(activeTab.id);
    statusMessage =
      'Returned to staged editing. The native preview was invalidated; no database write occurred.';
  }

  async function discardTableAndClose(tabId: string) {
    const ui = tableTabs[tabId];
    const session = sessions[tabId];
    if (ui?.preview && session) {
      try {
        await invokeCommand('discard_mutation_plan', {
          profile_id: session.profile_id,
          tab_id: session.tab_id,
          session_id: session.session_id,
          plan_id: ui.preview.plan_id
        });
      } catch (error) {
        statusMessage = safeErrorMessage(error);
        return;
      }
    }
    if (ui) {
      ui.preview = null;
      ui.staged = [];
      ui.stagingRevision += 1;
    }
    await closeTab(tabId);
  }

  async function saveQueryAndClose(tabId: string) {
    const tab = workspace.tabs.find((candidate) => candidate.id === tabId);
    if (!tab || tab.kind !== 'query') return;
    workspace.active_tab_id = tabId;
    await saveActiveSqlFile(false);
    if (!tab.dirty) await closeTab(tabId);
  }

  async function previewTableChanges() {
    if (
      !activeTab ||
      !activeSession ||
      !activeTableUi ||
      !activeTab.table_namespace ||
      !activeTab.table_name
    )
      return;
    const ui = activeTableUi;
    const tabId = activeTab.id;
    const session = activeSession;
    const localErrors = localMutationErrors(ui.staged);
    if (localErrors.length > 0) {
      statusMessage = `Correct ${localErrors.length} invalid staged value${localErrors.length === 1 ? '' : 's'} before preview. ${localErrors[0]}`;
      return;
    }
    await runAction(async () => {
      try {
        ui.preview = await invokeCommand('preview_table_mutations', {
          profile_id: session.profile_id,
          tab_id: session.tab_id,
          session_id: session.session_id,
          namespace: activeTab.table_namespace!,
          table: activeTab.table_name!,
          staging_revision: ui.stagingRevision,
          operations: nativeMutationOperations(
            structuredClone($state.snapshot(ui.staged))
          )
        });
        statusMessage = ui.preview.message;
      } catch (error) {
        if (safeErrorCategory(error) === 'connectivity') {
          retainTableStagingAfterConnectionLoss(tabId);
        }
        throw error;
      }
    });
  }

  async function applyTableChanges() {
    if (!activeTab || !activeSession || !activeTableUi?.preview) return;
    const tabId = activeTab.id;
    const ui = activeTableUi;
    const session = activeSession;
    await runAction(async () => {
      let response: MutationApplyResponse;
      try {
        response = await invokeCommand('apply_table_mutations', {
          profile_id: session.profile_id,
          tab_id: session.tab_id,
          session_id: session.session_id,
          plan_id: ui.preview!.plan_id,
          staging_revision: ui.stagingRevision
        });
      } catch (error) {
        // Apply consumes the one-use native plan even on a conflict. Keep the
        // staged edits, but require a newly reviewed preview before retrying.
        ui.preview = null;
        if (safeErrorCategory(error) === 'connectivity') {
          retainTableStagingAfterConnectionLoss(tabId);
        } else if (safeErrorCategory(error) === 'transaction') {
          session.transaction.certainty = 'unknown';
        }
        throw error;
      }
      ui.preview = null;
      ui.staged = [];
      ui.stagingRevision += 1;
      await loadTablePage(tabId, ui.cursor, ui.offset, false);
      statusMessage = response.message;
    });
  }

  function changeTableFilter(filter: TableFilterView | null) {
    if (!activeTab || !activeTableUi) return;
    if (activeTableUi.staged.length) {
      statusMessage =
        'Discard or apply staged changes before changing server filters.';
      return;
    }
    if (!filter) {
      activeTableUi.filters = [];
    } else {
      const existing = activeTableUi.filters.findIndex(
        (candidate) =>
          candidate.column === filter.column &&
          candidate.operator === filter.operator
      );
      if (existing >= 0) activeTableUi.filters[existing] = filter;
      else if (activeTableUi.filters.length < 32)
        activeTableUi.filters.push(filter);
      else {
        statusMessage = 'At most 32 server filters can be combined.';
        return;
      }
    }
    activeTableUi.back = [];
    void loadTablePage(activeTab.id, [], 0, false);
  }

  function removeTableFilter(filterIndex: number) {
    if (!activeTab || !activeTableUi || activeTableUi.staged.length) return;
    if (filterIndex < 0 || filterIndex >= activeTableUi.filters.length) return;
    activeTableUi.filters.splice(filterIndex, 1);
    activeTableUi.back = [];
    void loadTablePage(activeTab.id, [], 0, false);
  }

  function changeTableSort(sort: TableSortView | null) {
    if (!activeTab || !activeTableUi) return;
    if (activeTableUi.staged.length) {
      statusMessage =
        'Discard or apply staged changes before changing server sort.';
      return;
    }
    activeTableUi.sorts = sort ? [sort] : [];
    activeTableUi.back = [];
    void loadTablePage(activeTab.id, [], 0, false);
  }

  function nextTablePage() {
    if (!activeTab || !activeTableUi?.page) return;
    void loadTablePage(
      activeTab.id,
      activeTableUi.page.next_cursor,
      activeTableUi.page.next_offset,
      true
    );
  }

  function previousTablePage() {
    if (!activeTab || !activeTableUi) return;
    const previous = activeTableUi.back.pop();
    if (previous) {
      void loadTablePage(activeTab.id, previous.cursor, previous.offset, false);
    }
  }

  async function changeActiveContext(context: string) {
    if (!activeTab || !activeSession || activeTab.kind !== 'query') return;
    const tab = activeTab;
    const session = activeSession;
    await runAction(async () => {
      try {
        const response = await invokeCommand('change_tab_context', {
          profile_id: session.profile_id,
          tab_id: session.tab_id,
          session_id: session.session_id,
          context
        });
        session.context = response.context;
        tab.context_label = response.context;
        pendingExecution = null;
        await saveWorkspaceNow();
        statusMessage = response.message;
      } catch (error) {
        if (safeErrorCategory(error) === 'connectivity') {
          retainTableStagingAfterConnectionLoss(tab.id);
        }
        throw error;
      }
    });
  }

  async function startQueryForObject(object: SchemaObjectView) {
    if (!activeProfile || !hasNativeRuntime()) return;
    const profileId = activeProfile.id;
    await runAction(async () => {
      const starter = await invokeCommand('starter_query', {
        profile_id: profileId,
        namespace: object.namespace,
        object_name: object.name
      });
      const tab = await invokeCommand('create_offline_tab', {
        profile_id: profileId
      });
      tab.title = `${object.name} query`;
      tab.sql = starter.text;
      tab.dirty = true;
      tab.context_label = object.namespace;
      tab.position = workspace.tabs.length;
      if (connections[profileId]) {
        await openConnectedTabSession(tab, profileId, object.namespace);
      }
      workspace.tabs.push(tab);
      workspace.active_tab_id = tab.id;
      statusMessage = connections[profileId]
        ? `${starter.message} Opened with a dedicated session on the existing connection.`
        : starter.message;
      await saveWorkspaceNow();
    });
  }

  async function openConnectedTabSession(
    tab: WorkspaceTabView,
    profileId: string,
    context: string | null = null
  ) {
    const session = await invokeCommand('open_tab_session', {
      profile_id: profileId,
      tab_id: tab.id
    });
    sessions[tab.id] = session;
    try {
      if (context && session.context !== context) {
        const changed = await invokeCommand('change_tab_context', {
          profile_id: profileId,
          tab_id: tab.id,
          session_id: session.session_id,
          context
        });
        session.context = changed.context;
      }
      tab.context_label = session.context;
    } catch (error) {
      await invokeCommand('close_tab_session', {
        profile_id: profileId,
        tab_id: tab.id,
        session_id: session.session_id
      }).catch(() => undefined);
      delete sessions[tab.id];
      throw error;
    }
  }

  function handleEditorChange(value: string) {
    if (!activeTab) return;
    activeTab.sql = value;
    activeTab.dirty = true;
    pendingExecution = null;
    queueWorkspaceSave();
  }

  async function connectActiveTab() {
    if (!activeTab?.profile_id || !activeProfile || !hasNativeRuntime()) {
      statusMessage =
        'Bind this draft to a saved profile before connecting it.';
      return;
    }
    const stagedTab = stagedTableTabForProfile(activeProfile.id);
    if (stagedTab) {
      workspace.active_tab_id = stagedTab.id;
      statusMessage =
        'Discard the in-memory staged edits from the lost table session before reconnecting; QueryNot will not replay them automatically.';
      return;
    }
    await runAction(async () => {
      let connection = connections[activeProfile.id];
      if (!connection) {
        connectionOperations[activeProfile.id] = 'connect';
        try {
          connection = await invokeCommand('connect_profile', {
            profile_id: activeProfile.id
          });
          connections[activeProfile.id] = connection;
          await loadSchemaNamespaces(activeProfile.id);
        } finally {
          delete connectionOperations[activeProfile.id];
        }
      }
      sessions[activeTab.id] = await invokeCommand('open_tab_session', {
        profile_id: activeProfile.id,
        tab_id: activeTab.id
      });
      if (
        activeTab.kind === 'table_data' &&
        activeTab.table_namespace &&
        sessions[activeTab.id].context !== activeTab.table_namespace
      ) {
        const changed = await invokeCommand('change_tab_context', {
          profile_id: activeProfile.id,
          tab_id: activeTab.id,
          session_id: sessions[activeTab.id].session_id,
          context: activeTab.table_namespace
        });
        sessions[activeTab.id].context = changed.context;
      }
      activeTab.context_label = sessions[activeTab.id].context;
      if (activeTab.kind === 'table_data') {
        tableTabs[activeTab.id] = newTableUi();
        await loadTablePage(activeTab.id, [], 0, false);
      }
      statusMessage = `${activeTab.title} is online with a dedicated ${connection.engine} ${connection.exact_version} session.`;
    });
  }

  async function disconnectActiveTab() {
    if (!activeTab || !activeSession || !hasNativeRuntime()) return;
    if (activeTableUi?.staged.length) {
      statusMessage =
        'Apply, discard, or cancel staged table changes before disconnecting this tab.';
      return;
    }
    await runAction(async () => {
      const result = await invokeCommand('close_tab_session', {
        profile_id: activeSession.profile_id,
        tab_id: activeSession.tab_id,
        session_id: activeSession.session_id
      });
      markTabOffline(
        activeTab.id,
        'This table tab was disconnected cleanly. Reconnect to load a fresh page.'
      );
      statusMessage = result.message;
    });
  }

  async function toggleNamespace(namespace: string) {
    if (!activeProfile || !hasNativeRuntime()) return;
    const key = `${activeProfile.id}:${namespace}`;
    expandedNamespaces[key] = !expandedNamespaces[key];
    if (!expandedNamespaces[key]) return;
    await runAction(async () => {
      const response = await loadSchemaNamespaceObjects(
        activeProfile.id,
        namespace
      );
      statusMessage = `${response.stale ? 'Showing stale cached metadata for' : 'Loaded'} ${response.objects.length} database objects from ${namespace}.`;
    });
  }

  async function refreshSchema() {
    if (!activeProfile || !hasNativeRuntime()) return;
    const stagedTab = stagedTableTabForProfile(activeProfile.id);
    if (stagedTab) {
      workspace.active_tab_id = stagedTab.id;
      statusMessage =
        'Apply, discard, or cancel staged table changes before refreshing metadata.';
      return;
    }
    const profileId = activeProfile.id;
    await runAction(async () => {
      const response = await loadSchemaNamespaces(profileId);
      const namespaceNames = new Set(
        response.namespaces.map((namespace) => namespace.name)
      );
      schemaObjects[profileId] = (schemaObjects[profileId] ?? []).filter(
        (object) => namespaceNames.has(object.namespace)
      );
      for (const namespace of response.namespaces) {
        if (expandedNamespaces[`${profileId}:${namespace.name}`]) {
          await loadSchemaNamespaceObjects(profileId, namespace.name);
        }
      }
      statusMessage = response.stale
        ? 'The metadata session could not refresh; retained cache is visibly stale.'
        : 'Refreshed database metadata without changing unrelated expansion state.';
    });
  }

  async function refreshNamespace(namespace: string) {
    if (!activeProfile || !hasNativeRuntime()) return;
    const stagedTab = stagedTableTabForProfile(activeProfile.id);
    if (stagedTab) {
      workspace.active_tab_id = stagedTab.id;
      statusMessage =
        'Apply, discard, or cancel staged table changes before refreshing metadata.';
      return;
    }
    const profileId = activeProfile.id;
    expandedNamespaces[`${profileId}:${namespace}`] = true;
    await runAction(async () => {
      const response = await loadSchemaNamespaceObjects(profileId, namespace);
      statusMessage = response.stale
        ? `${namespace} could not refresh; its retained cache is labelled stale.`
        : `Refreshed ${namespace} without changing other namespaces.`;
    });
  }

  async function inspectSchemaObject(object: SchemaObjectView) {
    if (!activeProfile || !hasNativeRuntime()) return;
    const profileId = activeProfile.id;
    invalidateProfileTablePreviews(profileId);
    await runAction(async () => {
      selectedSchemaObject = await invokeCommand('load_schema_object_detail', {
        profile_id: profileId,
        namespace: object.namespace,
        object_name: object.name
      });
      statusMessage = `${selectedSchemaObject.stale ? 'Showing stale cached metadata' : 'Loaded metadata'} for ${object.namespace}.${object.name}; database-provided text is rendered as plain text.`;
    });
  }

  function refreshSelectedSchemaObject() {
    const stagedTab = activeProfile
      ? stagedTableTabForProfile(activeProfile.id)
      : null;
    if (stagedTab) {
      workspace.active_tab_id = stagedTab.id;
      statusMessage =
        'Apply, discard, or cancel staged table changes before refreshing metadata.';
      return;
    }
    if (selectedSchemaObject) {
      void inspectSchemaObject(selectedSchemaObject.object);
    }
  }

  function stagedTableTabForProfile(profileId: string) {
    return workspace.tabs.find(
      (tab) =>
        tab.profile_id === profileId &&
        tab.kind === 'table_data' &&
        (tableTabs[tab.id]?.staged.length ?? 0) > 0
    );
  }

  async function copyQualifiedName(object: SchemaObjectView) {
    if (!activeProfile || !hasNativeRuntime()) return;
    const response = await invokeCommand('qualified_schema_name', {
      profile_id: activeProfile.id,
      namespace: object.namespace,
      object_name: object.name
    });
    await navigator.clipboard?.writeText(response.text);
    statusMessage = response.message;
  }

  function utf8Offset(text: string, codeUnitOffset: number): number {
    return new TextEncoder().encode(text.slice(0, codeUnitOffset)).length;
  }

  function utf8Range(text: string, start: number, end: number): string {
    return new TextDecoder().decode(
      new TextEncoder().encode(text).slice(start, end)
    );
  }

  async function runEditorRequest(editorRequest: EditorRunRequest) {
    if (!activeTab || !activeProfile || !activeSession || !hasNativeRuntime()) {
      statusMessage =
        'Connect this profile-bound tab before running SQL. Restored and file tabs remain offline by default.';
      return;
    }
    const sql = activeTab.sql;
    const request: StartExecutionRequest = {
      profile_id: activeProfile.id,
      tab_id: activeTab.id,
      session_id: activeSession.session_id,
      sql,
      selection_start:
        editorRequest.selectionStart === null
          ? null
          : utf8Offset(sql, editorRequest.selectionStart),
      selection_end:
        editorRequest.selectionEnd === null
          ? null
          : utf8Offset(sql, editorRequest.selectionEnd),
      cursor: utf8Offset(sql, editorRequest.cursor),
      run_all: editorRequest.runAll,
      approval_fingerprint: null
    };
    await startExecutionRequest(request);
  }

  async function startExecutionRequest(request: StartExecutionRequest) {
    if (!hasNativeRuntime()) return;
    await runAction(async () => {
      const response = await invokeCommand('start_execution', request);
      if (response.status === 'confirmation_required') {
        pendingExecution = { request, response };
        await openModal('destructive');
        statusMessage =
          'Execution paused for an immutable destructive-statement confirmation.';
        return;
      }
      const targetTab = workspace.tabs.find((tab) => tab.id === request.tab_id);
      if (!response.execution_id || !targetTab) {
        throw new Error('Native execution did not allocate a job identifier.');
      }
      if (executions[targetTab.id]?.id !== response.execution_id) {
        executions[targetTab.id] = {
          id: response.execution_id,
          tabId: targetTab.id,
          state: 'queued',
          startedAt: Date.now(),
          completedAt: null,
          statementsCompleted: 0,
          receivedRows: 0,
          error: null
        };
      }
      results[targetTab.id] = (results[targetTab.id] ?? []).filter(
        (result) => result.executionId === response.execution_id
      );
      statusMessage = response.message;
    });
  }

  async function approveDestructiveExecution() {
    if (!pendingExecution?.response.fingerprint) return;
    const request = {
      ...pendingExecution.request,
      approval_fingerprint: pendingExecution.response.fingerprint
    };
    pendingExecution = null;
    await closeModal();
    await startExecutionRequest(request);
  }

  async function cancelActiveExecution() {
    if (!activeExecution || !hasNativeRuntime()) return;
    const result = await invokeCommand('cancel_execution', {
      execution_id: activeExecution.id
    });
    setExecutionState(activeExecution, 'cancelling');
    statusMessage = result.message;
  }

  async function handleExecutionEvent(event: ExecutionEventView) {
    const tab = workspace.tabs.find(
      (candidate) => candidate.id === event.tab_id
    );
    if (!tab) return;
    let execution = executions[event.tab_id];
    if (!execution || execution.id !== event.execution_id) {
      if (event.event_type !== 'started') return;
      execution = {
        id: event.execution_id,
        tabId: event.tab_id,
        state: event.event_type,
        startedAt: Date.now(),
        completedAt: null,
        statementsCompleted: 0,
        receivedRows: 0,
        error: null
      };
      executions[event.tab_id] = execution;
    }
    if (event.event_type === 'batch' && event.result_set_id) {
      const tabResults = (results[event.tab_id] ??= []);
      let result = tabResults.find(
        (candidate) => candidate.id === event.result_set_id
      );
      if (!result) {
        result = {
          id: event.result_set_id,
          executionId: event.execution_id,
          statementIndex: event.statement_index ?? 0,
          columns: event.columns,
          rows: [],
          receivedRows: 0,
          retainedBytes: 0,
          paused: false,
          capped: false,
          terminalState: null,
          durationMs: null,
          nextSequence: 0
        };
        tabResults.push(result);
      }
      if (
        result.executionId !== event.execution_id ||
        result.terminalState !== null ||
        event.sequence !== result.nextSequence ||
        (result.nextSequence === 0 && event.columns.length === 0)
      ) {
        setExecutionState(execution, 'failed');
        execution.error =
          'A duplicate, late, unknown, or out-of-order result event was rejected.';
        statusMessage = execution.error;
        void invokeCommand('cancel_execution', {
          execution_id: event.execution_id
        }).catch(() => undefined);
        return;
      }
      if (event.columns.length) result.columns = event.columns;
      result.rows.push(...event.rows);
      result.receivedRows += event.rows.length;
      result.retainedBytes += event.retained_bytes;
      result.nextSequence += 1;
      execution.receivedRows += event.rows.length;
      setExecutionState(execution, 'running');
      try {
        await invokeCommand('ack_result_batch', {
          execution_id: event.execution_id,
          result_set_id: event.result_set_id,
          sequence: event.sequence ?? 0
        });
      } catch (error) {
        statusMessage = safeErrorMessage(error);
      }
    } else if (event.event_type === 'paused' && event.result_set_id) {
      const result = results[event.tab_id]?.find(
        (candidate) => candidate.id === event.result_set_id
      );
      if (
        !result ||
        event.sequence !== result.nextSequence ||
        event.received_rows !== result.receivedRows ||
        event.retained_bytes !== result.retainedBytes
      )
        return;
      result.paused = true;
      setExecutionState(execution, 'paused');
    } else if (event.event_type === 'result_terminal' && event.result_set_id) {
      const result = results[event.tab_id]?.find(
        (candidate) => candidate.id === event.result_set_id
      );
      if (
        !result ||
        result.terminalState !== null ||
        event.sequence !== result.nextSequence ||
        event.received_rows !== result.receivedRows ||
        event.retained_bytes !== result.retainedBytes
      )
        return;
      result.paused = false;
      result.capped = event.capped;
      result.terminalState = event.terminal_state;
    } else if (event.event_type === 'statement_message') {
      execution.statementsCompleted += 1;
      for (const result of results[event.tab_id] ?? []) {
        if (result.statementIndex === event.statement_index) {
          result.durationMs = event.duration_ms;
        }
      }
      if (event.transaction && sessions[event.tab_id]) {
        sessions[event.tab_id].transaction = event.transaction;
      }
      statusMessage = `Statement ${Number(event.statement_index ?? 0) + 1} affected ${event.rows_affected ?? 0} row(s).`;
    } else if (event.event_type === 'finished') {
      setExecutionState(execution, 'succeeded');
      execution.statementsCompleted = event.statements_completed ?? 0;
      execution.receivedRows = event.received_rows;
      if (event.transaction && sessions[event.tab_id]) {
        sessions[event.tab_id].transaction = event.transaction;
      }
      statusMessage = `Execution succeeded: ${execution.statementsCompleted} statement(s), ${execution.receivedRows} received row(s).`;
    } else if (event.event_type === 'failed') {
      setExecutionState(execution, 'failed');
      execution.error = event.error;
      if (event.transaction && sessions[event.tab_id]) {
        sessions[event.tab_id].transaction = event.transaction;
      }
      if (event.error_category === 'connectivity')
        retainTableStagingAfterConnectionLoss(event.tab_id);
      const range =
        event.statement_start !== null && event.statement_end !== null
          ? ` at bytes ${event.statement_start}–${event.statement_end}`
          : '';
      statusMessage = `${event.error ?? 'Database execution failed safely.'}${range}${event.retryable ? ' Retry is available after resolving the cause.' : ''}`;
    } else if (event.event_type === 'cancelled') {
      setExecutionState(
        execution,
        event.cancel_confirmed ? 'cancelled' : 'cancelling'
      );
      if (event.transaction && sessions[event.tab_id]) {
        sessions[event.tab_id].transaction = event.transaction;
      }
      statusMessage = event.cancel_confirmed
        ? 'The database confirmed cancellation; the dedicated session remains available.'
        : 'Cancellation was requested but server confirmation is still pending.';
    } else if (event.event_type === 'started') {
      setExecutionState(execution, 'running');
    }
  }

  async function loadMore(result: ResultUi) {
    const response = await invokeCommand('load_more_results', {
      execution_id: result.executionId,
      result_set_id: result.id
    });
    result.paused = false;
    statusMessage = response.message;
  }

  async function discardRemainder(result: ResultUi) {
    const response = await invokeCommand('discard_result', {
      execution_id: result.executionId,
      result_set_id: result.id
    });
    result.paused = false;
    statusMessage = response.message;
  }

  function updateResultView(resultSetId: string, indexes: number[]) {
    resultViewIndexes[resultSetId] = indexes;
  }

  async function exportResult(
    result: ResultUi,
    format: 'csv' | 'json',
    currentView: boolean,
    nullToken: string
  ) {
    if (!hasNativeRuntime()) return;
    await runAction(async () => {
      const indexes = currentView
        ? (resultViewIndexes[result.id] ?? result.rows.map((_, index) => index))
        : result.rows.map((_, index) => index);
      const response = await invokeCommand('export_result', {
        execution_id: result.executionId,
        result_set_id: result.id,
        format,
        row_indexes: indexes,
        null_token: nullToken,
        view_label: currentView ? 'current_view' : 'server_order'
      });
      statusMessage = response.message;
    });
  }

  async function formatEditor() {
    if (!activeTab || !hasNativeRuntime()) return;
    const selection = editorApi?.selection();
    await runAction(async () => {
      const response = await invokeCommand('format_sql', {
        sql: activeTab.sql,
        selection_start:
          selection && selection.start !== selection.end
            ? utf8Offset(activeTab.sql, selection.start)
            : null,
        selection_end:
          selection && selection.start !== selection.end
            ? utf8Offset(activeTab.sql, selection.end)
            : null
      });
      activeTab.sql = response.sql;
      activeTab.dirty = true;
      queueWorkspaceSave();
      statusMessage =
        'Formatted the document or selection without executing or saving it.';
    });
  }

  async function setAutomaticTransaction(automatic: boolean) {
    if (!activeSession || !hasNativeRuntime()) return;
    const tabId = activeSession.tab_id;
    await runAction(async () => {
      try {
        activeSession.transaction = await invokeCommand(
          'set_transaction_mode',
          {
            profile_id: activeSession.profile_id,
            tab_id: activeSession.tab_id,
            session_id: activeSession.session_id,
            automatic
          }
        );
      } catch (error) {
        if (safeErrorCategory(error) === 'connectivity') {
          retainTableStagingAfterConnectionLoss(tabId);
        }
        throw error;
      }
      statusMessage = automatic
        ? 'Auto-commit mode is active.'
        : 'Manual mode is active; transaction state remains adapter-authoritative.';
    });
  }

  async function resolveTransaction(action: 'commit' | 'rollback') {
    if (!activeSession || !hasNativeRuntime()) return;
    const tabId = activeSession.tab_id;
    await runAction(async () => {
      try {
        activeSession.transaction = await invokeCommand(
          action === 'commit' ? 'commit_transaction' : 'rollback_transaction',
          {
            profile_id: activeSession.profile_id,
            tab_id: activeSession.tab_id,
            session_id: activeSession.session_id
          }
        );
      } catch (error) {
        if (safeErrorCategory(error) === 'connectivity') {
          retainTableStagingAfterConnectionLoss(tabId);
        }
        throw error;
      }
      statusMessage = `${action === 'commit' ? 'Committed' : 'Rolled back'} the tab transaction; manual mode remains active.`;
    });
  }

  function queueWorkspaceSave() {
    if (!hasNativeRuntime() || !settings.session_restoration_enabled) return;
    workspaceRecoveryWarning =
      'Draft recovery has unsaved changes and will retry after one second of inactivity.';
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void saveWorkspaceNow();
    }, 1_000);
  }

  async function saveWorkspaceNow(): Promise<boolean> {
    if (!hasNativeRuntime()) return false;
    if (!settings.session_restoration_enabled) {
      workspaceRecoveryWarning = null;
      return true;
    }
    workspace.tabs.forEach((tab, index) => {
      tab.position = index;
    });
    try {
      const result = await invokeCommand(
        'save_workspace',
        structuredClone($state.snapshot(workspace))
      );
      if (result.saved) {
        workspaceRecoveryWarning = null;
        return true;
      } else {
        workspaceRecoveryWarning = result.message;
        statusMessage = result.message;
        return false;
      }
    } catch (error) {
      workspaceRecoveryWarning = `Draft recovery could not be saved. ${safeErrorMessage(error)} Current in-memory work remains available and the next edit will retry.`;
      statusMessage = workspaceRecoveryWarning;
      return false;
    }
  }

  function requestCloseTab(tab: WorkspaceTabView) {
    if (
      tab.dirty ||
      sessions[tab.id] ||
      executions[tab.id] ||
      (tableTabs[tab.id]?.staged.length ?? 0) > 0
    ) {
      closeTabId = tab.id;
      void openModal('close-tab');
    } else {
      void closeTab(tab.id);
    }
  }

  async function closeTab(tabId: string) {
    if (!hasNativeRuntime()) return;
    await runAction(async () => {
      const session = sessions[tabId];
      if (session) {
        await invokeCommand('close_tab_session', {
          profile_id: session.profile_id,
          tab_id: session.tab_id,
          session_id: session.session_id
        });
        delete sessions[tabId];
      }
      await invokeCommand('close_offline_tab', { tab_id: tabId });
      const index = workspace.tabs.findIndex((tab) => tab.id === tabId);
      workspace.tabs.splice(index, 1);
      if (workspace.active_tab_id === tabId) {
        workspace.active_tab_id =
          workspace.tabs[Math.min(index, workspace.tabs.length - 1)]?.id ??
          null;
      }
      delete executions[tabId];
      delete results[tabId];
      delete tableTabs[tabId];
      await saveWorkspaceNow();
      statusMessage =
        'Tab and its native database resources were closed explicitly.';
      await closeCompletedModal();
    });
  }

  async function cancelTabAndKeepOpen(tabId: string) {
    const execution = executions[tabId];
    if (!execution || !hasNativeRuntime()) return;
    const response = await invokeCommand('cancel_execution', {
      execution_id: execution.id
    });
    setExecutionState(execution, 'cancelling');
    statusMessage = `${response.message} The tab remains open until the database adapter reports a terminal state.`;
    await closeModal();
  }

  async function resolveTabTransactionAndClose(
    tabId: string,
    action: 'commit' | 'rollback'
  ) {
    const session = sessions[tabId];
    if (!session || !hasNativeRuntime()) return;
    try {
      session.transaction = await invokeCommand(
        action === 'commit' ? 'commit_transaction' : 'rollback_transaction',
        {
          profile_id: session.profile_id,
          tab_id: session.tab_id,
          session_id: session.session_id
        }
      );
      await closeTab(tabId);
    } catch (error) {
      if (safeErrorCategory(error) === 'connectivity') {
        retainTableStagingAfterConnectionLoss(tabId);
      }
      statusMessage = safeErrorMessage(error);
    }
  }

  async function closeWindowAfterSafetyChecks() {
    if (Object.keys(connectionOperations).length > 0) {
      throw new Error(
        'Wait for or cancel connection setup before closing the window.'
      );
    }
    const activeJob = Object.values(executions).find((execution) =>
      isExecutionActive(execution.state)
    );
    if (activeJob) {
      throw new Error(
        'Cancel the running query and wait for its terminal state before closing the window.'
      );
    }
    const unresolved = Object.values(sessions).find(
      (session) => session.transaction.certainty !== 'clean'
    );
    if (unresolved) {
      throw new Error(
        'Commit or roll back every open or unknown tab transaction before closing the window.'
      );
    }
    if (Object.values(tableTabs).some((table) => table.staged.length > 0)) {
      throw new Error(
        'Apply or discard staged table changes in every table-data tab before closing the window.'
      );
    }
    if (!(await saveWorkspaceNow())) {
      throw new Error(
        'Draft recovery did not reach a valid saved state. The window remains open with current in-memory work.'
      );
    }
    for (const session of Object.values(sessions)) {
      await invokeCommand('close_tab_session', {
        profile_id: session.profile_id,
        tab_id: session.tab_id,
        session_id: session.session_id
      });
      delete sessions[session.tab_id];
    }
    await getCurrentWindow().destroy();
  }

  async function preserveDraftsAndCloseWindow() {
    if (!hasNativeRuntime()) return;
    await runAction(closeWindowAfterSafetyChecks);
  }

  async function saveChangedFilesAndCloseWindow() {
    if (!hasNativeRuntime()) return;
    await runAction(async () => {
      for (const tab of workspace.tabs.filter(
        (candidate) =>
          candidate.kind === 'query' &&
          candidate.dirty &&
          candidate.source_file_grant_id
      )) {
        const response = await invokeCommand('save_sql_file', {
          profile_id: tab.profile_id,
          tab_id: tab.id,
          file_grant_id: tab.source_file_grant_id!,
          content: tab.sql
        });
        if (response.status !== 'saved') {
          workspace.active_tab_id = tab.id;
          throw new Error(
            `${response.message} The window remains open so you can review or use Save as.`
          );
        }
        tab.dirty = false;
      }
      await closeWindowAfterSafetyChecks();
    });
  }

  function openSettings() {
    settingsDraft = structuredClone($state.snapshot(settings));
    void openModal('settings');
  }

  async function loadHistory() {
    if (!hasNativeRuntime()) return;
    await runAction(async () => {
      const response = await invokeCommand('list_history', {
        search: historySearch,
        limit: 500
      });
      historyEntries = response.entries;
      historyWarning = response.warning;
      statusMessage =
        response.warning ??
        `Loaded ${response.entries.length} local history entries.`;
    });
  }

  function toggleHistory() {
    historyOpen = !historyOpen;
    if (historyOpen) void loadHistory();
  }

  async function deleteHistoryItem(entry: HistoryEntryView) {
    if (!hasNativeRuntime()) return;
    await runAction(async () => {
      const response = await invokeCommand('delete_history_entry', {
        history_id: entry.id
      });
      historyEntries = historyEntries.filter(
        (candidate) => candidate.id !== entry.id
      );
      statusMessage = response.message;
    });
  }

  async function clearAllHistory() {
    if (!hasNativeRuntime()) return;
    await runAction(async () => {
      const response = await invokeCommand('clear_history', {
        confirmed: true
      });
      historyEntries = [];
      clearHistoryConfirmation = false;
      statusMessage = response.message;
    });
  }

  async function reopenHistoryEntry(entry: HistoryEntryView) {
    if (!hasNativeRuntime()) return;
    const profileId = profiles.some(
      (profile) => profile.id === entry.profile_id
    )
      ? entry.profile_id
      : null;
    await runAction(async () => {
      const tab = await invokeCommand('create_offline_tab', {
        profile_id: profileId
      });
      tab.title = `History · ${new Date(entry.timestamp_ms).toLocaleString()}`;
      tab.sql = entry.sql;
      tab.dirty = true;
      tab.context_label = entry.context;
      tab.position = workspace.tabs.length;
      workspace.tabs.push(tab);
      workspace.active_tab_id = tab.id;
      historyOpen = false;
      await saveWorkspaceNow();
      statusMessage =
        'Reopened history in a new offline query tab. No connection or execution was started.';
    });
  }

  async function persistSettings(event: SubmitEvent) {
    event.preventDefault();
    if (!hasNativeRuntime()) {
      settings = structuredClone($state.snapshot(settingsDraft));
      statusMessage = 'Theme preview applied for this desktop preview.';
      await closeCompletedModal();
      return;
    }
    await runAction(async () => {
      settings = await invokeCommand(
        'save_settings',
        structuredClone($state.snapshot(settingsDraft))
      );
      statusMessage = 'Settings saved and safe immediate changes were applied.';
      await closeCompletedModal();
    });
  }

  async function resetSettings() {
    if (!hasNativeRuntime()) {
      settingsDraft = defaultSettings();
      resetConfirmation = false;
      return;
    }
    await runAction(async () => {
      settings = await invokeCommand('reset_settings', { confirmed: true });
      settingsDraft = structuredClone(settings);
      resetConfirmation = false;
      statusMessage =
        'Settings reset. Profiles, history, and drafts were not deleted.';
    });
  }

  async function clearOperationalLog() {
    if (!hasNativeRuntime()) return;
    await runAction(async () => {
      const result = await invokeCommand('clear_operational_log', {
        confirmed: true
      });
      clearLogConfirmation = false;
      statusMessage = result.message;
    });
  }

  async function clearSavedWorkspace() {
    if (!hasNativeRuntime()) return;
    await runAction(async () => {
      const result = await invokeCommand('clear_saved_workspace', {
        confirmed: true
      });
      clearDraftConfirmation = false;
      workspaceRecoveryWarning = null;
      statusMessage = result.message;
    });
  }

  async function openDiagnostics() {
    if (!hasNativeRuntime()) {
      statusMessage = 'Diagnostics are available in the desktop runtime.';
      return;
    }
    await runAction(async () => {
      diagnostics = await invokeCommand('diagnostics_preview', null);
      await openModal('diagnostics');
    });
  }

  async function exportDiagnostics() {
    if (!diagnostics || !hasNativeRuntime()) return;
    await runAction(async () => {
      const result = await invokeCommand(
        'export_diagnostics',
        structuredClone($state.snapshot(diagnostics!))
      );
      statusMessage = result.message;
      if (result.completed) await closeCompletedModal();
    });
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (modal) return;
    if ((event.metaKey || event.ctrlKey) && event.key === '1') {
      event.preventDefault();
      document.getElementById('connections-heading')?.focus();
    } else if ((event.metaKey || event.ctrlKey) && event.key === '2') {
      event.preventDefault();
      editorApi?.focus();
    } else if ((event.metaKey || event.ctrlKey) && event.key === '3') {
      event.preventDefault();
      document.getElementById('query-results')?.focus();
    } else if ((event.metaKey || event.ctrlKey) && event.key === ',') {
      event.preventDefault();
      openSettings();
    } else if (
      (event.metaKey || event.ctrlKey) &&
      event.key.toLowerCase() === 'n'
    ) {
      event.preventDefault();
      void createOfflineTab(activeProfile?.id ?? null);
    } else if (
      (event.metaKey || event.ctrlKey) &&
      event.key.toLowerCase() === 'o'
    ) {
      event.preventDefault();
      void openSqlFile();
    } else if (
      (event.metaKey || event.ctrlKey) &&
      event.key.toLowerCase() === 's'
    ) {
      event.preventDefault();
      void saveActiveSqlFile(event.shiftKey);
    } else if (
      (event.metaKey || event.ctrlKey) &&
      event.key.toLowerCase() === 'f'
    ) {
      event.preventDefault();
      editorApi?.openSearch();
    } else if (event.ctrlKey && event.key === 'Tab' && workspace.tabs.length) {
      event.preventDefault();
      const current = workspace.tabs.findIndex(
        (tab) => tab.id === workspace.active_tab_id
      );
      const direction = event.shiftKey ? -1 : 1;
      const next =
        (current + direction + workspace.tabs.length) % workspace.tabs.length;
      workspace.active_tab_id = workspace.tabs[next].id;
      queueWorkspaceSave();
    }
  }
</script>

<svelte:head>
  <title>QueryNot — local-first SQL workbench</title>
  <meta
    name="description"
    content="QueryNot is a local-first desktop SQL client for everyday developer workflows."
  />
</svelte:head>

<svelte:window onkeydown={handleWindowKeydown} />

<div
  class="app-shell"
  data-theme={displayedSettings.theme}
  style:--ui-scale={displayedSettings.ui_scale_percent / 100}
  aria-busy={busy}
>
  <header class="topbar">
    <div class="brand">
      <p class="eyebrow">Not Projects</p>
      <h1>QueryNot</h1>
      <span class="phase-badge">Common database adapter</span>
    </div>
    <div class="topbar-actions">
      <span class="offline-badge">
        {Object.keys(connections).length
          ? `${Object.keys(connections).length} connected`
          : 'Offline'}
      </span>
      <button type="button" class="quiet" onclick={openSettings}
        >Settings</button
      >
    </div>
  </header>

  {#if storeMessage}
    <div class="recovery-banner" role="alert">
      <strong>Local store: {storeState.replace('_', ' ')}</strong>
      <span>{storeMessage}</span>
    </div>
  {/if}

  {#if workspaceRecoveryWarning}
    <div class="recovery-banner" role="alert">
      <strong>Draft recovery</strong>
      <span>{workspaceRecoveryWarning}</span>
    </div>
  {/if}

  {#if activeConnection?.compatibility_warning}
    <div class="recovery-banner" role="alert">
      <strong>
        {activeConnection.legacy
          ? 'Legacy server connection'
          : activeConnection.compatibility_status === 'query_only'
            ? 'Query-only compatibility mode'
            : 'Connection warning'}
      </strong>
      <span>{activeConnection.compatibility_warning}</span>
    </div>
  {/if}

  <div class="workbench">
    <aside aria-labelledby="connections-heading">
      <div class="pane-heading">
        <div>
          <p class="eyebrow">Workspace</p>
          <h2 id="connections-heading" tabindex="-1">Connections</h2>
        </div>
        <button
          type="button"
          class="icon-button"
          aria-label="Create network connection profile"
          onclick={openNetworkProfile}>+</button
        >
      </div>

      {#if profiles.length === 0}
        <div class="sidebar-empty">
          <p>No saved profiles</p>
          <span>QueryNot will not scan this device or network for them.</span>
        </div>
      {:else}
        <ul class="profile-list" aria-label="Saved connection profiles">
          {#each profiles as profile (profile.id)}
            <li>
              <button
                type="button"
                class="profile-main"
                onclick={() => void createOfflineTab(profile.id)}
                aria-label={`Open query tab for ${profile.name}`}
              >
                <span class="engine-mark" aria-hidden="true">
                  {profile.kind === 'sqlite' ? 'SQ' : 'MY'}
                </span>
                <span>
                  <strong>{profile.name}</strong>
                  <small>
                    {profile.kind === 'sqlite'
                      ? profile.file_name
                      : `${profile.host}:${profile.port}`}
                  </small>
                </span>
                <span
                  class="status-dot"
                  class:connected={Boolean(connections[profile.id])}
                  title={connections[profile.id] ? 'Connected' : 'Offline'}
                  aria-label={connections[profile.id] ? 'Connected' : 'Offline'}
                ></span>
              </button>
              <div class="profile-actions">
                {#if connectionOperations[profile.id]}
                  <span role="status">
                    {connectionOperations[profile.id] === 'test'
                      ? 'Testing…'
                      : 'Connecting…'}
                  </span>
                  <button
                    type="button"
                    onclick={() => void cancelProfileConnection(profile)}
                    >Cancel</button
                  >
                {:else}
                  <button
                    type="button"
                    onclick={() => void testProfile(profile)}>Test</button
                  >
                {/if}
                {#if connections[profile.id]}
                  <button
                    type="button"
                    onclick={() => void disconnectProfile(profile)}
                    >Disconnect</button
                  >
                {:else if !connectionOperations[profile.id]}
                  <button
                    type="button"
                    onclick={() => void connectProfile(profile)}>Connect</button
                  >
                {/if}
                <button type="button" onclick={() => editProfile(profile)}
                  >Edit</button
                >
                <button
                  type="button"
                  onclick={() => void duplicateProfile(profile)}
                  >Duplicate</button
                >
                <button
                  type="button"
                  onclick={() => confirmDeleteProfile(profile)}>Delete</button
                >
              </div>
            </li>
          {/each}
        </ul>
      {/if}

      <div class="sidebar-actions">
        <button type="button" onclick={openNetworkProfile}
          >Create connection</button
        >
        <button type="button" onclick={() => void chooseSqliteProfile()}
          >Open SQLite file</button
        >
        <button type="button" onclick={() => void chooseNewSqliteProfile()}
          >Create SQLite file</button
        >
        <button type="button" onclick={() => void openSqlFile()}
          >Open SQL file offline</button
        >
      </div>
      <p class="sidebar-note">
        Profiles and drafts stay on this device. Credentials use the OS vault or
        native session memory.
      </p>

      {#if activeProfile}
        <section class="schema-explorer" aria-labelledby="schema-heading">
          <div class="pane-heading compact">
            <div>
              <p class="eyebrow">Progressive metadata</p>
              <h2 id="schema-heading">Schema</h2>
            </div>
            {#if activeConnection}
              <button
                type="button"
                class="schema-refresh"
                disabled={busy}
                onclick={() => void refreshSchema()}>Refresh</button
              >
            {/if}
          </div>
          <p
            class:schema-stale={activeSchemaState === 'stale'}
            class="schema-state"
          >
            {activeSchemaState === 'disconnected'
              ? 'Disconnected — connect this profile to refresh metadata.'
              : activeSchemaState === 'loading'
                ? 'Loading top-level namespaces…'
                : activeSchemaState === 'empty'
                  ? 'Connected; this database exposes no namespaces.'
                  : activeSchemaState === 'stale'
                    ? 'Stale cache — the latest metadata refresh did not succeed.'
                    : activeSchemaState === 'permission-denied'
                      ? 'Permission denied while loading metadata; retained cache was not erased.'
                      : activeSchemaState === 'error'
                        ? 'Metadata error — editor sessions remain independent.'
                        : 'Metadata is current.'}
          </p>
          {#if activeConnection}
            <label class="schema-filter">
              <span class="sr-only">Filter loaded schema objects</span>
              <input
                type="search"
                placeholder="Filter loaded objects"
                bind:value={schemaFilter}
              />
            </label>
            <div
              class="schema-tree"
              role="tree"
              aria-label="Database schema objects"
            >
              {#each schemaNamespaces[activeProfile.id] ?? [] as namespace (namespace.name)}
                <div
                  role="treeitem"
                  aria-selected="false"
                  aria-expanded={Boolean(
                    expandedNamespaces[`${activeProfile.id}:${namespace.name}`]
                  )}
                >
                  <button
                    type="button"
                    title={namespace.name}
                    onclick={() => void toggleNamespace(namespace.name)}
                  >
                    <span aria-hidden="true"
                      >{expandedNamespaces[
                        `${activeProfile.id}:${namespace.name}`
                      ]
                        ? '▾'
                        : '▸'}</span
                    >
                    {denseMetadataText(namespace.name)}
                    <small>{namespace.state}</small>
                  </button>
                  <button
                    type="button"
                    class="schema-copy"
                    aria-label={`Refresh ${namespace.name} metadata`}
                    onclick={() => void refreshNamespace(namespace.name)}
                    >Refresh</button
                  >
                  {#if expandedNamespaces[`${activeProfile.id}:${namespace.name}`]}
                    <ul role="group">
                      {#each visibleSchemaObjects.filter((object) => object.namespace === namespace.name) as object (`${object.namespace}:${object.name}`)}
                        <li
                          role="treeitem"
                          aria-selected={selectedSchemaObject?.object
                            .namespace === object.namespace &&
                            selectedSchemaObject?.object.name === object.name}
                        >
                          <button
                            type="button"
                            onclick={() => void inspectSchemaObject(object)}
                          >
                            <span aria-hidden="true"
                              >{object.kind === 'table'
                                ? '▦'
                                : object.kind === 'routine'
                                  ? 'ƒ'
                                  : '◇'}</span
                            >
                            <span title={object.name}
                              >{denseMetadataText(object.name)}</span
                            >
                          </button>
                          <button
                            type="button"
                            class="schema-copy"
                            aria-label={`Copy qualified name for ${object.name}`}
                            onclick={() => void copyQualifiedName(object)}
                            >Copy</button
                          >
                          {#if object.kind === 'table' || object.kind === 'view'}
                            <button
                              type="button"
                              class="schema-copy"
                              aria-label={`Open data for ${object.name}`}
                              onclick={() => void openTableData(object)}
                              >Data</button
                            >
                            <button
                              type="button"
                              class="schema-copy"
                              aria-label={`Start query for ${object.name}`}
                              onclick={() => void startQueryForObject(object)}
                              >Query</button
                            >
                          {/if}
                        </li>
                      {/each}
                    </ul>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
          {#if selectedSchemaObject}
            <details class="object-detail" open>
              <summary>
                {selectedSchemaObject.object.name} details{selectedSchemaObject.stale
                  ? ' · stale'
                  : ''}
              </summary>
              <button
                type="button"
                class="schema-refresh"
                onclick={refreshSelectedSchemaObject}>Refresh object</button
              >
              <p>
                {selectedSchemaObject.object.kind} · {selectedSchemaObject
                  .columns.length} columns
              </p>
              <ul>
                {#each selectedSchemaObject.columns as column (`${column.name}:${column.primary_key_position}`)}
                  <li title={column.name}>
                    <code>{column.name}</code>
                    <span
                      >{column.declared_type ||
                        'untyped'}{column.primary_key_position
                        ? ' · PK'
                        : ''}{column.nullable
                        ? ' · nullable'
                        : ' · required'}{column.generated
                        ? ' · generated'
                        : ''}</span
                    >
                    {#if column.default_expression}
                      <small>Default: {column.default_expression}</small>
                    {/if}
                  </li>
                {/each}
              </ul>
              {#if selectedSchemaObject.indexes.length > 0}
                <details>
                  <summary
                    >{selectedSchemaObject.indexes.length} indexes</summary
                  >
                  <ul>
                    {#each selectedSchemaObject.indexes as index (index.name)}
                      <li>
                        <code>{index.name}</code>
                        <span
                          >{index.unique ? 'unique' : 'non-unique'} · {index.origin}
                          ·
                          {index.columns.join(', ')}</span
                        >
                      </li>
                    {/each}
                  </ul>
                </details>
              {/if}
              {#if selectedSchemaObject.foreign_keys.length > 0}
                <details>
                  <summary>
                    {selectedSchemaObject.foreign_keys.length} foreign-key columns
                  </summary>
                  <ul>
                    {#each selectedSchemaObject.foreign_keys as foreignKey (`${foreignKey.id}:${foreignKey.sequence}`)}
                      <li>
                        <code>{foreignKey.from_column}</code>
                        <span>
                          references {foreignKey.referenced_table}.{foreignKey.to_column ??
                            '(adapter default)'} · update {foreignKey.on_update} ·
                          delete
                          {foreignKey.on_delete}
                        </span>
                      </li>
                    {/each}
                  </ul>
                </details>
              {/if}
              {#if selectedSchemaObject.definition}
                <details>
                  <summary>Full engine-provided definition</summary>
                  <pre>{selectedSchemaObject.definition}</pre>
                </details>
              {/if}
              <p>
                {selectedSchemaObject.routines_supported
                  ? 'Routine metadata is supported by this adapter.'
                  : 'Routine metadata is unavailable for this adapter or object.'}
              </p>
            </details>
          {/if}
        </section>
      {/if}

      <section class="history-panel" aria-labelledby="history-heading">
        <div class="pane-heading compact">
          <div>
            <p class="eyebrow">Local execution record</p>
            <h2 id="history-heading">History</h2>
          </div>
          <button type="button" onclick={toggleHistory}>
            {historyOpen ? 'Hide' : 'Open'}
          </button>
        </div>
        {#if historyOpen}
          <form
            class="history-search"
            onsubmit={(event) => {
              event.preventDefault();
              void loadHistory();
            }}
          >
            <label>
              <span class="sr-only">Search local query history</span>
              <input
                type="search"
                placeholder="Search SQL or metadata"
                bind:value={historySearch}
              />
            </label>
            <button type="submit">Search</button>
          </form>
          {#if historyWarning}<p class="schema-state">{historyWarning}</p>{/if}
          <ul class="history-list">
            {#each historyEntries as entry (entry.id)}
              <li>
                <button
                  type="button"
                  class="history-main"
                  onclick={() => void reopenHistoryEntry(entry)}
                >
                  <strong>{entry.status} · {entry.profile_label}</strong>
                  <code>{entry.sql.slice(0, 160)}</code>
                  <small>
                    {new Date(entry.timestamp_ms).toLocaleString()} · {entry.duration_ms}
                    ms ·
                    {entry.received_rows} rows
                  </small>
                </button>
                <button
                  type="button"
                  class="history-delete"
                  aria-label={`Delete history entry from ${new Date(entry.timestamp_ms).toLocaleString()}`}
                  onclick={() => void deleteHistoryItem(entry)}>×</button
                >
              </li>
            {/each}
          </ul>
          {#if historyEntries.length === 0}
            <p class="schema-state">No matching local history entries.</p>
          {/if}
          {#if clearHistoryConfirmation}
            <div class="confirm-strip" role="alert">
              <span>Clear all active local history entries?</span>
              <button
                type="button"
                onclick={() => (clearHistoryConfirmation = false)}>Keep</button
              >
              <button type="button" onclick={() => void clearAllHistory()}
                >Clear</button
              >
            </div>
          {:else}
            <button
              type="button"
              class="quiet"
              onclick={() => (clearHistoryConfirmation = true)}
            >
              Clear all history…
            </button>
          {/if}
          <p class="sidebar-note">
            History never stores result rows, credentials, certificate contents,
            staged edits, or raw driver logs. Backup and storage-forensics
            deletion is outside QueryNot’s guarantee.
          </p>
        {/if}
      </section>
    </aside>

    <main
      class:has-query-results={Boolean(
        activeTab?.kind === 'query' &&
        (activeResults.length || activeExecution?.error)
      )}
    >
      <div class="context-bar" aria-label="Active query context">
        <span class="context-state" class:online={Boolean(activeSession)}>
          {activeSession ? 'Online' : 'Offline'}
        </span>
        <span>{activeTab?.profile_label ?? 'No profile'}</span>
        <span
          >{activeConnection
            ? `${activeConnection.engine} ${activeConnection.exact_version}`
            : 'Engine unavailable'}</span
        >
        {#if activeSession && activeTab?.kind === 'query' && activeProfile}
          <label class="context-selector">
            <span class="sr-only">Active database or schema for this tab</span>
            <select
              value={activeSession.context}
              disabled={Boolean(activeExecution) ||
                activeSession.transaction.certainty !== 'clean'}
              onchange={(event) =>
                void changeActiveContext(
                  (event.currentTarget as HTMLSelectElement).value
                )}
            >
              {#each schemaNamespaces[activeProfile.id] ?? [] as namespace (namespace.name)}
                <option value={namespace.name}>{namespace.name}</option>
              {/each}
            </select>
          </label>
        {:else}
          <span>
            {activeSession?.context ??
              activeTab?.context_label ??
              activeConnection?.context ??
              'No database selected'}
          </span>
        {/if}
        <span>
          {activeSession
            ? `${activeSession.transaction.automatic ? 'Auto-commit' : 'Manual'} · ${activeSession.transaction.certainty}`
            : 'Transaction unavailable'}
        </span>
        <span>{activeExecution?.state ?? 'Idle'}</span>
      </div>

      {#if workspace.tabs.length > 0}
        <div class="tab-strip" role="tablist" aria-label="Query tabs">
          {#each workspace.tabs as tab (tab.id)}
            <div
              class:active={workspace.active_tab_id === tab.id}
              class="tab-item"
            >
              <button
                type="button"
                role="tab"
                aria-selected={workspace.active_tab_id === tab.id}
                tabindex={workspace.active_tab_id === tab.id ? 0 : -1}
                onclick={() => (workspace.active_tab_id = tab.id)}
              >
                <span>{tab.title}</span>
                {#if tab.pinned}<span aria-label="Pinned tab">◆</span>{/if}
                {#if tab.kind === 'table_data'}<span aria-label="Table-data tab"
                    >▦</span
                  >{/if}
                {#if tab.dirty}<span aria-label="Unsaved draft">●</span>{/if}
              </button>
              <input
                class="tab-rename"
                value={tab.title}
                aria-label={`Rename ${tab.title}`}
                onchange={(event) =>
                  renameTab(
                    tab,
                    (event.currentTarget as HTMLInputElement).value
                  )}
              />
              <button
                type="button"
                class="tab-close"
                aria-label={`${tab.pinned ? 'Unpin' : 'Pin'} ${tab.title}`}
                onclick={() => togglePinTab(tab)}>◆</button
              >
              <button
                type="button"
                class="tab-close"
                aria-label={`Move ${tab.title} left`}
                onclick={() => moveTab(tab.id, -1)}>←</button
              >
              <button
                type="button"
                class="tab-close"
                aria-label={`Move ${tab.title} right`}
                onclick={() => moveTab(tab.id, 1)}>→</button
              >
              {#if tab.kind === 'query'}
                <button
                  type="button"
                  class="tab-close"
                  aria-label={`Duplicate ${tab.title}`}
                  onclick={() => void duplicateQueryTab(tab)}>⧉</button
                >
              {/if}
              <button
                type="button"
                class="tab-close"
                aria-label={`Close ${tab.title}`}
                onclick={() => requestCloseTab(tab)}>×</button
              >
            </div>
          {/each}
          <button
            type="button"
            class="new-tab"
            aria-label="New offline query tab"
            onclick={() => void createOfflineTab(activeProfile?.id ?? null)}
            >+</button
          >
        </div>

        {#if activeTab?.kind === 'table_data'}
          {#if activeTableUi?.page}
            {#if !activeSession}
              <div class="recovery-banner" role="alert">
                <strong>Table session offline</strong>
                <span>{activeTableUi.error}</span>
                <button
                  type="button"
                  disabled={activeTableUi.staged.length > 0}
                  onclick={() => void connectActiveTab()}
                >
                  Reconnect after review
                </button>
              </div>
            {/if}
            <TableDataGrid
              page={activeTableUi.page}
              filters={activeTableUi.filters}
              staged={activeTableUi.staged}
              preview={activeTableUi.preview}
              {busy}
              canGoBack={activeTableUi.back.length > 0}
              onstageupdate={stageTableUpdate}
              onstagedelete={stageTableDelete}
              onstageinsert={stageTableInsert}
              onunstage={unstageTableOperation}
              ondiscard={() => void discardTableChanges()}
              onreturn={returnToTableEditing}
              onpreview={() => void previewTableChanges()}
              onapply={() => void applyTableChanges()}
              onnext={nextTablePage}
              onprevious={previousTablePage}
              onfilter={changeTableFilter}
              onremovefilter={removeTableFilter}
              onsort={changeTableSort}
              onstatus={(message) => (statusMessage = message)}
            />
          {:else}
            <section
              class="editor-workspace"
              aria-labelledby="table-loading-heading"
            >
              <h2 id="table-loading-heading">Table data is offline</h2>
              <p>
                {activeTableUi?.error ??
                  'Reconnect this restored table-data tab to load rows. Staged edits are never restored.'}
              </p>
              {#if activeTab.profile_id && !activeSession}
                <button
                  type="button"
                  class="primary"
                  onclick={() => void connectActiveTab()}
                >
                  Connect table tab
                </button>
              {/if}
            </section>
          {/if}
        {:else}
          <section class="editor-workspace" aria-labelledby="editor-heading">
            <div class="editor-heading-row">
              <div>
                <p class="eyebrow">SQL draft</p>
                <h2 id="editor-heading">{activeTab?.title}</h2>
              </div>
              <span class="safety-label"
                >{activeSession
                  ? `${activeConnection?.engine ?? 'Database'} · explicit execution only`
                  : 'Offline · connect to execute'}</span
              >
            </div>
            <div class="query-toolbar" aria-label="Query actions">
              {#if activeSession}
                <button
                  type="button"
                  class="primary"
                  disabled={activeExecution &&
                    ['queued', 'running', 'paused', 'cancelling'].includes(
                      activeExecution.state
                    )}
                  onclick={() => {
                    const selection = editorApi?.selection();
                    void runEditorRequest({
                      selectionStart:
                        selection && selection.start !== selection.end
                          ? selection.start
                          : null,
                      selectionEnd:
                        selection && selection.start !== selection.end
                          ? selection.end
                          : null,
                      cursor: selection?.cursor ?? 0,
                      runAll: false
                    });
                  }}>Run</button
                >
                <button
                  type="button"
                  disabled={activeExecution &&
                    ['queued', 'running', 'paused', 'cancelling'].includes(
                      activeExecution.state
                    )}
                  onclick={() => {
                    const selection = editorApi?.selection();
                    void runEditorRequest({
                      selectionStart: null,
                      selectionEnd: null,
                      cursor: selection?.cursor ?? 0,
                      runAll: true
                    });
                  }}>Run all</button
                >
                <button
                  type="button"
                  disabled={!activeExecution ||
                    !['queued', 'running', 'paused', 'cancelling'].includes(
                      activeExecution.state
                    )}
                  onclick={() => void cancelActiveExecution()}>Cancel</button
                >
                <label class="transaction-mode">
                  <span>Mode</span>
                  <select
                    value={activeSession.transaction.automatic
                      ? 'automatic'
                      : 'manual'}
                    onchange={(event) =>
                      void setAutomaticTransaction(
                        (event.currentTarget as HTMLSelectElement).value ===
                          'automatic'
                      )}
                  >
                    <option value="automatic">Auto-commit</option>
                    <option value="manual">Manual</option>
                  </select>
                </label>
                {#if activeSession.transaction.certainty !== 'clean'}
                  <button
                    type="button"
                    onclick={() => void resolveTransaction('commit')}
                    >Commit</button
                  >
                  <button
                    type="button"
                    onclick={() => void resolveTransaction('rollback')}
                    >Rollback</button
                  >
                {/if}
                <button type="button" onclick={() => void disconnectActiveTab()}
                  >Disconnect tab</button
                >
              {:else if activeTab?.profile_id}
                <button
                  type="button"
                  class="primary"
                  onclick={() => void connectActiveTab()}>Connect tab</button
                >
              {/if}
              <button type="button" onclick={() => void formatEditor()}
                >Format</button
              >
              <button
                type="button"
                onclick={() => void saveActiveSqlFile(false)}
              >
                Save
              </button>
              <button
                type="button"
                onclick={() => void saveActiveSqlFile(true)}
              >
                Save as…
              </button>
              {#if activeTab?.source_file_grant_id}
                <button
                  type="button"
                  onclick={() => void reviewActiveSqlFile()}
                >
                  Review disk version
                </button>
              {/if}
            </div>
            {#key activeTab?.id}
              <div id="sql-editor" class="code-editor-frame">
                <SqlEditor
                  value={activeTab?.sql ?? ''}
                  wordWrap={displayedSettings.editor_word_wrap}
                  dialect={activeConnection?.dialect ?? 'sqlite'}
                  {completionSchema}
                  disabled={Boolean(
                    activeExecution &&
                    ['queued', 'running', 'cancelling'].includes(
                      activeExecution.state
                    )
                  )}
                  onchange={handleEditorChange}
                  onrun={(request) => void runEditorRequest(request)}
                  oncancel={() => void cancelActiveExecution()}
                  onformat={() => void formatEditor()}
                  onready={(api) => (editorApi = api)}
                />
              </div>
            {/key}
            <div class="editor-status">
              <span>
                {activeTab?.source_file_grant_id
                  ? activeTab.dirty
                    ? 'Source file changed'
                    : 'Source file saved'
                  : 'Offline draft'}
              </span>
              <span>{activeTab?.profile_label ?? 'Unbound offline file'}</span>
              <span>
                {activeExecution
                  ? `${activeExecution.state} · ${activeExecution.statementsCompleted} statements · ${activeExecution.receivedRows} rows · ${executionElapsedMs(activeExecution, nowMs)} ms`
                  : 'Idle · Mod+Enter run · Mod+Shift+Enter run all'}
              </span>
            </div>
          </section>

          {#if activeResults.length || activeExecution?.error}
            <section
              class="results-workspace"
              id="query-results"
              tabindex="-1"
              aria-labelledby="results-heading"
            >
              <div class="editor-heading-row">
                <div>
                  <p class="eyebrow">Received rows and messages</p>
                  <h2 id="results-heading">Results</h2>
                </div>
                <span class="safety-label">No hidden fetch or re-execution</span
                >
              </div>
              {#if activeExecution?.error}
                <div class="result-error" role="alert">
                  {activeExecution.error}
                </div>
              {/if}
              {#each activeResults as result (result.id)}
                <ResultGrid
                  resultSetId={result.id}
                  statementIndex={result.statementIndex}
                  columns={result.columns}
                  rows={result.rows}
                  capped={result.capped}
                  paused={result.paused}
                  terminalState={result.terminalState}
                  durationMs={result.durationMs}
                  onloadmore={() => void loadMore(result)}
                  ondiscard={() => void discardRemainder(result)}
                  onexport={(format, currentView, nullToken) =>
                    void exportResult(result, format, currentView, nullToken)}
                  onviewchange={updateResultView}
                  onstatus={(message) => (statusMessage = message)}
                />
              {/each}
              <p class="export-warning">
                CSV preserves raw values, including spreadsheet-formula
                prefixes. Opening a CSV in spreadsheet software may evaluate
                formulas. NULL exports as <code>\N</code> by default; binary values
                use hexadecimal in CSV and tagged base64 in JSON.
              </p>
            </section>
          {/if}
        {/if}
      {:else}
        <section class="empty-state" aria-labelledby="welcome-heading">
          <p class="eyebrow">Local-first SQL workbench</p>
          <h2 id="welcome-heading">Query your data, not your patience.</h2>
          <p>
            Start with an exact file or authorized server profile. QueryNot does
            not scan for databases, reconnect automatically, or execute restored
            drafts.
          </p>
          <div class="action-list">
            <button type="button" onclick={openNetworkProfile}>
              <strong>Create connection</strong>
              <span>Configure MySQL or MariaDB manually.</span>
            </button>
            <button type="button" onclick={() => void chooseSqliteProfile()}>
              <strong>Open SQLite file</strong>
              <span>Choose one database file through the native dialog.</span>
            </button>
            <button type="button" onclick={() => void openSqlFile()}>
              <strong>Open SQL file offline</strong>
              <span
                >Read text into a draft without connecting or executing.</span
              >
            </button>
            <button type="button" onclick={openSettings}>
              <strong>Settings</strong>
              <span
                >Review appearance, retention, logging, and diagnostics.</span
              >
            </button>
          </div>
        </section>
      {/if}
    </main>
  </div>

  <footer>
    <span class="status-message" aria-live="polite">{statusMessage}</span>
    <span
      >Mod+N New · Mod+O Open · Mod+S Save · Mod+Enter Run · Mod+Shift+Enter Run
      all · Mod+. Cancel · Shift+Alt+F Format · Mod+1/2/3 Focus · Mod+F Find ·
      Ctrl+Tab / Ctrl+Shift+Tab Switch tab</span
    >
  </footer>
</div>

{#if modal}
  <div
    class="modal-backdrop theme-context"
    data-theme={displayedSettings.theme}
    style:--ui-scale={displayedSettings.ui_scale_percent / 100}
  >
    <div
      class="modal-card"
      class:modal-wide={modal === 'settings' || modal === 'file-review'}
      role="dialog"
      tabindex="-1"
      aria-modal="true"
      aria-labelledby="modal-title"
      {@attach captureDialog}
      onkeydown={handleDialogKeydown}
    >
      {#if modal === 'profile'}
        <form onsubmit={submitProfile}>
          <div class="modal-header">
            <div>
              <p class="eyebrow">Saved profile</p>
              <h2 id="modal-title">
                {editingProfileId
                  ? 'Edit connection profile'
                  : 'Create connection profile'}
              </h2>
            </div>
            <button
              type="button"
              class="icon-button"
              aria-label="Close"
              onclick={closeModal}>×</button
            >
          </div>

          <div class="form-grid">
            <label class="field field-full">
              <span>Profile name</span>
              <input required maxlength="100" bind:value={profileForm.name} />
            </label>

            {#if profileForm.kind === 'sqlite'}
              <div class="file-summary field-full">
                <span>Native file grant</span>
                <strong
                  >{selectedSqliteName ??
                    'Previously selected SQLite file'}</strong
                >
                <small
                  >The full local path is kept behind the native boundary.</small
                >
              </div>
              <label class="check-row field-full">
                <input type="checkbox" bind:checked={profileForm.read_only} />
                <span
                  >Enforce read-only access in every native tab and metadata
                  session</span
                >
              </label>
            {:else}
              <label class="field">
                <span>Host</span>
                <input
                  required
                  maxlength="255"
                  autocomplete="off"
                  bind:value={profileForm.host}
                />
              </label>
              <label class="field">
                <span>Port</span>
                <input
                  required
                  type="number"
                  min="1"
                  max="65535"
                  bind:value={profileForm.port}
                />
              </label>
              <label class="field">
                <span>Username</span>
                <input
                  maxlength="255"
                  autocomplete="username"
                  bind:value={profileForm.username}
                />
              </label>
              <label class="field">
                <span>Default database (optional)</span>
                <input
                  maxlength="255"
                  autocomplete="off"
                  bind:value={profileForm.default_database}
                />
              </label>
              <label class="field field-full">
                <span>TLS mode</span>
                <select bind:value={profileForm.tls_mode}>
                  <option value="disabled"
                    >Unencrypted — trusted local development only</option
                  >
                  <option value="required"
                    >Require encryption without identity verification</option
                  >
                  <option value="verify_identity"
                    >System trust — verify certificate and identity</option
                  >
                  <option value="custom_ca"
                    >Custom CA — verify certificate and identity</option
                  >
                </select>
                <small>
                  Verified modes fail closed. QueryNot never silently downgrades
                  transport or identity verification.
                </small>
              </label>
              {#if profileForm.tls_mode === 'disabled'}
                <div class="inline-warning field-full" role="alert">
                  The database password, SQL, and returned data will cross the
                  network without TLS. Use only on an explicitly trusted local
                  development endpoint.
                </div>
              {:else if profileForm.tls_mode === 'required'}
                <div class="inline-warning field-full" role="alert">
                  Transport is encrypted, but the server certificate and host
                  identity are not verified.
                </div>
              {/if}
              {#if profileForm.tls_mode === 'custom_ca'}
                <div class="file-summary field-full">
                  <span>Trusted CA certificate</span>
                  <strong>{selectedTlsCaName ?? 'No CA selected'}</strong>
                  <small>
                    The native boundary retains the path as sensitive local-file
                    metadata; diagnostics omit it.
                  </small>
                  <div class="profile-actions">
                    <button
                      type="button"
                      onclick={() => void chooseTlsFile('pick_tls_ca_file')}
                      >Choose CA</button
                    >
                    {#if selectedTlsCaName}
                      <button type="button" onclick={clearTlsCa}>Remove</button>
                    {/if}
                  </div>
                </div>
              {/if}
              {#if profileForm.tls_mode === 'verify_identity' || profileForm.tls_mode === 'custom_ca'}
                <div class="file-summary field-full">
                  <span>Client certificate authentication (optional)</span>
                  <strong>
                    {selectedTlsClientCertificateName ?? 'No certificate'} · {selectedTlsClientKeyName ??
                      'no private key'}
                  </strong>
                  <small>
                    Certificate and PEM private-key contents remain native and
                    are never copied into profile JSON or diagnostics. Encrypted
                    PKCS#8 keys can be unlocked with the optional passphrase
                    below.
                  </small>
                  <div class="profile-actions">
                    <button
                      type="button"
                      onclick={() =>
                        void chooseTlsFile('pick_tls_client_certificate_file')}
                      >Choose certificate</button
                    >
                    <button
                      type="button"
                      onclick={() =>
                        void chooseTlsFile('pick_tls_client_key_file')}
                      >Choose private key</button
                    >
                    {#if selectedTlsClientCertificateName || selectedTlsClientKeyName}
                      <button type="button" onclick={clearTlsClientIdentity}
                        >Remove client identity</button
                      >
                    {/if}
                  </div>
                </div>
              {/if}
              <label class="field field-full">
                <span>Password (optional)</span>
                <input
                  type="password"
                  maxlength="16384"
                  autocomplete="new-password"
                  bind:value={profileForm.password}
                />
                <small>The field is cleared after every native response.</small>
              </label>
              {#if selectedTlsClientKeyName || profileForm.tls_client_key_grant_id}
                <label class="field field-full">
                  <span>Encrypted PKCS#8 client-key passphrase (optional)</span>
                  <input
                    type="password"
                    maxlength="16384"
                    autocomplete="new-password"
                    bind:value={profileForm.client_key_passphrase}
                  />
                  <small>
                    Used only in native memory to unlock an encrypted PKCS#8 PEM
                    key; decrypted key material is passed to TLS in memory and
                    is never written to QueryNot storage.
                  </small>
                </label>
              {/if}
              <fieldset class="field-full secret-choice">
                <legend>Credential handling</legend>
                <label>
                  <input
                    type="radio"
                    value="none"
                    bind:group={profileForm.secret_mode}
                  />
                  Do not submit a credential
                </label>
                <label>
                  <input
                    type="radio"
                    value="vault"
                    bind:group={profileForm.secret_mode}
                  />
                  Save through the operating-system vault
                </label>
                <label>
                  <input
                    type="radio"
                    value="session"
                    bind:group={profileForm.secret_mode}
                  />
                  Keep in native memory for this session only
                </label>
              </fieldset>
            {/if}

            <label class="field">
              <span>Connection timeout (seconds)</span>
              <input
                required
                type="number"
                min="5"
                max="120"
                bind:value={profileForm.connection_timeout_seconds}
              />
            </label>
            <label class="check-row align-end">
              <input
                type="checkbox"
                disabled={!editingProfileId ||
                  !profiles.find((p) => p.id === editingProfileId)
                    ?.has_saved_secret}
                bind:checked={profileForm.automatic_reconnect}
              />
              <span>Allow automatic reconnect with saved credential</span>
            </label>
          </div>

          {#if editingProfileId && profiles.find((p) => p.id === editingProfileId)?.has_saved_secret}
            <div class="inline-warning">
              <span>This profile has an OS-vault credential reference.</span>
              <button type="button" onclick={() => void removeSavedSecret()}
                >Remove saved secret</button
              >
            </div>
          {/if}

          <div class="modal-actions">
            <button type="button" class="quiet" onclick={closeModal}
              >Cancel</button
            >
            <button type="submit" class="primary" disabled={busy}>
              {editingProfileId ? 'Save profile' : 'Create profile'}
            </button>
          </div>
        </form>
      {:else if modal === 'delete-profile'}
        <div class="modal-header">
          <div>
            <p class="eyebrow">Recoverable two-step deletion</p>
            <h2 id="modal-title">Delete connection profile?</h2>
          </div>
          <button
            type="button"
            class="icon-button"
            aria-label="Close"
            onclick={closeModal}>×</button
          >
        </div>
        <p class="modal-copy">
          QueryNot will remove profile metadata, schema cache, and its vault
          item. It will never delete the selected user database file. A partial
          vault or store failure remains visible and retriable.
        </p>
        <div class="choice-panel">
          <label class="check-row">
            <input type="checkbox" bind:checked={deleteHistory} />
            <span>Also delete associated history</span>
          </label>
          <label class="check-row">
            <input type="checkbox" bind:checked={deleteDrafts} />
            <span>Also delete associated drafts</span>
          </label>
          <small>
            Retained history and query drafts are relabelled as deleted and
            cannot reconnect. Table-data tabs close because their row pages and
            staging are session-ephemeral.
          </small>
        </div>
        <div class="modal-actions">
          <button type="button" class="quiet" onclick={closeModal}
            >Cancel</button
          >
          <button
            type="button"
            class="danger"
            disabled={busy}
            onclick={() => void deleteProfile()}>Delete profile</button
          >
        </div>
      {:else if modal === 'settings'}
        <form onsubmit={persistSettings}>
          <div class="modal-header">
            <div>
              <p class="eyebrow">Local preferences</p>
              <h2 id="modal-title">Settings</h2>
            </div>
            <button
              type="button"
              class="icon-button"
              aria-label="Close"
              onclick={closeModal}>×</button
            >
          </div>
          <div class="settings-grid">
            <section>
              <h3>Appearance and editor</h3>
              <label class="field">
                <span>Theme</span>
                <select bind:value={settingsDraft.theme}>
                  <option value="system">System</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                  <option value="forest">Forest</option>
                </select>
              </label>
              <label class="field">
                <span>UI scale: {settingsDraft.ui_scale_percent}%</span>
                <input
                  type="range"
                  min="75"
                  max="200"
                  step="5"
                  bind:value={settingsDraft.ui_scale_percent}
                />
              </label>
              <label class="check-row">
                <input
                  type="checkbox"
                  bind:checked={settingsDraft.editor_word_wrap}
                />
                <span>Editor word wrap</span>
              </label>
              <label class="check-row">
                <input
                  type="checkbox"
                  bind:checked={settingsDraft.formatter_uppercase_keywords}
                />
                <span>Formatter uppercases keywords</span>
              </label>
              <label class="field">
                <span>Formatter indentation</span>
                <input
                  type="number"
                  min="1"
                  max="8"
                  bind:value={settingsDraft.formatter_indent_spaces}
                />
              </label>
            </section>

            <section>
              <h3>Query defaults</h3>
              <label class="field">
                <span>Connection timeout (seconds)</span>
                <input
                  type="number"
                  min="5"
                  max="120"
                  bind:value={settingsDraft.connection_timeout_seconds}
                />
              </label>
              <label class="field">
                <span>Result tranche rows</span>
                <input
                  type="number"
                  min="100"
                  max="50000"
                  bind:value={settingsDraft.result_tranche_rows}
                />
              </label>
              <label class="field">
                <span>Table page rows</span>
                <input
                  type="number"
                  min="25"
                  max="1000"
                  bind:value={settingsDraft.table_page_rows}
                />
              </label>
              <label class="check-row">
                <input
                  type="checkbox"
                  bind:checked={settingsDraft.session_restoration_enabled}
                />
                <span>Restore drafts and tabs offline</span>
              </label>
              <p class="settings-note">
                Restored SQL text can contain sensitive literals. Drafts are
                local and saved after one second of inactivity; staged table
                edits are excluded.
              </p>
              {#if clearDraftConfirmation}
                <div class="confirm-strip" role="alert">
                  <span
                    >Clear the saved recovery snapshot but keep current tabs
                    open?</span
                  >
                  <button
                    type="button"
                    onclick={() => (clearDraftConfirmation = false)}
                    >Keep</button
                  >
                  <button
                    type="button"
                    onclick={() => void clearSavedWorkspace()}>Clear</button
                  >
                </div>
              {:else}
                <button
                  type="button"
                  onclick={() => (clearDraftConfirmation = true)}
                >
                  Clear saved draft recovery…
                </button>
              {/if}
              <p class="settings-note">
                Automatic reconnect defaults off and requires a saved credential
                per profile.
              </p>
            </section>

            <section>
              <h3>History and local diagnostics</h3>
              <label class="check-row">
                <input
                  type="checkbox"
                  bind:checked={settingsDraft.history_enabled}
                />
                <span>Keep local query history</span>
              </label>
              <label class="field">
                <span>History retention (days)</span>
                <input
                  type="number"
                  min="1"
                  max="3650"
                  bind:value={settingsDraft.history_retention_days}
                />
              </label>
              <label class="check-row">
                <input
                  type="checkbox"
                  bind:checked={settingsDraft.operational_log_enabled}
                />
                <span>Keep redacted local operational log</span>
              </label>
              <label class="field">
                <span>Log retention (days)</span>
                <input
                  type="number"
                  min="1"
                  max="7"
                  bind:value={settingsDraft.operational_log_retention_days}
                />
              </label>
              <p class="settings-note">
                The log is capped at 5 MiB and never has a secret/value debug
                mode.
              </p>
              <div class="settings-buttons">
                <button type="button" onclick={() => void openDiagnostics()}
                  >Preview diagnostics</button
                >
                <button
                  type="button"
                  onclick={() => (clearLogConfirmation = true)}
                  >Clear local log</button
                >
              </div>
              {#if clearLogConfirmation}
                <div class="confirm-strip" role="alert">
                  <span>Clear the redacted local log?</span>
                  <button
                    type="button"
                    onclick={() => (clearLogConfirmation = false)}>Keep</button
                  >
                  <button
                    type="button"
                    onclick={() => void clearOperationalLog()}>Clear</button
                  >
                </div>
              {/if}
            </section>
          </div>

          <div class="settings-reset">
            {#if resetConfirmation}
              <div class="confirm-strip" role="alert">
                <span
                  >Reset settings only? Profiles, history, and drafts stay
                  intact.</span
                >
                <button
                  type="button"
                  onclick={() => (resetConfirmation = false)}>Cancel</button
                >
                <button type="button" onclick={() => void resetSettings()}
                  >Confirm reset</button
                >
              </div>
            {:else}
              <button
                type="button"
                class="quiet"
                onclick={() => (resetConfirmation = true)}
                >Reset settings…</button
              >
            {/if}
          </div>
          <div class="modal-actions">
            <button type="button" class="quiet" onclick={closeModal}
              >Cancel</button
            >
            <button type="submit" class="primary" disabled={busy}
              >Save settings</button
            >
          </div>
        </form>
      {:else if modal === 'file-review' && fileReview}
        <div class="modal-header">
          <div>
            <p class="eyebrow">External-change review</p>
            <h2 id="modal-title">Compare {fileReview.displayName}</h2>
          </div>
          <button
            type="button"
            class="icon-button"
            aria-label="Close"
            onclick={closeModal}>×</button
          >
        </div>
        <p class="modal-copy">
          The in-memory draft remains authoritative. QueryNot will not overwrite
          a file whose identity, timestamp, or size changed outside the app.
        </p>
        <div class="file-review-grid">
          <label>
            <span>In-memory draft</span>
            <textarea readonly spellcheck="false" value={fileReview.draft}
            ></textarea>
          </label>
          <label>
            <span>Current disk version</span>
            <textarea readonly spellcheck="false" value={fileReview.external}
            ></textarea>
          </label>
        </div>
        <div class="modal-actions">
          <button type="button" class="quiet" onclick={closeModal}
            >Keep draft</button
          >
          <button
            type="button"
            class="primary"
            onclick={() => {
              void closeModal().then(() => saveActiveSqlFile(true));
            }}>Save draft as…</button
          >
        </div>
      {:else if modal === 'diagnostics'}
        <div class="modal-header">
          <div>
            <p class="eyebrow">Preview before local export</p>
            <h2 id="modal-title">Redacted diagnostics</h2>
          </div>
          <button
            type="button"
            class="icon-button"
            aria-label="Close"
            onclick={closeModal}>×</button
          >
        </div>
        <p class="modal-copy">
          This bundle contains build/runtime identity, safe categories, and
          bounded lifecycle events. It excludes credentials, endpoints,
          database/object names, SQL, results, certificate/key paths, user file
          paths, and raw driver messages. QueryNot never uploads it.
        </p>
        {#if diagnostics}
          <dl class="diagnostics-summary">
            <div>
              <dt>Application</dt>
              <dd>{diagnostics.application_version}</dd>
            </div>
            <div>
              <dt>Contract</dt>
              <dd>{diagnostics.contract_version}</dd>
            </div>
            <div>
              <dt>Runtime</dt>
              <dd>
                {diagnostics.operating_system} / {diagnostics.runtime_architecture}
              </dd>
            </div>
            <div>
              <dt>Events</dt>
              <dd>{diagnostics.events.length}</dd>
            </div>
          </dl>
          <textarea
            class="event-preview"
            readonly
            aria-label="Redacted lifecycle events"
            value={diagnosticsText}></textarea>
        {/if}
        <div class="modal-actions">
          <button type="button" class="quiet" onclick={closeModal}
            >Cancel</button
          >
          <button
            type="button"
            class="primary"
            disabled={busy}
            onclick={() => void exportDiagnostics()}
            >Choose local export file…</button
          >
        </div>
      {:else if modal === 'destructive' && pendingExecution}
        <div class="modal-header">
          <div>
            <p class="eyebrow">Immutable execution confirmation</p>
            <h2 id="modal-title">Review destructive statement ranges</h2>
          </div>
          <button
            type="button"
            class="icon-button"
            aria-label="Cancel execution confirmation"
            onclick={closeModal}>×</button
          >
        </div>
        <p class="modal-copy">
          QueryNot flagged every range before running any statement. Approval is
          bound to this exact profile, dedicated session, database context, SQL
          text, ranges, and parser result. Editing, reconnecting, or changing
          context invalidates it. Cancel is the default.
        </p>
        <dl class="safety-context">
          <div>
            <dt>Connection</dt>
            <dd>{activeProfile?.name ?? 'Unavailable'}</dd>
          </div>
          <div>
            <dt>Database / schema</dt>
            <dd>
              {activeConnection?.context ??
                activeTab?.context_label ??
                'Unavailable'}
            </dd>
          </div>
        </dl>
        <ul class="safety-flags">
          {#each pendingExecution.response.safety_flags as flag (`${flag.statement_index}:${flag.start}:${flag.end}`)}
            <li>
              <strong>{flag.statement_type}</strong>
              <span>{flag.reason.replaceAll('_', ' ')}</span>
              <span>{flag.object_name ?? 'object uncertain'}</span>
              <code>bytes {flag.start}–{flag.end}</code>
              <pre><code
                  >{utf8Range(
                    pendingExecution.request.sql,
                    flag.start,
                    flag.end
                  )}</code
                ></pre>
            </li>
          {/each}
        </ul>
        <div class="modal-actions">
          <button
            type="button"
            class="primary"
            onclick={() => {
              pendingExecution = null;
              void closeModal();
              statusMessage =
                'Destructive execution was cancelled; no statement ran.';
            }}>Cancel</button
          >
          <button
            type="button"
            class="danger"
            disabled={busy}
            onclick={() => void approveDestructiveExecution()}
            >Run these exact ranges once</button
          >
        </div>
      {:else if modal === 'close-tab'}
        {@const closingExecution = closeTabId ? executions[closeTabId] : null}
        {@const closingSession = closeTabId ? sessions[closeTabId] : null}
        {@const closingTable = closeTabId ? tableTabs[closeTabId] : null}
        {@const closingTab = closeTabId
          ? workspace.tabs.find((tab) => tab.id === closeTabId)
          : null}
        <div class="modal-header">
          <div>
            <p class="eyebrow">Tab resource decision</p>
            <h2 id="modal-title">Close this tab?</h2>
          </div>
        </div>
        <p class="modal-copy">
          Closing applies to the draft and this tab’s dedicated native session.
          QueryNot never silently abandons a running job or open transaction and
          never writes through to an opened SQL source file.
        </p>
        <div class="modal-actions">
          <button type="button" class="quiet" onclick={closeModal}
            >Keep tab</button
          >
          {#if closingExecution && ['queued', 'running', 'paused', 'cancelling'].includes(closingExecution.state)}
            <button
              type="button"
              class="danger"
              onclick={() =>
                closeTabId && void cancelTabAndKeepOpen(closeTabId)}
              >Cancel query and keep tab</button
            >
          {:else if closingSession && closingSession.transaction.certainty !== 'clean'}
            {#if closingSession.transaction.certainty === 'active'}
              <button
                type="button"
                onclick={() =>
                  closeTabId &&
                  void resolveTabTransactionAndClose(closeTabId, 'commit')}
                >Commit and close</button
              >
            {/if}
            <button
              type="button"
              class="danger"
              onclick={() =>
                closeTabId &&
                void resolveTabTransactionAndClose(closeTabId, 'rollback')}
              >Rollback and close</button
            >
          {:else if closingTable?.staged.length}
            <button
              type="button"
              class="danger"
              onclick={() =>
                closeTabId && void discardTableAndClose(closeTabId)}
            >
              Discard staged changes and close
            </button>
          {:else if closingTab?.kind === 'query' && closingTab.dirty}
            <button
              type="button"
              onclick={() => closeTabId && void saveQueryAndClose(closeTabId)}
            >
              Save file and close
            </button>
            <button
              type="button"
              class="danger"
              onclick={() => closeTabId && void closeTab(closeTabId)}
            >
              Discard unsaved changes and close
            </button>
          {:else}
            <button
              type="button"
              class="danger"
              onclick={() => closeTabId && void closeTab(closeTabId)}
              >Discard draft and close</button
            >
          {/if}
        </div>
      {:else if modal === 'close-window'}
        <div class="modal-header">
          <div>
            <p class="eyebrow">Window close decision</p>
            <h2 id="modal-title">
              Resolve native work, preserve drafts, and close?
            </h2>
          </div>
        </div>
        <p class="modal-copy">
          QueryNot retains draft text, tab order, profile bindings, context, and
          panel sizes locally. It closes only clean tab sessions; running jobs
          and active or unknown transactions must be cancelled, committed, or
          rolled back first. Closing never executes SQL or writes through to SQL
          source files.
        </p>
        <div class="modal-actions">
          <button type="button" class="quiet" onclick={closeModal}
            >Keep window open</button
          >
          <button
            type="button"
            class="primary"
            disabled={busy}
            onclick={() => void preserveDraftsAndCloseWindow()}
            >Close without changing source files; preserve recovery drafts</button
          >
          {#if workspace.tabs.some((tab) => tab.kind === 'query' && tab.dirty && tab.source_file_grant_id)}
            <button
              type="button"
              disabled={busy}
              onclick={() => void saveChangedFilesAndCloseWindow()}
              >Save changed source files, preserve drafts, and close</button
            >
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/if}
