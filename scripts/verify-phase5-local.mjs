import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { arch, platform } from 'node:os';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const evidenceDirectory = resolve(root, 'evidence', 'phase-5');
const conformancePath = resolve(
  evidenceDirectory,
  'adapter-conformance-report.json'
);
const uiLayoutPath = resolve(root, 'artifacts', 'ui-layout-report.json');
const retainedUiLayoutPath = resolve(
  evidenceDirectory,
  'ui-layout-report.json'
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
  if (result.status !== 0)
    throw new Error(`${program} ${args.join(' ')} failed`);
  return result.stdout.trim();
}

if (platform() !== 'linux' || arch() !== 'x64') {
  throw new Error(
    'Phase 5 local verification currently requires a native Linux x86-64 host'
  );
}
const sourceCommit = output('git', ['rev-parse', 'HEAD']);
if (output('git', ['status', '--porcelain', '--untracked-files=all']) !== '') {
  throw new Error(
    'Phase 5 local verification requires a clean committed source tree'
  );
}

const startedAt = new Date().toISOString();
const checks = [];
let failure = null;
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
    throw new Error('Phase 5 adapter conformance is incomplete or stale');
  }
  for (const result of report.network_results) {
    if (!expected.delete(result.id))
      throw new Error(
        `unexpected or duplicate conformance target ${result.id}`
      );
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
      throw new Error(
        `${result.id} lacks a required candidate conformance assertion`
      );
    }
  }
  if (expected.size !== 0)
    throw new Error('a Phase 5 database target is missing');
}

const denyEnvironment = {
  ...process.env,
  ...(process.env.QUERYNOT_CARGO_DENY_HOME
    ? { CARGO_HOME: process.env.QUERYNOT_CARGO_DENY_HOME }
    : {})
};

try {
  const evidenceGate = spawnSync('npm', ['run', 'test:release-evidence'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (
    evidenceGate.status === 0 ||
    !`${evidenceGate.stderr ?? ''}${evidenceGate.stdout ?? ''}`.includes(
      'release manifest is not ready_to_publish'
    )
  ) {
    throw new Error(
      'incomplete Phase 5 evidence did not fail closed for the expected reason'
    );
  }
  checks.push({
    id: 'P5-EVIDENCE-FAIL-CLOSED',
    command: 'npm run test:release-evidence',
    status: 'pass_expected_incomplete',
    duration_ms: 0
  });
  const publicationGate = spawnSync(
    'npm',
    [
      'run',
      'release:prepare-publication',
      '--',
      '--directory',
      'artifacts/candidate',
      '--output',
      'artifacts/publication',
      '--tag',
      'v0.1.0',
      '--confirm',
      'publish-v0.1.0',
      '--report',
      'artifacts/publication-plan.json'
    ],
    {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );
  if (
    publicationGate.status === 0 ||
    !`${publicationGate.stderr ?? ''}${publicationGate.stdout ?? ''}`.includes(
      'Phase 5 release evidence gate did not pass; publication is forbidden'
    )
  ) {
    throw new Error(
      'incomplete Phase 5 evidence did not block Phase 6 publication'
    );
  }
  checks.push({
    id: 'P6-PUBLICATION-FAIL-CLOSED',
    command: 'npm run release:prepare-publication',
    status: 'pass_expected_incomplete',
    duration_ms: 0
  });
  run('P5-NPM-CI', 'npm ci', 'npm', ['ci']);
  run('P5-CONTRACTS', 'npm run test:contracts', 'npm', [
    'run',
    'test:contracts'
  ]);
  run('P5-TRACEABILITY', 'npm run test:traceability', 'npm', [
    'run',
    'test:traceability'
  ]);
  run('P5-NPM-POLICY', 'npm run test:dependencies', 'npm', [
    'run',
    'test:dependencies'
  ]);
  npmAudit = JSON.parse(
    run(
      'P5-NPM-AUDIT',
      'npm audit --audit-level=high --json',
      'npm',
      ['audit', '--audit-level=high', '--json'],
      { capture: true }
    )
  );
  run('P5-SVELTE-CHECK', 'npm run check', 'npm', ['run', 'check']);
  run('P5-FRONTEND-TEST', 'npm run test', 'npm', ['run', 'test']);
  run('P5-UI-LAYOUT', 'npm run test:ui-layout', 'npm', [
    'run',
    'test:ui-layout'
  ]);
  const uiLayout = JSON.parse(readFileSync(uiLayoutPath, 'utf8'));
  if (
    uiLayout?.status !== 'pass' ||
    uiLayout?.source_commit !== sourceCommit ||
    uiLayout?.layouts?.length !== 4 ||
    uiLayout?.dialog_themes?.length !== 4
  ) {
    throw new Error('UI layout evidence is incomplete or stale');
  }
  copyFileSync(uiLayoutPath, retainedUiLayoutPath);
  run('P5-FRONTEND-BUILD', 'npm run build', 'npm', ['run', 'build']);
  run('P5-FORMAT', 'npm run format:check', 'npm', ['run', 'format:check']);
  run('P5-RUSTFMT', 'cargo fmt --all -- --check', 'cargo', [
    'fmt',
    '--all',
    '--',
    '--check'
  ]);
  run(
    'P5-CARGO-CHECK',
    'cargo check --locked --workspace --all-targets',
    'cargo',
    ['check', '--locked', '--workspace', '--all-targets']
  );
  run(
    'P5-CARGO-TEST',
    'cargo test --locked --workspace --all-targets',
    'cargo',
    ['test', '--locked', '--workspace', '--all-targets']
  );
  run(
    'P5-CLIPPY',
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
    'P5-CARGO-DENY',
    'cargo deny --offline check advisories licenses bans sources',
    'cargo',
    ['deny', '--offline', 'check', 'advisories', 'licenses', 'bans', 'sources'],
    { env: denyEnvironment }
  );
  run(
    'P5-ADAPTER-CONFORMANCE',
    'npm run test:conformance:phase5',
    'npm',
    ['run', 'test:conformance:phase5'],
    { capture: true }
  );
  assertConformance(JSON.parse(readFileSync(conformancePath, 'utf8')));
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
}

mkdirSync(evidenceDirectory, { recursive: true });
const packageLock = JSON.parse(
  readFileSync(resolve(root, 'package-lock.json'), 'utf8')
);
const licenseCounts = {};
for (const [path, entry] of Object.entries(packageLock.packages ?? {})) {
  if (path && entry.license)
    licenseCounts[entry.license] = (licenseCounts[entry.license] ?? 0) + 1;
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
  phase_5_direct_dependency_additions: [],
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
  phase: 5,
  source_commit: sourceCommit,
  application_version: '0.1.0',
  status: failure ? 'fail' : 'pass_local_automation',
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
    'P5-AUTO-RELEASE-CONTRACTS':
      'src/phase5-release.test.ts > candidate version, packaging, unsigned guidance, and fail-closed evidence contracts',
    'P5-AUTO-UI-LAYOUT':
      'scripts/check-ui-layout.mjs > large/narrow viewport status-bar geometry, PostNot theme names, and opaque themed dialogs',
    'P5-AUTO-ARTIFACT-INSPECTION':
      'scripts/inspect-release-artifacts.mjs > package count, binary material, updater, CSP, and capability inspection',
    'P5-AUTO-CHECKSUMS':
      'scripts/release-checksums.mjs > commit-addressed SHA-256 records for nonempty regular packages',
    'P5-AUTO-ADAPTER-CONFORMANCE':
      'querynot-fixture-harness across the exact five-server release candidate matrix',
    'P5-AUTO-RELEASE-EVIDENCE':
      'src/release-evidence-audit.test.ts and scripts/audit-release-evidence.mjs > positive and fail-closed exact 101-requirement, 20-criterion, native-matrix, checksum, and raw-performance release gate',
    'P6-AUTO-PUBLICATION-GUARD':
      'src/phase6-release.test.ts and scripts/release-publication.mjs > exact reviewed artifact, checksum, tag, confirmation, and Phase 5 prerequisite boundary'
  },
  phase_gate: {
    local_regression_dependency_and_conformance: failure
      ? 'see checks'
      : 'pass',
    wsl2_engineering_automation: failure ? 'see checks' : 'pass',
    windows_11_x64_nsis_build_and_inspection: 'pending_ci_candidate',
    native_owner_journey: 'post_release_unperformed',
    native_accessibility_performance_safety_and_security:
      'post_release_unperformed',
    fixed_five_day_dogfood: 'post_release_unperformed',
    external_beta: 'post_release_deferred',
    all_20_acceptance_criteria: 'incomplete',
    release_evidence_bundle: 'incomplete'
  },
  release_blockers_remaining: [
    'The Windows 11 x86-64 NSIS candidate must be built, inspected, and checksummed by CI.',
    'Traceability and the release manifest must remain incomplete until the retained Windows candidate evidence is complete.'
  ],
  adapter_conformance_report:
    'evidence/phase-5/adapter-conformance-report.json',
  ui_layout_report: 'evidence/phase-5/ui-layout-report.json',
  release_tool_inputs: 'fixtures/release-tool-inputs.json',
  dependency_review: 'evidence/phase-5/dependency-review.json',
  failure
};
writeFileSync(
  resolve(evidenceDirectory, 'local-validation-report.json'),
  `${JSON.stringify(report, null, 2)}\n`
);

if (failure) throw new Error(failure);
process.stdout.write(
  `Phase 5 WSL2 automation passed for ${sourceCommit}; Windows candidate and final evidence gates remain incomplete\n`
);
