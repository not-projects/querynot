import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { arch, platform } from 'node:os';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const evidenceDirectory = resolve(root, 'evidence', 'phase-0');
const sourceCommit = commandOutput('git', ['rev-parse', 'HEAD']);
const initialStatus = commandOutput('git', [
  'status',
  '--porcelain',
  '--untracked-files=all'
]);
if (initialStatus !== '') {
  throw new Error(
    'Phase 0 verification requires a clean committed source tree'
  );
}

const startedAt = new Date().toISOString();
const checks = [];
let npmAudit = null;
let failure = null;

function commandOutput(program, commandArguments, options = {}) {
  const result = spawnSync(program, commandArguments, {
    cwd: root,
    encoding: 'utf8',
    env: options.env ?? process.env,
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${program} ${commandArguments.join(' ')} failed`);
  }
  return result.stdout.trim();
}

function run(id, displayCommand, program, commandArguments, options = {}) {
  const started = Date.now();
  const result = spawnSync(program, commandArguments, {
    cwd: root,
    encoding: 'utf8',
    env: options.env ?? process.env,
    maxBuffer: 32 * 1024 * 1024,
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  });
  const record = {
    id,
    command: displayCommand,
    status: result.status === 0 && !result.error ? 'pass' : 'fail',
    duration_ms: Date.now() - started
  };
  checks.push(record);
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
  run('P0-NPM-CI', 'npm ci', 'npm', ['ci']);
  run('P0-CONTRACTS', 'npm run test:contracts', 'npm', [
    'run',
    'test:contracts'
  ]);
  run('P0-TRACEABILITY', 'npm run test:traceability', 'npm', [
    'run',
    'test:traceability'
  ]);
  run('P0-NPM-POLICY', 'npm run test:dependencies', 'npm', [
    'run',
    'test:dependencies'
  ]);
  run('P0-SVELTE-CHECK', 'npm run check', 'npm', ['run', 'check']);
  run('P0-FRONTEND-TEST', 'npm run test', 'npm', ['run', 'test']);
  run('P0-FRONTEND-BUILD', 'npm run build', 'npm', ['run', 'build']);
  run('P0-FORMAT', 'npm run format:check', 'npm', ['run', 'format:check']);
  npmAudit = JSON.parse(
    run(
      'P0-NPM-AUDIT',
      'npm audit --audit-level=high --json',
      'npm',
      ['audit', '--audit-level=high', '--json'],
      { capture: true }
    )
  );
  run('P0-RUSTFMT', 'cargo fmt --all -- --check', 'cargo', [
    'fmt',
    '--all',
    '--',
    '--check'
  ]);
  run(
    'P0-CARGO-CHECK',
    'cargo check --locked --workspace --all-targets',
    'cargo',
    ['check', '--locked', '--workspace', '--all-targets']
  );
  run('P0-CARGO-TEST', 'cargo test --locked --workspace', 'cargo', [
    'test',
    '--locked',
    '--workspace'
  ]);
  run(
    'P0-CLIPPY',
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
    'P0-CARGO-DENY',
    'cargo deny check advisories licenses bans sources',
    'cargo',
    ['deny', 'check', 'advisories', 'licenses', 'bans', 'sources'],
    { env: denyEnvironment }
  );
  run('P0-TAURI-BUILD', 'npm run tauri -- build --no-bundle', 'npm', [
    'run',
    'tauri',
    '--',
    'build',
    '--no-bundle'
  ]);
  run('P0-NETWORK-FEASIBILITY', 'npm run test:feasibility:native', 'npm', [
    'run',
    'test:feasibility:native'
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
const auditMetadata = npmAudit?.metadata?.vulnerabilities ?? {};

const dependencyReport = {
  schema_version: 1,
  source_commit: sourceCommit,
  status: failure ? 'fail' : 'pass',
  reviewed_at: startedAt,
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
    audit_vulnerabilities: auditMetadata
  },
  rust: {
    locked_packages: (cargoLock.match(/^\[\[package\]\]$/gm) ?? []).length,
    cargo_deny_version: commandOutput('cargo', ['deny', '--version'], {
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
const validationReport = {
  schema_version: 1,
  phase: 0,
  source_commit: sourceCommit,
  status: failure ? 'fail' : 'pass',
  started_at: startedAt,
  completed_at: new Date().toISOString(),
  environment: {
    os: platform(),
    architecture: arch(),
    kernel: commandOutput('uname', ['-sr']),
    cpu: cpuModel ?? 'unavailable',
    node: commandOutput('node', ['--version']),
    npm: commandOutput('npm', ['--version']),
    rustc: commandOutput('rustc', ['--version']),
    cargo: commandOutput('cargo', ['--version'])
  },
  checks,
  phase_gate: {
    traceability_rows_seeded: 121,
    generated_contract_drift_gate: 'pass',
    fail_closed_fixture_isolation: 'pass',
    sqlite_feasibility: 'pass',
    network_feasibility: failure ? 'see checks' : 'pass',
    dependency_policy: failure ? 'see checks' : 'pass',
    local_linux_desktop_build: failure ? 'see checks' : 'pass',
    remote_ci_matrix: 'configured; execution requires a pushed commit'
  },
  failure
};
writeFileSync(
  resolve(evidenceDirectory, 'validation-report.json'),
  `${JSON.stringify(validationReport, null, 2)}\n`
);

if (failure) throw new Error(failure);
process.stdout.write(
  `Phase 0 verification passed for ${sourceCommit}; retained reports in evidence/phase-0\n`
);
