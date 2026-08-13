import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { arch, platform } from 'node:os';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const evidenceDirectory = resolve(root, 'evidence', 'phase-1');
const sourceCommit = output('git', ['rev-parse', 'HEAD']);
const initialStatus = output('git', [
  'status',
  '--porcelain',
  '--untracked-files=all'
]);
if (initialStatus !== '') {
  throw new Error(
    'Phase 1 verification requires a clean committed source tree so evidence identifies exact code'
  );
}

const startedAt = new Date().toISOString();
const checks = [];
let failure = null;

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
  run('P1-NPM-CI', 'npm ci', 'npm', ['ci']);
  run('P1-CONTRACTS', 'npm run test:contracts', 'npm', [
    'run',
    'test:contracts'
  ]);
  run('P1-TRACEABILITY', 'npm run test:traceability', 'npm', [
    'run',
    'test:traceability'
  ]);
  run('P1-SVELTE-CHECK', 'npm run check', 'npm', ['run', 'check']);
  run('P1-FRONTEND-TEST', 'npm run test', 'npm', ['run', 'test']);
  run('P1-FRONTEND-BUILD', 'npm run build', 'npm', ['run', 'build']);
  run('P1-FORMAT', 'npm run format:check', 'npm', ['run', 'format:check']);
  run('P1-RUSTFMT', 'cargo fmt --all -- --check', 'cargo', [
    'fmt',
    '--all',
    '--',
    '--check'
  ]);
  run(
    'P1-CARGO-CHECK',
    'cargo check --locked --workspace --all-targets',
    'cargo',
    ['check', '--locked', '--workspace', '--all-targets']
  );
  run('P1-CARGO-TEST', 'cargo test --locked --workspace', 'cargo', [
    'test',
    '--locked',
    '--workspace'
  ]);
  run(
    'P1-CLIPPY',
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
    'P1-CARGO-DENY',
    'cargo deny check advisories licenses bans sources',
    'cargo',
    ['deny', 'check', 'advisories', 'licenses', 'bans', 'sources'],
    { env: denyEnvironment }
  );
  run('P1-TAURI-BUILD', 'npm run tauri -- build --no-bundle', 'npm', [
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
  phase: 1,
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
    'P1-AUTO-STATE-MACHINES':
      'querynot_core::state::tests::every_required_machine_has_valid_and_safe_invalid_transitions',
    'P1-AUTO-OWNERSHIP':
      'querynot_core::ownership::tests::cross_profile_and_cross_window_access_fails_closed',
    'P1-AUTO-RELOAD-CLEANUP':
      'querynot_core::ownership::tests::frontend_reload_produces_native_cleanup_plan',
    'P1-AUTO-MIGRATION-ROLLBACK':
      'querynot_core::store::tests::migrations_are_forward_only_transactional_and_preserve_last_valid_version',
    'P1-AUTO-STORE-CORRUPTION':
      'querynot_core::store::tests::corruption_never_causes_replacement_with_a_fresh_store',
    'P1-AUTO-SECRET-EXCLUSION':
      'querynot_core::store::tests::local_store_contains_only_an_opaque_reference_never_secret_material',
    'P1-AUTO-VAULT-REFUSAL':
      'querynot_core::vault::tests::rejected_replacement_preserves_existing_secret_and_never_formats_it',
    'P1-AUTO-PROFILE-DELETION':
      'querynot_core::store::tests::deletion_is_recoverable_retriable_and_relabels_retained_drafts',
    'P1-AUTO-OFFLINE-RESTORE':
      'querynot_core::workspace::tests::restoration_preserves_drafts_binding_order_and_context_without_execution_state',
    'P1-AUTO-SETTINGS-RESET':
      'querynot_core::store::tests::settings_profiles_and_offline_workspace_round_trip',
    'P1-AUTO-REDACTED-LOG':
      'querynot_core::diagnostics::tests::log_is_structured_bounded_retained_and_contains_no_arbitrary_sensitive_fields',
    'P1-AUTO-FIRST-RUN-A11Y':
      'src/workbench.test.ts > offers every keyboard-reachable first-run route without execution controls',
    'P1-AUTO-SETTINGS-A11Y':
      'src/workbench.test.ts > renders an accessible settings dialog with all documented local defaults',
    'P1-AUTO-THEME-CONTRAST':
      'src/phase1-boundaries.test.ts > keeps normal text and semantic accents above WCAG AA contrast in every theme',
    'P1-AUTO-FILE-PROVENANCE':
      'src/phase1-boundaries.test.ts > allocates tab IDs and file grants natively and never exposes a native SQLite path',
    'P1-AUTO-NO-TELEMETRY':
      'src/phase1-boundaries.test.ts > has no query-execution command and no frontend filesystem or network capability'
  },
  phase_gate: {
    local_store_transactional_migrations: failure ? 'see checks' : 'pass',
    vault_abstraction_and_fault_injection: failure
      ? 'see checks'
      : 'pass_fake_vault',
    secret_exclusion: failure ? 'see checks' : 'pass',
    required_state_machines: failure ? 'see checks' : '8_of_8_pass',
    native_resource_ownership: failure ? 'see checks' : 'pass',
    native_file_grant_boundary: failure ? 'see checks' : 'pass',
    offline_restore_without_execution: failure ? 'see checks' : 'pass',
    settings_logs_and_diagnostics: failure ? 'see checks' : 'pass',
    local_linux_accessibility_automation: failure ? 'see checks' : 'pass',
    local_linux_desktop_build: failure ? 'see checks' : 'pass',
    real_os_vault_integration:
      'pending Windows/macOS/Linux desktop-platform integration procedure',
    target_platform_manual_accessibility:
      'pending Windows/macOS/Linux Phase 5 manual review',
    cross_platform_ci:
      'configured; Windows/macOS/Linux execution requires a pushed commit'
  },
  release_blockers_remaining: [
    'Real OS-vault behavior remains unverified on Windows, macOS, and Linux desktop sessions.',
    'The Phase 1 shell has not completed target-platform manual keyboard, screen-reader, scale, narrow-width, and visual review.',
    'Later phase connection, query, results, editing, packaging, dogfood, beta, and release gates remain incomplete.'
  ],
  failure
};
writeFileSync(
  resolve(evidenceDirectory, 'validation-report.json'),
  `${JSON.stringify(report, null, 2)}\n`
);

if (failure) throw new Error(failure);
process.stdout.write(
  `Phase 1 local verification passed for ${sourceCommit}; retained report in evidence/phase-1\n`
);
