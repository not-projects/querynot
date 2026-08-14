import { createHash } from 'node:crypto';
import {
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync
} from 'node:fs';
import { basename, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { arch, platform, release } from 'node:os';
import { parseArgs } from 'node:util';

import { porcelainPaths } from './release-source-state.mjs';

const root = resolve(import.meta.dirname, '..');
const { values } = parseArgs({
  options: {
    binary: { type: 'string' },
    directory: { type: 'string' },
    expect: { type: 'string' },
    report: { type: 'string' }
  },
  strict: true
});
if (!values.binary || !values.directory || !values.expect || !values.report) {
  throw new Error(
    'usage: node scripts/inspect-release-artifacts.mjs --binary <release-binary> --directory <bundle-dir> --expect <comma-formats> --report <report.json>'
  );
}

const binaryPath = resolve(root, values.binary);
const directory = resolve(root, values.directory);
const reportPath = resolve(root, values.report);
if (reportPath !== root && !reportPath.startsWith(`${root}${sep}`)) {
  throw new Error('artifact inspection report must stay inside the repository');
}
for (const path of [binaryPath, directory]) {
  if (realpathSync(path) !== path)
    throw new Error('artifact inspection refuses symbolic paths');
}
if (!lstatSync(binaryPath).isFile() || lstatSync(binaryPath).size === 0) {
  throw new Error('release binary is absent or empty');
}

const formatExtensions = new Map([
  ['appimage', '.AppImage'],
  ['deb', '.deb'],
  ['dmg', '.dmg'],
  ['nsis', '.exe']
]);
const expected = values.expect
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
if (
  expected.length === 0 ||
  expected.some((format) => !formatExtensions.has(format))
) {
  throw new Error(
    'artifact inspection received an unsupported expected format'
  );
}

function regularFiles(path) {
  const files = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const candidate = resolve(path, entry.name);
    if (entry.isSymbolicLink()) {
      if (
        [...formatExtensions.values()].some((extension) =>
          entry.name.endsWith(extension)
        )
      ) {
        throw new Error('release artifact must not be a symbolic link');
      }
      continue;
    }
    if (entry.isDirectory()) files.push(...regularFiles(candidate));
    else if (entry.isFile()) files.push(candidate);
  }
  return files;
}
const files = regularFiles(directory);
const artifacts = expected.map((format) => {
  const extension = formatExtensions.get(format);
  const matches = files.filter((path) => path.endsWith(extension));
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly one ${format} artifact; found ${matches.length}`
    );
  }
  const path = matches[0];
  const bytes = readFileSync(path);
  if (bytes.length === 0) throw new Error(`${format} artifact is empty`);
  return {
    format,
    name: basename(path),
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex')
  };
});

const binary = readFileSync(binaryPath);
for (const forbidden of [
  root,
  '-----BEGIN PRIVATE KEY-----',
  '-----BEGIN ENCRYPTED PRIVATE KEY-----',
  'hunter42',
  'phase4-insert'
]) {
  if (binary.includes(Buffer.from(forbidden))) {
    throw new Error(
      `release binary contains forbidden build or test material: ${forbidden}`
    );
  }
}
const config = JSON.parse(
  readFileSync(resolve(root, 'src-tauri/tauri.conf.json'))
);
const capability = JSON.parse(
  readFileSync(resolve(root, 'src-tauri/capabilities/main.json'))
);
if (
  config.bundle?.createUpdaterArtifacts !== false ||
  config.bundle?.active !== true ||
  !Array.isArray(config.bundle?.targets) ||
  config.bundle.targets.length !== 0 ||
  !String(config.app?.security?.csp).includes("script-src 'self'") ||
  capability.permissions.some((permission) =>
    /shell|process|http|env|fs:allow/.test(permission)
  )
) {
  throw new Error(
    'release configuration violates the reviewed local capability boundary'
  );
}
const git = spawnSync('git', ['rev-parse', 'HEAD'], {
  cwd: root,
  encoding: 'utf8'
});
if (git.status !== 0)
  throw new Error('could not identify the release source commit');
const gitStatus = spawnSync(
  'git',
  ['status', '--porcelain', '--untracked-files=all'],
  { cwd: root, encoding: 'utf8' }
);
if (gitStatus.status !== 0)
  throw new Error('could not inspect the release source tree');
const disallowedChanges = porcelainPaths(gitStatus.stdout).filter(
  (path) => !path.startsWith('evidence/phase-5/')
);
if (disallowedChanges.length > 0) {
  throw new Error(
    'release artifact inspection refuses uncommitted application or packaging inputs'
  );
}
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json')));
const report = {
  schema_version: 1,
  source_commit: git.stdout.trim(),
  application_version: packageJson.version,
  status: 'pass',
  environment: {
    os: platform(),
    architecture: arch(),
    os_release: release(),
    node: process.version,
    ci_runner_image: process.env.ImageOS ?? null,
    ci_runner_version: process.env.ImageVersion ?? null
  },
  binary: {
    name: basename(binaryPath),
    bytes: binary.length,
    sha256: createHash('sha256').update(binary).digest('hex'),
    forbidden_material_scan: 'pass'
  },
  artifacts,
  updater_artifacts: false,
  capability_and_csp_review: 'pass'
};
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
  encoding: 'utf8',
  mode: 0o644
});
process.stdout.write(
  `release artifact inspection passed for ${expected.join(', ')}\n`
);
