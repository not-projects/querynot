import { basename } from 'node:path';

/**
 * Installable packages published for the cross-platform desktop release.
 * Match functions intentionally use Tauri's stable suffixes rather than a
 * version-specific filename so the contract survives routine version bumps.
 */
export const distributableArtifacts = [
  {
    id: 'windows-nsis-x64',
    format: 'nsis',
    matches: /** @param {string} name */ (name) =>
      name.endsWith('.exe') && !name.endsWith('.exe.sig')
  },
  {
    id: 'windows-msi-x64',
    format: 'msi',
    matches: /** @param {string} name */ (name) => name.endsWith('.msi')
  },
  {
    id: 'linux-appimage-x64',
    format: 'appimage',
    matches: /** @param {string} name */ (name) => name.endsWith('.AppImage')
  },
  {
    id: 'linux-deb-x64',
    format: 'deb',
    matches: /** @param {string} name */ (name) => name.endsWith('.deb')
  },
  {
    id: 'linux-rpm-x64',
    format: 'rpm',
    matches: /** @param {string} name */ (name) => name.endsWith('.rpm')
  },
  {
    id: 'macos-dmg-x64',
    format: 'dmg',
    matches: /** @param {string} name */ (name) => name.endsWith('_x64.dmg')
  },
  {
    id: 'macos-dmg-aarch64',
    format: 'dmg',
    matches: /** @param {string} name */ (name) => name.endsWith('_aarch64.dmg')
  }
];

/**
 * Unique payloads authenticated by the Tauri updater. Windows and Linux reuse
 * their installable package bytes; macOS updates use Tauri's app archive.
 */
export const updaterPayloads = [
  {
    id: 'windows-nsis-x64',
    matches: distributableArtifacts[0].matches
  },
  {
    id: 'windows-msi-x64',
    matches: distributableArtifacts[1].matches
  },
  {
    id: 'linux-appimage-x64',
    matches: distributableArtifacts[2].matches
  },
  {
    id: 'linux-deb-x64',
    matches: distributableArtifacts[3].matches
  },
  {
    id: 'linux-rpm-x64',
    matches: distributableArtifacts[4].matches
  },
  {
    id: 'macos-updater-x64',
    matches: /** @param {string} name */ (name) =>
      name.endsWith('_x64.app.tar.gz')
  },
  {
    id: 'macos-updater-aarch64',
    matches: /** @param {string} name */ (name) =>
      name.endsWith('_aarch64.app.tar.gz')
  }
];

/**
 * PostNot-compatible feed keys. The generic keys are the values selected by
 * Tauri at runtime; package-specific keys keep direct-package metadata usable.
 */
export const updaterPlatformBindings = [
  { key: 'windows-x86_64-nsis', payloadId: 'windows-nsis-x64' },
  { key: 'windows-x86_64', payloadId: 'windows-msi-x64' },
  { key: 'linux-x86_64-appimage', payloadId: 'linux-appimage-x64' },
  { key: 'linux-x86_64', payloadId: 'linux-appimage-x64' },
  { key: 'linux-x86_64-deb', payloadId: 'linux-deb-x64' },
  { key: 'linux-x86_64-rpm', payloadId: 'linux-rpm-x64' },
  { key: 'darwin-x86_64', payloadId: 'macos-updater-x64' },
  { key: 'darwin-aarch64', payloadId: 'macos-updater-aarch64' }
];

export const expectedPlatformKeys = updaterPlatformBindings
  .map(({ key }) => key)
  .sort();

export const candidateInspectionTargets = [
  'windows-x64',
  'linux-x64',
  'macos-x64',
  'macos-aarch64'
];

/** @param {string} name */
export function distributableForName(name) {
  return distributableArtifacts.find((entry) => entry.matches(name)) ?? null;
}

/** @param {string} name */
export function updaterPayloadForName(name) {
  return updaterPayloads.find((entry) => entry.matches(name)) ?? null;
}

/**
 * @param {string[]} paths
 * @param {(name: string) => boolean} matches
 * @param {string} label
 */
export function exactlyOneMatchingPath(paths, matches, label) {
  const found = paths.filter((path) => matches(basename(path)));
  if (found.length !== 1) {
    throw new Error(`expected exactly one ${label}; found ${found.length}`);
  }
  return found[0];
}
