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

const root = resolve(import.meta.dirname, '..');
const expectedPlatformKeys = ['windows-x86_64', 'windows-x86_64-nsis'];

/**
 * @typedef {{
 *   name: string,
 *   path: string,
 *   bytes: number,
 *   sha256: string,
 *   content: Buffer
 * }} FileRecord
 */

/**
 * @param {unknown} condition
 * @param {string} message
 * @returns {asserts condition}
 */
function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

/** @param {string | Buffer} bytes */
function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * @param {string} directory
 * @returns {string[]}
 */
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

/**
 * @param {string} path
 * @returns {FileRecord}
 */
function fileRecord(path) {
  const bytes = readFileSync(path);
  requireCondition(bytes.length > 0, `${basename(path)} is empty`);
  return {
    name: basename(path),
    path,
    bytes: bytes.length,
    sha256: sha256(bytes),
    content: bytes
  };
}

/**
 * @param {string} directory
 * @returns {{
 *   installer: FileRecord,
 *   signature: FileRecord,
 *   latest: FileRecord,
 *   checksums: FileRecord,
 *   paths: string[]
 * }}
 */
function collectPublicAssets(directory) {
  const paths = regularFiles(directory);
  const installer = fileRecord(
    onePath(paths, (path) => path.endsWith('.exe'), 'Windows installer')
  );
  const signature = fileRecord(
    onePath(paths, (path) => path.endsWith('.exe.sig'), 'updater signature')
  );
  const latest = fileRecord(
    onePath(paths, (path) => basename(path) === 'latest.json', 'latest.json')
  );
  const checksums = fileRecord(
    onePath(paths, (path) => basename(path) === 'SHA256SUMS', 'SHA256SUMS')
  );
  requireCondition(
    signature.name === `${installer.name}.sig`,
    'updater signature does not match the Windows installer name'
  );
  requireCondition(
    safeArtifactName(installer.name) && safeArtifactName(signature.name),
    'publication input has an unsafe artifact name'
  );
  return { installer, signature, latest, checksums, paths };
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
 * @param {{
 *   version: string,
 *   requestedTag: string,
 *   releaseNotes: string,
 *   installer: FileRecord,
 *   signature: FileRecord,
 *   latest: any,
 *   checksumText: string
 * }} input
 * @returns {any}
 */
export function validateUpdatePublicationContract({
  version,
  requestedTag,
  releaseNotes,
  installer,
  signature,
  latest,
  checksumText
}) {
  requireCondition(
    requestedTag === `v${version}`,
    'requested tag does not match the application version'
  );
  requireCondition(
    signature.name === `${installer.name}.sig`,
    'signature name does not match the installer'
  );
  const checksums = parseChecksumManifest(checksumText);
  requireCondition(
    checksums.size === 1 && checksums.get(installer.name) === installer.sha256,
    'SHA256SUMS does not identify exactly the Windows installer bytes'
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
    'latest.json does not contain exactly the supported Windows updater keys'
  );
  const expectedUrl = `https://github.com/not-projects/querynot/releases/download/v${version}/${encodeURIComponent(installer.name)}`;
  const signatureText = signature.content.toString('utf8').trim();
  requireCondition(signatureText.length > 32, 'updater signature is invalid');
  for (const platform of expectedPlatformKeys) {
    requireCondition(
      JSON.stringify(Object.keys(latest.platforms[platform] ?? {}).sort()) ===
        JSON.stringify(['signature', 'url']),
      `latest.json ${platform} contains unexpected fields`
    );
    requireCondition(
      latest.platforms[platform]?.url === expectedUrl,
      `latest.json ${platform} URL does not match the reviewed installer`
    );
    requireCondition(
      latest.platforms[platform]?.signature === signatureText,
      `latest.json ${platform} signature does not match the reviewed signature`
    );
  }
  return {
    schema_version: 1,
    status: 'pass',
    application_version: version,
    release_tag: requestedTag,
    assets: [installer, signature].map(
      ({ content, path, ...record }) => record
    ),
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
 * @param {{installer: FileRecord, signature: FileRecord, latest: FileRecord}} assets
 * @param {string} version
 * @param {string} sourceCommit
 */
function validateCandidateEvidence(paths, assets, version, sourceCommit) {
  const inspection = readJson(
    onePath(
      paths,
      (path) => basename(path) === 'inspection.json',
      'candidate inspection report'
    ),
    'candidate inspection report'
  );
  const manifestReport = readJson(
    onePath(
      paths,
      (path) => basename(path) === 'updater-manifest-report.json',
      'updater manifest report'
    ),
    'updater manifest report'
  );
  const checksums = readJson(
    onePath(
      paths,
      (path) => basename(path) === 'checksums.json',
      'candidate checksum report'
    ),
    'candidate checksum report'
  );
  for (const [label, report] of [
    ['candidate inspection', inspection],
    ['updater manifest', manifestReport]
  ]) {
    requireCondition(
      report?.schema_version === 1 && report?.status === 'pass',
      `${label} did not pass`
    );
    requireCondition(
      report?.source_commit === sourceCommit,
      `${label} source does not match the checked-out candidate`
    );
    requireCondition(
      report?.application_version === version,
      `${label} version does not match package.json`
    );
  }
  requireCondition(
    inspection.updater_artifacts === true,
    'candidate inspection did not require updater artifacts'
  );
  requireCondition(
    Array.isArray(inspection.artifacts) && inspection.artifacts.length === 1,
    'candidate inspection does not contain exactly one installer'
  );
  const inspected = inspection.artifacts[0];
  requireCondition(
    inspected.name === assets.installer.name &&
      inspected.bytes === assets.installer.bytes &&
      inspected.sha256 === assets.installer.sha256,
    'candidate installer does not match its inspection'
  );
  requireCondition(
    inspected.signature?.name === assets.signature.name &&
      inspected.signature?.bytes === assets.signature.bytes &&
      inspected.signature?.sha256 === assets.signature.sha256,
    'candidate signature does not match its inspection'
  );
  requireCondition(
    manifestReport.installer?.name === assets.installer.name &&
      manifestReport.installer?.bytes === assets.installer.bytes &&
      manifestReport.installer?.sha256 === assets.installer.sha256 &&
      manifestReport.signature?.name === assets.signature.name &&
      manifestReport.signature?.bytes === assets.signature.bytes &&
      manifestReport.signature?.sha256 === assets.signature.sha256 &&
      manifestReport.manifest?.name === assets.latest.name &&
      manifestReport.manifest?.bytes === assets.latest.bytes &&
      manifestReport.manifest?.sha256 === assets.latest.sha256,
    'updater manifest report does not match candidate bytes'
  );
  requireCondition(
    manifestReport.endpoint ===
      'https://github.com/not-projects/querynot/releases/latest/download/latest.json' &&
      Array.isArray(manifestReport.platform_keys) &&
      JSON.stringify([...manifestReport.platform_keys].sort()) ===
        JSON.stringify(expectedPlatformKeys),
    'updater manifest report has the wrong endpoint or platform keys'
  );
  requireCondition(
    checksums?.schema_version === 1 &&
      checksums?.source_commit === sourceCommit &&
      checksums?.application_version === version,
    'candidate checksum report source or version does not match'
  );
  requireCondition(
    Array.isArray(checksums.artifacts) &&
      checksums.artifacts.length === 1 &&
      checksums.artifacts[0]?.name === assets.installer.name &&
      checksums.artifacts[0]?.sha256 === assets.installer.sha256,
    'candidate checksum report does not match the installer'
  );
}

/**
 * @param {string} path
 * @param {string} label
 */
function checkedArtifactOutput(path, label) {
  const resolved = resolve(root, path);
  const artifactsRoot = resolve(root, 'artifacts');
  requireCondition(
    resolved.startsWith(`${artifactsRoot}${sep}`),
    `${label} must stay under artifacts/`
  );
  return resolved;
}

/**
 * @param {string} path
 * @param {any} report
 */
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
    mode === 'prepare' || mode === 'verify',
    'usage: node scripts/release-update-publication.mjs <prepare|verify> --directory <artifact-dir> --tag <tag> --report <report.json> [--output <staging-dir> --confirm <confirmation>]'
  );
  const { values } = parseArgs({
    args: process.argv.slice(3),
    options: {
      directory: { type: 'string' },
      output: { type: 'string' },
      tag: { type: 'string' },
      report: { type: 'string' },
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
      !outputOption && !values.confirm,
      'verification does not accept staging or confirmation options'
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
    installer: assets.installer,
    signature: assets.signature,
    latest,
    checksumText: assets.checksums.content.toString('utf8')
  });
  report.source_commit = currentSourceCommit();
  report.latest.sha256 = assets.latest.sha256;
  if (mode === 'prepare') {
    validateCandidateEvidence(
      assets.paths,
      assets,
      packageJson.version,
      report.source_commit
    );
    requireCondition(outputOption, 'publication staging output is required');
    const output = checkedArtifactOutput(
      outputOption,
      'publication staging output'
    );
    requireCondition(
      !existsSync(output),
      'publication staging output already exists'
    );
    mkdirSync(output, { recursive: true, mode: 0o755 });
    for (const asset of [
      assets.installer,
      assets.signature,
      assets.latest,
      assets.checksums
    ]) {
      copyFileSync(asset.path, resolve(output, asset.name));
    }
    const staged = collectPublicAssets(output);
    requireCondition(
      staged.paths.length === 4,
      'publication staging contains unexpected files'
    );
    report.staging_verification = 'pass';
  } else {
    requireCondition(
      assets.paths.length === 4,
      'published release contains unexpected assets'
    );
  }
  writeReport(values.report, report);
  process.stdout.write(
    `${mode === 'prepare' ? 'prepared' : 'verified'} four signed update release assets for ${values.tag}\n`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename)
  main();
