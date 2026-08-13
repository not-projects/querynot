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
    WorkspaceTabView,
    WorkspaceView
  } from './lib/generated/contracts';
  import ResultGrid from './lib/components/ResultGrid.svelte';
  import SqlEditor, {
    type EditorRunRequest,
    type SqlEditorApi
  } from './lib/components/SqlEditor.svelte';
  import { hasNativeRuntime, invokeCommand } from './lib/native';

  type ModalName =
    | 'profile'
    | 'delete-profile'
    | 'settings'
    | 'diagnostics'
    | 'close-tab'
    | 'close-window'
    | 'destructive'
    | null;

  type ExecutionUi = {
    id: string;
    tabId: string;
    state: string;
    startedAt: number;
    statementsCompleted: number;
    receivedRows: number;
    error: string | null;
  };

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

  type ProfileForm = ProfileInput & {
    password: string;
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
      schema[object.name] =
        selectedSchemaObject?.object.name === object.name
          ? selectedSchemaObject.columns.map((column) => column.name)
          : [];
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
      void getCurrentWindow()
        .onCloseRequested(async (event) => {
          if (
            workspace.tabs.some((tab) => tab.dirty) ||
            Object.keys(sessions).length > 0 ||
            Object.values(executions).some((execution) =>
              ['queued', 'running', 'paused', 'cancelling'].includes(
                execution.state
              )
            )
          ) {
            event.preventDefault();
            await openModal('close-window');
            statusMessage =
              'Window close paused so offline draft changes can be preserved.';
          } else {
            await saveWorkspaceNow();
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
      window.clearInterval(elapsedTimer);
      if (saveTimer) clearTimeout(saveTimer);
    };
  });

  async function bootstrap() {
    if (!hasNativeRuntime()) {
      applyBootstrap({
        contract_version: 1,
        phase: 'phase_3_mysql_family_parity',
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
    });
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
    if (modal === 'destructive') pendingExecution = null;
    modal = null;
    profileForm.password = '';
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
    await runAction(async () => {
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
      secret_mode: 'none'
    };
    void openModal('profile');
  }

  async function submitProfile(event: SubmitEvent) {
    event.preventDefault();
    if (!hasNativeRuntime()) {
      statusMessage =
        'Profile persistence is available in the desktop runtime.';
      await closeModal();
      return;
    }
    await runAction(async () => {
      const password = profileForm.password;
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
      if (password && secretMode !== 'none') {
        profileForm.password = '';
        const secretResult = await invokeCommand('save_profile_secret', {
          profile_id: saved.id,
          secret: password,
          session_only: secretMode === 'session'
        });
        message = secretResult.message;
        if (secretResult.saved) {
          profiles[index >= 0 ? index : profiles.length - 1].has_saved_secret =
            true;
        }
      }
      statusMessage = `${message} No connection was started.`;
      await closeModal();
    });
    profileForm.password = '';
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
          for (const tab of workspace.tabs) {
            if (tab.profile_id === profileId) {
              tab.profile_id = null;
              tab.profile_label = `Deleted profile: ${deletedProfile?.name ?? 'Unknown'}`;
              tab.reconnectable = false;
            }
          }
        }
        selectedSchemaObject = null;
        await closeModal();
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
      workspace.tabs.push(tab);
      workspace.active_tab_id = tab.id;
      if (profileId && connections[profileId]) {
        sessions[tab.id] = await invokeCommand('open_tab_session', {
          profile_id: profileId,
          tab_id: tab.id
        });
        tab.context_label = connections[profileId].context;
        statusMessage =
          'Opened a query tab with its own dedicated native database session.';
      } else {
        statusMessage = profileId
          ? 'Opened a profile-bound offline draft. Connect the profile to create a dedicated session.'
          : 'Opened an offline draft.';
      }
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
      if (!picked.tab_id) throw new Error('Native tab allocation failed.');
      const tab: WorkspaceTabView = {
        id: picked.tab_id,
        title: picked.display_name ?? 'Offline SQL file',
        profile_id: null,
        profile_label: null,
        context_label: null,
        sql: picked.content ?? '',
        dirty: false,
        position: workspace.tabs.length,
        source_file_grant_id: picked.file_grant_id,
        reconnectable: false
      };
      workspace.tabs.push(tab);
      workspace.active_tab_id = tab.id;
      statusMessage = `${tab.title} opened offline without execution.`;
      await saveWorkspaceNow();
    });
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
      activeTab.context_label = connection.context;
      statusMessage = `${activeTab.title} is online with a dedicated ${connection.engine} ${connection.exact_version} session.`;
    });
  }

  async function disconnectActiveTab() {
    if (!activeTab || !activeSession || !hasNativeRuntime()) return;
    await runAction(async () => {
      const result = await invokeCommand('close_tab_session', {
        profile_id: activeSession.profile_id,
        tab_id: activeSession.tab_id,
        session_id: activeSession.session_id
      });
      delete sessions[activeTab.id];
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
    await runAction(async () => {
      selectedSchemaObject = await invokeCommand('load_schema_object_detail', {
        profile_id: activeProfile.id,
        namespace: object.namespace,
        object_name: object.name
      });
      statusMessage = `${selectedSchemaObject.stale ? 'Showing stale cached metadata' : 'Loaded metadata'} for ${object.namespace}.${object.name}; database-provided text is rendered as plain text.`;
    });
  }

  function refreshSelectedSchemaObject() {
    if (selectedSchemaObject) {
      void inspectSchemaObject(selectedSchemaObject.object);
    }
  }

  async function copyQualifiedName(object: SchemaObjectView) {
    const quote = activeConnection?.dialect === 'mysql' ? '`' : '"';
    const escapedNamespace = object.namespace.replaceAll(quote, quote + quote);
    const escapedName = object.name.replaceAll(quote, quote + quote);
    const qualified = `${quote}${escapedNamespace}${quote}.${quote}${escapedName}${quote}`;
    await navigator.clipboard?.writeText(qualified);
    statusMessage = `Copied the qualified ${activeConnection?.engine ?? 'database'} name for ${object.name}.`;
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
    activeExecution.state = 'cancelling';
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
        execution.state = 'failed';
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
      execution.state = 'running';
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
      execution.state = 'paused';
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
      execution.state = 'succeeded';
      execution.statementsCompleted = event.statements_completed ?? 0;
      execution.receivedRows = event.received_rows;
      if (event.transaction && sessions[event.tab_id]) {
        sessions[event.tab_id].transaction = event.transaction;
      }
      statusMessage = `Execution succeeded: ${execution.statementsCompleted} statement(s), ${execution.receivedRows} received row(s).`;
    } else if (event.event_type === 'failed') {
      execution.state = 'failed';
      execution.error = event.error;
      if (event.transaction && sessions[event.tab_id]) {
        sessions[event.tab_id].transaction = event.transaction;
      }
      const range =
        event.statement_start !== null && event.statement_end !== null
          ? ` at bytes ${event.statement_start}–${event.statement_end}`
          : '';
      statusMessage = `${event.error ?? 'Database execution failed safely.'}${range}${event.retryable ? ' Retry is available after resolving the cause.' : ''}`;
    } else if (event.event_type === 'cancelled') {
      execution.state = event.cancel_confirmed ? 'cancelled' : 'cancelling';
      if (event.transaction && sessions[event.tab_id]) {
        sessions[event.tab_id].transaction = event.transaction;
      }
      statusMessage = event.cancel_confirmed
        ? 'The database confirmed cancellation; the dedicated session remains available.'
        : 'Cancellation was requested but server confirmation is still pending.';
    } else if (event.event_type === 'started') {
      execution.state = 'running';
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
    await runAction(async () => {
      activeSession.transaction = await invokeCommand('set_transaction_mode', {
        profile_id: activeSession.profile_id,
        tab_id: activeSession.tab_id,
        session_id: activeSession.session_id,
        automatic
      });
      statusMessage = automatic
        ? 'Auto-commit mode is active.'
        : 'Manual mode is active; transaction state remains adapter-authoritative.';
    });
  }

  async function resolveTransaction(action: 'commit' | 'rollback') {
    if (!activeSession || !hasNativeRuntime()) return;
    await runAction(async () => {
      activeSession.transaction = await invokeCommand(
        action === 'commit' ? 'commit_transaction' : 'rollback_transaction',
        {
          profile_id: activeSession.profile_id,
          tab_id: activeSession.tab_id,
          session_id: activeSession.session_id
        }
      );
      statusMessage = `${action === 'commit' ? 'Committed' : 'Rolled back'} the tab transaction; manual mode remains active.`;
    });
  }

  function queueWorkspaceSave() {
    if (!hasNativeRuntime() || !settings.session_restoration_enabled) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void saveWorkspaceNow();
    }, 1_000);
  }

  async function saveWorkspaceNow() {
    if (!hasNativeRuntime()) return;
    workspace.tabs.forEach((tab, index) => {
      tab.position = index;
    });
    const result = await invokeCommand(
      'save_workspace',
      structuredClone($state.snapshot(workspace))
    );
    if (!result.saved) statusMessage = result.message;
  }

  function requestCloseTab(tab: WorkspaceTabView) {
    if (tab.dirty || sessions[tab.id] || executions[tab.id]) {
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
      await saveWorkspaceNow();
      statusMessage =
        'Tab and its native database resources were closed explicitly.';
      await closeModal();
    });
  }

  async function cancelTabAndKeepOpen(tabId: string) {
    const execution = executions[tabId];
    if (!execution || !hasNativeRuntime()) return;
    const response = await invokeCommand('cancel_execution', {
      execution_id: execution.id
    });
    execution.state = 'cancelling';
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
      statusMessage = safeErrorMessage(error);
    }
  }

  async function preserveDraftsAndCloseWindow() {
    if (!hasNativeRuntime()) return;
    await runAction(async () => {
      const activeJob = Object.values(executions).find((execution) =>
        ['queued', 'running', 'paused', 'cancelling'].includes(execution.state)
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
      for (const session of Object.values(sessions)) {
        await invokeCommand('close_tab_session', {
          profile_id: session.profile_id,
          tab_id: session.tab_id,
          session_id: session.session_id
        });
      }
      await saveWorkspaceNow();
      await getCurrentWindow().destroy();
    });
  }

  function openSettings() {
    settingsDraft = structuredClone($state.snapshot(settings));
    void openModal('settings');
  }

  async function persistSettings(event: SubmitEvent) {
    event.preventDefault();
    if (!hasNativeRuntime()) {
      settings = structuredClone($state.snapshot(settingsDraft));
      statusMessage = 'Theme preview applied for this desktop preview.';
      await closeModal();
      return;
    }
    await runAction(async () => {
      settings = await invokeCommand(
        'save_settings',
        structuredClone($state.snapshot(settingsDraft))
      );
      statusMessage = 'Settings saved and safe immediate changes were applied.';
      await closeModal();
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
      if (result.completed) await closeModal();
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
      void saveWorkspaceNow();
      statusMessage =
        'Draft saved locally. QueryNot did not overwrite an opened SQL source file.';
    } else if (event.ctrlKey && event.key === 'Tab' && workspace.tabs.length) {
      event.preventDefault();
      const current = workspace.tabs.findIndex(
        (tab) => tab.id === workspace.active_tab_id
      );
      const direction = event.shiftKey ? -1 : 1;
      const next =
        (current + direction + workspace.tabs.length) % workspace.tabs.length;
      workspace.active_tab_id = workspace.tabs[next].id;
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
  style:font-size={`${displayedSettings.ui_scale_percent}%`}
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
                    onclick={() => void toggleNamespace(namespace.name)}
                  >
                    <span aria-hidden="true"
                      >{expandedNamespaces[
                        `${activeProfile.id}:${namespace.name}`
                      ]
                        ? '▾'
                        : '▸'}</span
                    >
                    {namespace.name}
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
                            <span title={object.name}>{object.name}</span>
                          </button>
                          <button
                            type="button"
                            class="schema-copy"
                            aria-label={`Copy qualified name for ${object.name}`}
                            onclick={() => void copyQualifiedName(object)}
                            >Copy</button
                          >
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
                        : ''}</span
                    >
                  </li>
                {/each}
              </ul>
              <p>
                {selectedSchemaObject.indexes.length} indexes · {selectedSchemaObject
                  .foreign_keys.length} foreign keys · {selectedSchemaObject.routines_supported
                  ? 'routines supported'
                  : 'routines unavailable'}
              </p>
            </details>
          {/if}
        </section>
      {/if}
    </aside>

    <main>
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
        <span
          >{activeTab?.context_label ??
            activeConnection?.context ??
            'No database selected'}</span
        >
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
                {#if tab.dirty}<span aria-label="Unsaved draft">●</span>{/if}
              </button>
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
            <span>{activeTab?.dirty ? 'Draft changed' : 'Draft saved'}</span>
            <span>{activeTab?.profile_label ?? 'Unbound offline file'}</span>
            <span>
              {activeExecution
                ? `${activeExecution.state} · ${activeExecution.statementsCompleted} statements · ${activeExecution.receivedRows} rows · ${Math.max(0, nowMs - activeExecution.startedAt)} ms`
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
              <span class="safety-label">No hidden fetch or re-execution</span>
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
              CSV preserves raw values, including spreadsheet-formula prefixes.
              Opening a CSV in spreadsheet software may evaluate formulas. NULL
              exports as <code>\N</code> by default; binary values use hexadecimal
              in CSV and tagged base64 in JSON.
            </p>
          </section>
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
      >Mod+Enter Run · Mod+Shift+Enter Run all · Mod+. Cancel · Mod+1/2/3 Focus
      · Shift+Alt+F Format</span
    >
  </footer>
</div>

{#if modal}
  <div class="modal-backdrop">
    <div
      class="modal-card"
      class:modal-wide={modal === 'settings'}
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
                    Certificate and unencrypted PEM private-key contents remain
                    native and are never copied into profile JSON or
                    diagnostics.
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
            Retained history and drafts are relabelled as deleted and cannot
            reconnect.
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
                  <option value="system">Follow operating system</option>
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
            >Close clean sessions, preserve drafts, and close</button
          >
        </div>
      {/if}
    </div>
  </div>
{/if}
