import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync
} from 'node:fs';
import { basename, dirname, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';

import {
  parseChecksumManifest,
  safeArtifactName
} from './release-evidence-contract.mjs';
import { normalizeReleaseNotes } from './create-updater-manifest.mjs';
import {
  candidateInspectionTargets,
  distributableArtifacts,
  exactlyOneMatchingPath,
  expectedPlatformKeys,
  updaterPlatformBindings,
  updaterPayloads
} from './release-platform-contract.mjs';
import { verifyUpdaterSignature } from './verify-updater-signature.mjs';

const root = resolve(import.meta.dirname, '..');

/**
 * @typedef {{
 *   name: string,
 *   path: string,
 *   bytes: number,
 *   sha256: string,
 *   content: Buffer
 * }} FileRecord
 */

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

/** @param {string | Buffer} bytes */
function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** @param {string} directory @returns {string[]} */
function regularFiles(directory) {
  requireCondition(
    existsSync(directory) &&
      lstatSync(directory).isDirectory() &&
      realpathSync(directory) === directory,
    'publication input must be a real directory'
  );
  /** @type {string[]} */
  const paths = [];
  /** @param {string} path */
  function visit(path) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const candidate = resolve(path, entry.name);
      requireCondition(
        !entry.isSymbolicLink(),
        'publication input must not contain symbolic links'
      );
      if (entry.isDirectory()) visit(candidate);
      else if (entry.isFile()) paths.push(candidate);
    }
  }
  visit(directory);
  return paths;
}

/**
 * @param {string[]} paths
 * @param {(path: string) => boolean} predicate
 * @param {string} label
 */
function onePath(paths, predicate, label) {
  const matches = paths.filter(predicate);
  requireCondition(
    matches.length === 1,
    `publication input must contain exactly one ${label}; found ${matches.length}`
  );
  return matches[0];
}

/** @param {string} path @returns {FileRecord} */
function fileRecord(path) {
  const content = readFileSync(path);
  requireCondition(content.length > 0, `${basename(path)} is empty`);
  return {
    name: basename(path),
    path,
    bytes: content.length,
    sha256: sha256(content),
    content
  };
}

/** @param {FileRecord} record */
function publicRecord(record) {
  const { content, path, ...result } = record;
  return result;
}

/** @param {string} directory */
function collectPublicAssets(directory) {
  const paths = regularFiles(directory);
  const artifacts = distributableArtifacts.map((descriptor) => ({
    id: descriptor.id,
    ...fileRecord(
      exactlyOneMatchingPath(
        paths,
        descriptor.matches,
        `${descriptor.id} package`
      )
    )
  }));
  const payloads = updaterPayloads.map((descriptor) => {
    const payload = fileRecord(
      exactlyOneMatchingPath(
        paths,
        descriptor.matches,
        `${descriptor.id} updater payload`
      )
    );
    const signature = fileRecord(
      exactlyOneMatchingPath(
        paths,
        (name) => name === `${payload.name}.sig`,
        `${descriptor.id} updater signature`
      )
    );
    requireCondition(
      safeArtifactName(payload.name) && safeArtifactName(signature.name),
      `${descriptor.id} uses an unsafe artifact name`
    );
    return { id: descriptor.id, ...payload, signature };
  });
  const latest = fileRecord(
    onePath(paths, (path) => basename(path) === 'latest.json', 'latest.json')
  );
  const checksums = fileRecord(
    onePath(paths, (path) => basename(path) === 'SHA256SUMS', 'SHA256SUMS')
  );
  const uniquePublicRecords = new Map();
  for (const record of [
    ...artifacts,
    ...payloads,
    ...payloads.map(({ signature }) => signature),
    latest,
    checksums
  ]) {
    const existing = uniquePublicRecords.get(record.name);
    requireCondition(
      !existing || existing.sha256 === record.sha256,
      `publication input repeats ${record.name} with different bytes`
    );
    uniquePublicRecords.set(record.name, record);
  }
  return {
    artifacts,
    payloads,
    latest,
    checksums,
    paths,
    publicRecords: [...uniquePublicRecords.values()]
  };
}

/** @param {string} path @param {string} label */
function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error(`${label} is missing or invalid JSON`);
  }
}

function currentSourceCommit() {
  const git = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8'
  });
  const commit = git.stdout.trim();
  requireCondition(
    git.status === 0 && /^[a-f0-9]{40}$/.test(commit),
    'could not identify publication source commit'
  );
  return commit;
}

/**
 * Validate the exact installable package set, signed updater payload set, and
 * combined PostNot-compatible updater manifest.
 *
 * @param {{
 *   version: string,
 *   requestedTag: string,
 *   releaseNotes: string,
 *   artifacts: Array<FileRecord & {id: string}>,
 *   payloads: Array<FileRecord & {id: string, signature: FileRecord}>,
 *   latest: any,
 *   checksumText: string
 * }} input
 */
export function validateUpdatePublicationContract({
  version,
  requestedTag,
  releaseNotes,
  artifacts,
  payloads,
  latest,
  checksumText
}) {
  requireCondition(
    requestedTag === `v${version}`,
    'requested tag does not match the application version'
  );
  const artifactById = new Map(artifacts.map((record) => [record.id, record]));
  const payloadById = new Map(payloads.map((record) => [record.id, record]));
  requireCondition(
    artifactById.size === distributableArtifacts.length &&
      distributableArtifacts.every(({ id }) => artifactById.has(id)),
    'publication input does not contain the exact cross-platform package set'
  );
  requireCondition(
    payloadById.size === updaterPayloads.length &&
      updaterPayloads.every(({ id }) => payloadById.has(id)),
    'publication input does not contain the exact updater payload set'
  );
  for (const [id, artifact] of artifactById) {
    const payload = payloadById.get(id);
    if (!payload) continue;
    requireCondition(
      payload.name === artifact.name &&
        payload.bytes === artifact.bytes &&
        payload.sha256 === artifact.sha256,
      `${id} updater payload does not reuse the installable package bytes`
    );
  }

  const checksums = parseChecksumManifest(checksumText);
  requireCondition(
    checksums.size === distributableArtifacts.length &&
      artifacts.every(
        ({ name, sha256: digest }) => checksums.get(name) === digest
      ),
    'SHA256SUMS does not identify exactly the reviewed installable packages'
  );
  requireCondition(
    latest?.version === version,
    'latest.json version does not match'
  );
  const expectedReleaseNotes = normalizeReleaseNotes(releaseNotes);
  requireCondition(
    latest?.notes === expectedReleaseNotes &&
      latest?.notes === normalizeReleaseNotes(latest.notes),
    'latest.json release notes do not match canonical LF text'
  );
  requireCondition(
    JSON.stringify(Object.keys(latest ?? {}).sort()) ===
      JSON.stringify(['notes', 'platforms', 'pub_date', 'version']),
    'latest.json contains unexpected top-level fields'
  );
  requireCondition(
    !Number.isNaN(Date.parse(latest?.pub_date ?? '')),
    'latest.json publication date is invalid'
  );
  const platformKeys = Object.keys(latest?.platforms ?? {}).sort();
  requireCondition(
    JSON.stringify(platformKeys) === JSON.stringify(expectedPlatformKeys),
    'latest.json does not contain the exact cross-platform updater keys'
  );
  for (const { key, payloadId } of updaterPlatformBindings) {
    const payload = payloadById.get(payloadId);
    requireCondition(payload, `missing updater payload ${payloadId}`);
    const signatureText = payload.signature.content.toString('utf8').trim();
    const expectedUrl = `https://github.com/not-projects/querynot/releases/download/v${version}/${encodeURIComponent(payload.name)}`;
    requireCondition(
      JSON.stringify(Object.keys(latest.platforms[key] ?? {}).sort()) ===
        JSON.stringify(['signature', 'url']),
      `latest.json ${key} contains unexpected fields`
    );
    requireCondition(
      latest.platforms[key]?.url === expectedUrl,
      `latest.json ${key} URL does not match the reviewed payload`
    );
    requireCondition(
      latest.platforms[key]?.signature === signatureText,
      `latest.json ${key} signature does not match the reviewed signature`
    );
  }
  return {
    schema_version: 2,
    status: 'pass',
    application_version: version,
    release_tag: requestedTag,
    artifacts: artifacts.map(publicRecord),
    updater_payloads: payloads.map(({ signature, ...payload }) => ({
      ...publicRecord(payload),
      signature: publicRecord(signature)
    })),
    latest: {
      name: 'latest.json',
      bytes: Buffer.byteLength(`${JSON.stringify(latest, null, 2)}\n`)
    },
    checksum: {
      name: 'SHA256SUMS',
      bytes: Buffer.byteLength(checksumText),
      sha256: sha256(checksumText)
    }
  };
}

/**
 * @param {string[]} paths
 * @param {ReturnType<typeof collectPublicAssets>} assets
 * @param {string} version
 * @param {string} sourceCommit
 */
function validateCandidateEvidence(paths, assets, version, sourceCommit) {
  const inspections = candidateInspectionTargets.map((target) =>
    readJson(
      onePath(
        paths,
        (path) => basename(path) === `inspection-${target}.json`,
        `${target} candidate inspection report`
      ),
      `${target} candidate inspection report`
    )
  );
  for (const inspection of inspections) {
    requireCondition(
      inspection?.schema_version === 2 && inspection?.status === 'pass',
      'candidate inspection did not pass'
    );
    requireCondition(
      inspection?.source_commit === sourceCommit &&
        inspection?.application_version === version,
      'candidate inspection source or version does not match'
    );
    requireCondition(
      inspection?.updater_artifacts === true,
      'candidate inspection did not require updater artifacts'
    );
  }
  const inspectedArtifacts = inspections.flatMap(
    (inspection) => inspection.artifacts ?? []
  );
  const inspectedPayloads = inspections.flatMap(
    (inspection) => inspection.updater_payloads ?? []
  );
  for (const artifact of assets.artifacts) {
    const matches = inspectedArtifacts.filter(
      (record) => record.id === artifact.id
    );
    requireCondition(
      matches.length === 1 &&
        matches[0].name === artifact.name &&
        matches[0].bytes === artifact.bytes &&
        matches[0].sha256 === artifact.sha256,
      `${artifact.id} does not match its candidate inspection`
    );
  }
  requireCondition(
    inspectedArtifacts.length === assets.artifacts.length,
    'candidate inspections contain an unexpected package'
  );
  for (const payload of assets.payloads) {
    const matches = inspectedPayloads.filter(
      (record) => record.id === payload.id
    );
    const inspected = matches[0];
    requireCondition(
      matches.length === 1 &&
        inspected.name === payload.name &&
        inspected.bytes === payload.bytes &&
        inspected.sha256 === payload.sha256 &&
        inspected.signature?.name === payload.signature.name &&
        inspected.signature?.bytes === payload.signature.bytes &&
        inspected.signature?.sha256 === payload.signature.sha256,
      `${payload.id} does not match its candidate updater inspection`
    );
  }
  requireCondition(
    inspectedPayloads.length === assets.payloads.length,
    'candidate inspections contain an unexpected updater payload'
  );

  const manifestReport = readJson(
    onePath(
      paths,
      (path) => basename(path) === 'updater-manifest-report.json',
      'updater manifest report'
    ),
    'updater manifest report'
  );
  requireCondition(
    manifestReport?.schema_version === 2 &&
      manifestReport?.status === 'pass' &&
      manifestReport?.source_commit === sourceCommit &&
      manifestReport?.application_version === version,
    'updater manifest report did not pass for this source and version'
  );
  requireCondition(
    manifestReport.endpoint ===
      'https://github.com/not-projects/querynot/releases/latest/download/latest.json' &&
      JSON.stringify([...manifestReport.platform_keys].sort()) ===
        JSON.stringify(expectedPlatformKeys) &&
      manifestReport.manifest?.name === assets.latest.name &&
      manifestReport.manifest?.bytes === assets.latest.bytes &&
      manifestReport.manifest?.sha256 === assets.latest.sha256,
    'updater manifest report does not match the reviewed feed'
  );
  const reportedPayloads = new Map(
    (manifestReport.updater_payloads ?? []).map(
      /** @param {any} record */ (record) => [record.id, record]
    )
  );
  for (const payload of assets.payloads) {
    const reported = reportedPayloads.get(payload.id);
    requireCondition(
      reported?.name === payload.name &&
        reported?.bytes === payload.bytes &&
        reported?.sha256 === payload.sha256 &&
        reported?.signature?.name === payload.signature.name &&
        reported?.signature?.bytes === payload.signature.bytes &&
        reported?.signature?.sha256 === payload.signature.sha256,
      `${payload.id} does not match the updater manifest report`
    );
  }

  const checksums = readJson(
    onePath(
      paths,
      (path) => basename(path) === 'checksums.json',
      'candidate checksum report'
    ),
    'candidate checksum report'
  );
  requireCondition(
    checksums?.schema_version === 1 &&
      checksums?.source_commit === sourceCommit &&
      checksums?.application_version === version,
    'candidate checksum report source or version does not match'
  );
  const checksumRecords = new Map(
    (checksums.artifacts ?? []).map(
      /** @param {any} record */ (record) => [record.name, record]
    )
  );
  requireCondition(
    checksumRecords.size === assets.artifacts.length &&
      assets.artifacts.every(
        (artifact) =>
          checksumRecords.get(artifact.name)?.sha256 === artifact.sha256
      ),
    'candidate checksum report does not match the installable packages'
  );
}

/**
 * Compare every downloaded draft asset with the publication plan produced
 * immediately before draft creation. This is separate from semantic manifest,
 * checksum, and signature validation so even harmless-looking byte changes are
 * rejected by the round trip.
 *
 * @param {any} plan
 * @param {ReturnType<typeof collectPublicAssets>} assets
 * @param {string} version
 * @param {string} requestedTag
 * @param {string} sourceCommit
 */
export function validateRoundTripPlan(
  plan,
  assets,
  version,
  requestedTag,
  sourceCommit
) {
  requireCondition(
    plan?.schema_version === 2 &&
      plan?.status === 'pass' &&
      plan?.staging_verification === 'pass' &&
      plan?.source_commit === sourceCommit &&
      plan?.application_version === version &&
      plan?.release_tag === requestedTag,
    'publication plan does not identify this staged candidate'
  );
  const plannedRecords = [
    ...(plan.artifacts ?? []),
    ...(plan.updater_payloads ?? []).flatMap(
      /** @param {any} payload */ (payload) => [payload, payload.signature]
    ),
    plan.latest,
    plan.checksum
  ];
  const plannedByName = new Map();
  for (const record of plannedRecords) {
    requireCondition(
      safeArtifactName(record?.name) &&
        Number.isSafeInteger(record?.bytes) &&
        record.bytes > 0 &&
        /^[a-f0-9]{64}$/.test(record?.sha256 ?? ''),
      'publication plan contains an invalid asset record'
    );
    const existing = plannedByName.get(record.name);
    requireCondition(
      !existing ||
        (existing.bytes === record.bytes && existing.sha256 === record.sha256),
      `publication plan repeats ${record.name} with different bytes`
    );
    plannedByName.set(record.name, record);
  }
  requireCondition(
    plannedByName.size === assets.publicRecords.length &&
      assets.publicRecords.every(
        (record) =>
          plannedByName.get(record.name)?.bytes === record.bytes &&
          plannedByName.get(record.name)?.sha256 === record.sha256
      ),
    'downloaded draft assets do not byte-match the publication plan'
  );
}

/** @param {string} path @param {string} label */
function checkedArtifactOutput(path, label) {
  const resolved = resolve(root, path);
  const artifactsRoot = resolve(root, 'artifacts');
  requireCondition(
    resolved.startsWith(`${artifactsRoot}${sep}`),
    `${label} must stay under artifacts/`
  );
  return resolved;
}

/** @param {string} path @param {any} report */
function writeReport(path, report) {
  const resolved = checkedArtifactOutput(path, 'publication report');
  mkdirSync(dirname(resolved), { recursive: true, mode: 0o755 });
  requireCondition(
    !existsSync(resolved) || !lstatSync(resolved).isSymbolicLink(),
    'publication report must not be a symbolic link'
  );
  writeFileSync(resolved, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o644
  });
}

function main() {
  const mode = process.argv[2];
  requireCondition(
    mode === 'candidate' || mode === 'prepare' || mode === 'verify',
    'usage: node scripts/release-update-publication.mjs <candidate|prepare|verify> --directory <artifact-dir> --tag <tag> --report <report.json> [--output <staging-dir> --confirm <confirmation> | --plan <publication-plan.json>]'
  );
  const { values } = parseArgs({
    args: process.argv.slice(3),
    options: {
      directory: { type: 'string' },
      output: { type: 'string' },
      tag: { type: 'string' },
      report: { type: 'string' },
      confirm: { type: 'string' },
      plan: { type: 'string' }
    },
    strict: true
  });
  requireCondition(
    values.directory && values.tag && values.report,
    'publication directory, tag, and report are required'
  );
  const outputOption = values.output;
  if (mode === 'prepare') {
    requireCondition(
      outputOption && !values.plan,
      'publication staging output is required and does not accept a prior plan'
    );
    requireCondition(
      values.confirm === `publish-${values.tag}`,
      `publication requires the exact confirmation publish-${values.tag}`
    );
  } else if (mode === 'candidate') {
    requireCondition(
      !outputOption && !values.confirm && !values.plan,
      'candidate verification does not accept staging, confirmation, or plan options'
    );
  } else {
    requireCondition(
      !outputOption && !values.confirm && values.plan,
      'publication verification requires the pre-draft plan and does not accept staging or confirmation options'
    );
  }

  const packageJson = readJson(resolve(root, 'package.json'), 'package.json');
  const notesPath = resolve(
    root,
    'docs',
    'release',
    `${packageJson.version}-notes.md`
  );
  requireCondition(
    existsSync(notesPath),
    `release notes are missing for ${packageJson.version}`
  );
  const releaseNotes = normalizeReleaseNotes(readFileSync(notesPath, 'utf8'));
  const directory = resolve(root, values.directory);
  const assets = collectPublicAssets(directory);
  const latest = JSON.parse(assets.latest.content.toString('utf8'));
  /** @type {any} */
  const report = validateUpdatePublicationContract({
    version: packageJson.version,
    requestedTag: values.tag,
    releaseNotes,
    artifacts: assets.artifacts,
    payloads: assets.payloads,
    latest,
    checksumText: assets.checksums.content.toString('utf8')
  });
  const publicKey = process.env.QUERYNOT_UPDATER_PUBLIC_KEY?.trim();
  requireCondition(
    publicKey,
    'QUERYNOT_UPDATER_PUBLIC_KEY is required to verify updater signatures'
  );
  report.signature_verification = assets.payloads.map((payload) => ({
    payload_id: payload.id,
    ...verifyUpdaterSignature({
      payload: payload.content,
      signature: payload.signature.content.toString('utf8').trim(),
      publicKey
    })
  }));
  report.source_commit = currentSourceCommit();
  report.latest.sha256 = assets.latest.sha256;

  if (mode === 'candidate' || mode === 'prepare') {
    validateCandidateEvidence(
      assets.paths,
      assets,
      packageJson.version,
      report.source_commit
    );
    report.candidate_evidence_verification = 'pass';
  }
  if (mode === 'prepare') {
    requireCondition(
      typeof outputOption === 'string',
      'publication staging output is required'
    );
    const output = checkedArtifactOutput(
      outputOption,
      'publication staging output'
    );
    requireCondition(
      !existsSync(output),
      'publication staging output already exists'
    );
    mkdirSync(output, { recursive: true, mode: 0o755 });
    for (const asset of assets.publicRecords) {
      copyFileSync(asset.path, resolve(output, asset.name));
    }
    const staged = collectPublicAssets(output);
    requireCondition(
      staged.paths.length === assets.publicRecords.length,
      'publication staging contains unexpected files'
    );
    report.staging_verification = 'pass';
  } else if (mode === 'verify') {
    requireCondition(
      typeof values.plan === 'string',
      'publication plan input is required'
    );
    const planPath = checkedArtifactOutput(
      values.plan,
      'publication plan input'
    );
    requireCondition(
      existsSync(planPath) &&
        lstatSync(planPath).isFile() &&
        realpathSync(planPath) === planPath,
      'publication plan must be a real file under artifacts/'
    );
    validateRoundTripPlan(
      readJson(planPath, 'publication plan'),
      assets,
      packageJson.version,
      values.tag,
      report.source_commit
    );
    requireCondition(
      assets.paths.length === assets.publicRecords.length,
      'published release contains unexpected assets'
    );
    report.round_trip_candidate_byte_verification = 'pass';
  }
  writeReport(values.report, report);
  process.stdout.write(
    `${mode === 'prepare' ? 'prepared' : 'verified'} ${assets.publicRecords.length} signed cross-platform release assets for ${values.tag}\n`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  main();
}
