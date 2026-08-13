<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { Attachment } from 'svelte/attachments';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import type { UnlistenFn } from '@tauri-apps/api/event';

  import type {
    BootstrapWorkspaceResponse,
    DiagnosticsPreviewView,
    ProfileInput,
    ProfileView,
    SettingsView,
    WorkspaceTabView,
    WorkspaceView
  } from './lib/generated/contracts';
  import { hasNativeRuntime, invokeCommand } from './lib/native';

  type ModalName =
    | 'profile'
    | 'delete-profile'
    | 'settings'
    | 'diagnostics'
    | 'close-tab'
    | 'close-window'
    | null;

  type ProfileForm = ProfileInput & {
    password: string;
    secret_mode: 'none' | 'vault' | 'session';
  };

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
  let busy = $state(false);
  let modal = $state<ModalName>(null);
  let profileForm = $state<ProfileForm>(defaultProfileForm());
  let editingProfileId = $state<string | null>(null);
  let selectedSqliteName = $state<string | null>(null);
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

  const activeTab = $derived(
    workspace.tabs.find((tab) => tab.id === workspace.active_tab_id) ?? null
  );
  const activeProfile = $derived(
    profiles.find((profile) => profile.id === activeTab?.profile_id) ?? null
  );
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
    if (hasNativeRuntime()) {
      void getCurrentWindow()
        .onCloseRequested(async (event) => {
          if (workspace.tabs.some((tab) => tab.dirty)) {
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
      if (saveTimer) clearTimeout(saveTimer);
    };
  });

  async function bootstrap() {
    if (!hasNativeRuntime()) {
      applyBootstrap({
        contract_version: 1,
        phase: 'phase_1_secure_local_foundation',
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
    if (error && typeof error === 'object' && 'safe_message' in error) {
      const safeMessage = (error as { safe_message?: unknown }).safe_message;
      if (typeof safeMessage === 'string') return safeMessage;
    }
    return 'The operation did not complete. Existing local data was preserved.';
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

  function editProfile(profile: ProfileView) {
    editingProfileId = profile.id;
    selectedSqliteName = profile.file_name;
    profileForm = {
      name: profile.name,
      kind: profile.kind,
      file_grant_id: null,
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
    await runAction(async () => {
      const result = await invokeCommand('delete_profile', {
        profile_id: deleteProfileId!,
        delete_history: deleteHistory,
        delete_drafts: deleteDrafts,
        confirmed: true
      });
      statusMessage = result.message;
      if (result.status === 'deleted') {
        profiles = profiles.filter((profile) => profile.id !== deleteProfileId);
        const refreshed = await invokeCommand('bootstrap_workspace', null);
        workspace = refreshed.workspace;
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
      statusMessage = profileId
        ? 'Opened a profile-bound offline draft. No connection was started.'
        : 'Opened an offline draft.';
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

  function handleEditorInput(event: Event) {
    if (!activeTab) return;
    activeTab.sql = (event.currentTarget as HTMLTextAreaElement).value;
    activeTab.dirty = true;
    queueWorkspaceSave();
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
    if (tab.dirty) {
      closeTabId = tab.id;
      void openModal('close-tab');
    } else {
      void closeTab(tab.id);
    }
  }

  async function closeTab(tabId: string) {
    if (!hasNativeRuntime()) return;
    await runAction(async () => {
      await invokeCommand('close_offline_tab', { tab_id: tabId });
      const index = workspace.tabs.findIndex((tab) => tab.id === tabId);
      workspace.tabs.splice(index, 1);
      if (workspace.active_tab_id === tabId) {
        workspace.active_tab_id =
          workspace.tabs[Math.min(index, workspace.tabs.length - 1)]?.id ??
          null;
      }
      await saveWorkspaceNow();
      statusMessage = 'Offline tab closed. No SQL was executed.';
      await closeModal();
    });
  }

  async function preserveDraftsAndCloseWindow() {
    if (!hasNativeRuntime()) return;
    await runAction(async () => {
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
      document.getElementById('sql-editor')?.focus();
    } else if ((event.metaKey || event.ctrlKey) && event.key === ',') {
      event.preventDefault();
      openSettings();
    } else if (
      (event.metaKey || event.ctrlKey) &&
      event.key.toLowerCase() === 'n'
    ) {
      event.preventDefault();
      void createOfflineTab(activeProfile?.id ?? null);
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
      <span class="phase-badge">Secure local foundation</span>
    </div>
    <div class="topbar-actions">
      <span class="offline-badge">Offline</span>
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
                aria-label={`Open offline query for ${profile.name}`}
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
                <span class="status-dot" title="Offline" aria-label="Offline"
                ></span>
              </button>
              <div class="profile-actions">
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
        <button type="button" onclick={() => void openSqlFile()}
          >Open SQL file offline</button
        >
      </div>
      <p class="sidebar-note">
        Profiles and drafts stay on this device. Credentials use the OS vault or
        native session memory.
      </p>
    </aside>

    <main>
      <div class="context-bar" aria-label="Active query context">
        <span class="context-state">Offline</span>
        <span>{activeTab?.profile_label ?? 'No profile'}</span>
        <span>{activeTab?.context_label ?? 'No database selected'}</span>
        <span>Transaction unavailable</span>
        <span>Idle</span>
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
              >Editing only · execution unavailable</span
            >
          </div>
          <textarea
            id="sql-editor"
            aria-label="SQL editor"
            spellcheck="false"
            wrap={displayedSettings.editor_word_wrap ? 'soft' : 'off'}
            value={activeTab?.sql ?? ''}
            oninput={handleEditorInput}></textarea>
          <div class="editor-status">
            <span>{activeTab?.dirty ? 'Draft changed' : 'Draft saved'}</span>
            <span>{activeTab?.profile_label ?? 'Unbound offline file'}</span>
            <span>No statement can execute in Phase 1</span>
          </div>
        </section>
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
    <span>Ctrl/⌘ 1 Connections · 2 Editor · N New draft · , Settings</span>
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
                  >Open read-only when connection support becomes available</span
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
                  <option value="verify_identity"
                    >Verify certificate and server identity</option
                  >
                  <option value="required">Require encrypted transport</option>
                </select>
                <small>Certificate verification cannot be disabled.</small>
              </label>
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
      {:else if modal === 'close-tab'}
        <div class="modal-header">
          <div>
            <p class="eyebrow">Unsaved draft</p>
            <h2 id="modal-title">Close this tab?</h2>
          </div>
        </div>
        <p class="modal-copy">
          This tab has draft changes. Closing it removes the restored draft; it
          never writes through to an opened SQL source file.
        </p>
        <div class="modal-actions">
          <button type="button" class="quiet" onclick={closeModal}
            >Keep tab</button
          >
          <button
            type="button"
            class="danger"
            onclick={() => closeTabId && void closeTab(closeTabId)}
            >Discard draft and close</button
          >
        </div>
      {:else if modal === 'close-window'}
        <div class="modal-header">
          <div>
            <p class="eyebrow">Window close decision</p>
            <h2 id="modal-title">Preserve offline drafts and close?</h2>
          </div>
        </div>
        <p class="modal-copy">
          QueryNot will retain draft text, tab order, profile bindings, context,
          and panel sizes locally, then close without reconnecting, executing,
          or writing through to SQL source files.
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
            >Preserve drafts and close</button
          >
        </div>
      {/if}
    </div>
  </div>
{/if}
