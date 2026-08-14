import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  parseChecksumManifest,
  validatePublicationContract
} from '../scripts/release-publication.mjs';

const read = (path: string) => readFileSync(path, 'utf8');
const sha = (digit: string) => digit.repeat(64);

const artifactRows = [
  ['windows-nsis-x64', 'nsis', 'QueryNot_0.1.0_x64-setup.exe', 101, sha('1')],
  ['macos-dmg-intel', 'dmg', 'QueryNot_0.1.0_x64.dmg', 102, sha('2')],
  ['macos-dmg-apple', 'dmg', 'QueryNot_0.1.0_aarch64.dmg', 103, sha('3')],
  [
    'linux-appimage-x64',
    'appimage',
    'QueryNot_0.1.0_amd64.AppImage',
    104,
    sha('4')
  ],
  ['linux-deb-x64', 'deb', 'QueryNot_0.1.0_amd64.deb', 105, sha('5')]
] as const;

function contract() {
  const artifacts = artifactRows.map(([id, format, name, bytes, sha256]) => ({
    id,
    format,
    name,
    bytes,
    sha256,
    unsigned: true,
    evidence_link: `evidence/phase-5/${id}.json`
  }));
  return {
    releaseManifest: {
      schema_version: 1,
      release_status: 'ready_to_publish',
      source_commit: 'a'.repeat(40),
      application_version: '0.1.0',
      release_tag: 'v0.1.0',
      reviewed_artifacts: artifacts.map(({ id, name, bytes, sha256 }) => ({
        id,
        name,
        bytes,
        sha256
      })),
      checksums: ['evidence/phase-5/SHA256SUMS']
    },
    packaging: {
      schema_version: 1,
      source_commit: 'a'.repeat(40),
      status: 'pass',
      updater_artifacts: false,
      checksum_verification: 'pass',
      checksum_manifest: 'evidence/phase-5/SHA256SUMS',
      artifacts
    },
    packageVersion: '0.1.0',
    requestedTag: 'v0.1.0',
    artifacts: artifacts.map(({ name, bytes, sha256 }) => ({
      name,
      bytes,
      sha256,
      path: `/synthetic/${name}`
    })) as Array<{ name: string; bytes: number; sha256: string; path: string }>,
    checksumText: `${artifacts.map(({ name, sha256 }) => `${sha256}  ${name}`).join('\n')}\n`
  };
}

describe('Phase 6 publication boundary', () => {
  it('accepts exactly the five reviewed artifacts and retained checksums', () => {
    const result = validatePublicationContract(contract());

    expect(result.status).toBe('pass');
    expect(result.release_tag).toBe('v0.1.0');
    expect(result.artifacts).toHaveLength(5);
    expect(parseChecksumManifest(contract().checksumText).size).toBe(5);
  });

  it('rejects substituted bytes, extra packages, and checksum path traversal', () => {
    const substituted = contract();
    substituted.artifacts[0].sha256 = sha('f');
    expect(() => validatePublicationContract(substituted)).toThrow(
      'publication input does not match'
    );

    const extra = contract();
    extra.artifacts.push({
      name: 'unreviewed.exe',
      bytes: 1,
      sha256: sha('9'),
      path: '/synthetic/unreviewed.exe'
    });
    expect(() => validatePublicationContract(extra)).toThrow(
      'exactly five artifacts'
    );

    expect(() =>
      parseChecksumManifest(`${sha('1')}  ../QueryNot.exe\n`)
    ).toThrow('invalid line');
  });

  it('publishes only by manual confirmation after a round-trip draft check', () => {
    const workflow = read('.github/workflows/release.yml');
    const notes = read('docs/release/initial-release-notes.md');
    const triage = read('docs/release/failure-triage.md');

    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('permissions: {}');
    expect(workflow).toContain('actions: read');
    expect(workflow).toContain('contents: write');
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).toContain('candidate_run_id');
    expect(workflow).toContain('publish-v0.1.0');
    expect(workflow).toContain(
      'PUBLISH_CONFIRMATION: ${{ inputs.confirmation }}'
    );
    expect(workflow).not.toContain('--confirm "${{ inputs.confirmation }}"');
    expect(workflow).toContain('release:prepare-publication');
    expect(workflow).toContain('gh release create v0.1.0');
    expect(workflow).toContain('--draft');
    expect(workflow).toContain('evidence_commit="$(git rev-parse HEAD)"');
    expect(workflow).toContain('--target "$evidence_commit"');
    expect(workflow).toContain('gh release download v0.1.0');
    expect(workflow).toContain('release:verify-publication');
    expect(workflow).toContain('gh release edit v0.1.0 --draft=false');
    expect(workflow).not.toContain('npm run build');
    expect(workflow).not.toContain('npm run package:');
    expect(workflow).not.toContain('npm ci');
    expect(workflow).not.toContain('--clobber');
    expect(notes).toContain('unsupported roadmap');
    expect(notes).toContain('SHA256SUMS');
    expect(notes).toContain('has no self-updater');
    expect(triage.indexOf('Data safety and security')).toBeLessThan(
      triage.indexOf('Reliability')
    );
    expect(triage.indexOf('Reliability')).toBeLessThan(
      triage.indexOf('Workflow friction')
    );
  });
});
