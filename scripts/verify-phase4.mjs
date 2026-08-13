import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { arch, platform } from 'node:os';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const evidenceDirectory = resolve(root, 'evidence', 'phase-4');
const tableConformancePath = resolve(
  evidenceDirectory,
  'table-conformance-report.json'
);

function output(program, args, options = {}) {
  const result = spawnSync(program, args, {
    cwd: root,
    encoding: 'utf8',
    env: options.env ?? process.env,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${program} ${args.join(' ')} failed`);
  }
  return result.stdout.trim();
}

const sourceCommit = output('git', ['rev-parse', 'HEAD']);
if (output('git', ['status', '--porcelain', '--untracked-files=all']) !== '') {
  throw new Error(
    'Phase 4 verification requires a clean committed source tree so evidence identifies exact code'
  );
}

const startedAt = new Date().toISOString();
const checks = [];
let failure = null;
let tableConformance = null;
let npmAudit = null;

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

function assertTableConformance(report) {
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
      'Phase 4 table conformance report is incomplete or not commit-addressed'
    );
  }
  for (const result of report.network_results) {
    if (!expected.delete(result.id)) {
      throw new Error(
        `unexpected or duplicate conformance target ${result.id}`
      );
    }
    const table = result.adapter?.table_editing;
    if (
      !result.marker_verified ||
      !result.adapter?.supported_capability_profile ||
      !table?.deterministic_keyset_paging ||
      !table?.bound_structured_filters ||
      !table?.typed_validation ||
      !table?.insert_update_delete ||
      !table?.generated_value_refresh ||
      !table?.optimistic_conflict_atomic_rollback
    ) {
      throw new Error(`${result.id} lacks a required Phase 4 table assertion`);
    }
  }
  if (expected.size !== 0) {
    throw new Error('a Phase 4 table matrix target is missing');
  }
}

const denyEnvironment = {
  ...process.env,
  ...(process.env.QUERYNOT_CARGO_DENY_HOME
    ? { CARGO_HOME: process.env.QUERYNOT_CARGO_DENY_HOME }
    : {})
};

try {
  run('P4-NPM-CI', 'npm ci', 'npm', ['ci']);
  run('P4-CONTRACTS', 'npm run test:contracts', 'npm', [
    'run',
    'test:contracts'
  ]);
  run('P4-TRACEABILITY', 'npm run test:traceability', 'npm', [
    'run',
    'test:traceability'
  ]);
  run('P4-NPM-POLICY', 'npm run test:dependencies', 'npm', [
    'run',
    'test:dependencies'
  ]);
  npmAudit = JSON.parse(
    run(
      'P4-NPM-AUDIT',
      'npm audit --audit-level=high --json',
      'npm',
      ['audit', '--audit-level=high', '--json'],
      { capture: true }
    )
  );
  run('P4-SVELTE-CHECK', 'npm run check', 'npm', ['run', 'check']);
  run('P4-FRONTEND-TEST', 'npm run test', 'npm', ['run', 'test']);
  run('P4-FRONTEND-BUILD', 'npm run build', 'npm', ['run', 'build']);
  run('P4-FORMAT', 'npm run format:check', 'npm', ['run', 'format:check']);
  run('P4-RUSTFMT', 'cargo fmt --all -- --check', 'cargo', [
    'fmt',
    '--all',
    '--',
    '--check'
  ]);
  run(
    'P4-CARGO-CHECK',
    'cargo check --locked --workspace --all-targets',
    'cargo',
    ['check', '--locked', '--workspace', '--all-targets']
  );
  run(
    'P4-CARGO-TEST',
    'cargo test --locked --workspace --all-targets',
    'cargo',
    ['test', '--locked', '--workspace', '--all-targets']
  );
  run(
    'P4-CLIPPY',
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
    'P4-CARGO-DENY',
    'cargo deny --offline check advisories licenses bans sources',
    'cargo',
    ['deny', '--offline', 'check', 'advisories', 'licenses', 'bans', 'sources'],
    { env: denyEnvironment }
  );
  run(
    'P4-TABLE-CONFORMANCE',
    'npm run test:conformance:phase4',
    'npm',
    ['run', 'test:conformance:phase4'],
    { capture: true }
  );
  tableConformance = JSON.parse(readFileSync(tableConformancePath, 'utf8'));
  assertTableConformance(tableConformance);
  run('P4-TAURI-BUILD', 'npm run tauri -- build --no-bundle', 'npm', [
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
const packageLock = JSON.parse(
  readFileSync(resolve(root, 'package-lock.json'), 'utf8')
);
const licenseCounts = {};
for (const [path, entry] of Object.entries(packageLock.packages ?? {})) {
  if (path && entry.license) {
    licenseCounts[entry.license] = (licenseCounts[entry.license] ?? 0) + 1;
  }
}
const cargoLock = readFileSync(resolve(root, 'Cargo.lock'), 'utf8');
const denyConfig = readFileSync(resolve(root, 'deny.toml'), 'utf8');
const ignoredAdvisories = [
  ...new Set(denyConfig.match(/RUSTSEC-\d{4}-\d{4}/g) ?? [])
].sort();
const dependencyReport = {
  schema_version: 1,
  source_commit: sourceCommit,
  status: failure ? 'fail' : 'pass',
  reviewed_at: startedAt,
  phase_4_direct_additions: {
    pkcs8: '0.10.2',
    tauri_plugin_single_instance: '2.4.3'
  },
  npm: {
    locked_packages: Math.max(
      0,
      Object.keys(packageLock.packages ?? {}).length - 1
    ),
    license_counts: Object.fromEntries(
      Object.entries(licenseCounts).sort(([left], [right]) =>
        left.localeCompare(right)
      )
    ),
    audit_vulnerabilities: npmAudit?.metadata?.vulnerabilities ?? null
  },
  rust: {
    locked_packages: (cargoLock.match(/^\[\[package\]\]$/gm) ?? []).length,
    cargo_deny_version: output('cargo', ['deny', '--version'], {
      env: denyEnvironment
    }),
    new_advisories: 0,
    reviewed_ignored_advisories: ignoredAdvisories,
    risk_register: 'docs/security/dependency-risk-register.md'
  }
};
writeFileSync(
  resolve(evidenceDirectory, 'dependency-review.json'),
  `${JSON.stringify(dependencyReport, null, 2)}\n`
);
const cpuModel = readFileSync('/proc/cpuinfo', 'utf8').match(
  /^model name\s*:\s*(.+)$/m
)?.[1];
const report = {
  schema_version: 1,
  phase: 4,
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
    'P4-AUTO-PRODUCTIVITY-CONTRACTS':
      'src/phase4-contracts.test.ts > Phase 4 productivity and safe-editing boundaries',
    'P4-AUTO-TABLE-PLANNER':
      'querynot_core::table::tests > identity, parameterization, optimistic predicates, and state transitions',
    'P4-AUTO-TABLE-SQLITE':
      'querynot_core::sqlite::tests::table_mutations_refresh_generated_values_and_roll_back_every_operation_on_conflict',
    'P4-AUTO-TABLE-MATRIX':
      'querynot-fixture-harness::check_table_editing across all five exact network fixtures',
    'P4-AUTO-TABLE-METADATA-COMPATIBILITY':
      'querynot-fixture-harness::check_table_editing > key and index metadata counters across all five exact network fixtures',
    'P4-AUTO-HISTORY':
      'querynot_core::store::tests::history_search_delete_retention_and_clear_are_immediate',
    'P4-AUTO-WORKSPACE-FILES':
      'src/phase4-contracts.test.ts > external-change and ephemeral-staging boundaries',
    'P4-AUTO-CREDENTIAL-BUNDLE':
      'querynot_core::vault::tests::vault_bundle_round_trips_both_secrets_and_reads_legacy_passwords',
    'P4-AUTO-CONTEXT-LOSS':
      'src/phase4-contracts.test.ts > dedicated context and no-replay loss boundaries',
    'P4-AUTO-EDITOR-COMPLETION':
      'src/phase2-contracts.test.ts and src/phase4-contracts.test.ts > CodeMirror schema completion, diagnostics, and shortcuts',
    'P4-AUTO-NO-IMPLICIT-EXECUTION':
      'src/phase4-contracts.test.ts > offline history/file/schema action boundaries'
  },
  phase_gate: {
    functional_requirements_local_automation: failure ? 'see checks' : 'pass',
    table_editing_sqlite_and_exact_network_matrix: failure
      ? 'see checks'
      : 'pass_local',
    history_drafts_and_external_file_safety: failure
      ? 'see checks'
      : 'pass_local',
    editor_schema_context_and_no_implicit_execution: failure
      ? 'see checks'
      : 'pass_local',
    dependency_license_and_vulnerability_review: failure
      ? 'see checks'
      : 'pass',
    acceptance_criteria_01_through_11_and_16_through_19: failure
      ? 'see checks'
      : 'pass_local_where_automatable',
    target_platform_interaction_and_accessibility:
      'pending Phase 5 Windows/macOS/Linux procedures'
  },
  release_blockers_remaining: [
    'Phase 5 native target-platform accessibility, performance, packaging, diagnostics, and manual safety procedures remain incomplete.',
    'The fixed five-day dogfood period and five-person opt-in beta cannot be inferred from automation and remain unperformed.',
    'Phase 6 follow-up and final release-evidence closure remain incomplete.'
  ],
  table_conformance_report: 'evidence/phase-4/table-conformance-report.json',
  dependency_review: 'evidence/phase-4/dependency-review.json',
  failure
};
writeFileSync(
  resolve(evidenceDirectory, 'validation-report.json'),
  `${JSON.stringify(report, null, 2)}\n`
);

if (failure) throw new Error(failure);
process.stdout.write(
  `Phase 4 local verification passed for ${sourceCommit}; retained reports in evidence/phase-4\n`
);
