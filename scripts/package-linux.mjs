import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const cacheRoot = resolve(root, '.tmp', 'release-tool-cache');

const fetchTools = spawnSync('node', ['scripts/fetch-release-tools.mjs'], {
  cwd: root,
  encoding: 'utf8',
  stdio: 'inherit'
});
if (fetchTools.error) throw fetchTools.error;
if (fetchTools.status !== 0)
  throw new Error('reviewed Linux release tools are unavailable');

const build = spawnSync(
  'npm',
  ['run', 'tauri', '--', 'build', '--bundles', 'deb,appimage'],
  {
    cwd: root,
    env: { ...process.env, XDG_CACHE_HOME: cacheRoot },
    stdio: 'inherit'
  }
);
if (build.error) throw build.error;
if (build.status !== 0) throw new Error('Linux candidate packaging failed');
