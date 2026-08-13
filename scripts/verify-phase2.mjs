import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { arch, platform } from 'node:os';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const evidenceDirectory = resolve(root, 'evidence', 'phase-2');
const sourceCommit = output('git', ['rev-parse', 'HEAD']);
const initialStatus = output('git', [
  'status',
  '--porcelain',
  '--untracked-files=all'
]);
if (initialStatus !== '') {
  throw new Error(
    'Phase 2 verification requires a clean committed source tree so evidence identifies exact code'
  );
}

const startedAt = new Date().toISOString();
const checks = [];
let failure = null;
let benchmark = null;

function output(program, args, options = {}) {
  const result = spawnSync(program, args, {
    cwd: root,
    encoding: 'utf8',
    env: options.env ?? process.env,
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${program} ${args.join(' ')} failed`);
  }
  return result.stdout.trim();
}

function run(id, displayCommand, program, args, options = {}) {
  const started = Date.now();
  const result = spawnSync(program, args, {
    cwd: root,
    encoding: 'utf8',
    env: options.env ?? process.env,
    maxBuffer: 32 * 1024 * 1024,
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  });
  checks.push({
    id,
    command: displayCommand,
    status: result.status === 0 && !result.error ? 'pass' : 'fail',
    duration_ms: Date.now() - started
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = options.capture
      ? (result.stderr || result.stdout || '').trim().slice(0, 1_000)
      : '';
    throw new Error(`${displayCommand} failed${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout?.trim() ?? '';
}

const denyEnvironment = {
  ...process.env,
  ...(process.env.QUERYNOT_CARGO_DENY_HOME
    ? { CARGO_HOME: process.env.QUERYNOT_CARGO_DENY_HOME }
    : {})
};

try {
  run('P2-NPM-CI', 'npm ci', 'npm', ['ci']);
  run('P2-CONTRACTS', 'npm run test:contracts', 'npm', [
    'run',
    'test:contracts'
  ]);
  run('P2-TRACEABILITY', 'npm run test:traceability', 'npm', [
    'run',
    'test:traceability'
  ]);
  run('P2-NPM-POLICY', 'npm run test:dependencies', 'npm', [
    'run',
    'test:dependencies'
  ]);
  run('P2-SVELTE-CHECK', 'npm run check', 'npm', ['run', 'check']);
  run('P2-FRONTEND-TEST', 'npm run test', 'npm', ['run', 'test']);
  run('P2-FRONTEND-BUILD', 'npm run build', 'npm', ['run', 'build']);
  run('P2-FORMAT', 'npm run format:check', 'npm', ['run', 'format:check']);
  run('P2-RUSTFMT', 'cargo fmt --all -- --check', 'cargo', [
    'fmt',
    '--all',
    '--',
    '--check'
  ]);
  run(
    'P2-CARGO-CHECK',
    'cargo check --locked --workspace --all-targets',
    'cargo',
    ['check', '--locked', '--workspace', '--all-targets']
  );
  run(
    'P2-CARGO-TEST',
    'cargo test --locked --workspace --all-targets',
    'cargo',
    ['test', '--locked', '--workspace', '--all-targets']
  );
  run(
    'P2-CLIPPY',
    'cargo clippy --locked --workspace --all-targets -- -D warnings',
    'cargo',
    [
      'clippy',
      '--locked',
      '--workspace',
      '--all-targets',
      '--',
      '-D',
      'warnings'
    ]
  );
  run(
    'P2-CARGO-DENY',
    'cargo deny --offline check advisories licenses bans sources',
    'cargo',
    ['deny', '--offline', 'check', 'advisories', 'licenses', 'bans', 'sources'],
    { env: denyEnvironment }
  );
  benchmark = JSON.parse(
    run(
      'P2-REFERENCE-BENCHMARK',
      'npm run benchmark:phase2',
      'node',
      ['scripts/benchmark-phase2.mjs'],
      { capture: true }
    )
  );
  run('P2-TAURI-BUILD', 'npm run tauri -- build --no-bundle', 'npm', [
    'run',
    'tauri',
    '--',
    'build',
    '--no-bundle'
  ]);
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
}

mkdirSync(evidenceDirectory, { recursive: true });
const cpuModel = readFileSync('/proc/cpuinfo', 'utf8').match(
  /^model name\s*:\s*(.+)$/m
)?.[1];
const report = {
  schema_version: 1,
  phase: 2,
  source_commit: sourceCommit,
  status: failure ? 'fail' : 'pass_local',
  started_at: startedAt,
  completed_at: new Date().toISOString(),
  environment: {
    os: platform(),
    architecture: arch(),
    kernel: output('uname', ['-sr']),
    cpu: cpuModel ?? 'unavailable',
    node: output('node', ['--version']),
    npm: output('npm', ['--version']),
    rustc: output('rustc', ['--version']),
    cargo: output('cargo', ['--version']),
    sqlite: benchmark?.sqlite_exact_version ?? 'benchmark_not_run'
  },
  checks,
  executable_test_ids: {
    'P2-AUTO-SQLITE-JOURNEY':
      'querynot_core::tests::sqlite_vertical_slice::sqlite_read_only_query_stream_retain_and_export_journey',
    'P2-AUTO-SQLITE-METADATA':
      'querynot_core::sqlite::tests::connection_metadata_and_read_only_mode_are_real',
    'P2-AUTO-METADATA-BOUNDARY':
      'querynot_core::sqlite::tests::hostile_metadata_is_rejected_at_the_display_boundary',
    'P2-AUTO-SCHEMA-CACHE':
      'querynot_core::store::tests::schema_cache_is_typed_bounded_and_removed_with_its_profile',
    'P2-AUTO-SESSION-ISOLATION':
      'querynot_core::sqlite::tests::dedicated_sessions_isolate_transactions_and_temporary_objects',
    'P2-AUTO-STREAM-BACKPRESSURE':
      'querynot_core::sqlite::tests::streaming_waits_for_acknowledgement_and_honors_load_more',
    'P2-AUTO-CANCELLATION':
      'querynot_core::sqlite::tests::cancellation_interrupts_query_and_leaves_session_usable',
    'P2-AUTO-CURSOR-EXPIRY':
      'querynot_core::sqlite::tests::paused_cursor_control_expires_without_reexecution',
    'P2-AUTO-EVENT-INTEGRITY':
      'querynot_lib::phase2::tests::bridge_retention_rejects_duplicate_events_and_cleanup_releases_rows',
    'P2-AUTO-RELOAD-CLEANUP':
      'src/phase2-contracts.test.ts > retains hard native bounds, acknowledgement backpressure, ownership checks, and atomic exports',
    'P2-AUTO-DESTRUCTIVE-SAFETY':
      'querynot_core::sql::tests::destructive_classifier_flags_all_uncertain_or_unbounded_statements',
    'P2-AUTO-APPROVAL-SINGLE-USE':
      'querynot_lib::phase2::tests::destructive_approval_is_exact_single_use_and_cleanup_invalidates_it',
    'P2-AUTO-SELECTION':
      'querynot_core::sql::tests::multi_statement_selection_preserves_order_and_document_ranges',
    'P2-AUTO-VIRTUAL-GRID':
      'src/phase2-contracts.test.ts > virtualizes 10,000 hostile rows and renders database content as text',
    'P2-AUTO-EXPORT-CSV':
      'querynot_core::export::tests::csv_is_rfc4180_shaped_and_preserves_hostile_values',
    'P2-AUTO-EXPORT-JSON':
      'querynot_core::export::tests::json_keeps_duplicate_columns_and_lossless_type_tags',
    'P2-AUTO-EXPORT-INTERRUPTION':
      'querynot_core::export::tests::interrupted_export_preserves_existing_destination_and_cleans_temp',
    'P2-AUTO-EDITOR':
      'src/phase2-contracts.test.ts > uses CodeMirror with SQLite parsing, completion, diagnostics, and fixed execution shortcuts',
    'P2-PERF-FIRST-BATCH':
      'scripts/benchmark-phase2.mjs > 30 measured release-build ordinary-result samples after one discarded setup run'
  },
  phase_gate: {
    sqlite_complete_query_journey: failure ? 'see checks' : 'pass_local',
    read_only_execution: failure ? 'see checks' : 'pass',
    fault_injection_and_last_valid_data: failure ? 'see checks' : 'pass',
    native_ownership_reload_and_cursor_cleanup: failure ? 'see checks' : 'pass',
    hostile_values_and_metadata: failure ? 'see checks' : 'pass',
    destructive_confirmation_integrity: failure ? 'see checks' : 'pass',
    reference_first_batch_performance:
      benchmark?.first_driver_stream_to_first_1000_row_batch_ms?.status ??
      'not_run',
    virtualized_10000_row_dom_bound: failure ? 'see checks' : 'pass_jsdom',
    local_linux_desktop_build: failure ? 'see checks' : 'pass',
    critical_high_safety_findings: failure
      ? 'see checks'
      : 'none_found_by_phase_2_automated_review',
    target_webview_fps_and_memory:
      'pending Phase 5 native Windows/macOS/Linux benchmark procedure',
    manual_security_review: 'pending Phase 5 named-reviewer sign-off'
  },
  release_blockers_remaining: [
    'MySQL-family adapter parity and the published conformance matrix remain Phase 3 work.',
    'Phase 4 productivity, history, SQL-file save, and safe table-data editing requirements remain incomplete.',
    'Native target-platform frame-rate, memory, accessibility, packaging, and manual safety evidence remain Phase 5 work.',
    'The fixed five-day dogfood period and five-person opt-in beta cannot be inferred from automation and remain unperformed.'
  ],
  failure
};
writeFileSync(
  resolve(evidenceDirectory, 'validation-report.json'),
  `${JSON.stringify(report, null, 2)}\n`
);
if (benchmark) {
  writeFileSync(
    resolve(evidenceDirectory, 'benchmark-report.json'),
    `${JSON.stringify(
      {
        ...benchmark,
        source_commit: sourceCommit,
        environment: report.environment
      },
      null,
      2
    )}\n`
  );
}

if (failure) throw new Error(failure);
process.stdout.write(
  `Phase 2 local verification passed for ${sourceCommit}; retained report in evidence/phase-2\n`
);
