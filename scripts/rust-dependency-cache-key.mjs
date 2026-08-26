import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const ignoredDirectories = new Set([
  '.git',
  'artifacts',
  'dist',
  'evidence',
  'node_modules',
  'target'
]);
const compileEnvironmentNames = new Set([
  'CARGO_BUILD_TARGET',
  'CARGO_ENCODED_RUSTFLAGS',
  'CARGO_INCREMENTAL',
  'CC',
  'CFLAGS',
  'CXX',
  'CXXFLAGS',
  'MACOSX_DEPLOYMENT_TARGET',
  'RUSTC_WORKSPACE_WRAPPER',
  'RUSTC_WRAPPER',
  'RUSTDOCFLAGS',
  'RUSTFLAGS',
  'SDKROOT'
]);
const compileEnvironmentPrefixes = [
  'CARGO_PROFILE_',
  'CARGO_TARGET_',
  'CMAKE_'
];

/** @param {string} manifest */
export function normalizeCargoManifest(manifest) {
  let section = '';
  return manifest
    .replaceAll('\r\n', '\n')
    .split('\n')
    .map((line) => {
      const header = line.match(/^\s*(\[[^\]]+\])\s*$/);
      if (header) section = header[1];
      if (section === '[workspace.package]' && /^\s*version\s*=/.test(line)) {
        return '';
      }
      if (/\bpath\s*=/.test(line)) {
        return line
          .replace(/\bversion\s*=\s*"[^"]+"\s*,\s*/, '')
          .replace(/,\s*version\s*=\s*"[^"]+"/, '');
      }
      return line;
    })
    .join('\n');
}

/** @param {string} lockfile */
export function normalizeCargoLock(lockfile) {
  const blocks = lockfile
    .replaceAll('\r\n', '\n')
    .split(/(?=^\[\[package\]\]\s*$)/m);
  return blocks
    .filter((block, index) => index === 0 || /^source\s*=/m.test(block))
    .join('');
}

/** @param {string} directory */
function cargoManifests(directory) {
  /** @type {string[]} */
  const manifests = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        manifests.push(...cargoManifests(resolve(directory, entry.name)));
      }
    } else if (entry.name === 'Cargo.toml') {
      manifests.push(resolve(directory, entry.name));
    }
  }
  return manifests.sort();
}

/**
 * @param {string} repositoryRoot
 * @param {NodeJS.ProcessEnv} environment
 */
export function rustDependencyCacheKey(
  repositoryRoot = root,
  environment = process.env
) {
  const hash = createHash('sha256');
  hash.update('querynot-rust-dependencies-v1\0');

  for (const manifest of cargoManifests(repositoryRoot)) {
    hash.update(relative(repositoryRoot, manifest));
    hash.update('\0');
    hash.update(normalizeCargoManifest(readFileSync(manifest, 'utf8')));
    hash.update('\0');
  }

  const lockfile = resolve(repositoryRoot, 'Cargo.lock');
  hash.update(normalizeCargoLock(readFileSync(lockfile, 'utf8')));
  hash.update('\0');

  for (const path of [
    'rust-toolchain.toml',
    '.cargo/config.toml',
    '.cargo/config'
  ]) {
    const absolute = resolve(repositoryRoot, path);
    if (existsSync(absolute)) {
      hash.update(path);
      hash.update('\0');
      hash.update(readFileSync(absolute));
      hash.update('\0');
    }
  }

  for (const [name, value] of Object.entries(environment)
    .filter(
      ([name]) =>
        compileEnvironmentNames.has(name) ||
        compileEnvironmentPrefixes.some((prefix) => name.startsWith(prefix))
    )
    .sort(([left], [right]) => left.localeCompare(right))) {
    hash.update(`${name}=${value ?? ''}\0`);
  }

  return hash.digest('hex');
}

function main() {
  const output = `key=${rustDependencyCacheKey()}\n`;
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, output);
  } else {
    process.stdout.write(output);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  main();
}
