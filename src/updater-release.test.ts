import { describe, expect, it } from 'vitest';

import { buildUpdaterManifest } from '../scripts/create-updater-manifest.mjs';
import {
  QUERYNOT_UPDATE_ENDPOINT,
  updaterBuildConfig
} from '../scripts/updater-build-config.mjs';
import { validateUpdaterSigningEnvironment } from '../scripts/updater-signing-environment.mjs';

function publicKeyDocument(): string {
  return Buffer.from(
    `untrusted comment: minisign public key: 0123456789ABCDEF\nRW${'A'.repeat(50)}\n`
  ).toString('base64');
}

describe('updater release trust boundary', () => {
  it('accepts a structurally valid dedicated key environment without returning key material', () => {
    expect(
      validateUpdaterSigningEnvironment({
        QUERYNOT_UPDATER_PUBLIC_KEY: publicKeyDocument(),
        TAURI_SIGNING_PRIVATE_KEY: 'private-key-material'.repeat(3),
        TAURI_SIGNING_PRIVATE_KEY_PASSWORD: 'protected'
      })
    ).toEqual({
      public_key_configured: true,
      private_key_configured: true,
      private_key_password_configured: true
    });
  });

  it('fails closed without either half of the signing identity', () => {
    expect(() =>
      validateUpdaterSigningEnvironment({
        TAURI_SIGNING_PRIVATE_KEY: 'private-key-material'.repeat(3)
      })
    ).toThrow('QUERYNOT_UPDATER_PUBLIC_KEY');
    expect(() =>
      validateUpdaterSigningEnvironment({
        QUERYNOT_UPDATER_PUBLIC_KEY: publicKeyDocument()
      })
    ).toThrow('TAURI_SIGNING_PRIVATE_KEY');
  });

  it('injects the validated public key into the required Tauri updater configuration', () => {
    const publicKey = publicKeyDocument();
    expect(JSON.parse(updaterBuildConfig(publicKey))).toEqual({
      plugins: {
        updater: {
          endpoints: [QUERYNOT_UPDATE_ENDPOINT],
          pubkey: publicKey
        }
      }
    });
    expect(() => updaterBuildConfig(undefined)).toThrow(
      'QUERYNOT_UPDATER_PUBLIC_KEY'
    );
  });

  it('creates only the two supported Windows feed keys from one signed installer', () => {
    const manifest = buildUpdaterManifest({
      version: '0.1.1',
      releaseNotes: 'Release notes',
      publishedAt: '2026-08-14T00:00:00Z',
      installerName: 'QueryNot_0.1.1_x64-setup.exe',
      signature: 'A'.repeat(80)
    });

    expect(Object.keys(manifest.platforms).sort()).toEqual([
      'windows-x86_64',
      'windows-x86_64-nsis'
    ]);
    expect(manifest.platforms['windows-x86_64'].url).toContain(
      '/not-projects/querynot/releases/download/v0.1.1/'
    );
    expect(manifest.platforms['windows-x86_64-nsis'].signature).toBe(
      'A'.repeat(80)
    );
  });
});
