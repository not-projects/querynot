import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const temporaryRoot = process.platform === 'linux' ? '/tmp' : tmpdir();
const cacheArgument = process.argv[2] === '--cache' ? process.argv[3] : null;
if (process.argv.length > (cacheArgument ? 4 : 2)) {
  throw new Error(
    'usage: node scripts/fetch-native-feasibility.mjs [--cache /absolute/path]'
  );
}
const cache = resolve(
  cacheArgument ?? join(temporaryRoot, 'querynot-native-fixture-cache')
);
const manifest = JSON.parse(
  readFileSync(
    resolve(root, 'fixtures', 'native-feasibility-inputs.json'),
    'utf8'
  )
);
if (
  manifest.schema_version !== 1 ||
  manifest.platform !== 'linux-x86_64' ||
  !Array.isArray(manifest.inputs)
) {
  throw new Error('native feasibility input manifest is invalid');
}
mkdirSync(cache, { recursive: true, mode: 0o700 });

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

for (const input of manifest.inputs) {
  if (
    basename(input.file) !== input.file ||
    !input.url.startsWith('https://') ||
    !/^[a-f0-9]{64}$/.test(input.sha256)
  ) {
    throw new Error(`unsafe or incomplete native input record: ${input.id}`);
  }
  const destination = resolve(cache, input.file);
  if (existsSync(destination) && (await sha256(destination)) === input.sha256) {
    process.stdout.write(`verified cached ${input.file}\n`);
    continue;
  }
  const partial = `${destination}.partial-${process.pid}`;
  rmSync(partial, { force: true });
  try {
    const result = spawnSync(
      'curl',
      [
        '--fail',
        '--location',
        '--retry',
        '5',
        '--retry-all-errors',
        '--retry-delay',
        '2',
        '--connect-timeout',
        '30',
        '--output',
        partial,
        input.url
      ],
      { cwd: cache, stdio: 'inherit' }
    );
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`download failed for ${input.file}`);
    }
    if ((await sha256(partial)) !== input.sha256) {
      throw new Error(`SHA-256 mismatch for ${input.file}`);
    }
    renameSync(partial, destination);
    process.stdout.write(`downloaded and verified ${input.file}\n`);
  } finally {
    rmSync(partial, { force: true });
  }
}
