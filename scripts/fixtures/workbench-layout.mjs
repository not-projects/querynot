import { emit } from '@tauri-apps/api/event';
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { mount } from 'svelte';

import App from '../../src/App.svelte';
import '../../src/styles/app.css';

let settings = {
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
  plan_hotspot_estimates_enabled: false,
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
let pausedExecutionId = null;
window.__QUERYNOT_FIXTURE_COMMANDS__ = commandLog;
window.__QUERYNOT_COMPLETION_WARMUP_RESOLUTIONS__ = 0;
let releaseCompletionWarmup;
const completionWarmupGate = new Promise((resolve) => {
  releaseCompletionWarmup = resolve;
});
window.__QUERYNOT_RELEASE_COMPLETION_WARMUP__ = () => releaseCompletionWarmup();
let releaseReportingConnectionSetup;
const reportingConnectionSetupGate = new Promise((resolve) => {
  releaseReportingConnectionSetup = resolve;
});
window.__QUERYNOT_RELEASE_REPORTING_CONNECTION_SETUP__ = () =>
  releaseReportingConnectionSetup();

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
  const reporting = profileId === 'long-profile';
  return {
    profile_id: profileId,
    profile_name: profileId === 'emissary' ? 'Emissary' : 'Reporting',
    engine: profileId === 'emissary' ? 'SQLite' : 'MySQL',
    exact_version: profileId === 'emissary' ? '3.51.3' : '9.1.0',
    dialect: profileId === 'emissary' ? 'sqlite' : 'mysql',
    context: profileId === 'emissary' ? 'main' : 'analytics',
    read_only: reporting,
    compatibility_status: reporting ? 'query_only' : 'supported',
    compatibility_warning: reporting
      ? 'MySQL 9.1.0 is outside this release’s fully supported matrix, so possible writes remain disabled.'
      : null,
    legacy: false,
    capabilities: {
      metadata: true,
      streaming: true,
      cancellation: true,
      explain: true,
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

async function emitMultipleResults(executionId) {
  await emit(
    'query_execution',
    event('started', { execution_id: executionId })
  );
  const resultSets = [
    {
      id: `${executionId}-first`,
      statementIndex: 0,
      column: 'first_result',
      value: 'fractions'
    },
    {
      id: `${executionId}-second`,
      statementIndex: 1,
      column: 'second_result',
      value: 'armors'
    }
  ];
  for (const result of resultSets) {
    await emit(
      'query_execution',
      event('batch', {
        execution_id: executionId,
        result_set_id: result.id,
        sequence: 0,
        statement_index: result.statementIndex,
        columns: [
          { name: result.column, declared_type: 'TEXT', nullable: false }
        ],
        rows: [{ values: [taggedValue('text', result.value)] }],
        received_rows: 1,
        retained_bytes: result.value.length
      })
    );
    await emit(
      'query_execution',
      event('result_terminal', {
        execution_id: executionId,
        result_set_id: result.id,
        sequence: 1,
        statement_index: result.statementIndex,
        received_rows: 1,
        retained_bytes: result.value.length,
        terminal_state: 'completed',
        duration_ms: 8 + result.statementIndex
      })
    );
  }
  await emit(
    'query_execution',
    event('finished', {
      execution_id: executionId,
      statements_completed: 2,
      received_rows: 2,
      duration_ms: 17,
      transaction: { automatic: true, certainty: 'clean' }
    })
  );
}

async function emitPausedResult(executionId) {
  await emit(
    'query_execution',
    event('started', { execution_id: executionId })
  );
  await emit(
    'query_execution',
    event('batch', {
      execution_id: executionId,
      result_set_id: 'paused-layout-result',
      sequence: 0,
      statement_index: 0,
      columns: [{ name: 'id', declared_type: 'INTEGER', nullable: false }],
      rows: [{ values: [taggedValue('integer', '1')] }],
      received_rows: 1,
      retained_bytes: 1
    })
  );
  await emit(
    'query_execution',
    event('paused', {
      execution_id: executionId,
      result_set_id: 'paused-layout-result',
      sequence: 1,
      received_rows: 1,
      retained_bytes: 1
    })
  );
}

async function emitUnconfirmedTerminalCancellation(executionId) {
  await emit(
    'query_execution',
    event('result_terminal', {
      execution_id: executionId,
      result_set_id: 'paused-layout-result',
      sequence: 1,
      received_rows: 1,
      retained_bytes: 1,
      terminal_state: 'cancelled'
    })
  );
  await emit(
    'query_execution',
    event('cancelled', {
      execution_id: executionId,
      received_rows: 1,
      cancel_confirmed: false,
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
      statement_index: 0,
      statement_start: 0,
      statement_end: 31,
      transaction: { automatic: true, certainty: 'clean' }
    })
  );
}

async function emitExplainPlan(
  executionId,
  duplicateTerminal = false,
  hotspot = false,
  dense = false,
  rawOnly = false
) {
  const base = {
    execution_id: executionId,
    profile_id: 'emissary',
    tab_id: 'fractions-query',
    session_id: 'session-fractions-query',
    statement_start: 0,
    statement_end: 50,
    duration_ms: null,
    plan: null,
    error: null,
    error_category: null,
    retryable: null,
    cancel_confirmed: null
  };
  await emit('query_explain', {
    ...base,
    event_type: 'started',
    sequence: 0
  });
  if (rawOnly) {
    await emit('query_explain', {
      ...base,
      event_type: 'completed',
      sequence: 1,
      duration_ms: 3,
      plan: {
        engine: 'MariaDB',
        exact_version: '11.4.12',
        context: 'fixture',
        raw_format: 'json',
        raw_payload: '{"query_block":{"unrecognized_fixture":true}}',
        normalization_status: 'raw_only',
        warnings: ['The engine plan shape was not recognized.'],
        nodes: []
      }
    });
    return;
  }

  if (dense) {
    await emit('query_explain', {
      ...base,
      event_type: 'completed',
      sequence: 1,
      duration_ms: 8,
      plan: {
        engine: 'PostgreSQL',
        exact_version: '18.6',
        context: 'public',
        raw_format: 'json',
        raw_payload: '[{"Plan":{"Node Type":"Dense fixture"}}]',
        normalization_status: 'normalized',
        warnings: [],
        nodes: Array.from({ length: 251 }, (_, id) => ({
          id,
          parent_id: id === 0 ? null : 0,
          depth: id === 0 ? 0 : 1,
          operation: id === 0 ? 'Append' : `Fixture scan ${id}`,
          relation: id === 0 ? null : `fixture_${id}`,
          alias: null,
          access_type: null,
          join_type: null,
          index: null,
          estimated_rows: String(id + 1),
          startup_cost: null,
          total_cost: null,
          width: null,
          condition: null,
          detail: null
        }))
      }
    });
    return;
  }

  if (hotspot) {
    const hotspotCompleted = {
      ...base,
      event_type: 'completed',
      sequence: 1,
      duration_ms: 7,
      plan: {
        engine: 'PostgreSQL',
        exact_version: '18.6',
        context: 'public',
        raw_format: 'json',
        raw_payload: JSON.stringify([{ Plan: { 'Node Type': 'Nested Loop' } }]),
        normalization_status: 'normalized',
        warnings: [],
        nodes: [
          {
            id: 0,
            parent_id: null,
            depth: 0,
            operation: 'Nested Loop',
            relation: null,
            alias: null,
            access_type: null,
            join_type: 'Inner',
            index: null,
            estimated_rows: '250',
            startup_cost: '0.84',
            total_cost: '100.25',
            width: '48',
            condition: null,
            detail: 'Nested Loop'
          },
          {
            id: 1,
            parent_id: 0,
            depth: 1,
            operation: 'Index Scan',
            relation: 'fractions',
            alias: 'f',
            access_type: null,
            join_type: null,
            index: 'fractions_pkey',
            estimated_rows: '4',
            startup_cost: '0.42',
            total_cost: '5.10',
            width: '16',
            condition: 'id > 0',
            detail: 'Index Scan using fractions_pkey'
          },
          {
            id: 2,
            parent_id: 0,
            depth: 1,
            operation: 'Seq Scan',
            relation: 'armors',
            alias: 'a',
            access_type: null,
            join_type: null,
            index: null,
            estimated_rows: '900',
            startup_cost: '0.00',
            total_cost: '75.75',
            width: '32',
            condition: 'fraction_id IS NOT NULL',
            detail: 'Seq Scan on armors'
          }
        ]
      }
    };
    await emit('query_explain', hotspotCompleted);
    return;
  }

  const rawPayload = JSON.stringify(
    [
      { id: 2, parent: 0, auxiliary: 0, detail: 'SCAN fractions' },
      {
        id: 7,
        parent: 2,
        auxiliary: 0,
        detail: 'SEARCH armors USING INDEX armors_fraction_idx (fraction_id=?)'
      }
    ],
    null,
    2
  );
  const completed = {
    ...base,
    event_type: 'completed',
    sequence: 1,
    duration_ms: 9,
    plan: {
      engine: 'SQLite',
      exact_version: '3.51.3',
      context: 'main',
      raw_format: 'sqlite_query_plan_rows',
      raw_payload: rawPayload,
      normalization_status: 'normalized',
      warnings: [
        'SQLite documents EXPLAIN QUERY PLAN output as unstable; Raw preserves the native rows QueryNot received.'
      ],
      nodes: [
        {
          id: 0,
          parent_id: null,
          depth: 0,
          operation: 'SCAN',
          relation: 'fractions',
          alias: null,
          access_type: null,
          join_type: null,
          index: null,
          estimated_rows: null,
          startup_cost: null,
          total_cost: null,
          width: null,
          condition: null,
          detail: 'SCAN fractions'
        },
        {
          id: 1,
          parent_id: 0,
          depth: 1,
          operation: 'SEARCH',
          relation: 'armors',
          alias: null,
          access_type: null,
          join_type: null,
          index: 'armors_fraction_idx',
          estimated_rows: '4',
          startup_cost: null,
          total_cost: null,
          width: null,
          condition: 'fraction_id=?',
          detail:
            'SEARCH armors USING INDEX armors_fraction_idx (fraction_id=?)'
        }
      ]
    }
  };
  await emit('query_explain', completed);
  if (duplicateTerminal) await emit('query_explain', completed);
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
  async (command, payload) => {
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
      case 'save_settings':
        settings = structuredClone(request);
        return structuredClone(settings);
      case 'reset_settings':
        return structuredClone(settings);
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
        if (request.profile_id === 'long-profile') {
          await reportingConnectionSetupGate;
        }
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
        await completionWarmupGate;
        window.__QUERYNOT_COMPLETION_WARMUP_RESOLUTIONS__ += 1;
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
      case 'change_tab_context':
        return {
          context: request.context,
          transaction: { automatic: true, certainty: 'clean' },
          message: 'Changed the fixture tab context.'
        };
      case 'close_tab_session':
        return {
          completed: true,
          cancelled: false,
          message: 'Closed the fixture tab session.'
        };
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
        if (request.sql.includes('QUERYNOT_REJECTED_STATE')) {
          throw {
            category: 'syntax',
            safe_message:
              'The SQL planner could not identify a complete statement to run.',
            safe_detail: 'Review the selected SQL and statement boundaries.',
            retryable: false
          };
        }
        executionCount += 1;
        {
          const executionId = `layout-execution-${executionCount}`;
          const emitter = request.sql.includes('QUERYNOT_ROWLESS_STATE')
            ? emitRowlessResult
            : request.sql.includes('QUERYNOT_MULTIPLE_RESULTS_STATE')
              ? emitMultipleResults
              : request.sql.includes('QUERYNOT_EMPTY_STATE')
                ? emitEmptyResult
                : request.sql.includes('QUERYNOT_FAILED_STATE')
                  ? emitFailedResult
                  : request.sql.includes('QUERYNOT_PAUSED_STATE')
                    ? emitPausedResult
                    : emitOneRowResult;
          if (emitter === emitPausedResult) pausedExecutionId = executionId;
          setTimeout(() => void emitter(executionId), 0);
          return {
            status: 'started',
            execution_id: executionId,
            fingerprint: null,
            safety_flags: [],
            message: 'Execution started.'
          };
        }
      case 'start_explain':
        executionCount += 1;
        {
          const executionId = `layout-explain-${executionCount}`;
          setTimeout(
            () =>
              void emitExplainPlan(
                executionId,
                request.sql.includes('QUERYNOT_EXPLAIN_SEQUENCE_STATE'),
                request.sql.includes('QUERYNOT_HOTSPOT_STATE'),
                request.sql.includes('QUERYNOT_DENSE_PLAN_STATE'),
                request.sql.includes('QUERYNOT_RAW_ONLY_STATE')
              ),
            0
          );
          return {
            execution_id: executionId,
            message: 'Estimated planning started.'
          };
        }
      case 'ack_result_batch':
        return { completed: true, cancelled: false, message: 'Acknowledged.' };
      case 'cancel_execution':
        if (request.execution_id === pausedExecutionId) {
          const executionId = pausedExecutionId;
          pausedExecutionId = null;
          setTimeout(
            () => void emitUnconfirmedTerminalCancellation(executionId),
            0
          );
        }
        return {
          completed: true,
          cancelled: false,
          message: 'Cancellation requested.'
        };
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
              operation_kind: 'query',
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
