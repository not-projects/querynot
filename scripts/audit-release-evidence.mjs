import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  expectedArtifacts,
  osMatrix,
  parseChecksumManifest,
  safeArtifactName
} from './release-evidence-contract.mjs';

const root = resolve(import.meta.dirname, '..');
const phase5Root = resolve(root, 'evidence', 'phase-5');
const failures = [];

function requireCondition(condition, message) {
  if (!condition) failures.push(message);
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    failures.push(`${label} is missing or invalid JSON`);
    return null;
  }
}

function recordsBy(records, key, label) {
  if (!Array.isArray(records)) {
    failures.push(`${label} must be an array`);
    return new Map();
  }
  const mapped = new Map();
  for (const record of records) {
    const id = record?.[key];
    if (typeof id !== 'string' || id.length === 0 || mapped.has(id)) {
      failures.push(`${label} has a missing or duplicate ${key}`);
      continue;
    }
    mapped.set(id, record);
  }
  return mapped;
}

function retainedFile(repositoryPath) {
  if (
    typeof repositoryPath !== 'string' ||
    repositoryPath.includes('..') ||
    repositoryPath.includes('templates/')
  ) {
    return false;
  }
  const path = resolve(root, repositoryPath);
  if (path !== root && !path.startsWith(`${root}${sep}`)) return false;
  if (!existsSync(path)) return false;
  const stat = lstatSync(path);
  return (
    stat.isFile() &&
    !stat.isSymbolicLink() &&
    stat.size > 0 &&
    realpathSync(path) === path
  );
}

function exactStrings(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

const paths = {
  manifest: 'evidence/release/manifest.json',
  local: 'evidence/phase-5/local-validation-report.json',
  dependencies: 'evidence/phase-5/dependency-review.json',
  adapter: 'evidence/phase-5/adapter-conformance-report.json',
  ui: 'evidence/phase-5/ui-layout-report.json',
  inspection: 'evidence/phase-5/windows-artifact-inspection.json',
  checksums: 'evidence/phase-5/windows-checksums.json',
  checksumManifest: 'evidence/phase-5/SHA256SUMS',
  packaging: 'evidence/phase-5/packaging-results.json',
  scope: 'evidence/phase-5/product-owner-scope.json',
  traceability: 'traceability/requirements.json'
};

const manifest = readJson(resolve(root, paths.manifest), 'release manifest');
const packageJson = readJson(resolve(root, 'package.json'), 'package.json');
requireCondition(
  manifest?.release_status === 'ready_to_publish',
  'release manifest is not ready_to_publish'
);
const sourceCommit = manifest?.source_commit;
requireCondition(
  typeof sourceCommit === 'string' && /^[a-f0-9]{40}$/.test(sourceCommit),
  'release manifest must name one exact 40-character source commit'
);
requireCondition(
  manifest?.application_version === packageJson?.version &&
    manifest?.release_tag === `v${packageJson?.version}`,
  'release manifest version or tag does not match package.json'
);

const sourceAncestor = spawnSync(
  'git',
  ['merge-base', '--is-ancestor', sourceCommit ?? '', 'HEAD'],
  { cwd: root, encoding: 'utf8' }
);
const gitStatus = spawnSync(
  'git',
  ['status', '--porcelain', '--untracked-files=all'],
  { cwd: root, encoding: 'utf8' }
);
const evidenceDiff = spawnSync(
  'git',
  ['diff', '--name-only', sourceCommit ?? '', 'HEAD'],
  { cwd: root, encoding: 'utf8' }
);
const allowedClosurePaths = [
  'evidence/',
  'traceability/',
  'docs/compatibility-matrix.md',
  'docs/release/initial-release-notes.md',
  'docs/release/unsigned-installation.md',
  'README.md',
  'AGENTS.md',
  'CHANGELOG.md'
];
requireCondition(
  sourceAncestor.status === 0,
  'release source commit is not an ancestor of the evidence commit'
);
requireCondition(
  evidenceDiff.status === 0 &&
    evidenceDiff.stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .every((path) =>
        allowedClosurePaths.some(
          (allowed) => path === allowed || path.startsWith(allowed)
        )
      ),
  'application or packaging inputs changed after the release source commit'
);
requireCondition(
  gitStatus.status === 0 && gitStatus.stdout.trim() === '',
  'release evidence audit requires a clean source tree'
);

for (const [label, path] of Object.entries(paths)) {
  requireCondition(retainedFile(path), `${label} is not retained safely`);
}

const local = readJson(resolve(root, paths.local), 'local validation report');
const dependencies = readJson(
  resolve(root, paths.dependencies),
  'dependency review'
);
const adapter = readJson(resolve(root, paths.adapter), 'adapter conformance');
const ui = readJson(resolve(root, paths.ui), 'UI layout report');
const inspection = readJson(
  resolve(root, paths.inspection),
  'Windows artifact inspection'
);
const checksums = readJson(resolve(root, paths.checksums), 'Windows checksums');
const packaging = readJson(resolve(root, paths.packaging), 'packaging results');
const scope = readJson(resolve(root, paths.scope), 'product owner scope');
const traceability = readJson(
  resolve(root, paths.traceability),
  'traceability matrix'
);

for (const [label, report] of [
  ['local validation report', local],
  ['dependency review', dependencies],
  ['UI layout report', ui],
  ['Windows artifact inspection', inspection],
  ['Windows checksums', checksums],
  ['packaging results', packaging],
  ['product owner scope', scope]
]) {
  requireCondition(
    report?.schema_version === 1 && report?.source_commit === sourceCommit,
    `${label} is not tied to the exact release source commit`
  );
}
requireCondition(
  adapter?.schema_version === 1 && adapter?.tested_source === sourceCommit,
  'adapter conformance is not tied to the exact release source commit'
);

requireCondition(
  local?.phase === 5 && local?.status === 'pass_local_automation',
  'Phase 5 local automation did not pass'
);
requireCondition(
  Array.isArray(local?.checks) &&
    local.checks.length > 0 &&
    local.checks.every((check) =>
      ['pass', 'pass_expected_incomplete'].includes(check.status)
    ),
  'Phase 5 local validation contains a failed or missing check'
);
requireCondition(
  dependencies?.status === 'pass' &&
    dependencies?.npm?.audit_vulnerabilities?.high === 0 &&
    dependencies?.npm?.audit_vulnerabilities?.critical === 0 &&
    dependencies?.rust?.new_advisories === 0 &&
    dependencies?.rust?.cargo_deny_version === 'cargo-deny 0.20.2',
  'dependency review did not pass the pinned release policy'
);

const expectedTargets = new Set([
  'mysql-5.7.44',
  'mysql-8.0.46',
  'mysql-8.4.10',
  'mariadb-10.11.18',
  'mariadb-11.4.12'
]);
requireCondition(
  adapter?.status === 'pass',
  'adapter conformance did not pass'
);
for (const result of adapter?.network_results ?? []) {
  const table = result?.adapter?.table_editing;
  requireCondition(
    expectedTargets.delete(result?.id) &&
      result?.marker_verified === true &&
      result?.adapter?.supported_capability_profile === true &&
      table?.deterministic_keyset_paging === true &&
      table?.bound_structured_filters === true &&
      table?.typed_validation === true &&
      table?.insert_update_delete === true &&
      table?.generated_value_refresh === true &&
      table?.optimistic_conflict_atomic_rollback === true,
    `adapter conformance target ${result?.id ?? 'unknown'} is incomplete`
  );
}
requireCondition(
  expectedTargets.size === 0 && adapter?.network_results?.length === 5,
  'adapter conformance does not contain the exact five-server matrix'
);

requireCondition(
  ui?.status === 'pass' &&
    exactStrings(
      ui?.layouts?.map((layout) => String(layout.viewport_width)),
      ['2048', '1280', '960', '720']
    ) &&
    exactStrings(ui?.theme_labels, ['System', 'Light', 'Dark', 'Forest']) &&
    ui?.dialog_themes?.length === 4 &&
    ui.dialog_themes.every(
      (dialog) =>
        dialog.inside_theme_context === true &&
        !['transparent', 'rgba(0, 0, 0, 0)'].includes(dialog.background_color)
    ) &&
    ui.layouts.every(
      (layout) =>
        layout.document_scroll_width <= layout.viewport_width &&
        layout.footer_height <= 40 &&
        Math.abs(layout.footer_bottom - 1068) < 1 &&
        layout.workbench_bottom <= layout.footer_top
    ),
  'browser layout, theme, or dialog evidence did not pass'
);

requireCondition(
  inspection?.status === 'pass' &&
    inspection?.application_version === packageJson?.version &&
    inspection?.environment?.os === 'win32' &&
    inspection?.environment?.architecture === 'x64' &&
    inspection?.updater_artifacts === false &&
    inspection?.capability_and_csp_review === 'pass' &&
    inspection?.artifacts?.length === 1 &&
    inspection.artifacts[0]?.format === 'nsis',
  'Windows NSIS artifact inspection did not pass'
);
requireCondition(
  checksums?.algorithm === 'sha256' &&
    checksums?.application_version === packageJson?.version &&
    checksums?.artifacts?.length === 1,
  'Windows checksum record is incomplete'
);

let checksumManifest = new Map();
try {
  checksumManifest = parseChecksumManifest(
    readFileSync(resolve(root, paths.checksumManifest), 'utf8')
  );
} catch (error) {
  failures.push(
    `SHA256SUMS is invalid: ${error instanceof Error ? error.message : error}`
  );
}
const inspectedArtifact = inspection?.artifacts?.[0];
const checksumArtifact = checksums?.artifacts?.[0];
requireCondition(
  safeArtifactName(inspectedArtifact?.name) &&
    inspectedArtifact?.name === checksumArtifact?.name &&
    inspectedArtifact?.bytes === checksumArtifact?.bytes &&
    inspectedArtifact?.sha256 === checksumArtifact?.sha256 &&
    checksumManifest.size === 1 &&
    checksumManifest.get(inspectedArtifact?.name) === inspectedArtifact?.sha256,
  'retained Windows artifact checksums do not match inspection'
);

const packaged = recordsBy(packaging?.artifacts, 'id', 'packaging artifacts');
requireCondition(
  packaging?.status === 'pass' &&
    packaging?.updater_artifacts === false &&
    packaging?.checksum_verification === 'pass' &&
    packaging?.checksum_manifest === paths.checksumManifest &&
    packaged.size === expectedArtifacts.size,
  'packaging evidence is incomplete or contains an unsupported artifact'
);
for (const [id, format] of expectedArtifacts) {
  const artifact = packaged.get(id);
  requireCondition(
    artifact?.format === format &&
      artifact?.name === inspectedArtifact?.name &&
      artifact?.bytes === inspectedArtifact?.bytes &&
      artifact?.sha256 === inspectedArtifact?.sha256 &&
      artifact?.unsigned === true &&
      artifact?.evidence_link === paths.inspection,
    `packaging evidence does not match reviewed artifact ${id}`
  );
}

const expectedPostRelease = {
  native_windows_owner_journey: 'unperformed',
  manual_safety_accessibility_performance: 'unperformed',
  fixed_five_day_dogfood: 'unperformed',
  external_beta: 'deferred_single_participant'
};
requireCondition(
  scope?.status === 'approved_revision' &&
    scope?.decision ===
      'docs/architecture/0010-windows-first-release-validation-boundary.md' &&
    exactStrings(scope?.release_platforms, osMatrix) &&
    scope?.initial_participants === 1 &&
    JSON.stringify(scope?.post_release_validation) ===
      JSON.stringify(expectedPostRelease) &&
    scope?.attestation === 'Unperformed checks are not represented as pass.',
  'product owner scope does not preserve the approved post-release non-claims'
);

const traceRecords = Array.isArray(traceability?.records)
  ? traceability.records
  : [];
requireCondition(
  traceRecords.filter((record) => record.kind === 'requirement').length ===
    101 &&
    traceRecords.filter((record) => record.kind === 'acceptance_criterion')
      .length === 20,
  'traceability does not contain exactly 101 requirements and 20 acceptance criteria'
);
for (const record of traceRecords) {
  const verificationIds = [
    ...(record?.automated_test_ids ?? []),
    ...(record?.manual_procedure_ids ?? [])
  ];
  requireCondition(
    record?.priority === 'must' && record?.status === 'verified',
    `${record?.id ?? 'unknown'} is not a verified must row`
  );
  requireCondition(
    verificationIds.length > 0 &&
      verificationIds.every((id) => !/^(PLANNED|PENDING|P5-MAN)-/.test(id)),
    `${record?.id ?? 'unknown'} has a planned, pending, or obsolete manual verification`
  );
  requireCondition(
    Array.isArray(record?.evidence_links) &&
      record.evidence_links.includes(paths.local) &&
      record.evidence_links.includes(paths.scope) &&
      record.evidence_links.every(retainedFile),
    `${record?.id ?? 'unknown'} lacks retained release-boundary evidence`
  );
}

const reviewed = recordsBy(
  manifest?.reviewed_artifacts,
  'id',
  'release manifest artifacts'
);
requireCondition(
  reviewed.size === expectedArtifacts.size &&
    manifest?.checksums?.length === 1 &&
    manifest.checksums[0] === paths.checksumManifest &&
    manifest?.product_owner_scope === paths.scope &&
    exactStrings(manifest?.release_platforms, osMatrix) &&
    manifest?.approved_exceptions?.length === 0,
  'release manifest does not contain the exact reviewed Windows release boundary'
);
for (const [id] of expectedArtifacts) {
  const artifact = reviewed.get(id);
  requireCondition(
    artifact?.name === inspectedArtifact?.name &&
      artifact?.bytes === inspectedArtifact?.bytes &&
      artifact?.sha256 === inspectedArtifact?.sha256,
    `release manifest does not match reviewed artifact ${id}`
  );
}

const compatibility = readFileSync(
  resolve(root, 'docs', 'compatibility-matrix.md'),
  'utf8'
);
requireCondition(
  compatibility.includes('Windows 11 25H2') &&
    compatibility.includes('Sole supported and published 0.1.0 row') &&
    compatibility.includes('Deferred; no `0.1.0` support or artifact claim'),
  'compatibility matrix does not state the approved Windows-only claim boundary'
);

if (failures.length > 0) {
  process.stderr.write(
    `Release evidence audit failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}\n`
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Release evidence passed for 101 requirements, 20 acceptance criteria, ${osMatrix.length} supported platform, and ${expectedArtifacts.size} reviewed artifact\n`
  );
}
