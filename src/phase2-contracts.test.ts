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
        resultSetId: 'result',
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
        onviewchange: () => undefined,
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
    expect(document.body.textContent).toContain(
      'Loaded rows only · 10000/10000'
    );
    expect(document.body.textContent).toContain('Statement 1');
  });

  it('uses CodeMirror with adapter-selected parsing, completion, diagnostics, and fixed execution shortcuts', () => {
    const editor = read('src/lib/components/SqlEditor.svelte');
    expect(editor).toContain('basicSetup');
    expect(editor).toContain('MySQL,');
    expect(editor).toContain('SQLite,');
    expect(editor).toContain('schemaCompletionSource');
    expect(editor).toContain("dialect === 'mysql' ? MySQL : SQLite");
    expect(editor).toContain('syntaxTree(editor.state)');
    expect(editor).toContain("key: 'Mod-Enter'");
    expect(editor).toContain("key: 'Mod-Shift-Enter'");
    expect(editor).toContain("key: 'Mod-.'");
    expect(editor).toContain("key: 'Shift-Alt-f'");
  });

  it('freezes terminal elapsed time and docks returned rows in the visible workbench', () => {
    const app = read('src/App.svelte');
    const lifecycle = read('src/lib/execution-ui.ts');
    const css = read('src/styles/app.css');

    expect(app).toContain('executionElapsedMs(activeExecution, nowMs)');
    expect(app).toContain("setExecutionState(execution, 'succeeded')");
    expect(lifecycle).toContain('execution.completedAt ?? now');
    expect(css).toMatch(
      /main\.has-query-results\s*\{[^}]*grid-template-rows:[^}]*minmax\(12rem, 2fr\)/s
    );
    expect(css).toMatch(
      /\.results-workspace\s*\{[^}]*min-height:\s*0;[^}]*overflow:\s*auto;/s
    );
  });

  it('quotes structural TSV characters and opens only one large value on demand', async () => {
    let copied = '';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          copied = value;
        }
      }
    });
    const large = `<script>${'large Ω'.repeat(200)}</script>`;
    mounted = mount(ResultGrid, {
      target: document.body,
      props: {
        resultSetId: 'hostile-result',
        statementIndex: 2,
        columns: [
          { name: 'text', declared_type: 'TEXT', nullable: true },
          { name: 'formula', declared_type: 'TEXT', nullable: true }
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
                value_type: 'null',
                text: null,
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
        onexport: () => undefined,
        onviewchange: () => undefined,
        onstatus: () => undefined
      }
    });
    flushSync();
    const firstCell = document.querySelector<HTMLButtonElement>(
      '.grid-row [role="gridcell"]'
    );
    firstCell?.click();
    document
      .querySelectorAll<HTMLButtonElement>('.result-tools button')[0]
      ?.click();
    await Promise.resolve();
    expect(copied).toBe('"line 1\nline 2\t""quoted"""\t=SUM(A1:A2)');

    const secondRowCell = document.querySelectorAll<HTMLButtonElement>(
      '.grid-row [role="gridcell"]'
    )[2];
    secondRowCell.click();
    flushSync();
    const open = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent === 'Open selected large value'
    );
    (open as HTMLButtonElement | undefined)?.click();
    flushSync();
    expect(document.querySelector('.large-value pre')?.textContent).toBe(large);
    expect(document.querySelector('script')).toBeNull();
  });
});
