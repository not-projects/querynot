import { createHash, generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { buildUpdaterManifest } from '../scripts/create-updater-manifest.mjs';
import {
  expectedPlatformKeys,
  updaterPayloads
} from '../scripts/release-platform-contract.mjs';
import {
  QUERYNOT_UPDATE_ENDPOINT,
  updaterBuildConfig
} from '../scripts/updater-build-config.mjs';
import { validateUpdaterSigningEnvironment } from '../scripts/updater-signing-environment.mjs';
import { verifyUpdaterSignature } from '../scripts/verify-updater-signature.mjs';

function publicKeyDocument(): string {
  return Buffer.from(
    `untrusted comment: minisign public key: 0123456789ABCDEF\nRW${'A'.repeat(50)}\n`
  ).toString('base64');
}

function signedUpdaterFixture(keyId = Buffer.from('0123456789abcdef', 'hex')) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicDer = publicKey.export({ type: 'spki', format: 'der' });
  const installer = Buffer.from('synthetic updater installer');
  const installerSignature = sign(
    null,
    createHash('blake2b512').update(installer).digest(),
    privateKey
  );
  const trustedComment = 'timestamp:1\tfile:QueryNot_0.1.1_x64-setup.exe';
  const globalSignature = sign(
    null,
    Buffer.concat([installerSignature, Buffer.from(trustedComment, 'utf8')]),
    privateKey
  );
  const publicPacket = Buffer.concat([
    Buffer.from('Ed'),
    keyId,
    publicDer.subarray(-32)
  ]);
  const signaturePacket = Buffer.concat([
    Buffer.from('ED'),
    keyId,
    installerSignature
  ]);
  const publicDocument = [
    `untrusted comment: minisign public key: ${Buffer.from(keyId).reverse().toString('hex').toUpperCase()}`,
    publicPacket.toString('base64')
  ].join('\n');
  const signatureDocument = [
    'untrusted comment: synthetic updater signature',
    signaturePacket.toString('base64'),
    `trusted comment: ${trustedComment}`,
    globalSignature.toString('base64')
  ].join('\n');
  return {
    installer,
    publicKey: Buffer.from(`${publicDocument}\n`).toString('base64'),
    signature: Buffer.from(`${signatureDocument}\n`).toString('base64')
  };
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

  it('creates the complete PostNot-aligned desktop feed from signed payloads', () => {
    const names = {
      'windows-nsis-x64': 'QueryNot_0.1.11_x64-setup.exe',
      'windows-msi-x64': 'QueryNot_0.1.11_x64_en-US.msi',
      'linux-appimage-x64': 'QueryNot_0.1.11_amd64.AppImage',
      'linux-deb-x64': 'QueryNot_0.1.11_amd64.deb',
      'linux-rpm-x64': 'QueryNot-0.1.11-1.x86_64.rpm',
      'macos-updater-x64': 'QueryNot_x64.app.tar.gz',
      'macos-updater-aarch64': 'QueryNot_aarch64.app.tar.gz'
    } as const;
    const manifest = buildUpdaterManifest({
      version: '0.1.11',
      releaseNotes: 'Release\r\nnotes\r\n',
      publishedAt: '2026-08-14T00:00:00Z',
      payloads: Object.fromEntries(
        updaterPayloads.map(({ id }) => [
          id,
          {
            name: names[id as keyof typeof names],
            signature: 'A'.repeat(80)
          }
        ])
      )
    });

    expect(Object.keys(manifest.platforms).sort()).toEqual(
      expectedPlatformKeys
    );
    expect(manifest.platforms['windows-x86_64'].url).toContain(
      '/not-projects/querynot/releases/download/v0.1.11/'
    );
    expect(manifest.platforms['darwin-aarch64'].signature).toBe('A'.repeat(80));
    expect(manifest.notes).toBe('Release\nnotes');
    expect(manifest.notes).not.toContain('\r');
  });

  it('cryptographically verifies the updater payload and trusted comment', () => {
    const fixture = signedUpdaterFixture();
    expect(verifyUpdaterSignature(fixture)).toEqual({
      status: 'pass',
      format: 'minisign',
      algorithm: 'Ed25519-BLAKE2b',
      public_key_id: 'EFCDAB8967452301'
    });

    const changedInstaller = Buffer.from(fixture.installer);
    changedInstaller[0] ^= 1;
    expect(() =>
      verifyUpdaterSignature({ ...fixture, installer: changedInstaller })
    ).toThrow('payload signature does not verify');

    const otherKey = signedUpdaterFixture(
      Buffer.from('fedcba9876543210', 'hex')
    );
    expect(() =>
      verifyUpdaterSignature({ ...fixture, publicKey: otherKey.publicKey })
    ).toThrow('key ID does not match');
  });
});
