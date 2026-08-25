// @vitest-environment jsdom

import { emit } from '@tauri-apps/api/event';
import { clearMocks, mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';

import App from './App.svelte';

let mounted: ReturnType<typeof mount> | null = null;

afterEach(async () => {
  if (mounted) await unmount(mounted);
  mounted = null;
  clearMocks();
  document.body.innerHTML = '';
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function profile(id: string, name: string) {
  return {
    id,
    name,
    kind: 'sqlite',
    file_name: `${name.toLowerCase()}.sqlite`,
    tls_ca_file_name: null,
    tls_client_certificate_file_name: null,
    tls_client_key_file_name: null,
    read_only: false,
    host: null,
    port: null,
    default_database: 'main',
    username: null,
    tls_mode: null,
    has_saved_secret: false,
    connection_timeout_seconds: 15,
    automatic_reconnect: false
  };
}

function tab(
  id: string,
  title: string,
  profileId: string | null,
  position: number
) {
  return {
    id,
    title,
    kind: 'query',
    pinned: false,
    profile_id: profileId,
    profile_label: profileId ? 'Primary' : null,
    context_label: profileId ? 'main' : null,
    sql: '',
    dirty: false,
    position,
    source_file_grant_id: null,
    table_namespace: null,
    table_name: null,
    reconnectable: Boolean(profileId)
  };
}

function defaultSettings() {
  return {
    theme: 'system',
    ui_scale_percent: 100,
    editor_word_wrap: false,
    formatter_uppercase_keywords: true,
    formatter_indent_spaces: 2,
    connection_timeout_seconds: 15,
    result_tranche_rows: 10_000,
    table_page_rows: 200,
    table_font_family: 'monospace',
    table_font_size_px: 13,
    history_enabled: true,
    history_retention_days: 90,
    session_restoration_enabled: true,
    automatic_reconnect_default: false,
    operational_log_enabled: true,
    operational_log_max_bytes: 5 * 1024 * 1024,
    operational_log_retention_days: 7
  };
}

function connection(profileId: string) {
  return {
    profile_id: profileId,
    profile_name: profileId === 'profile-1' ? 'Primary' : 'Empty',
    engine: 'SQLite',
    exact_version: '3.46.0',
    dialect: 'sqlite',
    context: 'main',
    read_only: false,
    compatibility_status: 'supported',
    compatibility_warning: null,
    legacy: false,
    capabilities: {
      metadata: true,
      streaming: true,
      cancellation: true,
      transactions: true,
      multiple_results: true,
      safe_table_mutations: true
    }
  };
}

function session(profileId: string, tabId: string) {
  return {
    profile_id: profileId,
    tab_id: tabId,
    session_id: `session-${tabId}`,
    state: 'connected',
    context: 'main',
    transaction: { automatic: true, certainty: 'clean' }
  };
}

function setupNativeWorkspace() {
  const commands: Array<{ command: string; request: Record<string, unknown> }> =
    [];
  const pendingSecond = deferred<ReturnType<typeof session>>();
  let failThird = true;
  let created = 0;
  mockWindows('main');
  mockIPC(
    (command, payload) => {
      const request = ((payload as { request?: unknown } | undefined)
        ?.request ?? {}) as Record<string, unknown>;
      commands.push({ command, request });
      switch (command) {
        case 'bootstrap_workspace':
          return {
            contract_version: 1,
            phase: 'phase_4_productivity_and_safe_data_editing',
            store_state: 'ready',
            store_message: null,
            profiles: [
              profile('profile-1', 'Primary'),
              profile('profile-2', 'Empty')
            ],
            settings: defaultSettings(),
            workspace: {
              tabs: [
                tab('query-1', 'Primary query 1', 'profile-1', 0),
                tab('query-2', 'Primary query 2', 'profile-1', 1),
                tab('query-3', 'Primary query 3', 'profile-1', 2),
                tab('offline-1', 'Offline draft', null, 3)
              ],
              active_tab_id: 'offline-1',
              panel_sizes: {
                explorer_percent: 22,
                results_percent: 35,
                sidebar_connections_percent: 50
              }
            }
          };
        case 'take_pending_sql_files':
          return { files: [] };
        case 'check_for_updates':
          return { configured: false, update: null };
        case 'save_workspace':
          return { saved: true, message: 'Saved in memory.' };
        case 'connect_profile':
          return connection(String(request.profile_id));
        case 'load_schema_namespaces':
          return {
            profile_id: String(request.profile_id),
            namespaces: [{ name: 'main', state: 'loaded' }],
            stale: false
          };
        case 'open_tab_session': {
          const profileId = String(request.profile_id);
          const tabId = String(request.tab_id);
          if (tabId === 'query-2') return pendingSecond.promise;
          if (tabId === 'query-3' && failThird) {
            failThird = false;
            throw new Error('Synthetic session-open failure');
          }
          return session(profileId, tabId);
        }
        case 'create_offline_tab': {
          created += 1;
          const profileId = (request.profile_id as string | null) ?? null;
          return tab(
            `created-${created}`,
            `Query ${created}`,
            profileId,
            4 + created
          );
        }
        case 'close_tab_session':
          return {
            completed: true,
            cancelled: false,
            message: 'Session closed.'
          };
        case 'disconnect_profile':
          return {
            completed: true,
            cancelled: false,
            message: 'Profile disconnected.'
          };
        default:
          return null;
      }
    },
    { shouldMockEvents: true }
  );
  return { commands, pendingSecond };
}

async function renderNativeWorkbench() {
  mounted = mount(App, { target: document.body });
  await waitFor(
    () =>
      document.querySelector('[data-profile-id="profile-1"]') !== null &&
      document.querySelector('[title="Offline draft"]') !== null
  );
}

async function waitFor(predicate: () => boolean, timeout = 2_000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeout)
      throw new Error('Timed out waiting for workbench state');
    await new Promise((resolve) => setTimeout(resolve, 5));
    flushSync();
  }
  flushSync();
}

function click(selector: string) {
  const element = document.querySelector<HTMLButtonElement>(selector);
  if (!element) throw new Error(`Missing button ${selector}`);
  element.click();
  flushSync();
}

function tabButton(title: string) {
  const titleElement = document.querySelector(`[title="${title}"]`);
  const button = titleElement?.closest('button');
  if (!(button instanceof HTMLButtonElement))
    throw new Error(`Missing tab ${title}`);
  return button;
}

function commandCount(
  commands: Array<{ command: string; request: Record<string, unknown> }>,
  command: string,
  tabId?: string
) {
  return commands.filter(
    (entry) =>
      entry.command === command && (!tabId || entry.request.tab_id === tabId)
  ).length;
}

describe('Connection-scoped workbench tabs', () => {
  it('uses a centered keyboard-resizable sidebar split and hides schema search until requested', async () => {
    const { commands } = setupNativeWorkspace();
    await renderNativeWorkbench();
    expect(document.body.textContent).not.toContain(
      'SQL files and detached drafts'
    );

    click('[data-profile-id="profile-1"] .connection-main');
    click('[data-profile-id="profile-1"] .connection-action');
    await waitFor(() => document.querySelector('.schema-tree') !== null);

    const separator = document.querySelector<HTMLElement>('.sidebar-separator');
    expect(separator?.getAttribute('aria-valuenow')).toBe('50');
    expect(document.querySelector('.schema-filter')).toBeNull();
    expect(document.body.textContent).not.toContain('Metadata is current.');

    click('[aria-label="Search schema objects"]');
    expect(document.querySelector('.schema-filter input')).not.toBeNull();
    click('[aria-label="Close schema search"]');
    expect(document.querySelector('.schema-filter')).toBeNull();

    separator?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'End', bubbles: true })
    );
    flushSync();
    expect(separator?.getAttribute('aria-valuenow')).toBe('80');
    await waitFor(() => commandCount(commands, 'save_workspace') > 0);
  });

  it('remembers the last tab per connection and cycles only visible tabs', async () => {
    setupNativeWorkspace();
    await renderNativeWorkbench();

    click('[data-profile-id="profile-1"] .connection-main');
    tabButton('Primary query 2').click();
    flushSync();
    click('[data-profile-id="offline"] .connection-main');
    expect(tabButton('Offline draft').getAttribute('aria-selected')).toBe(
      'true'
    );

    click('[data-profile-id="profile-1"] .connection-main');
    await waitFor(
      () =>
        tabButton('Primary query 2').getAttribute('aria-selected') === 'true'
    );
    expect(document.querySelector('[title="Offline draft"]')).toBeNull();

    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        ctrlKey: true,
        bubbles: true
      })
    );
    await waitFor(
      () =>
        tabButton('Primary query 3').getAttribute('aria-selected') === 'true'
    );
    expect(document.querySelector('[title="Offline draft"]')).toBeNull();
  });

  it('shows only the selected connection group in the top strip, then lazily opens only its selected child', async () => {
    const { commands } = setupNativeWorkspace();
    await renderNativeWorkbench();

    expect(
      document.querySelector('[aria-label="Offline tabs"]')?.textContent
    ).toContain('Offline draft');
    expect(document.querySelector('[title="Primary query 1"]')).toBeNull();
    expect(
      document.querySelector('[data-profile-id="profile-1"]')
    ).not.toBeNull();

    click('[data-profile-id="profile-1"] .connection-main');
    await waitFor(
      () =>
        tabButton('Primary query 1').getAttribute('aria-selected') === 'true'
    );
    expect(document.querySelector('[title="Offline draft"]')).toBeNull();
    expect(commandCount(commands, 'open_tab_session')).toBe(0);

    click('[data-profile-id="profile-1"] .connection-action');
    await waitFor(
      () => commandCount(commands, 'open_tab_session', 'query-1') === 1
    );
    await waitFor(
      () => document.querySelector('.context-state.online') !== null
    );
    expect(document.querySelector('.tab-session')).toBeNull();
    expect(commandCount(commands, 'open_tab_session', 'query-2')).toBe(0);
    expect(commandCount(commands, 'open_tab_session', 'query-3')).toBe(0);
  });

  it('deduplicates rapid opens, blocks disconnect and window close while pending, and retries a failed child without dropping the profile', async () => {
    const { commands, pendingSecond } = setupNativeWorkspace();
    await renderNativeWorkbench();
    click('[data-profile-id="profile-1"] .connection-main');
    click('[data-profile-id="profile-1"] .connection-action');
    await waitFor(
      () => commandCount(commands, 'open_tab_session', 'query-1') === 1
    );

    tabButton('Primary query 2').click();
    tabButton('Primary query 2').click();
    flushSync();
    await waitFor(
      () => commandCount(commands, 'open_tab_session', 'query-2') === 1
    );

    click('[data-profile-id="profile-1"] .connection-action');
    expect(document.body.textContent).toContain(
      'Wait for this tab’s dedicated session to finish opening'
    );
    expect(commandCount(commands, 'disconnect_profile')).toBe(0);

    await emit('tauri://close-requested');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(commandCount(commands, 'plugin:window|destroy')).toBe(0);

    pendingSecond.resolve(session('profile-1', 'query-2'));
    await waitFor(
      () =>
        document.querySelector('.context-state.online')?.textContent?.trim() ===
        'Connected'
    );

    tabButton('Primary query 3').click();
    await waitFor(
      () =>
        document
          .querySelector('.tab-session-error button')
          ?.textContent?.trim() === 'Retry'
    );
    click('.tab-session-error button');
    await waitFor(
      () => commandCount(commands, 'open_tab_session', 'query-3') === 2
    );
    await waitFor(() => document.querySelector('.tab-session-error') === null);
    expect(
      document
        .querySelector('[data-profile-id="profile-1"] .connection-action')
        ?.textContent?.trim()
    ).toBe('Disconnect');
  });

  it('creates a child only for an empty selected group and opens new children immediately under an established connection', async () => {
    const { commands } = setupNativeWorkspace();
    await renderNativeWorkbench();
    click('[data-profile-id="profile-1"] .connection-main');
    click('[data-profile-id="profile-1"] .connection-action');
    await waitFor(
      () => commandCount(commands, 'open_tab_session', 'query-1') === 1
    );

    click('[aria-label="New query in Primary"]');
    await waitFor(
      () => commandCount(commands, 'open_tab_session', 'created-1') === 1
    );

    click('[data-profile-id="profile-2"] .connection-main');
    await waitFor(() => document.querySelector('[title="Query 2"]') !== null);
    expect(commandCount(commands, 'open_tab_session', 'created-2')).toBe(0);
  });
});
