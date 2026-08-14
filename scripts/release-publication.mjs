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

const root = resolve(import.meta.dirname, '..');
const phase5Root = resolve(root, 'evidence', 'phase-5');
const artifactExtensions = ['.AppImage', '.deb', '.dmg', '.exe'];
const expectedArtifactFormats = new Map([
  ['windows-nsis-x64', 'nsis'],
  ['macos-dmg-intel', 'dmg'],
  ['macos-dmg-apple', 'dmg'],
  ['linux-appimage-x64', 'appimage'],
  ['linux-deb-x64', 'deb']
]);

/**
 * @param {unknown} condition
 * @param {string} message
 * @returns {asserts condition}
 */
function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * @param {string} path
 * @param {string} label
 * @returns {any}
 */
function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error(`${label} is missing or invalid JSON`);
  }
}

/**
 * @param {unknown} records
 * @param {string} key
 * @param {string} label
 * @returns {Map<string, any>}
 */
function recordsBy(records, key, label) {
  requireCondition(Array.isArray(records), `${label} must be an array`);
  const mapped = new Map();
  for (const record of records) {
    const value = record?.[key];
    requireCondition(
      typeof value === 'string' && value.length > 0,
      `${label} contains a record without ${key}`
    );
    requireCondition(
      !mapped.has(value),
      `${label} contains duplicate ${value}`
    );
    mapped.set(value, record);
  }
  return mapped;
}

/** @param {unknown} name */
function safeArtifactName(name) {
  return (
    typeof name === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(name) &&
    basename(name) === name &&
    !name.includes('/') &&
    !name.includes('\\') &&
    !/[\u0000-\u001f\u007f]/.test(name)
  );
}

/**
 * @param {string} text
 * @returns {Map<string, string>}
 */
export function parseChecksumManifest(text) {
  requireCondition(typeof text === 'string', 'checksum manifest is not text');
  const lines = text.trimEnd().split('\n');
  requireCondition(
    lines.length > 0 && lines[0] !== '',
    'checksum manifest is empty'
  );
  const records = new Map();
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  ([^/\\]+)$/.exec(line);
    requireCondition(match, 'checksum manifest contains an invalid line');
    const [, sha256, name] = match;
    requireCondition(
      safeArtifactName(name),
      'checksum manifest contains an unsafe name'
    );
    requireCondition(!records.has(name), `checksum manifest repeats ${name}`);
    records.set(name, sha256);
  }
  return records;
}

/**
 * @param {{
 *   releaseManifest: any,
 *   packaging: any,
 *   packageVersion: string,
 *   requestedTag: string,
 *   artifacts: Array<{name: string, path: string, bytes: number, sha256: string}>,
 *   checksumText: string
 * }} input
 * @returns {any}
 */
export function validatePublicationContract({
  releaseManifest,
  packaging,
  packageVersion,
  requestedTag,
  artifacts,
  checksumText
}) {
  requireCondition(
    releaseManifest?.schema_version === 1,
    'release manifest schema is not version 1'
  );
  requireCondition(
    releaseManifest?.release_status === 'ready_to_publish',
    'release manifest is not ready_to_publish'
  );
  requireCondition(
    /^[a-f0-9]{40}$/.test(releaseManifest?.source_commit ?? ''),
    'release manifest has no exact source commit'
  );
  requireCondition(
    releaseManifest?.application_version === packageVersion,
    'release manifest application version does not match package.json'
  );
  requireCondition(
    releaseManifest?.release_tag === `v${packageVersion}` &&
      requestedTag === releaseManifest.release_tag,
    'requested release tag does not match the reviewed application version'
  );
  requireCondition(
    packaging?.schema_version === 1 && packaging?.status === 'pass',
    'packaging evidence is not a passing version 1 record'
  );
  requireCondition(
    packaging?.source_commit === releaseManifest.source_commit,
    'packaging evidence does not match the release source commit'
  );
  requireCondition(
    packaging?.updater_artifacts === false,
    'packaging evidence permits updater artifacts'
  );
  requireCondition(
    packaging?.checksum_verification === 'pass',
    'packaging checksum verification did not pass'
  );
  requireCondition(
    typeof packaging?.checksum_manifest === 'string' &&
      packaging.checksum_manifest.startsWith('evidence/phase-5/') &&
      basename(packaging.checksum_manifest) === 'SHA256SUMS',
    'packaging evidence does not identify the retained SHA256SUMS file'
  );
  requireCondition(
    Array.isArray(releaseManifest?.checksums) &&
      releaseManifest.checksums.length === 1 &&
      releaseManifest.checksums[0] === packaging.checksum_manifest,
    'release manifest does not identify exactly the reviewed SHA256SUMS file'
  );

  const packagingArtifacts = recordsBy(
    packaging.artifacts,
    'id',
    'packaging artifacts'
  );
  const reviewedArtifacts = recordsBy(
    releaseManifest.reviewed_artifacts,
    'id',
    'reviewed artifacts'
  );
  const downloadedArtifacts = recordsBy(
    artifacts,
    'name',
    'downloaded artifacts'
  );
  requireCondition(
    packagingArtifacts.size === expectedArtifactFormats.size,
    'packaging evidence does not contain exactly five artifacts'
  );
  requireCondition(
    reviewedArtifacts.size === expectedArtifactFormats.size,
    'release manifest does not contain exactly five reviewed artifacts'
  );
  requireCondition(
    downloadedArtifacts.size === expectedArtifactFormats.size,
    'publication input does not contain exactly five artifacts'
  );

  const checksumRecords = parseChecksumManifest(checksumText);
  requireCondition(
    checksumRecords.size === expectedArtifactFormats.size,
    'SHA256SUMS does not contain exactly five artifacts'
  );

  const publicationArtifacts = [];
  for (const [id, format] of expectedArtifactFormats) {
    const packaged = packagingArtifacts.get(id);
    const reviewed = reviewedArtifacts.get(id);
    requireCondition(Boolean(packaged), `packaging evidence is missing ${id}`);
    requireCondition(Boolean(reviewed), `release manifest is missing ${id}`);
    requireCondition(
      packaged.format === format,
      `packaging evidence has the wrong format for ${id}`
    );
    requireCondition(
      safeArtifactName(packaged.name),
      `packaging evidence has an unsafe name for ${id}`
    );
    requireCondition(
      Number.isSafeInteger(packaged.bytes) && packaged.bytes > 0,
      `packaging evidence has an invalid byte count for ${id}`
    );
    requireCondition(
      /^[a-f0-9]{64}$/.test(packaged.sha256 ?? ''),
      `packaging evidence has an invalid digest for ${id}`
    );
    requireCondition(packaged.unsigned === true, `${id} is not unsigned`);
    requireCondition(
      reviewed.name === packaged.name &&
        reviewed.bytes === packaged.bytes &&
        reviewed.sha256 === packaged.sha256,
      `release manifest does not match the reviewed ${id} artifact`
    );
    const downloaded = downloadedArtifacts.get(packaged.name);
    requireCondition(
      Boolean(downloaded),
      `publication input is missing ${packaged.name}`
    );
    requireCondition(
      downloaded.bytes === packaged.bytes &&
        downloaded.sha256 === packaged.sha256,
      `publication input does not match the reviewed ${id} artifact`
    );
    requireCondition(
      checksumRecords.get(packaged.name) === packaged.sha256,
      `SHA256SUMS does not match the reviewed ${id} artifact`
    );
    publicationArtifacts.push({
      id,
      format,
      name: packaged.name,
      bytes: packaged.bytes,
      sha256: packaged.sha256,
      path: downloaded.path
    });
  }
  for (const name of downloadedArtifacts.keys()) {
    requireCondition(
      publicationArtifacts.some((artifact) => artifact.name === name),
      `publication input contains unreviewed artifact ${name}`
    );
  }
  for (const name of checksumRecords.keys()) {
    requireCondition(
      downloadedArtifacts.has(name),
      `SHA256SUMS contains unreviewed artifact ${name}`
    );
  }

  return {
    schema_version: 1,
    status: 'pass',
    source_commit: releaseManifest.source_commit,
    application_version: packageVersion,
    release_tag: requestedTag,
    artifacts: publicationArtifacts,
    checksum: {
      name: 'SHA256SUMS',
      bytes: Buffer.byteLength(checksumText),
      sha256: createHash('sha256').update(checksumText).digest('hex')
    }
  };
}

/**
 * @param {string} directory
 * @returns {Array<{name: string, path: string, bytes: number, sha256: string}>}
 */
function collectArtifacts(directory) {
  requireCondition(
    existsSync(directory),
    'publication artifact directory is missing'
  );
  requireCondition(
    lstatSync(directory).isDirectory() && realpathSync(directory) === directory,
    'publication artifact directory must be a real directory'
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
      else if (
        entry.isFile() &&
        artifactExtensions.some((extension) => entry.name.endsWith(extension))
      ) {
        paths.push(candidate);
      }
    }
  }
  visit(directory);
  return paths.map((path) => {
    const bytes = readFileSync(path);
    requireCondition(bytes.length > 0, `${basename(path)} is empty`);
    return {
      name: basename(path),
      path,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex')
    };
  });
}

/** @param {string} repositoryRelativePath */
function retainedEvidencePath(repositoryRelativePath) {
  const path = resolve(root, repositoryRelativePath);
  requireCondition(
    path.startsWith(`${phase5Root}${sep}`) &&
      existsSync(path) &&
      lstatSync(path).isFile() &&
      !lstatSync(path).isSymbolicLink() &&
      lstatSync(path).size > 0 &&
      realpathSync(path) === path,
    'retained checksum must be a nonempty regular Phase 5 evidence file'
  );
  return path;
}

function runEvidenceAudit() {
  const audit = spawnSync(
    process.execPath,
    [resolve(root, 'scripts', 'audit-release-evidence.mjs')],
    { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
  );
  if (audit.status !== 0) {
    throw new Error(
      `Phase 5 release evidence gate did not pass; publication is forbidden\n${audit.stderr || audit.stdout}`
    );
  }
}

function evidenceCommit() {
  const git = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8'
  });
  const commit = git.stdout.trim();
  requireCondition(
    git.status === 0 && /^[a-f0-9]{40}$/.test(commit),
    'could not identify the audited evidence commit'
  );
  return commit;
}

/** @param {any} artifact */
function withoutLocalPath(artifact) {
  const redacted = { ...artifact };
  delete redacted.path;
  return redacted;
}

/**
 * @param {string} path
 * @param {any} report
 */
function writeReport(path, report) {
  const resolved = resolve(root, path);
  const artifactRoot = resolve(root, 'artifacts');
  requireCondition(
    resolved.startsWith(`${artifactRoot}${sep}`) &&
      basename(resolved).endsWith('.json'),
    'publication report must be a JSON file under artifacts/'
  );
  if (!existsSync(artifactRoot)) {
    mkdirSync(artifactRoot, { mode: 0o755 });
  }
  requireCondition(
    lstatSync(artifactRoot).isDirectory() &&
      realpathSync(artifactRoot) === artifactRoot,
    'publication report root must be a real artifacts/ directory'
  );
  mkdirSync(dirname(resolved), { recursive: true });
  requireCondition(
    realpathSync(dirname(resolved)) === dirname(resolved),
    'publication report directory must not use symbolic paths'
  );
  requireCondition(
    !existsSync(resolved) || !lstatSync(resolved).isSymbolicLink(),
    'publication report must not be a symbolic link'
  );
  const redacted = {
    ...report,
    artifacts: report.artifacts.map(withoutLocalPath)
  };
  writeFileSync(resolved, `${JSON.stringify(redacted, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o644
  });
}

function main() {
  const mode = process.argv[2];
  requireCondition(
    mode === 'prepare' || mode === 'verify',
    'usage: node scripts/release-publication.mjs <prepare|verify> --directory <artifact-dir> --tag <tag> --report <report.json> [--output <staging-dir> --confirm <confirmation>]'
  );
  const { values } = parseArgs({
    args: process.argv.slice(3),
    options: {
      directory: { type: 'string' },
      tag: { type: 'string' },
      report: { type: 'string' },
      output: { type: 'string' },
      confirm: { type: 'string' }
    },
    strict: true
  });
  requireCondition(
    values.directory && values.tag && values.report,
    'publication directory, tag, and report are required'
  );
  const outputOption = values.output;
  if (mode === 'prepare') {
    requireCondition(outputOption, 'publication staging output is required');
    requireCondition(
      values.confirm === `publish-${values.tag}`,
      `publication requires the exact confirmation publish-${values.tag}`
    );
  } else {
    requireCondition(
      !values.output && !values.confirm,
      'publication verification does not accept staging or confirmation options'
    );
  }

  runEvidenceAudit();
  const releaseManifest = readJson(
    resolve(root, 'evidence', 'release', 'manifest.json'),
    'release manifest'
  );
  const packaging = readJson(
    resolve(phase5Root, 'packaging-results.json'),
    'packaging evidence'
  );
  const packageJson = readJson(resolve(root, 'package.json'), 'package.json');
  const retainedChecksumPath = retainedEvidencePath(
    packaging.checksum_manifest
  );
  const retainedChecksumText = readFileSync(retainedChecksumPath, 'utf8');
  const directory = resolve(root, values.directory);
  const inputChecksumPath =
    mode === 'verify' ? resolve(directory, 'SHA256SUMS') : retainedChecksumPath;
  requireCondition(
    existsSync(inputChecksumPath) &&
      lstatSync(inputChecksumPath).isFile() &&
      !lstatSync(inputChecksumPath).isSymbolicLink() &&
      realpathSync(inputChecksumPath) === inputChecksumPath,
    'publication input SHA256SUMS is missing or unsafe'
  );
  const checksumText = readFileSync(inputChecksumPath, 'utf8');
  requireCondition(
    checksumText === retainedChecksumText,
    'publication SHA256SUMS is not byte-for-byte identical to retained evidence'
  );
  const report = validatePublicationContract({
    releaseManifest,
    packaging,
    packageVersion: packageJson.version,
    requestedTag: values.tag,
    artifacts: collectArtifacts(directory),
    checksumText
  });
  report.evidence_commit = evidenceCommit();

  if (mode === 'prepare') {
    requireCondition(outputOption, 'publication staging output is required');
    const output = resolve(root, outputOption);
    const artifactRoot = resolve(root, 'artifacts');
    requireCondition(
      existsSync(artifactRoot) &&
        lstatSync(artifactRoot).isDirectory() &&
        realpathSync(artifactRoot) === artifactRoot &&
        output.startsWith(`${artifactRoot}${sep}`) &&
        !output.startsWith(`${directory}${sep}`) &&
        !directory.startsWith(`${output}${sep}`),
      'publication staging output must stay under artifacts/'
    );
    requireCondition(
      !existsSync(output),
      'publication staging output already exists'
    );
    mkdirSync(output, { recursive: true, mode: 0o755 });
    for (const artifact of report.artifacts) {
      copyFileSync(artifact.path, resolve(output, artifact.name));
    }
    copyFileSync(retainedChecksumPath, resolve(output, 'SHA256SUMS'));
    const staged = validatePublicationContract({
      releaseManifest,
      packaging,
      packageVersion: packageJson.version,
      requestedTag: values.tag,
      artifacts: collectArtifacts(output),
      checksumText: readFileSync(resolve(output, 'SHA256SUMS'), 'utf8')
    });
    report.staging_verification = staged.status;
  }

  writeReport(values.report, report);
  process.stdout.write(
    `${mode === 'prepare' ? 'prepared' : 'verified'} ${report.artifacts.length} exact reviewed release artifacts for ${report.release_tag}\n`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename)
  main();
