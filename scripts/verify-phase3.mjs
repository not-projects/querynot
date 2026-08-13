import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { arch, platform } from 'node:os';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const evidenceDirectory = resolve(root, 'evidence', 'phase-3');
const conformancePath = resolve(
  evidenceDirectory,
  'adapter-conformance-report.json'
);
const sourceCommit = output('git', ['rev-parse', 'HEAD']);
const initialStatus = output('git', [
  'status',
  '--porcelain',
  '--untracked-files=all'
]);
if (initialStatus !== '') {
  throw new Error(
    'Phase 3 verification requires a clean committed source tree so evidence identifies exact code'
  );
}

const startedAt = new Date().toISOString();
const checks = [];
let failure = null;
let conformance = null;

function output(program, args, options = {}) {
  const result = spawnSync(program, args, {
    cwd: root,
    encoding: 'utf8',
    env: options.env ?? process.env,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${program} ${args.join(' ')} failed`);
  return result.stdout.trim();
}

function run(id, displayCommand, program, args, options = {}) {
  const started = Date.now();
  const result = spawnSync(program, args, {
    cwd: root,
    encoding: 'utf8',
    env: options.env ?? process.env,
    maxBuffer: 64 * 1024 * 1024,
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

function assertConformance(report) {
  const expected = new Set([
    'mysql-5.7.44',
    'mysql-8.0.46',
    'mysql-8.4.10',
    'mariadb-10.11.18',
    'mariadb-11.4.12'
  ]);
  if (
    report?.status !== 'pass' ||
    report?.tested_source !== sourceCommit ||
    !Array.isArray(report.network_results) ||
    report.network_results.length !== expected.size
  ) {
    throw new Error(
      'Phase 3 conformance report is incomplete or not commit-addressed'
    );
  }
  for (const result of report.network_results) {
    if (!expected.delete(result.id)) {
      throw new Error(
        `unexpected or duplicate conformance target ${result.id}`
      );
    }
    const adapter = result.adapter;
    if (
      !result.marker_verified ||
      result.tls_version !== 'TLSv1.2' ||
      !result.tls_identity_verified ||
      !result.transaction_rollback ||
      !adapter?.exact_identity ||
      !adapter?.supported_capability_profile ||
      !adapter?.metadata_tables_views_routines ||
      adapter?.streaming_rows !== 1_024 ||
      !adapter?.typed_values ||
      !adapter?.zero_row_column_metadata ||
      !adapter?.duplicate_column_names ||
      adapter?.multiple_result_sets < 2 ||
      !adapter?.transaction_reconciliation ||
      !adapter?.implicit_ddl_commit_reconciled ||
      !adapter?.cancellation_confirmed ||
      !adapter?.session_usable_after_cancel ||
      !adapter?.system_trust_rejected_private_ca ||
      adapter?.client_certificate_required_and_verified !== true
    ) {
      throw new Error(`${result.id} lacks a required Phase 3 assertion`);
    }
  }
  if (expected.size !== 0)
    throw new Error('a Phase 3 matrix target is missing');
}

const denyEnvironment = {
  ...process.env,
  ...(process.env.QUERYNOT_CARGO_DENY_HOME
    ? { CARGO_HOME: process.env.QUERYNOT_CARGO_DENY_HOME }
    : {})
};

try {
  run('P3-NPM-CI', 'npm ci', 'npm', ['ci']);
  run('P3-CONTRACTS', 'npm run test:contracts', 'npm', [
    'run',
    'test:contracts'
  ]);
  run('P3-TRACEABILITY', 'npm run test:traceability', 'npm', [
    'run',
    'test:traceability'
  ]);
  run('P3-NPM-POLICY', 'npm run test:dependencies', 'npm', [
    'run',
    'test:dependencies'
  ]);
  run('P3-SVELTE-CHECK', 'npm run check', 'npm', ['run', 'check']);
  run('P3-FRONTEND-TEST', 'npm run test', 'npm', ['run', 'test']);
  run('P3-FRONTEND-BUILD', 'npm run build', 'npm', ['run', 'build']);
  run('P3-FORMAT', 'npm run format:check', 'npm', ['run', 'format:check']);
  run('P3-RUSTFMT', 'cargo fmt --all -- --check', 'cargo', [
    'fmt',
    '--all',
    '--',
    '--check'
  ]);
  run(
    'P3-CARGO-CHECK',
    'cargo check --locked --workspace --all-targets',
    'cargo',
    ['check', '--locked', '--workspace', '--all-targets']
  );
  run(
    'P3-CARGO-TEST',
    'cargo test --locked --workspace --all-targets',
    'cargo',
    ['test', '--locked', '--workspace', '--all-targets']
  );
  run(
    'P3-CLIPPY',
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
    'P3-CARGO-DENY',
    'cargo deny --offline check advisories licenses bans sources',
    'cargo',
    ['deny', '--offline', 'check', 'advisories', 'licenses', 'bans', 'sources'],
    { env: denyEnvironment }
  );
  run(
    'P3-ADAPTER-CONFORMANCE',
    'npm run test:conformance:phase3',
    'npm',
    ['run', 'test:conformance:phase3'],
    { capture: true }
  );
  conformance = JSON.parse(readFileSync(conformancePath, 'utf8'));
  assertConformance(conformance);
  run('P3-TAURI-BUILD', 'npm run tauri -- build --no-bundle', 'npm', [
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
  phase: 3,
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
    cargo: output('cargo', ['--version'])
  },
  checks,
  executable_test_ids: {
    'P3-AUTO-ADAPTER-CONFORMANCE':
      'querynot-fixture-harness::check_querynot_adapter across all five exact archive fixtures',
    'P3-AUTO-TLS-MATRIX':
      'adapter conformance > TLS 1.2 custom CA, private-CA system-trust rejection, and required client identity',
    'P3-AUTO-AUTH-MATRIX':
      'adapter conformance > mysql_native_password and caching_sha2_password exact fixtures',
    'P3-AUTO-METADATA-MATRIX':
      'adapter conformance > namespaces, tables, views, routines, columns, keys, indexes, and detail',
    'P3-AUTO-RESULT-MATRIX':
      'adapter conformance > acknowledged streaming, typed edge values, zero rows, duplicate columns, and multiple results',
    'P3-AUTO-TRANSACTION-MATRIX':
      'adapter conformance > manual rollback, server reconciliation, and implicit DDL commit',
    'P3-AUTO-CANCELLATION-MATRIX':
      'adapter conformance > confirmed KILL QUERY and post-cancel session continuity',
    'P3-AUTO-CONNECTION-LIFECYCLE':
      'querynot_lib::phase2::tests::connection_attempts_are_single_owner_cancellable_and_cleanup_safe',
    'P3-AUTO-DIALECT-CONTRACT':
      'src/phase3-contracts.test.ts > Phase 3 MySQL-family adapter boundaries',
    'P3-AUTO-SQLITE-REGRESSION':
      'querynot_core::tests::sqlite_vertical_slice::sqlite_read_only_query_stream_retain_and_export_journey'
  },
  phase_gate: {
    exact_five_server_matrix: failure ? 'see checks' : 'pass_local',
    authentication_and_tls: failure ? 'see checks' : 'pass_local',
    metadata_dialect_and_parser: failure ? 'see checks' : 'pass_local',
    transactions_and_implicit_commits: failure ? 'see checks' : 'pass_local',
    results_types_and_multiple_results: failure ? 'see checks' : 'pass_local',
    cancellation_and_session_continuity: failure ? 'see checks' : 'pass_local',
    unsupported_query_only_and_legacy_visibility: failure
      ? 'see checks'
      : 'pass_local',
    common_adapter_without_engine_ui_branch: failure ? 'see checks' : 'pass',
    sqlite_complete_journey_regression: failure ? 'see checks' : 'pass_local',
    local_linux_desktop_build: failure ? 'see checks' : 'pass',
    target_platform_system_trust_and_packaging:
      'pending Phase 5 Windows/macOS/Linux procedures'
  },
  release_blockers_remaining: [
    'Phase 4 productivity, SQL-file/history workflows, and safe table-data editing requirements remain incomplete.',
    'Native target-platform trust stores, accessibility, performance, packaging, diagnostics, and manual safety review remain Phase 5 work.',
    'The fixed five-day dogfood period and five-person opt-in beta cannot be inferred from automation and remain unperformed.'
  ],
  conformance_report: 'evidence/phase-3/adapter-conformance-report.json',
  failure
};
writeFileSync(
  resolve(evidenceDirectory, 'validation-report.json'),
  `${JSON.stringify(report, null, 2)}\n`
);

if (failure) throw new Error(failure);
process.stdout.write(
  `Phase 3 local verification passed for ${sourceCommit}; retained reports in evidence/phase-3\n`
);
