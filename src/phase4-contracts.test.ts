import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('Phase 4 productivity and safe-editing boundaries', () => {
  it('keeps history metadata-only, bounded, optional, and independently clearable', () => {
    const history = read('crates/querynot-core/src/history.rs');
    const store = read('crates/querynot-core/src/store.rs');
    const runtime = read('src-tauri/src/phase1.rs');

    expect(history).toContain('pub struct HistoryEntry');
    expect(history).not.toContain('pub rows:');
    expect(history).not.toContain('pub password:');
    expect(store).toContain('prune_history');
    expect(store).toContain('compact_history');
    expect(store).toContain('PRAGMA optimize');
    expect(runtime).toContain('settings.history_enabled');
    expect(runtime).toContain('clear_history');
  });

  it('reopens history only as an offline dirty draft without execution', () => {
    const app = read('src/App.svelte');
    const reopen = app.slice(
      app.indexOf('async function reopenHistoryEntry'),
      app.indexOf('async function deleteHistoryEntry')
    );

    expect(reopen).toContain('Reopened history in a new offline query tab');
    expect(reopen).toContain('create_offline_tab');
    expect(reopen).not.toContain('start_execution');
    expect(reopen).not.toContain('connect_profile');
  });

  it('keeps tab operations local and routes every unsafe close through an explicit decision', () => {
    const app = read('src/App.svelte');

    expect(app).toContain('function renameTab');
    expect(app).toContain('function moveTab');
    expect(app).toContain('function togglePinTab');
    expect(app).toContain('async function duplicateQueryTab');
    expect(app).toContain("openModal('close-tab')");
    expect(app).toContain('Cancel query and keep tab');
    expect(app).toContain('Commit and close');
    expect(app).toContain('Rollback and close');
    expect(app).toContain('Discard staged changes and close');
    expect(app).toContain('Save file and close');
  });

  it('keeps an active close inside its connection group and creates an empty same-group query when needed', () => {
    const app = read('src/App.svelte');
    const close = app.slice(
      app.indexOf('async function closeTab'),
      app.indexOf('async function cancelTabAndKeepOpen')
    );

    expect(close).toContain('tabsInGroup(closingTab.profile_id)');
    expect(close).toContain('groupTabs[groupIndex - 1]');
    expect(close).toContain('groupTabs[groupIndex + 1]');
    expect(close).toContain('appendNewQueryTab(closingTab.profile_id)');
    expect(close).not.toContain('workspace.tabs[Math.min');
  });

  it('treats history persistence failure as a warning after database work completes', () => {
    const runtime = read('src-tauri/src/phase2.rs');
    const historyWrite = runtime.slice(
      runtime.indexOf('if let (Some(capture), Some(status))'),
      runtime.indexOf('fn retain_execution_event')
    );

    expect(historyWrite).toContain('capture.store.save_history_entry');
    expect(historyWrite).toContain('Execution completed');
    expect(historyWrite).not.toContain('return Err');
  });

  it('uses structured bound-value plans and exact optimistic predicates for table changes', () => {
    const table = read('crates/querynot-core/src/table.rs');
    const sqlite = read('crates/querynot-core/src/sqlite.rs');
    const mysql = read('crates/querynot-core/src/mysql.rs');

    expect(table).toContain('pub parameters: Vec<TaggedValue>');
    expect(table).toContain('null_safe_equal');
    expect(table).toContain('expected_rows: 1');
    expect(table).toContain('pub original: Vec<TaggedValue>');
    expect(table).toContain('MutationCellMode::DatabaseDefault');
    expect(table).toContain('predicates.join(" AND ")');
    expect(table).toContain("LIKE ? ESCAPE '!'");
    expect(table).toContain('index.partial');
    expect(table).toContain('index.has_expressions');
    expect(table).toContain('MAX_TABLE_PLAN_BYTES');
    expect(sqlite).toContain(
      'result.rows_affected() == operation.expected_rows'
    );
    expect(mysql).toContain(
      'result.rows_affected() == operation.expected_rows'
    );
    expect(sqlite).toContain('ROLLBACK');
    expect(mysql).toContain('ROLLBACK');
    expect(sqlite).toContain(
      'could not confirm whether the mutation commit completed'
    );
    expect(mysql).toContain(
      'could not confirm whether the mutation commit completed'
    );
  });

  it('checks mutation-plan ownership before consuming the one-use preview', () => {
    const runtime = read('src-tauri/src/phase2.rs');
    const apply = runtime.slice(
      runtime.indexOf('pub(crate) async fn apply_table_mutations'),
      runtime.indexOf('pub(crate) fn discard_mutation_plan')
    );

    expect(apply.indexOf('plans.get(&plan_id)')).toBeGreaterThanOrEqual(0);
    expect(apply.indexOf('plans.get(&plan_id)')).toBeLessThan(
      apply.indexOf('.remove(&plan_id)')
    );
  });

  it('keeps staged table values ephemeral and blocks unsafe lifecycle transitions', () => {
    const app = read('src/App.svelte');
    const workspace = read('crates/querynot-core/src/workspace.rs');
    const runtime = read('src-tauri/src/phase2.rs');

    expect(app).toContain('let tableTabs = $state');
    expect(workspace).not.toContain('staged_mutations');
    expect(app).toContain('ui.staged.length');
    expect(app).toContain('localMutationErrors(ui.staged)');
    expect(app).toContain('nativeMutationOperations(');
    expect(runtime).toContain('mutation_plans');
    expect(runtime).toContain('discard_mutation_plan');
    expect(app).toContain('cannot be replayed automatically');
    expect(app).toContain('focusProfileSafetyBlocker');
    expect(app).toContain('closeProfileSessions');
  });

  it('keeps typed validation local while the native plan remains authoritative', () => {
    const table = read('crates/querynot-core/src/table.rs');
    const grid = read('src/lib/components/TableDataGrid.svelte');
    const staging = read('src/lib/table-staging.ts');

    expect(grid).toContain('raw_input: raw');
    expect(grid).toContain('local_error:');
    expect(grid).toContain('validationErrors.length > 0');
    expect(grid).toContain("column.editor === 'read_only'");
    expect(grid).toContain('filterOperators(selectedFilterColumn())');
    expect(staging).toContain('localMutationErrors');
    expect(staging).toContain('nativeMutationOperations');
    expect(table).toContain('valid_date_time');
    expect(table).toContain('valid_enum_like');
    expect(table).toContain('validate_table_page_values');
  });

  it('stops SQL-file overwrite on external change and offers a real comparison', () => {
    const runtime = read('src-tauri/src/phase1.rs');
    const app = read('src/App.svelte');

    expect(runtime).toContain('status: "external_change"');
    expect(runtime).toContain('current != expected');
    expect(runtime).toContain('write_local_bytes_atomically');
    expect(app).toContain("'file-review'");
    expect(app).toContain('Current disk version');
    expect(app).toContain('Save draft as…');
  });

  it('stores password and encrypted client-key passphrase in one opaque vault bundle', () => {
    const vault = read('crates/querynot-core/src/vault.rs');
    const mysql = read('crates/querynot-core/src/mysql.rs');
    const profile = read('crates/querynot-core/src/profile.rs');

    expect(vault).toContain('SECRET_BUNDLE_PREFIX');
    expect(vault).toContain('decode_from_vault');
    expect(vault).toContain('Version 0 stored the database password directly');
    expect(mysql).toContain('EncryptedPrivateKeyInfo');
    expect(mysql).toContain('ssl_client_key_from_pem');
    expect(profile).toContain('secret_reference: Option<SecretRef>');
    expect(profile).not.toContain('client_key_passphrase');
  });

  it('changes only a dedicated tab context and requires native confirmation', () => {
    const runtime = read('src-tauri/src/phase2.rs');
    const adapter = read('crates/querynot-core/src/adapter.rs');
    const mysql = read('crates/querynot-core/src/mysql.rs');

    expect(runtime).toContain('change_tab_context');
    expect(runtime).toContain('resource.session.change_context');
    expect(runtime).toContain('state.phase2.mutation_plans');
    expect(adapter).toContain('pub async fn change_context');
    expect(mysql).toContain('SELECT DATABASE()');
    expect(runtime).toContain('close_lost_session_if_needed');
  });

  it('routes startup and second-instance SQL files into the one offline window', () => {
    const entry = read('src-tauri/src/lib.rs');
    const runtime = read('src-tauri/src/phase1.rs');
    const app = read('src/App.svelte');
    const configuration = read('src-tauri/tauri.conf.json');

    expect(entry.indexOf('tauri_plugin_single_instance::init')).toBeLessThan(
      entry.indexOf('tauri_plugin_dialog::init')
    );
    expect(entry).toContain('tauri::RunEvent::Opened');
    expect(entry).toContain('phase1::route_sql_file_paths');
    expect(runtime).toContain('querynot_open_files');
    expect(runtime).toContain('take_pending_sql_files');
    expect(configuration).toContain('fileAssociations');
    const drain = app.slice(
      app.indexOf('function appendOpenedSqlFile'),
      app.indexOf('async function saveActiveSqlFile')
    );
    expect(drain).toContain("invokeCommand('take_pending_sql_files'");
    expect(drain).toContain('profile_id: null');
    expect(drain).toContain('reconnectable: false');
    expect(drain).not.toContain('connect_profile');
    expect(drain).not.toContain('start_execution');
  });

  it('renders full supported schema detail as bounded untrusted text', () => {
    const app = read('src/App.svelte');
    const detail = read('src/lib/components/SchemaObjectDetail.svelte');
    const sqlite = read('crates/querynot-core/src/sqlite.rs');
    const mysql = read('crates/querynot-core/src/mysql.rs');

    expect(app).toContain('denseMetadataText');
    expect(app).toContain("tableTabViews[tab.id] = 'structure'");
    expect(app).toContain('loadSchemaObjectDetailForTab');
    expect(detail).toContain('Engine definition');
    expect(detail).toContain('foreignKey.referenced_table');
    expect(detail).toContain("index.columns.join(', ')");
    expect(detail).toContain('Primary ${column.primary_key_position}');
    expect(detail).toContain('No indexes were reported.');
    expect(detail).toContain('No foreign keys were reported.');
    expect(detail).toContain('Browse rows');
    expect(app).not.toContain('>Data</button');
    expect(detail).not.toContain('{@html');
    expect(sqlite).toContain('MAX_METADATA_NAME_BYTES');
    expect(mysql).toContain('MAX_METADATA_BYTES');
  });

  it('opens schema starter queries on the existing connection and presents history as a workbench drawer', () => {
    const app = read('src/App.svelte');
    const historyDrawer = read('src/lib/components/HistoryDrawer.svelte');
    const starter = app.slice(
      app.indexOf('async function startQueryForObject'),
      app.indexOf('function handleEditorChange')
    );

    expect(starter).toContain('connections[profileId]');
    expect(starter).toContain('await ensureTabSession(tab)');
    expect(starter).toContain('tab.context_label = object.namespace');
    expect(starter).toContain("invokeCommand('open_tab_session'");
    expect(app).toContain('aria-controls="history-drawer"');
    expect(app).toContain('<HistoryDrawer');
    expect(app).toContain(
      'await tick();\n    if (returnFocus) historyButton?.focus()'
    );
    expect(historyDrawer).toContain('role="dialog"');
    expect(historyDrawer).toContain('aria-modal="true"');
    expect(historyDrawer).toContain("if (event.key === 'Escape')");
    expect(historyDrawer).toContain('History never stores result rows');
  });

  it('runs daily history maintenance and tests the Phase 4 migration rollback boundary', () => {
    const entry = read('src-tauri/src/lib.rs');
    const runtime = read('src-tauri/src/phase1.rs');
    const store = read('crates/querynot-core/src/store.rs');

    expect(entry).toContain('run_history_maintenance');
    expect(runtime).toContain('HISTORY_CLEANUP_INTERVAL_MS');
    expect(runtime).toContain('maybe_prune_history');
    expect(store).toContain('MigrationFault::before(3)');
    expect(store).toContain('WorkspaceTabKind::Query');
    expect(store).toContain('workspace.validate()');
  });

  it('formats only the requested range while preserving comments and never executing', () => {
    const runtime = read('src-tauri/src/phase2.rs');
    const format = runtime.slice(
      runtime.indexOf('fn format_sql_request'),
      runtime.indexOf('#[tauri::command]\npub(crate) async fn start_execution')
    );

    expect(format).toContain('sqlformat::format');
    expect(format).toContain('replace_range');
    expect(format).not.toContain('start_execution');
    expect(runtime).toContain('formatting_preserves_comments');
  });
});
