import { emit } from '@tauri-apps/api/event';
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { mount } from 'svelte';

import App from '../../src/App.svelte';
import '../../src/styles/app.css';

const settings = {
  theme: 'dark',
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
};

const profiles = [
  {
    id: 'emissary',
    name: 'Emissary',
    kind: 'sqlite',
    file_name: 'galactic_archive.sqlite',
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
  },
  {
    id: 'long-profile',
    name: 'Long reporting warehouse connection',
    kind: 'mysql_family',
    file_name: null,
    tls_ca_file_name: null,
    tls_client_certificate_file_name: null,
    tls_client_key_file_name: null,
    read_only: false,
    host: 'reporting.internal.example',
    port: 3306,
    default_database: 'analytics',
    username: 'fixture',
    tls_mode: 'verify_identity',
    has_saved_secret: false,
    connection_timeout_seconds: 15,
    automatic_reconnect: false
  }
];

const tabs = [
  queryTab('fractions-query', 'fractions query', 'emissary', 'Emissary', 0),
  queryTab('armors-query', 'armors query', 'emissary', 'Emissary', 1),
  queryTab('report-query', 'report query', 'long-profile', 'Reporting', 2),
  queryTab('offline-query', 'offline notes', null, null, 3)
];

function queryTab(id, title, profileId, profileLabel, position) {
  return {
    id,
    title,
    kind: 'query',
    pinned: false,
    profile_id: profileId,
    profile_label: profileLabel,
    context_label: profileId ? 'main' : null,
    sql:
      profileId === 'emissary'
        ? 'SELECT * FROM "main"."fractions" LIMIT 100;'
        : '',
    dirty: false,
    position,
    source_file_grant_id: null,
    table_namespace: null,
    table_name: null,
    reconnectable: Boolean(profileId)
  };
}

function connection(profileId) {
  return {
    profile_id: profileId,
    profile_name: profileId === 'emissary' ? 'Emissary' : 'Reporting',
    engine: profileId === 'emissary' ? 'SQLite' : 'MySQL',
    exact_version: profileId === 'emissary' ? '3.51.3' : '8.4.10',
    dialect: profileId === 'emissary' ? 'sqlite' : 'mysql',
    context: profileId === 'emissary' ? 'main' : 'analytics',
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

function session(profileId, tabId) {
  return {
    profile_id: profileId,
    tab_id: tabId,
    session_id: `session-${tabId}`,
    state: 'connected',
    context: profileId === 'emissary' ? 'main' : 'analytics',
    transaction: { automatic: true, certainty: 'clean' }
  };
}

function event(eventType, overrides = {}) {
  return {
    event_type: eventType,
    execution_id: 'layout-execution',
    profile_id: 'emissary',
    tab_id: 'fractions-query',
    session_id: 'session-fractions-query',
    result_set_id: null,
    sequence: null,
    statement_index: null,
    statement_start: null,
    statement_end: null,
    statement_count: null,
    statements_completed: null,
    columns: [],
    rows: [],
    received_rows: 0,
    retained_bytes: 0,
    rows_affected: null,
    duration_ms: null,
    terminal_state: null,
    capped: false,
    transaction: null,
    error: null,
    error_category: null,
    retryable: null,
    cancel_confirmed: null,
    ...overrides
  };
}

async function emitOneRowResult() {
  await emit('query_execution', event('started'));
  await emit(
    'query_execution',
    event('batch', {
      result_set_id: 'layout-result',
      sequence: 0,
      statement_index: 0,
      columns: [
        { name: 'id', declared_type: 'INTEGER', nullable: false },
        { name: 'name', declared_type: 'TEXT', nullable: true }
      ],
      rows: [
        {
          values: [
            taggedValue('integer', '1'),
            taggedValue('text', 'Knights of the Fraction Table')
          ]
        }
      ],
      received_rows: 1,
      retained_bytes: 64
    })
  );
  await emit(
    'query_execution',
    event('result_terminal', {
      result_set_id: 'layout-result',
      sequence: 1,
      statement_index: 0,
      received_rows: 1,
      retained_bytes: 64,
      terminal_state: 'completed',
      duration_ms: 16
    })
  );
  await emit(
    'query_execution',
    event('finished', {
      statements_completed: 1,
      received_rows: 1,
      duration_ms: 16,
      transaction: { automatic: true, certainty: 'clean' }
    })
  );
}

function taggedValue(valueType, text) {
  return {
    value_type: valueType,
    text,
    boolean: null,
    bytes_base64: null,
    timezone_or_offset: null
  };
}

mockWindows('main');
mockIPC(
  (command, payload) => {
    const request = payload?.request ?? {};
    switch (command) {
      case 'bootstrap_workspace':
        return {
          contract_version: 1,
          phase: 'phase_4_productivity_and_safe_data_editing',
          store_state: 'ready',
          store_message: null,
          profiles,
          settings,
          workspace: {
            tabs,
            active_tab_id: 'fractions-query',
            panel_sizes: { explorer_percent: 22, results_percent: 35 }
          }
        };
      case 'take_pending_sql_files':
        return { files: [] };
      case 'check_for_updates':
        return { configured: false, update: null };
      case 'save_workspace':
        return { saved: true, message: 'Saved in memory.' };
      case 'connect_profile':
        return connection(request.profile_id);
      case 'load_schema_namespaces':
        return {
          profile_id: request.profile_id,
          namespaces: [{ name: 'main', state: 'loaded' }],
          stale: false
        };
      case 'open_tab_session':
        return session(request.profile_id, request.tab_id);
      case 'start_execution':
        setTimeout(() => void emitOneRowResult(), 0);
        return {
          status: 'started',
          execution_id: 'layout-execution',
          fingerprint: null,
          safety_flags: [],
          message: 'Execution started.'
        };
      case 'ack_result_batch':
        return { completed: true, cancelled: false, message: 'Acknowledged.' };
      case 'list_history':
        return { entries: [], warning: null };
      default:
        return null;
    }
  },
  { shouldMockEvents: true }
);

const target = document.getElementById('app');
if (!target) throw new Error('Workbench layout fixture root is missing');
mount(App, { target });
