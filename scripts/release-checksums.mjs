import { createHash } from 'node:crypto';
import {
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync
} from 'node:fs';
import { basename, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';

import {
  disallowedReleaseChanges,
  releaseChangeSummary
} from './release-source-state.mjs';
import { distributableArtifacts } from './release-platform-contract.mjs';

const root = resolve(import.meta.dirname, '..');
const { values } = parseArgs({
  options: {
    directory: { type: 'string' },
    output: { type: 'string' },
    manifest: { type: 'string' },
    'require-complete': { type: 'boolean', default: false }
  },
  strict: true
});
if (!values.directory || !values.output || !values.manifest) {
  throw new Error(
    'usage: node scripts/release-checksums.mjs --directory <bundle-dir> --output <SHA256SUMS> --manifest <checksums.json>'
  );
}

const directory = resolve(root, values.directory);
const outputPath = resolve(root, values.output);
const manifestPath = resolve(root, values.manifest);
for (const path of [outputPath, manifestPath]) {
  if (path !== root && !path.startsWith(`${root}${sep}`)) {
    throw new Error('release checksum output must stay inside the repository');
  }
}

function artifactsUnder(path) {
  const found = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const candidate = resolve(path, entry.name);
    if (entry.isSymbolicLink()) {
      if (distributableArtifacts.some(({ matches }) => matches(entry.name))) {
        throw new Error(
          `release artifact ${entry.name} must not be a symbolic link`
        );
      }
      continue;
    }
    if (entry.isDirectory()) found.push(...artifactsUnder(candidate));
    else if (
      distributableArtifacts.some(({ matches }) => matches(entry.name))
    ) {
      found.push(candidate);
    }
  }
  return found;
}

if (
  !lstatSync(directory).isDirectory() ||
  realpathSync(directory) !== directory
) {
  throw new Error('release artifact directory must be a real directory');
}
const artifacts = artifactsUnder(directory).sort((left, right) =>
  basename(left).localeCompare(basename(right))
);
if (artifacts.length === 0) throw new Error('no release artifacts were found');
if (values['require-complete']) {
  for (const descriptor of distributableArtifacts) {
    const matches = artifacts.filter((path) =>
      descriptor.matches(basename(path))
    );
    if (matches.length !== 1) {
      throw new Error(
        `complete release checksum set requires exactly one ${descriptor.id}; found ${matches.length}`
      );
    }
  }
}
const names = new Set();
const records = artifacts.map((path) => {
  const stat = lstatSync(path);
  const name = basename(path);
  if (!stat.isFile() || stat.size === 0 || realpathSync(path) !== path) {
    throw new Error(`release artifact ${name} is not a nonempty regular file`);
  }
  if (!names.add(name))
    throw new Error(`duplicate release artifact name ${name}`);
  return {
    name,
    repository_relative_path: relative(root, path),
    bytes: stat.size,
    sha256: createHash('sha256').update(readFileSync(path)).digest('hex')
  };
});
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
const disallowedChanges = disallowedReleaseChanges(gitStatus.stdout, {
  allowGeneratedOutputs: true
});
if (disallowedChanges.length > 0) {
  throw new Error(
    `release checksums refuse uncommitted application or packaging inputs: ${releaseChangeSummary(disallowedChanges)}`
  );
}
const packageJson = JSON.parse(
  readFileSync(resolve(root, 'package.json'), 'utf8')
);

writeFileSync(
  outputPath,
  `${records.map((record) => `${record.sha256}  ${record.name}`).join('\n')}\n`,
  { encoding: 'utf8', mode: 0o644 }
);
writeFileSync(
  manifestPath,
  `${JSON.stringify(
    {
      schema_version: 1,
      algorithm: 'sha256',
      source_commit: git.stdout.trim(),
      application_version: packageJson.version,
      artifacts: records
    },
    null,
    2
  )}\n`,
  { encoding: 'utf8', mode: 0o644 }
);
process.stdout.write(`hashed ${records.length} release artifact(s)\n`);
