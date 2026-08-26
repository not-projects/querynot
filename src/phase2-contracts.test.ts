// @vitest-environment jsdom

import { readFileSync } from 'node:fs';

import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';

import ResultGrid from './lib/components/ResultGrid.svelte';
import type {
  ResultColumnView,
  ResultRowView
} from './lib/generated/contracts';

const read = (path: string) => readFileSync(path, 'utf8');
let mounted: ReturnType<typeof mount> | null = null;

afterEach(async () => {
  if (mounted) await unmount(mounted);
  mounted = null;
  document.body.innerHTML = '';
});

describe('Phase 2 SQLite boundaries', () => {
  it('exposes only typed native connection, session, execution, result-control, transaction, schema, and export commands', () => {
    const contract = JSON.parse(read('contracts/querynot.v1.json')) as {
      commands: Record<string, unknown>;
      events: Record<string, unknown>;
    };
    const commands = Object.keys(contract.commands);

    for (const command of [
      'test_profile_connection',
      'connect_profile',
      'open_tab_session',
      'load_schema_objects',
      'start_execution',
      'ack_result_batch',
      'load_more_results',
      'cancel_execution',
      'commit_transaction',
      'rollback_transaction',
      'export_result'
    ]) {
      expect(commands).toContain(command);
    }
    expect(contract.events).toEqual({
      query_execution: 'ExecutionEventView',
      querynot_open_files: 'PendingSqlFilesSignal',
      update_download_progress: 'UpdateDownloadProgressView'
    });
    expect(commands).not.toContain('read_file');
    expect(commands).not.toContain('write_file');
    expect(commands).not.toContain('execute_sql');
  });

  it('retains hard native bounds, acknowledgement backpressure, ownership checks, and atomic exports', () => {
    const sqlite = read('crates/querynot-core/src/sqlite.rs');
    const result = read('crates/querynot-core/src/result.rs');
    const runtime = read('src-tauri/src/phase2.rs');
    const exporter = read('crates/querynot-core/src/export.rs');

    expect(result).toContain('MAX_RETAINED_ROWS: usize = 100_000');
    expect(result).toContain('MAX_RETAINED_BYTES: usize = 128 * 1024 * 1024');
    expect(result).toContain('MAX_BATCH_ROWS: usize = 1_000');
    expect(result).toContain('MAX_BATCH_BYTES: usize = 2 * 1024 * 1024');
    expect(sqlite).toContain('ExecutionControl::Acknowledge');
    expect(sqlite).toContain('ExecutionControl::LoadMore');
    expect(runtime).toContain('authorize_execution(');
    expect(runtime).toContain('authorize_session(');
    expect(runtime).toContain('consume_approval(');
    expect(runtime).toContain('lifecycle_epoch');
    expect(read('src-tauri/src/phase1.rs')).toContain(
      'state.phase2.cleanup();'
    );
    expect(exporter).toContain('std::fs::rename(&temporary, destination)');
    expect(exporter).toContain('create_new(true)');
  });

  it('shows exact destructive context and statement text with cancel as the default action', () => {
    const app = read('src/App.svelte');
    expect(app).toContain('<dt>Connection</dt>');
    expect(app).toContain('<dt>Database / schema</dt>');
    expect(app).toContain('utf8Range(');
    expect(app).toContain('Run these exact ranges once');
    expect(app).toContain('Cancel is the default');
  });

  it('virtualizes 10,000 hostile rows and renders database content as text', async () => {
    const columns: ResultColumnView[] = [
      { name: 'duplicate', declared_type: 'TEXT', nullable: true },
      { name: 'duplicate', declared_type: 'TEXT', nullable: true }
    ];
    const rows: ResultRowView[] = Array.from(
      { length: 10_000 },
      (_, index) => ({
        values: [
          {
            value_type: 'text',
            text: index === 0 ? '<img src=x onerror=alert(1)>' : `row ${index}`,
            boolean: null,
            bytes_base64: null,
            timezone_or_offset: null
          },
          {
            value_type: index % 2 ? 'null' : 'signed_integer',
            text: index % 2 ? null : '18446744073709551615',
            boolean: null,
            bytes_base64: null,
            timezone_or_offset: null
          }
        ]
      })
    );
    mounted = mount(ResultGrid, {
      target: document.body,
      props: {
        statementIndex: 0,
        columns,
        rows,
        capped: false,
        paused: false,
        terminalState: 'completed',
        durationMs: 12,
        onloadmore: () => undefined,
        ondiscard: () => undefined,
        onexport: () => undefined,
        onstatus: () => undefined
      }
    });
    flushSync();

    expect(document.querySelectorAll('.grid-row').length).toBeLessThan(40);
    expect(
      document.querySelector('[role="grid"]')?.getAttribute('aria-rowcount')
    ).toBe('10000');
    expect(document.querySelector('img')).toBeNull();
    expect(document.body.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(document.body.textContent).toContain('10000 loaded rows');
    expect(document.body.textContent).toContain('Statement 1');
  });

  it('explains a completed result that returned columns without rows', () => {
    mounted = mount(ResultGrid, {
      target: document.body,
      props: {
        statementIndex: 0,
        columns: [
          { name: 'id', declared_type: 'INTEGER', nullable: false },
          { name: 'name', declared_type: 'TEXT', nullable: true }
        ],
        rows: [],
        capped: false,
        paused: false,
        terminalState: 'completed',
        durationMs: 8,
        onloadmore: () => undefined,
        ondiscard: () => undefined,
        onexport: () => undefined,
        onstatus: () => undefined
      }
    });
    flushSync();

    expect(document.querySelector('.grid-empty-state')?.textContent).toContain(
      'No rows returned'
    );
    expect(
      document.querySelector('[role="grid"]')?.getAttribute('aria-rowcount')
    ).toBe('0');
    expect(document.body.textContent).toContain('0 loaded rows');
  });

  it('uses CodeMirror with adapter-selected parsing, completion, diagnostics, and platform execution shortcuts', () => {
    const editor = read('src/lib/components/SqlEditor.svelte');
    expect(editor).toContain('basicSetup');
    expect(editor).toContain('MySQL,');
    expect(editor).toContain('SQLite,');
    expect(editor).toContain('schemaCompletionSource');
    expect(editor).toContain("dialect === 'mysql' ? MySQL : SQLite");
    expect(editor).toContain('syntaxTree(editor.state)');
    expect(editor).toContain('defaultKeymap: false');
    expect(editor).toContain("{ key: 'Tab', run: acceptCompletion }");
    expect(editor).toContain("key: 'Enter'");
    expect(editor).toContain('return insertNewlineAndIndent(editor)');
    expect(editor).toContain(
      "'.cm-tooltip-autocomplete > ul > li[aria-selected]'"
    );
    expect(editor).toContain("macPrimaryShortcuts ? 'Cmd' : 'Ctrl'");
    expect(editor).toContain('`${editorPrimaryModifier}-Enter`');
    expect(editor).toContain('`${editorPrimaryModifier}-Shift-Enter`');
    expect(editor).toContain('`${editorPrimaryModifier}-.`');
    expect(editor).toContain("key: 'Shift-Alt-f'");
  });

  it('freezes terminal elapsed time and docks returned rows in the visible workbench', () => {
    const app = read('src/App.svelte');
    const lifecycle = read('src/lib/execution-ui.ts');
    const css = read('src/styles/app.css');

    expect(app).toContain('executionElapsedMs(activeExecution, nowMs)');
    expect(app).toContain("setExecutionState(execution, 'succeeded')");
    expect(app).toContain('resultFromFirstBatch(event)');
    expect(app).not.toContain('(results[event.tab_id] ??= [])');
    expect(lifecycle).toContain('execution.completedAt ?? now');
    expect(app).toContain('workspace.panel_sizes.results_percent');
    expect(app).toContain('role="separator"');
    expect(app).toContain('aria-valuemin="20"');
    expect(app).toContain('aria-valuemax="70"');
    expect(css).toMatch(/\.results-separator\s*\{[^}]*cursor:\s*row-resize/s);
    expect(css).toMatch(/\.results-workspace\s*\{[^}]*overflow:\s*hidden/s);
    expect(read('src/lib/components/ResultGrid.svelte')).toContain(
      'style:transform={`translateX(${-scrollLeft}px)`}'
    );
  });

  it('makes row selection actionable and safely opens wrapped and formatted values on demand', async () => {
    let copied = '';
    let exportRequest: {
      format: 'csv' | 'json';
      currentView: boolean;
      nullToken: string;
      viewIndexes: number[];
    } | null = null;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          copied = value;
        }
      }
    });
    const large = `<script>${'large Ω'.repeat(200)}</script>`;
    const json =
      '{"big":900719925474099312345,"nested":{"message":"soft wrap"}}';
    mounted = mount(ResultGrid, {
      target: document.body,
      props: {
        statementIndex: 2,
        columns: [
          { name: 'text', declared_type: 'TEXT', nullable: true },
          { name: 'formula_or_json', declared_type: 'JSON', nullable: true }
        ],
        rows: [
          {
            values: [
              {
                value_type: 'text',
                text: 'line 1\nline 2\t"quoted"',
                boolean: null,
                bytes_base64: null,
                timezone_or_offset: null
              },
              {
                value_type: 'text',
                text: '=SUM(A1:A2)',
                boolean: null,
                bytes_base64: null,
                timezone_or_offset: null
              }
            ]
          },
          {
            values: [
              {
                value_type: 'text',
                text: large,
                boolean: null,
                bytes_base64: null,
                timezone_or_offset: null
              },
              {
                value_type: 'text',
                text: json,
                boolean: null,
                bytes_base64: null,
                timezone_or_offset: null
              }
            ]
          }
        ],
        capped: false,
        paused: false,
        terminalState: 'completed',
        durationMs: 4,
        onloadmore: () => undefined,
        ondiscard: () => undefined,
        onexport: (format, currentView, nullToken, viewIndexes) => {
          exportRequest = {
            format,
            currentView,
            nullToken,
            viewIndexes: [...viewIndexes]
          };
        },
        onstatus: () => undefined
      }
    });
    flushSync();

    const exportTrigger = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Export result rows"]'
    );
    expect(document.querySelector('.export-warning')).toBeNull();
    expect(
      document.querySelector('.result-set > .export-safety-note')
    ).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    exportTrigger?.click();
    flushSync();
    const exportDialog = document.querySelector<HTMLElement>(
      '[role="dialog"][aria-label="Export result rows"]'
    );
    expect(exportDialog).not.toBeNull();
    expect(exportDialog?.textContent).toContain('Formula prefixes remain raw');
    expect(exportDialog?.textContent).toContain(
      'Binary values use tagged base64'
    );

    const filter = document.querySelector<HTMLInputElement>(
      'input[aria-label="Filter loaded rows"]'
    );
    if (filter) {
      filter.value = 'large';
      filter.dispatchEvent(new Event('input', { bubbles: true }));
      flushSync();
    }
    const currentViewCsv = Array.from(
      exportDialog?.querySelectorAll<HTMLButtonElement>(
        '[aria-labelledby="csv-export-heading"] button'
      ) ?? []
    ).find(
      (button) => button.querySelector('strong')?.textContent === 'Current view'
    );
    currentViewCsv?.click();
    flushSync();
    expect(exportRequest).toEqual({
      format: 'csv',
      currentView: true,
      nullToken: '\\N',
      viewIndexes: [1]
    });
    if (filter) {
      filter.value = '';
      filter.dispatchEvent(new Event('input', { bubbles: true }));
      flushSync();
    }

    document
      .querySelector<HTMLInputElement>(
        'input[aria-label="Select loaded row 1"]'
      )
      ?.click();
    flushSync();
    expect(document.querySelector('.selection-label')?.textContent).toContain(
      '1 row selected'
    );
    const copySelected = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.result-tools button')
    ).find((button) => button.textContent?.trim() === 'Copy selected');
    copySelected?.click();
    await Promise.resolve();
    expect(copied).toBe('"line 1\nline 2\t""quoted"""\t=SUM(A1:A2)');

    const secondRowCell = document.querySelectorAll<HTMLButtonElement>(
      '.grid-row [role="gridcell"]'
    )[2];
    secondRowCell.click();
    flushSync();
    const open = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Open value'
    );
    (open as HTMLButtonElement | undefined)?.click();
    flushSync();
    expect(document.querySelectorAll('.value-viewer')).toHaveLength(1);
    expect(document.querySelector('.value-viewer pre')?.textContent).toBe(
      large
    );
    expect(document.querySelector('script')).toBeNull();

    const jsonCell = document.querySelectorAll<HTMLButtonElement>(
      '.grid-row [role="gridcell"]'
    )[3];
    jsonCell.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    );
    flushSync();
    const formatted = document.querySelector('.value-viewer pre');
    expect(document.querySelectorAll('.value-viewer')).toHaveLength(1);
    expect(formatted?.textContent).toContain('"big": 900719925474099312345');
    expect(formatted?.textContent).toContain('\n');
    const raw = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Raw'
    );
    (raw as HTMLButtonElement | undefined)?.click();
    flushSync();
    expect(document.querySelector('.value-viewer pre')?.textContent).toBe(json);

    const gridSource = read('src/lib/components/ResultGrid.svelte');
    const viewerSource = read('src/lib/components/ResultValueViewer.svelte');
    expect(gridSource).not.toContain('<details class="action-options');
    expect(gridSource).toContain('menuLabel="Actions for copying result rows"');
    expect(gridSource).toContain('label="Export result rows"');
    expect(gridSource).toContain('oncontextmenu=');
    expect(viewerSource).toContain('white-space: pre-wrap');
    expect(viewerSource).toContain('overflow-wrap: anywhere');
    expect(viewerSource).toContain('JSON.parse(trimmed)');
    expect(viewerSource).not.toContain('JSON.stringify');
  });
});
