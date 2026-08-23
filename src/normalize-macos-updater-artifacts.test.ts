import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { normalizeMacosUpdaterArtifacts } from '../scripts/normalize-macos-updater-artifacts.mjs';

const temporaryDirectories: string[] = [];

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'querynot-macos-updater-'));
  temporaryDirectories.push(directory);
  writeFileSync(join(directory, 'QueryNot.app.tar.gz'), 'payload');
  writeFileSync(join(directory, 'QueryNot.app.tar.gz.sig'), 'signature');
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('macOS updater artifact normalization', () => {
  it.each([
    ['x64', 'QueryNot_x64.app.tar.gz'],
    ['arm64', 'QueryNot_aarch64.app.tar.gz']
  ])('retains the architecture in %s updater names', (arch, payloadName) => {
    const directory = fixture();

    expect(normalizeMacosUpdaterArtifacts(directory, arch)).toEqual({
      payloadName,
      signatureName: `${payloadName}.sig`
    });
    expect(readdirSync(directory).sort()).toEqual(
      [payloadName, `${payloadName}.sig`].sort()
    );
  });

  it('fails closed when the updater signature is absent', () => {
    const directory = mkdtempSync(join(tmpdir(), 'querynot-macos-updater-'));
    temporaryDirectories.push(directory);
    writeFileSync(join(directory, 'QueryNot.app.tar.gz'), 'payload');

    expect(() => normalizeMacosUpdaterArtifacts(directory, 'arm64')).toThrow(
      'macOS updater archive signature is missing or invalid'
    );
  });
});
