import { createHash } from 'node:crypto';
import {
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
  exactlyOneMatchingPath,
  updaterPlatformBindings,
  updaterPayloads
} from './release-platform-contract.mjs';

const root = resolve(import.meta.dirname, '..');
const repository = 'not-projects/querynot';

/**
 * @param {unknown} condition
 * @param {string} message
 * @returns {asserts condition}
 */
function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * @param {string} directory
 * @returns {string[]}
 */
function regularFiles(directory) {
  /** @type {string[]} */
  const paths = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const candidate = resolve(directory, entry.name);
    requireCondition(
      !entry.isSymbolicLink(),
      'updater manifest input must not contain symbolic links'
    );
    if (entry.isDirectory()) paths.push(...regularFiles(candidate));
    else if (entry.isFile()) paths.push(candidate);
  }
  return paths;
}

/** @param {string} path */
function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function sourceCommit() {
  const git = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8'
  });
  requireCondition(git.status === 0, 'could not identify candidate source');
  const commit = git.stdout.trim();
  requireCondition(
    /^[a-f0-9]{40}$/.test(commit),
    'candidate source is invalid'
  );
  return commit;
}

function sourceDate() {
  const git = spawnSync('git', ['show', '-s', '--format=%cI', 'HEAD'], {
    cwd: root,
    encoding: 'utf8'
  });
  requireCondition(
    git.status === 0,
    'could not identify candidate source date'
  );
  const value = git.stdout.trim();
  requireCondition(
    !Number.isNaN(Date.parse(value)),
    'candidate source date is invalid'
  );
  return new Date(value).toISOString();
}

/** @param {string} releaseNotes */
export function normalizeReleaseNotes(releaseNotes) {
  requireCondition(
    typeof releaseNotes === 'string',
    'release notes must be text'
  );
  return releaseNotes.replace(/\r\n?/g, '\n').trim();
}

/**
 * @param {string} path
 * @param {string} label
 */
function checkedOutputPath(path, label) {
  const resolved = resolve(root, path);
  requireCondition(
    resolved.startsWith(`${resolve(root, 'artifacts')}${sep}`),
    `${label} must stay under artifacts/`
  );
  mkdirSync(dirname(resolved), { recursive: true, mode: 0o755 });
  requireCondition(
    !existsSync(resolved) || !lstatSync(resolved).isSymbolicLink(),
    `${label} must not be a symbolic link`
  );
  return resolved;
}

/**
 * @param {{
 *   version: string,
 *   releaseNotes: string,
 *   publishedAt: string,
 *   payloads: Record<string, {name: string, signature: string}>
 * }} input
 */
export function buildUpdaterManifest({
  version,
  releaseNotes,
  publishedAt,
  payloads
}) {
  requireCondition(
    /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version),
    'version is not semantic'
  );
  requireCondition(
    !Number.isNaN(Date.parse(publishedAt)),
    'publication date is invalid'
  );
  const tag = `v${version}`;
  /** @type {Record<string, {signature: string, url: string}>} */
  const platforms = {};
  for (const { key, payloadId } of updaterPlatformBindings) {
    const payload = payloads?.[payloadId];
    const descriptor = updaterPayloads.find(({ id }) => id === payloadId);
    requireCondition(descriptor, `unknown updater payload ${payloadId}`);
    requireCondition(
      payload?.name === basename(payload.name) &&
        descriptor.matches(payload.name),
      `${payloadId} updater payload name is unsafe or unexpected`
    );
    requireCondition(
      typeof payload.signature === 'string' && payload.signature.length > 32,
      `${payloadId} updater signature is missing`
    );
    platforms[key] = {
      signature: payload.signature,
      url: `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(payload.name)}`
    };
  }
  return {
    version,
    notes: normalizeReleaseNotes(releaseNotes),
    pub_date: new Date(publishedAt).toISOString(),
    platforms
  };
}

function main() {
  const { values } = parseArgs({
    options: {
      directory: { type: 'string' },
      output: { type: 'string' },
      report: { type: 'string' }
    },
    strict: true
  });
  requireCondition(
    values.directory && values.output && values.report,
    'usage: node scripts/create-updater-manifest.mjs --directory <bundle-dir> --output <latest.json> --report <report.json>'
  );
  const directory = resolve(root, values.directory);
  requireCondition(
    existsSync(directory) &&
      lstatSync(directory).isDirectory() &&
      realpathSync(directory) === directory,
    'updater bundle directory must be a real directory'
  );
  const files = regularFiles(directory);
  const payloadRecords = updaterPayloads.map((descriptor) => {
    const payloadPath = exactlyOneMatchingPath(
      files,
      descriptor.matches,
      `${descriptor.id} updater payload`
    );
    const signaturePath = exactlyOneMatchingPath(
      files,
      (name) => name === `${basename(payloadPath)}.sig`,
      `${descriptor.id} updater signature`
    );
    const signature = readFileSync(signaturePath, 'utf8').trim();
    requireCondition(
      signature.length > 32 && !/[\u0000-\u001f\u007f]/.test(signature),
      `${descriptor.id} updater signature is invalid`
    );
    return {
      id: descriptor.id,
      path: payloadPath,
      signaturePath,
      name: basename(payloadPath),
      signature
    };
  });

  const packageJson = JSON.parse(
    readFileSync(resolve(root, 'package.json'), 'utf8')
  );
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
  requireCondition(releaseNotes.length > 0, 'release notes are empty');
  const manifest = buildUpdaterManifest({
    version: packageJson.version,
    releaseNotes,
    publishedAt: sourceDate(),
    payloads: Object.fromEntries(
      payloadRecords.map(({ id, name, signature }) => [id, { name, signature }])
    )
  });
  const output = checkedOutputPath(values.output, 'updater manifest');
  const reportPath = checkedOutputPath(
    values.report,
    'updater manifest report'
  );
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(output, manifestText, { encoding: 'utf8', mode: 0o644 });
  writeFileSync(
    reportPath,
    `${JSON.stringify(
      {
        schema_version: 2,
        status: 'pass',
        source_commit: sourceCommit(),
        application_version: packageJson.version,
        endpoint:
          'https://github.com/not-projects/querynot/releases/latest/download/latest.json',
        updater_payloads: payloadRecords.map(
          ({ id, path, signaturePath, name }) => ({
            id,
            name,
            bytes: lstatSync(path).size,
            sha256: sha256(path),
            signature: {
              name: basename(signaturePath),
              bytes: lstatSync(signaturePath).size,
              sha256: sha256(signaturePath)
            }
          })
        ),
        manifest: {
          name: basename(output),
          bytes: Buffer.byteLength(manifestText),
          sha256: createHash('sha256').update(manifestText).digest('hex')
        },
        platform_keys: Object.keys(manifest.platforms)
      },
      null,
      2
    )}\n`,
    { encoding: 'utf8', mode: 0o644 }
  );
  process.stdout.write(
    `created signed cross-platform updater manifest for QueryNot ${packageJson.version}\n`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename)
  main();
