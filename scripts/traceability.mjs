import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const prdPath = resolve(root, 'docs/product-requirements.md');
const overridesPath = resolve(root, 'traceability/status-overrides.json');
const outputPath = resolve(root, 'traceability/requirements.json');

const expectedRequirementCount = 101;
const expectedAcceptanceCount = 20;
const validStatuses = new Set([
  'planned',
  'in_progress',
  'implemented',
  'verified',
  'blocked',
  'excepted'
]);

const phaseTwo = new Set([
  'CON-2',
  'WKS-7',
  'WKS-8',
  'WKS-12',
  'SCH-1',
  'SCH-2',
  'SCH-3',
  'SCH-6',
  'SCH-7',
  'SCH-8',
  'EDT-1',
  'EDT-2',
  'EDT-6',
  'EDT-7',
  'EDT-8',
  'EDT-9',
  'EDT-10',
  'EXE-1',
  'EXE-2',
  'EXE-3',
  'EXE-4',
  'EXE-7',
  'EXE-8',
  'EXE-9',
  'EXE-11',
  'EXE-12',
  'EXE-14',
  'RES-1',
  'RES-2',
  'RES-3',
  'RES-4',
  'RES-6',
  'RES-7',
  'RES-8',
  'RES-9',
  'RES-10',
  'RES-11',
  'RES-12',
  'RES-13',
  'RES-14'
]);

const phaseThree = new Set([
  'CON-3',
  'CON-4',
  'CON-7',
  'CON-13',
  'CON-14',
  'CON-16',
  'EXE-10'
]);

const phaseFourPrefixes = new Set(['DAT', 'HIS']);
const phaseFour = new Set([
  'SCH-4',
  'SCH-5',
  'EDT-3',
  'EDT-4',
  'EDT-5',
  'EXE-5',
  'EXE-6',
  'EXE-13',
  'RES-5',
  'WKS-3',
  'WKS-5',
  'WKS-10'
]);

function owningPhase(id) {
  if (phaseThree.has(id)) return 3;
  if (phaseTwo.has(id)) return 2;
  if (phaseFour.has(id) || phaseFourPrefixes.has(id.split('-')[0])) return 4;
  return 1;
}

function matrixScope(id) {
  const prefix = id.split('-')[0];
  if (['CON', 'SCH', 'EDT', 'EXE', 'RES', 'DAT'].includes(prefix)) {
    return [
      'sqlite',
      'mysql-5.7.44',
      'mysql-8.0',
      'mysql-8.4-lts',
      'mariadb-10.11-lts',
      'mariadb-11.4-lts'
    ];
  }
  return ['windows-x86_64', 'macos-aarch64', 'macos-x86_64', 'linux-x86_64'];
}

function parseRequirements(prd) {
  const records = [];
  for (const match of prd.matchAll(/^\*\*([A-Z]+-\d+) — (.+?)\.\*\*/gm)) {
    const id = match[1];
    records.push({
      id,
      kind: 'requirement',
      title: match[2],
      priority: 'must',
      owning_phase: owningPhase(id),
      implementation_issues: [`PHASE-${owningPhase(id)}`],
      automated_test_ids: [`PLANNED-AUTO-${id}`],
      manual_procedure_ids: [`PLANNED-MAN-${id}`],
      supported_matrix_entries: matrixScope(id),
      status: 'planned',
      evidence_links: []
    });
  }
  return records;
}

function parseAcceptanceCriteria(prd) {
  const section = prd
    .split('## 13. Initial-release acceptance criteria')[1]
    ?.split('## 14. Success measures')[0];
  if (!section) throw new Error('acceptance criteria section is missing');

  const records = [];
  for (const match of section.matchAll(/^(\d+)\. (.+)$/gm)) {
    const number = Number(match[1]);
    const id = `AC-${String(number).padStart(2, '0')}`;
    const phase = number <= 11 || (number >= 16 && number <= 19) ? 4 : 5;
    records.push({
      id,
      kind: 'acceptance_criterion',
      title: match[2],
      priority: 'must',
      owning_phase: phase,
      implementation_issues: [`PHASE-${phase}`],
      automated_test_ids: [`PLANNED-AUTO-${id}`],
      manual_procedure_ids: [`PLANNED-MAN-${id}`],
      supported_matrix_entries: ['all_applicable_release_matrix_entries'],
      status: 'planned',
      evidence_links: []
    });
  }
  return records;
}

function applyOverrides(records, overrideFile) {
  const unknown = new Set(Object.keys(overrideFile.records));
  for (const record of records) {
    const override = overrideFile.records[record.id];
    if (!override) continue;
    unknown.delete(record.id);
    Object.assign(record, override);
  }
  if (unknown.size > 0) {
    throw new Error(
      `unknown traceability override IDs: ${[...unknown].join(', ')}`
    );
  }
}

function attachGeneratedEvidence(records) {
  for (const record of records) {
    if (record.automated_test_ids.some((id) => id.startsWith('P4-'))) {
      if (
        !record.evidence_links.includes(
          'evidence/phase-4/validation-report.json'
        )
      ) {
        record.evidence_links.push('evidence/phase-4/validation-report.json');
      }
    }
    if (
      record.automated_test_ids.some((id) =>
        [
          'P4-AUTO-TABLE-MATRIX',
          'P4-AUTO-TABLE-METADATA-COMPATIBILITY'
        ].includes(id)
      ) &&
      !record.evidence_links.includes(
        'evidence/phase-4/table-conformance-report.json'
      )
    ) {
      record.evidence_links.push(
        'evidence/phase-4/table-conformance-report.json'
      );
    }
    if (record.automated_test_ids.some((id) => id.startsWith('P3-'))) {
      if (
        !record.evidence_links.includes(
          'evidence/phase-3/validation-report.json'
        )
      ) {
        record.evidence_links.push('evidence/phase-3/validation-report.json');
      }
    }
    if (
      record.automated_test_ids.some((id) =>
        [
          'P3-AUTO-ADAPTER-CONFORMANCE',
          'P3-AUTO-TLS-MATRIX',
          'P3-AUTO-AUTH-MATRIX',
          'P3-AUTO-METADATA-MATRIX',
          'P3-AUTO-RESULT-MATRIX',
          'P3-AUTO-TRANSACTION-MATRIX',
          'P3-AUTO-CANCELLATION-MATRIX'
        ].includes(id)
      ) &&
      !record.evidence_links.includes(
        'evidence/phase-3/adapter-conformance-report.json'
      )
    ) {
      record.evidence_links.push(
        'evidence/phase-3/adapter-conformance-report.json'
      );
    }
    if (record.automated_test_ids.some((id) => id.startsWith('P2-'))) {
      if (
        !record.evidence_links.includes(
          'evidence/phase-2/validation-report.json'
        )
      ) {
        record.evidence_links.push('evidence/phase-2/validation-report.json');
      }
    }
    if (
      record.automated_test_ids.includes('P2-PERF-FIRST-BATCH') &&
      !record.evidence_links.includes('evidence/phase-2/benchmark-report.json')
    ) {
      record.evidence_links.push('evidence/phase-2/benchmark-report.json');
    }
  }
}

function validate(records) {
  const requirementCount = records.filter(
    (record) => record.kind === 'requirement'
  ).length;
  const acceptanceCount = records.filter(
    (record) => record.kind === 'acceptance_criterion'
  ).length;
  if (
    requirementCount !== expectedRequirementCount ||
    acceptanceCount !== expectedAcceptanceCount
  ) {
    throw new Error(
      `expected ${expectedRequirementCount} requirements and ${expectedAcceptanceCount} criteria; found ${requirementCount} and ${acceptanceCount}`
    );
  }

  const ids = new Set();
  for (const record of records) {
    if (ids.has(record.id))
      throw new Error(`duplicate traceability ID: ${record.id}`);
    ids.add(record.id);
    if (!validStatuses.has(record.status))
      throw new Error(`${record.id} has invalid status ${record.status}`);
    if (
      record.automated_test_ids.length + record.manual_procedure_ids.length ===
      0
    ) {
      throw new Error(`${record.id} has no mapped verification`);
    }
    if (record.status === 'verified' && record.evidence_links.length === 0) {
      throw new Error(`${record.id} is verified without retained evidence`);
    }
    if (record.status === 'excepted' && !record.exception?.expires_on) {
      throw new Error(`${record.id} exception lacks an expiry`);
    }
  }
}

function buildMatrix() {
  const prd = readFileSync(prdPath, 'utf8');
  const overrides = JSON.parse(readFileSync(overridesPath, 'utf8'));
  if (overrides.schema_version !== 1 || typeof overrides.records !== 'object') {
    throw new Error('traceability overrides have an unsupported schema');
  }

  const records = [...parseRequirements(prd), ...parseAcceptanceCriteria(prd)];
  applyOverrides(records, overrides);
  attachGeneratedEvidence(records);
  validate(records);

  return {
    schema_version: 1,
    source: 'docs/product-requirements.md',
    source_commit: overrides.source_prd_commit,
    source_sha256: createHash('sha256').update(prd).digest('hex'),
    conventions: {
      statuses: [...validStatuses],
      evidence_links:
        'repository-relative paths into evidence/; verified rows require at least one retained artifact',
      planned_test_ids:
        'PLANNED-* entries reserve coverage and must be replaced by executable IDs before verification'
    },
    records
  };
}

const serialized = `${JSON.stringify(buildMatrix(), null, 2)}\n`;
const mode = process.argv[2];

if (mode === '--write') {
  writeFileSync(outputPath, serialized, 'utf8');
  process.stdout.write(`wrote ${outputPath}\n`);
} else if (mode === '--check') {
  const current = readFileSync(outputPath, 'utf8');
  if (current !== serialized) {
    throw new Error(
      'traceability/requirements.json is stale; run npm run traceability:sync'
    );
  }
  process.stdout.write(
    'traceability matrix is current: 101 requirements + 20 acceptance criteria\n'
  );
} else {
  throw new Error('usage: node scripts/traceability.mjs --write|--check');
}
