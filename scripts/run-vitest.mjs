import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const temporaryDirectory = resolve(root, '.tmp', 'vitest');
mkdirSync(temporaryDirectory, { recursive: true });

const result = spawnSync(
  process.execPath,
  [resolve(root, 'node_modules/vitest/vitest.mjs'), 'run'],
  {
    cwd: root,
    env: {
      ...process.env,
      TEMP: temporaryDirectory,
      TMP: temporaryDirectory,
      TMPDIR: temporaryDirectory
    },
    stdio: 'inherit'
  }
);

if (result.error) {
  throw result.error;
}

process.exitCode = result.status ?? 1;
