import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const cacheRoot = resolve(root, '.tmp', 'release-tool-cache');
const reviewedRoot = resolve(cacheRoot, 'reviewed');
const tauriCache = resolve(cacheRoot, 'tauri');
const manifest = JSON.parse(
  readFileSync(resolve(root, 'fixtures', 'release-tool-inputs.json'), 'utf8')
);
const allowedHosts = new Set(['github.com', 'raw.githubusercontent.com']);

if (manifest.schema_version !== 1 || manifest.inputs?.length !== 5) {
  throw new Error('release-tool input manifest is incomplete');
}
mkdirSync(reviewedRoot, { recursive: true, mode: 0o700 });
mkdirSync(tauriCache, { recursive: true, mode: 0o700 });

function verify(input, bytes) {
  return (
    bytes.length === input.bytes &&
    createHash('sha256').update(bytes).digest('hex') === input.sha256
  );
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function download(input) {
  const url = new URL(input.url);
  if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname)) {
    throw new Error(`release tool ${input.id} uses an unapproved source`);
  }
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(
      `release tool ${input.id} download failed with ${response.status}`
    );
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > input.bytes) {
      throw new Error(
        `release tool ${input.id} exceeded its reviewed byte count`
      );
    }
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  if (!verify(input, bytes)) {
    throw new Error(
      `release tool ${input.id} failed its reviewed SHA-256 digest (received ${digest(bytes)})`
    );
  }
  return bytes;
}

for (const input of manifest.inputs) {
  if (
    typeof input.cache_name !== 'string' ||
    input.cache_name.includes('/') ||
    !Number.isInteger(input.bytes) ||
    input.bytes <= 0 ||
    !/^[a-f0-9]{64}$/.test(input.sha256)
  ) {
    throw new Error(
      `release tool ${input.id ?? 'unknown'} has invalid metadata`
    );
  }
  const destination = resolve(reviewedRoot, input.cache_name);
  let bytes = existsSync(destination) ? readFileSync(destination) : null;
  if (bytes && !verify(input, bytes)) {
    throw new Error(
      `cached release tool ${input.id} failed its reviewed digest`
    );
  }
  if (!bytes) {
    bytes = await download(input);
    const temporary = `${destination}.querynot-download`;
    if (existsSync(temporary)) unlinkSync(temporary);
    writeFileSync(temporary, bytes, { mode: 0o600, flag: 'wx' });
    renameSync(temporary, destination);
  }
  chmodSync(destination, input.executable ? 0o700 : 0o600);
  process.stdout.write(`verified ${input.id}\n`);
}

for (const input of manifest.inputs) {
  const reviewed = resolve(reviewedRoot, input.cache_name);
  const working = resolve(tauriCache, input.cache_name);
  if (existsSync(working)) {
    const stat = lstatSync(working);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(
        `release-tool work cache ${input.id} is not a regular file`
      );
    }
    unlinkSync(working);
  }
  copyFileSync(reviewed, working, 0);
  chmodSync(working, input.executable ? 0o700 : 0o600);
}

process.stdout.write(`${cacheRoot}\n`);
