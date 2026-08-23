import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, rmSync } from 'node:fs';
import { resolve, sep } from 'node:path';

import {
  disallowedReleaseChanges,
  releaseChangeSummary
} from './release-source-state.mjs';
import { updaterBuildConfig } from './updater-build-config.mjs';
import { validateUpdaterSigningEnvironment } from './updater-signing-environment.mjs';

const root = resolve(import.meta.dirname, '..');
const platform = process.argv[2];
const bundles = new Map([
  ['linux', 'deb,rpm,appimage'],
  ['windows', 'nsis,msi'],
  ['macos', 'app,dmg']
]);
if (!bundles.has(platform)) {
  throw new Error(
    'usage: node scripts/package-platform.mjs <linux|windows|macos>'
  );
}

validateUpdaterSigningEnvironment(process.env);
const updaterConfig = updaterBuildConfig(
  process.env.QUERYNOT_UPDATER_PUBLIC_KEY
);

const sourceStatus = spawnSync(
  'git',
  ['status', '--porcelain', '--untracked-files=all'],
  { cwd: root, encoding: 'utf8' }
);
if (sourceStatus.status !== 0) {
  throw new Error('could not inspect release inputs before packaging');
}
const dirtyInputs = disallowedReleaseChanges(sourceStatus.stdout);
if (dirtyInputs.length > 0) {
  throw new Error(
    `candidate packaging refuses uncommitted application or packaging inputs: ${releaseChangeSummary(dirtyInputs)}`
  );
}

const targetRoot = resolve(root, 'target', `release-candidate-${platform}`);
const allowedTargetRoot = resolve(root, 'target');
if (!targetRoot.startsWith(`${allowedTargetRoot}${sep}release-candidate-`)) {
  throw new Error(
    'release candidate target directory escaped the generated target root'
  );
}
if (existsSync(targetRoot)) {
  const stat = lstatSync(targetRoot);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(
      'release candidate target path is not a real generated directory'
    );
  }
  rmSync(targetRoot, { recursive: true, force: true });
}

if (platform === 'linux') {
  const fetchTools = spawnSync('node', ['scripts/fetch-release-tools.mjs'], {
    cwd: root,
    encoding: 'utf8',
    stdio: 'inherit'
  });
  if (fetchTools.error) throw fetchTools.error;
  if (fetchTools.status !== 0)
    throw new Error('reviewed Linux release tools are unavailable');
}

const cacheRoot = resolve(root, '.tmp', 'release-tool-cache');
const tauriCli = resolve(
  root,
  'node_modules',
  '@tauri-apps',
  'cli',
  'tauri.js'
);
const buildArguments = [tauriCli, 'build', '--bundles', bundles.get(platform)];
buildArguments.push('--config', updaterConfig);

const build = spawnSync(process.execPath, buildArguments, {
  cwd: root,
  env: {
    ...process.env,
    CARGO_TARGET_DIR: targetRoot,
    ...(platform === 'linux' ? { XDG_CACHE_HOME: cacheRoot } : {})
  },
  stdio: 'inherit'
});
if (build.error) throw build.error;
if (build.status !== 0)
  throw new Error(`${platform} candidate packaging failed`);
