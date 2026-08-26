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
tabs[0].dirty = true;
tabs[1].dirty = true;
const commandLog = [];
let createdTabCount = 0;
let executionCount = 0;
window.__QUERYNOT_FIXTURE_COMMANDS__ = commandLog;

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

async function emitOneRowResult(executionId) {
  await emit(
    'query_execution',
    event('started', { execution_id: executionId })
  );
  await emit(
    'query_execution',
    event('batch', {
      execution_id: executionId,
      result_set_id: 'layout-result',
      sequence: 0,
      statement_index: 0,
      columns: [
        { name: 'id', declared_type: 'INTEGER', nullable: false },
        { name: 'created_at', declared_type: 'TEXT', nullable: false },
        { name: 'updated_at', declared_type: 'TEXT', nullable: false },
        { name: 'deleted_at', declared_type: 'TEXT', nullable: true },
        { name: 'name', declared_type: 'TEXT', nullable: true },
        { name: 'armor', declared_type: 'JSON', nullable: true },
        { name: 'sequence_id', declared_type: 'INTEGER', nullable: false }
      ],
      rows: [
        {
          values: [
            taggedValue('integer', '1'),
            taggedValue('text', '2026-08-21 12:00:00'),
            taggedValue('text', '2026-08-21 12:01:00'),
            taggedValue('null', null),
            taggedValue('text', 'Knights of the Fraction Table'),
            taggedValue(
              'text',
              `{"helmet":"Bronze","shield":true,"serial":900719925474099312345,"notes":"${'Soft wrap value '.repeat(
                80
              )}"}`
            ),
            taggedValue('integer', '42')
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
      execution_id: executionId,
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
      execution_id: executionId,
      statements_completed: 1,
      received_rows: 1,
      duration_ms: 16,
      transaction: { automatic: true, certainty: 'clean' }
    })
  );
}

async function emitRowlessResult(executionId) {
  await emit(
    'query_execution',
    event('started', { execution_id: executionId })
  );
  await new Promise((resolve) => setTimeout(resolve, 700));
  await emit(
    'query_execution',
    event('finished', {
      execution_id: executionId,
      statements_completed: 1,
      received_rows: 0,
      duration_ms: 700,
      transaction: { automatic: true, certainty: 'clean' }
    })
  );
}

async function emitEmptyResult(executionId) {
  await emit(
    'query_execution',
    event('started', { execution_id: executionId })
  );
  await emit(
    'query_execution',
    event('batch', {
      execution_id: executionId,
      result_set_id: `${executionId}-result`,
      sequence: 0,
      statement_index: 0,
      columns: [
        { name: 'id', declared_type: 'INTEGER', nullable: false },
        { name: 'name', declared_type: 'TEXT', nullable: true }
      ],
      rows: [],
      received_rows: 0,
      retained_bytes: 0
    })
  );
  await emit(
    'query_execution',
    event('result_terminal', {
      execution_id: executionId,
      result_set_id: `${executionId}-result`,
      sequence: 1,
      statement_index: 0,
      received_rows: 0,
      retained_bytes: 0,
      terminal_state: 'completed',
      duration_ms: 7
    })
  );
  await emit(
    'query_execution',
    event('finished', {
      execution_id: executionId,
      statements_completed: 1,
      received_rows: 0,
      duration_ms: 7,
      transaction: { automatic: true, certainty: 'clean' }
    })
  );
}

async function emitFailedResult(executionId) {
  await emit(
    'query_execution',
    event('started', { execution_id: executionId })
  );
  await emit(
    'query_execution',
    event('failed', {
      execution_id: executionId,
      error: 'Synthetic permission denial for rendered state coverage.',
      error_category: 'authorization',
      retryable: false,
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
    commandLog.push({ command, request: structuredClone(request) });
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
      case 'create_offline_tab': {
        createdTabCount += 1;
        const profile = profiles.find(
          (candidate) => candidate.id === request.profile_id
        );
        return queryTab(
          `created-tab-${createdTabCount}`,
          `Query ${createdTabCount}`,
          request.profile_id ?? null,
          profile?.name ?? null,
          tabs.length + createdTabCount
        );
      }
      case 'connect_profile':
        return connection(request.profile_id);
      case 'load_schema_namespaces':
        return {
          profile_id: request.profile_id,
          namespaces: [
            { name: 'main', state: 'loaded' },
            { name: 'temp', state: 'loaded' }
          ],
          stale: false
        };
      case 'load_schema_objects':
        return {
          profile_id: request.profile_id,
          namespace: request.namespace,
          objects: [
            { namespace: 'main', name: 'fractions', kind: 'table' },
            { namespace: 'main', name: 'fraction_totals', kind: 'view' }
          ],
          stale: false
        };
      case 'load_schema_object_detail':
        return {
          object: {
            namespace: request.namespace,
            name: request.object_name,
            kind: request.object_name === 'fractions' ? 'table' : 'view'
          },
          columns: [
            {
              name: 'id',
              declared_type: 'INTEGER',
              nullable: false,
              primary_key_position: 1,
              default_expression: null,
              generated: false
            },
            {
              name: 'name',
              declared_type: 'TEXT',
              nullable: false,
              primary_key_position: 0,
              default_expression: null,
              generated: false
            },
            {
              name: 'created_at',
              declared_type: 'DATETIME',
              nullable: false,
              primary_key_position: 0,
              default_expression: 'CURRENT_TIMESTAMP',
              generated: false
            }
          ],
          foreign_keys: [
            {
              id: 0,
              sequence: 0,
              referenced_table: 'armors',
              from_column: 'armor_id',
              to_column: 'id',
              on_update: 'NO ACTION',
              on_delete: 'RESTRICT'
            }
          ],
          indexes: [
            {
              name: 'fractions_name_idx',
              unique: true,
              origin: 'created',
              columns: ['name']
            }
          ],
          definition: 'CREATE TABLE fractions (...);',
          routines_supported: false,
          stale: false
        };
      case 'open_tab_session':
        return session(request.profile_id, request.tab_id);
      case 'browse_table':
        return {
          definition: {
            namespace: request.namespace,
            table: request.table,
            columns: [
              {
                name: 'id',
                declared_type: 'INTEGER',
                nullable: false,
                primary_key_position: 1,
                has_default: false,
                generated: false,
                editor: 'integer',
                editable: true,
                read_only_reason: null
              },
              {
                name: 'name',
                declared_type: 'TEXT',
                nullable: false,
                primary_key_position: 0,
                has_default: false,
                generated: false,
                editor: 'text',
                editable: true,
                read_only_reason: null
              }
            ],
            identity_source: 'primary_key',
            identity_columns: ['id'],
            editable: true,
            read_only_reason: null
          },
          rows: [
            {
              values: [taggedValue('integer', '1'), taggedValue('text', 'half')]
            }
          ],
          has_more: false,
          next_cursor: [taggedValue('integer', '1')],
          next_offset: 1,
          unstable: false,
          message: 'Loaded one deterministic row.'
        };
      case 'start_execution':
        executionCount += 1;
        {
          const executionId = `layout-execution-${executionCount}`;
          const emitter = request.sql.includes('QUERYNOT_ROWLESS_STATE')
            ? emitRowlessResult
            : request.sql.includes('QUERYNOT_EMPTY_STATE')
              ? emitEmptyResult
              : request.sql.includes('QUERYNOT_FAILED_STATE')
                ? emitFailedResult
                : emitOneRowResult;
          setTimeout(() => void emitter(executionId), 0);
          return {
            status: 'started',
            execution_id: executionId,
            fingerprint: null,
            safety_flags: [],
            message: 'Execution started.'
          };
        }
      case 'ack_result_batch':
        return { completed: true, cancelled: false, message: 'Acknowledged.' };
      case 'list_history':
        return {
          entries: [
            {
              id: 'layout-history-entry',
              sql: 'SELECT id, name FROM fractions ORDER BY id;',
              timestamp_ms: 1_786_569_600_000,
              profile_id: 'emissary',
              profile_label: 'Emissary',
              engine: 'SQLite',
              context: 'main',
              duration_ms: 16,
              status: 'completed',
              affected_rows: 0,
              received_rows: 1,
              error_category: null
            }
          ],
          warning: null
        };
      default:
        return null;
    }
  },
  { shouldMockEvents: true }
);

const target = document.getElementById('app');
if (!target) throw new Error('Workbench layout fixture root is missing');
mount(App, { target });
