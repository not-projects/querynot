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
 *   installerName: string,
 *   signature: string
 * }} input
 */
export function buildUpdaterManifest({
  version,
  releaseNotes,
  publishedAt,
  installerName,
  signature
}) {
  requireCondition(
    /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version),
    'version is not semantic'
  );
  requireCondition(
    installerName === basename(installerName) && installerName.endsWith('.exe'),
    'installer name is unsafe'
  );
  requireCondition(
    typeof signature === 'string' && signature.length > 32,
    'updater signature is missing'
  );
  requireCondition(
    !Number.isNaN(Date.parse(publishedAt)),
    'publication date is invalid'
  );
  const tag = `v${version}`;
  const url = `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(installerName)}`;
  const platform = { signature, url };
  return {
    version,
    notes: normalizeReleaseNotes(releaseNotes),
    pub_date: new Date(publishedAt).toISOString(),
    platforms: {
      'windows-x86_64-nsis': platform,
      'windows-x86_64': { ...platform }
    }
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
  const installers = files.filter((path) => path.endsWith('.exe'));
  requireCondition(
    installers.length === 1,
    `expected exactly one Windows installer; found ${installers.length}`
  );
  const installer = installers[0];
  const signatures = files.filter((path) => path.endsWith('.exe.sig'));
  requireCondition(
    signatures.length === 1 && signatures[0] === `${installer}.sig`,
    'expected exactly one signature matching the Windows installer'
  );
  const signature = readFileSync(signatures[0], 'utf8').trim();
  requireCondition(
    signature.length > 32 && !/[\u0000-\u001f\u007f]/.test(signature),
    'updater signature is invalid'
  );

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
    installerName: basename(installer),
    signature
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
        schema_version: 1,
        status: 'pass',
        source_commit: sourceCommit(),
        application_version: packageJson.version,
        endpoint:
          'https://github.com/not-projects/querynot/releases/latest/download/latest.json',
        installer: {
          name: basename(installer),
          bytes: lstatSync(installer).size,
          sha256: sha256(installer)
        },
        signature: {
          name: basename(signatures[0]),
          bytes: lstatSync(signatures[0]).size,
          sha256: sha256(signatures[0])
        },
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
    `created signed updater manifest for QueryNot ${packageJson.version}\n`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename)
  main();
