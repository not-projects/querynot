import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const evidenceRoot = resolve(root, 'evidence', 'phase-5');
const failures = [];
const requiredFiles = {
  os: 'operating-system-results.json',
  packaging: 'packaging-results.json',
  accessibility: 'accessibility-results.json',
  performance: 'performance-results.json',
  safety: 'manual-safety-review.json',
  security: 'security-review.json',
  dogfood: 'dogfood-record.json',
  beta: 'beta-record.json'
};

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    failures.push(`${label} is missing or invalid JSON`);
    return null;
  }
}
function requireCondition(condition, message) {
  if (!condition) failures.push(message);
}
function unique(values) {
  return new Set(values).size === values.length;
}
function recordsById(records) {
  return new Map(
    (Array.isArray(records) ? records : []).map((record) => [record.id, record])
  );
}
function nonemptyText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}
function validEvidenceLink(value) {
  if (
    !nonemptyText(value) ||
    !value.startsWith('evidence/phase-5/') ||
    value.includes('..')
  ) {
    return false;
  }
  const path = resolve(root, value);
  if (path !== evidenceRoot && !path.startsWith(`${evidenceRoot}${sep}`))
    return false;
  if (!existsSync(path)) return false;
  const stat = lstatSync(path);
  return (
    stat.isFile() &&
    !stat.isSymbolicLink() &&
    stat.size > 0 &&
    realpathSync(path) === path
  );
}
function requireEvidenceLink(value, message) {
  requireCondition(validEvidenceLink(value), message);
}
function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[midpoint - 1] + sorted[midpoint]) / 2
    : sorted[midpoint];
}

const releaseManifest = readJson(
  resolve(root, 'evidence', 'release', 'manifest.json'),
  'release manifest'
);
const packageJson = readJson(resolve(root, 'package.json'), 'package.json');
const sourceCommit = releaseManifest?.source_commit;
requireCondition(
  typeof sourceCommit === 'string' && /^[a-f0-9]{40}$/.test(sourceCommit),
  'release manifest must name one exact 40-character source commit'
);
requireCondition(
  releaseManifest?.release_status === 'ready_to_publish',
  'release manifest is not ready_to_publish'
);
requireCondition(
  releaseManifest?.application_version === packageJson?.version,
  'release manifest application version does not match package.json'
);
requireCondition(
  releaseManifest?.release_tag === `v${packageJson?.version}`,
  'release manifest tag does not match package.json'
);
const sourceAncestor = spawnSync(
  'git',
  ['merge-base', '--is-ancestor', sourceCommit ?? '', 'HEAD'],
  { cwd: root, encoding: 'utf8' }
);
const gitStatus = spawnSync(
  'git',
  ['status', '--porcelain', '--untracked-files=all'],
  {
    cwd: root,
    encoding: 'utf8'
  }
);
const evidenceOnlyDiff = spawnSync(
  'git',
  ['diff', '--name-only', sourceCommit ?? '', 'HEAD'],
  {
    cwd: root,
    encoding: 'utf8'
  }
);
const allowedClosurePaths = [
  'evidence/',
  'traceability/',
  'docs/compatibility-matrix.md',
  'README.md',
  'CHANGELOG.md',
  'AGENTS.md'
];
requireCondition(
  sourceAncestor.status === 0,
  'release source commit is not an ancestor of the evidence commit'
);
requireCondition(
  evidenceOnlyDiff.status === 0 &&
    evidenceOnlyDiff.stdout
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

const evidence = Object.fromEntries(
  Object.entries(requiredFiles).map(([key, file]) => [
    key,
    readJson(resolve(evidenceRoot, file), `Phase 5 ${key} evidence`)
  ])
);
for (const [key, record] of Object.entries(evidence)) {
  requireCondition(
    record?.schema_version === 1,
    `Phase 5 ${key} evidence schema is not version 1`
  );
  requireCondition(
    record?.status === 'pass',
    `Phase 5 ${key} evidence is not pass`
  );
  requireCondition(
    record?.source_commit === sourceCommit,
    `Phase 5 ${key} evidence is not tied to the release source commit`
  );
}

const automation = readJson(
  resolve(evidenceRoot, 'local-validation-report.json'),
  'Phase 5 local validation evidence'
);
const dependency = readJson(
  resolve(evidenceRoot, 'dependency-review.json'),
  'Phase 5 dependency evidence'
);
const conformance = readJson(
  resolve(evidenceRoot, 'adapter-conformance-report.json'),
  'Phase 5 adapter conformance evidence'
);
requireCondition(
  automation?.status === 'pass_local_automation',
  'Phase 5 local automation is not pass_local_automation'
);
requireCondition(
  automation?.source_commit === sourceCommit,
  'Phase 5 local automation is not tied to the release commit'
);
requireCondition(
  dependency?.status === 'pass',
  'Phase 5 dependency review did not pass'
);
requireCondition(
  dependency?.source_commit === sourceCommit,
  'Phase 5 dependency review is not tied to the release commit'
);
requireCondition(
  conformance?.status === 'pass',
  'Phase 5 adapter conformance did not pass'
);
requireCondition(
  conformance?.tested_source === sourceCommit,
  'Phase 5 adapter conformance is not tied to the release commit'
);
const conformanceTargets = new Set([
  'mysql-5.7.44',
  'mysql-8.0.46',
  'mysql-8.4.10',
  'mariadb-10.11.18',
  'mariadb-11.4.12'
]);
requireCondition(
  conformance?.network_results?.length === conformanceTargets.size,
  'Phase 5 adapter conformance does not contain exactly five targets'
);
for (const result of conformance?.network_results ?? []) {
  requireCondition(
    conformanceTargets.delete(result.id),
    `Phase 5 adapter conformance has an unexpected or duplicate target ${result.id}`
  );
  requireCondition(
    result.marker_verified === true,
    `${result.id} did not verify its disposable fixture marker`
  );
  requireCondition(
    result.adapter?.supported_capability_profile === true,
    `${result.id} did not pass its capability profile`
  );
  requireCondition(
    result.adapter?.table_editing?.optimistic_conflict_atomic_rollback === true,
    `${result.id} did not pass conflict and rollback conformance`
  );
}
requireCondition(
  conformanceTargets.size === 0,
  'Phase 5 adapter conformance is missing a target'
);
const npmVulnerabilities = dependency?.npm?.audit_vulnerabilities;
requireCondition(
  npmVulnerabilities?.critical === 0 && npmVulnerabilities?.high === 0,
  'Phase 5 npm dependency review has a critical or high vulnerability'
);
requireCondition(
  dependency?.rust?.new_advisories === 0,
  'Phase 5 Rust dependency review has a new advisory'
);
requireCondition(
  dependency?.rust?.cargo_deny_version === 'cargo-deny 0.20.2',
  'Phase 5 dependency review used the wrong cargo-deny version'
);

const osMatrix = [
  'windows-10-22h2-x64',
  'windows-11-x64',
  'macos-13-intel',
  'macos-13-apple',
  'macos-current-intel',
  'macos-current-apple',
  'ubuntu-22.04-x64',
  'ubuntu-24.04-x64'
];
const expectedArtifacts = new Map([
  ['windows-nsis-x64', 'nsis'],
  ['macos-dmg-intel', 'dmg'],
  ['macos-dmg-apple', 'dmg'],
  ['linux-appimage-x64', 'appimage'],
  ['linux-deb-x64', 'deb']
]);
const osArtifacts = new Map([
  ['windows-10-22h2-x64', ['windows-nsis-x64']],
  ['windows-11-x64', ['windows-nsis-x64']],
  ['macos-13-intel', ['macos-dmg-intel']],
  ['macos-13-apple', ['macos-dmg-apple']],
  ['macos-current-intel', ['macos-dmg-intel']],
  ['macos-current-apple', ['macos-dmg-apple']],
  ['ubuntu-22.04-x64', ['linux-appimage-x64', 'linux-deb-x64']],
  ['ubuntu-24.04-x64', ['linux-appimage-x64', 'linux-deb-x64']]
]);
const osResults = recordsById(evidence.os?.results);
requireCondition(
  osResults.size === osMatrix.length,
  'operating-system evidence must contain exactly eight matrix rows'
);
requireCondition(
  Array.isArray(evidence.os?.results) &&
    unique(evidence.os.results.map((result) => result.id)),
  'operating-system matrix IDs are not unique'
);
for (const id of osMatrix) {
  const result = osResults.get(id);
  requireCondition(
    nonemptyText(result?.os_version),
    `${id} has no exact OS version`
  );
  requireCondition(
    nonemptyText(result?.runtime_version),
    `${id} has no exact WebView runtime version`
  );
  requireCondition(
    nonemptyText(result?.architecture),
    `${id} has no architecture`
  );
  const requiredPackages = osArtifacts.get(id);
  const testedPackages = recordsById(result?.packages);
  requireCondition(
    testedPackages.size === requiredPackages.length &&
      Array.isArray(result?.packages) &&
      unique(result.packages.map((record) => record.id)),
    `${id} does not contain exactly its required package journeys`
  );
  for (const artifactId of requiredPackages) {
    const tested = testedPackages.get(artifactId);
    requireCondition(
      nonemptyText(tested?.name),
      `${id} ${artifactId} has no reviewed package name`
    );
    requireCondition(
      tested?.install === 'pass',
      `${id} ${artifactId} installation did not pass`
    );
    requireCondition(
      tested?.core_journey === 'pass',
      `${id} ${artifactId} core journey did not pass`
    );
    requireCondition(
      tested?.uninstall === 'pass',
      `${id} ${artifactId} uninstall did not pass`
    );
    requireCondition(
      tested?.unsigned_warning_observed === true,
      `${id} ${artifactId} unsigned warning was not recorded`
    );
    requireCondition(
      typeof tested?.sha256 === 'string' &&
        /^[a-f0-9]{64}$/.test(tested.sha256),
      `${id} ${artifactId} checksum is absent or invalid`
    );
    requireCondition(
      Array.isArray(tested?.evidence_links) && tested.evidence_links.length > 0,
      `${id} ${artifactId} has no retained evidence link`
    );
    for (const link of tested?.evidence_links ?? [])
      requireEvidenceLink(
        link,
        `${id} ${artifactId} has an invalid retained evidence link`
      );
  }
}

const artifacts = recordsById(evidence.packaging?.artifacts);
requireCondition(
  artifacts.size === expectedArtifacts.size,
  'packaging evidence must contain exactly five artifacts'
);
requireCondition(
  Array.isArray(evidence.packaging?.artifacts) &&
    unique(evidence.packaging.artifacts.map((artifact) => artifact.id)),
  'packaging artifact IDs are not unique'
);
for (const [id, format] of expectedArtifacts) {
  const artifact = artifacts.get(id);
  requireCondition(
    artifact?.format === format,
    `${id} has the wrong package format`
  );
  requireCondition(
    Number.isInteger(artifact?.bytes) && artifact.bytes > 0,
    `${id} is empty`
  );
  requireCondition(
    typeof artifact?.sha256 === 'string' &&
      /^[a-f0-9]{64}$/.test(artifact.sha256),
    `${id} checksum is absent or invalid`
  );
  requireCondition(
    artifact?.unsigned === true,
    `${id} is not recorded as unsigned`
  );
  requireEvidenceLink(
    artifact?.evidence_link,
    `${id} has no valid retained artifact-inspection evidence`
  );
}
for (const id of osMatrix) {
  const testedPackages = recordsById(osResults.get(id)?.packages);
  for (const artifactId of osArtifacts.get(id)) {
    const tested = testedPackages.get(artifactId);
    const artifact = artifacts.get(artifactId);
    requireCondition(
      tested?.name === artifact?.name && tested?.sha256 === artifact?.sha256,
      `${id} did not install the exact reviewed ${artifactId} artifact`
    );
  }
}
requireCondition(
  evidence.packaging?.updater_artifacts === false,
  'packaging evidence must confirm no updater artifacts'
);
requireCondition(
  evidence.packaging?.checksum_verification === 'pass',
  'published checksum verification did not pass'
);
requireEvidenceLink(
  evidence.packaging?.checksum_manifest,
  'packaging evidence has no valid retained checksum manifest'
);

const reviewedArtifacts = recordsById(releaseManifest?.reviewed_artifacts);
requireCondition(
  reviewedArtifacts.size === expectedArtifacts.size,
  'release manifest must contain exactly the five reviewed artifacts'
);
for (const [id] of expectedArtifacts) {
  const artifact = artifacts.get(id);
  const reviewed = reviewedArtifacts.get(id);
  requireCondition(
    reviewed?.name === artifact?.name &&
      reviewed?.bytes === artifact?.bytes &&
      reviewed?.sha256 === artifact?.sha256,
    `release manifest does not match reviewed artifact ${id}`
  );
}
requireCondition(
  Array.isArray(releaseManifest?.checksums) &&
    releaseManifest.checksums.length === 1 &&
    releaseManifest.checksums[0] === evidence.packaging?.checksum_manifest &&
    validEvidenceLink(releaseManifest.checksums[0]),
  'release manifest does not identify exactly the reviewed checksum file'
);

const accessibility = evidence.accessibility ?? {};
for (const theme of ['light', 'dark', 'forest']) {
  requireCondition(
    accessibility.themes?.[theme] === 'pass',
    `${theme} theme accessibility did not pass`
  );
}
for (const width of ['1280', '960', '720']) {
  requireCondition(
    accessibility.viewport_widths?.[width] === 'pass',
    `${width}px viewport review did not pass`
  );
}
for (const scale of ['80', '100', '200']) {
  requireCondition(
    accessibility.ui_scales?.[scale] === 'pass',
    `${scale}% UI scale review did not pass`
  );
}
for (const check of [
  'wcag_2_2_aa',
  'keyboard_all_functions',
  'visible_focus',
  'tablist_tree_dialog_patterns',
  'not_color_only',
  'reduced_motion',
  'no_page_horizontal_scroll'
]) {
  requireCondition(
    accessibility.checks?.[check] === 'pass',
    `accessibility check ${check} did not pass`
  );
}
requireCondition(
  Array.isArray(accessibility.platform_matrix_ids) &&
    accessibility.platform_matrix_ids.length === osMatrix.length &&
    unique(accessibility.platform_matrix_ids) &&
    osMatrix.every((id) => accessibility.platform_matrix_ids.includes(id)),
  'accessibility evidence does not cover every operating-system matrix row'
);
requireCondition(
  nonemptyText(accessibility.reviewer),
  'accessibility evidence has no reviewer'
);
requireCondition(
  Array.isArray(accessibility.evidence_links) &&
    accessibility.evidence_links.length > 0,
  'accessibility evidence has no retained evidence'
);
for (const link of accessibility.evidence_links ?? [])
  requireEvidenceLink(
    link,
    'accessibility evidence contains an invalid retained link'
  );

const performance = evidence.performance ?? {};
requireCondition(
  performance.environment?.native === true,
  'performance evidence is not from a native machine'
);
requireCondition(
  performance.environment?.ssd === true,
  'performance environment does not record SSD storage'
);
requireCondition(
  performance.environment?.memory_gib >= 16,
  'performance environment has less than 16 GiB memory'
);
requireCondition(
  performance.discarded_setup_runs === 1,
  'performance evidence must record exactly one discarded setup run'
);
for (const [name, maximum] of [
  ['cold_launch_p95_ms', 3000],
  ['local_response_p95_ms', 100],
  ['first_visible_batch_p95_ms', 100],
  ['idle_resident_memory_mib', 250],
  ['cleanup_ratio_after_10s', 1.15]
]) {
  const measurement = performance.measurements?.[name];
  requireCondition(
    measurement?.samples >= 30,
    `${name} has fewer than 30 retained samples`
  );
  requireCondition(
    Number.isFinite(measurement?.value) && measurement.value <= maximum,
    `${name} exceeds ${maximum} or is not a finite measurement`
  );
  requireEvidenceLink(
    measurement?.raw_evidence_link,
    `${name} has no valid raw evidence link`
  );
}
for (const name of ['editor_typing_fps_p95', 'result_scroll_fps_p95']) {
  const measurement = performance.measurements?.[name];
  requireCondition(
    measurement?.samples >= 30,
    `${name} has fewer than 30 retained samples`
  );
  requireCondition(
    Number.isFinite(measurement?.value) && measurement.value >= 55,
    `${name} is below 55 FPS or is not a finite measurement`
  );
  requireEvidenceLink(
    measurement?.raw_evidence_link,
    `${name} has no valid raw evidence link`
  );
}
requireCondition(
  performance.large_schema_progressive === 'pass',
  'large-schema progressive loading did not pass'
);
requireCondition(
  performance.rendered_rows_bounded === 'pass',
  'result-grid rendered-row bound did not pass'
);

const expectedSafety = [
  'credential_persistence',
  'tls_modes',
  'diagnostic_redaction',
  'history_clear',
  'destructive_confirmations',
  'transaction_close',
  'export_overwrite',
  'unsigned_installation',
  'fixture_isolation'
];
const safetyChecks = recordsById(evidence.safety?.checks);
requireCondition(
  safetyChecks.size === expectedSafety.length,
  'manual safety evidence must contain exactly nine checks'
);
requireCondition(
  Array.isArray(evidence.safety?.checks) &&
    unique(evidence.safety.checks.map((check) => check.id)),
  'manual safety check IDs are not unique'
);
for (const id of expectedSafety) {
  const check = safetyChecks.get(id);
  requireCondition(
    check?.status === 'pass',
    `manual safety check ${id} did not pass`
  );
  requireEvidenceLink(
    check?.evidence_link,
    `manual safety check ${id} lacks valid evidence`
  );
}
requireCondition(
  nonemptyText(evidence.safety?.reviewer),
  'manual safety review has no reviewer'
);

const security = evidence.security ?? {};
requireCondition(
  nonemptyText(security.reviewer),
  'security review has no reviewer'
);
requireCondition(
  security.known_critical === 0,
  'security review has a known critical issue'
);
requireCondition(
  security.known_high === 0,
  'security review has a known high issue'
);
for (const area of [
  'credential_handling',
  'tls',
  'sql_targeting',
  'transactions',
  'row_editing',
  'exports',
  'local_file_access',
  'secret_redaction'
]) {
  requireCondition(
    security.areas?.[area] === 'pass',
    `security area ${area} did not pass`
  );
}
requireCondition(
  Array.isArray(security.evidence_links) && security.evidence_links.length > 0,
  'security review has no retained evidence'
);
for (const link of security.evidence_links ?? [])
  requireEvidenceLink(
    link,
    'security review contains an invalid retained link'
  );

function nextWorkingDay(dateText) {
  const date = new Date(`${dateText}T00:00:00Z`);
  do date.setUTCDate(date.getUTCDate() + 1);
  while ([0, 6].includes(date.getUTCDay()));
  return date.toISOString().slice(0, 10);
}
const days = Array.isArray(evidence.dogfood?.days) ? evidence.dogfood.days : [];
requireCondition(
  days.length === 5,
  'dogfood record must contain exactly five working days'
);
requireCondition(
  unique(days.map((day) => day.date)),
  'dogfood dates are not unique'
);
requireCondition(
  nonemptyText(evidence.dogfood?.owner),
  'dogfood record has no project owner'
);
requireCondition(
  days.every(
    (day) =>
      /^\d{4}-\d{2}-\d{2}$/.test(day.date) &&
      new Date(`${day.date}T00:00:00Z`).toISOString().slice(0, 10) ===
        day.date &&
      ![0, 6].includes(new Date(`${day.date}T00:00:00Z`).getUTCDay())
  ),
  'dogfood dates must be valid working days'
);
for (let index = 1; index < days.length; index += 1) {
  requireCondition(
    days[index].date === nextWorkingDay(days[index - 1].date),
    'dogfood dates are not five consecutive working days'
  );
}
for (const [index, day] of days.entries()) {
  const tasks = recordsById(day.tasks);
  requireCondition(
    Array.isArray(day.tasks) && unique(day.tasks.map((task) => task.id)),
    `${day.date ?? index} has duplicate dogfood task IDs`
  );
  requireCondition(
    (day.tasks ?? []).every((task) => /^DOG-[1-9]$/.test(task.id)),
    `${day.date ?? index} has an unknown dogfood task ID`
  );
  for (const id of ['DOG-1', 'DOG-2', 'DOG-3', 'DOG-4', 'DOG-6', 'DOG-9']) {
    requireCondition(
      tasks.get(id)?.status === 'pass',
      `${day.date ?? index} is missing passing ${id}`
    );
    requireCondition(
      tasks.get(id)?.fallback_used === false,
      `${day.date ?? index} used a fallback for ${id}`
    );
    requireEvidenceLink(
      tasks.get(id)?.evidence_link,
      `${day.date ?? index} ${id} lacks valid retained evidence`
    );
  }
  if (index > 0) {
    requireCondition(
      tasks.get('DOG-8')?.status === 'pass',
      `${day.date} is missing restoration check DOG-8`
    );
    requireEvidenceLink(
      tasks.get('DOG-8')?.evidence_link,
      `${day.date} DOG-8 lacks valid retained evidence`
    );
  }
  requireCondition(
    day.unrecoverable_workspace_loss === false,
    `${day.date ?? index} records workspace loss`
  );
}
const dogfoodTasks = days.flatMap((day) =>
  Array.isArray(day.tasks) ? day.tasks : []
);
requireCondition(
  dogfoodTasks.some((task) => task.id === 'DOG-5' && task.status === 'pass'),
  'DOG-5 never passed'
);
for (const task of dogfoodTasks.filter((task) => task.status === 'pass')) {
  requireCondition(
    task.fallback_used === false,
    `${task.id} used a fallback client`
  );
  requireEvidenceLink(
    task.evidence_link,
    `${task.id} lacks valid retained evidence`
  );
}
const exercisedModes = (id) =>
  new Set(
    dogfoodTasks
      .filter((task) => task.id === id && task.status === 'pass')
      .flatMap((task) => task.modes ?? [])
  );
requireCondition(
  exercisedModes('DOG-1').has('profile_created_or_edited_and_tested'),
  'DOG-1 never created or edited and tested a profile'
);
for (const mode of ['selection', 'cursor_statement', 'run_all']) {
  requireCondition(
    exercisedModes('DOG-4').has(mode),
    `DOG-4 never exercised ${mode}`
  );
}
for (const mode of ['copy', 'filter_or_sort', 'load_more']) {
  requireCondition(
    exercisedModes('DOG-6').has(mode),
    `DOG-6 never exercised ${mode}`
  );
}
requireCondition(
  exercisedModes('DOG-6').has('export_csv') ||
    exercisedModes('DOG-6').has('export_json'),
  'DOG-6 never exercised CSV or JSON export'
);
const dog7 = dogfoodTasks.filter(
  (task) => task.id === 'DOG-7' && task.status === 'pass'
);
requireCondition(
  dog7.some((task) => task.modes?.includes('successful_apply')),
  'DOG-7 lacks a successful apply'
);
requireCondition(
  dog7.some((task) => task.modes?.includes('rollback_or_conflict')),
  'DOG-7 lacks rollback or conflict evidence'
);
requireCondition(
  evidence.dogfood?.fallback_client_used === false,
  'dogfood record used a fallback client'
);
const connectionTimes = evidence.dogfood?.metrics?.profile_to_editable_tab_ms;
const rowTimes = evidence.dogfood?.metrics?.table_to_known_row_copy_ms;
requireCondition(
  Array.isArray(connectionTimes) &&
    connectionTimes.length >= 5 &&
    connectionTimes.every((value) => Number.isFinite(value) && value >= 0),
  'dogfood connection timing samples are incomplete'
);
requireCondition(
  Array.isArray(rowTimes) &&
    rowTimes.length >= 5 &&
    rowTimes.every((value) => Number.isFinite(value) && value >= 0),
  'dogfood table timing samples are incomplete'
);
if (Array.isArray(connectionTimes) && connectionTimes.length > 0)
  requireCondition(
    median(connectionTimes) < 5_000,
    'median profile-to-editable-tab time is not under five seconds'
  );
if (Array.isArray(rowTimes) && rowTimes.length > 0)
  requireCondition(
    median(rowTimes) < 10_000,
    'median table-to-known-row-copy time is not under ten seconds'
  );
for (const finding of evidence.dogfood?.failures ?? []) {
  requireCondition(
    finding.resolved_and_rerun === true,
    'dogfood contains a failure that was not resolved and rerun'
  );
  requireEvidenceLink(
    finding.evidence_link,
    'dogfood failure resolution lacks valid evidence'
  );
}

const participants = Array.isArray(evidence.beta?.participants)
  ? evidence.beta.participants
  : [];
requireCondition(
  participants.length >= 5,
  'beta has fewer than five opt-in participants'
);
requireCondition(
  unique(participants.map((participant) => participant.id)),
  'beta participant IDs are not unique'
);
requireCondition(
  participants.every(
    (participant) =>
      participant.opt_in === true && participant.attempted === true
  ),
  'not every beta participant opted in and attempted the journey'
);
requireCondition(
  participants.filter(
    (participant) =>
      participant.completed_core_journey === true &&
      participant.maintainer_intervention === false
  ).length >= 4,
  'fewer than four beta participants completed without maintainer intervention'
);
requireCondition(
  participants.every(
    (participant) =>
      participant.unresolved_data_safety_issue === false &&
      participant.unresolved_workspace_loss === false
  ),
  'beta record contains an unresolved data-safety or workspace-loss issue'
);
for (const participant of participants)
  requireEvidenceLink(
    participant.evidence_link,
    `beta participant ${participant.id ?? 'unknown'} lacks valid retained evidence`
  );

const traceability = readJson(
  resolve(root, 'traceability', 'requirements.json'),
  'traceability matrix'
);
const uncovered = (traceability?.records ?? []).filter(
  (record) => record.priority === 'must' && record.status !== 'verified'
);
requireCondition(
  uncovered.length === 0,
  `traceability contains ${uncovered.length} unverified must rows`
);
const staleVerificationIds = (traceability?.records ?? []).filter((record) =>
  [
    ...(record.automated_test_ids ?? []),
    ...(record.manual_procedure_ids ?? [])
  ].some((id) => /^(PLANNED|PENDING)-/.test(id))
);
requireCondition(
  staleVerificationIds.length === 0,
  `traceability contains ${staleVerificationIds.length} planned or pending verification IDs`
);
const missingCandidateEvidence = (traceability?.records ?? []).filter(
  (record) =>
    record.priority === 'must' &&
    !(record.evidence_links ?? []).some((path) =>
      path.startsWith('evidence/phase-5/')
    )
);
requireCondition(
  missingCandidateEvidence.length === 0,
  `traceability contains ${missingCandidateEvidence.length} must rows without Phase 5 evidence`
);
requireCondition(
  Array.isArray(releaseManifest?.approved_exceptions) &&
    releaseManifest.approved_exceptions.length === 0,
  'release manifest contains an approved exception; this release baseline requires none'
);

if (failures.length > 0) {
  throw new Error(`release evidence audit failed:\n- ${failures.join('\n- ')}`);
}
process.stdout.write(
  'release evidence audit passed: all 101 requirements and 20 criteria are verified\n'
);
