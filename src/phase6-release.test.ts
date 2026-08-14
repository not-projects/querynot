import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  parseChecksumManifest,
  validatePublicationContract
} from '../scripts/release-publication.mjs';
import { validateUpdatePublicationContract } from '../scripts/release-update-publication.mjs';
import {
  disallowedReleaseChanges,
  porcelainPaths,
  releaseChangeSummary
} from '../scripts/release-source-state.mjs';

const read = (path: string) => readFileSync(path, 'utf8');
const sha = (digit: string) => digit.repeat(64);

const artifactRows = [
  ['windows-nsis-x64', 'nsis', 'QueryNot_0.1.0_x64-setup.exe', 101, sha('1')]
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
  it('accepts exactly the reviewed Windows artifact and retained checksum', () => {
    const result = validatePublicationContract(contract());

    expect(result.status).toBe('pass');
    expect(result.release_tag).toBe('v0.1.0');
    expect(result.artifacts).toHaveLength(1);
    expect(parseChecksumManifest(contract().checksumText).size).toBe(1);
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
      'exactly 1 artifact'
    );

    expect(() =>
      parseChecksumManifest(`${sha('1')}  ../QueryNot.exe\n`)
    ).toThrow('invalid line');
  });

  it('preserves the leading porcelain status column for the first evidence path', () => {
    expect(
      porcelainPaths(
        ' M evidence/phase-5/adapter-conformance-report.json\n?? evidence/phase-5/new.json\n'
      )
    ).toEqual([
      'evidence/phase-5/adapter-conformance-report.json',
      'evidence/phase-5/new.json'
    ]);
  });

  it('normalizes Windows porcelain paths and distinguishes source from generated output', () => {
    const status =
      ' M evidence\\phase-5\\local-validation-report.json\r\n' +
      '?? target\\release-candidate-windows\\querynot.exe\r\n' +
      ' M Cargo.lock\r\n';

    expect(disallowedReleaseChanges(status)).toEqual([
      'target/release-candidate-windows/querynot.exe',
      'Cargo.lock'
    ]);
    expect(
      disallowedReleaseChanges(status, { allowGeneratedOutputs: true })
    ).toEqual(['Cargo.lock']);
  });

  it('keeps dirty-source diagnostics bounded and free of control characters', () => {
    expect(releaseChangeSummary(['Cargo.lock', 'bad\tpath'])).toBe(
      'Cargo.lock, [path contains unsupported characters]'
    );
  });

  it('publishes only by manual confirmation after a round-trip draft check', () => {
    const workflow = read('.github/workflows/release.yml');
    const notes = read('docs/release/0.1.1-notes.md');
    const triage = read('docs/release/failure-triage.md');

    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('permissions: {}');
    expect(workflow).toContain('actions: read');
    expect(workflow).toContain('contents: write');
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).toContain('candidate_run_id');
    expect(workflow).toContain('publish-v<package-version>');
    expect(workflow).toContain(
      'PUBLISH_CONFIRMATION: ${{ inputs.confirmation }}'
    );
    expect(workflow).not.toContain('--confirm "${{ inputs.confirmation }}"');
    expect(workflow).toContain('release:prepare-update-publication');
    expect(workflow).toContain('gh release create "$RELEASE_TAG"');
    expect(workflow).toContain('--draft');
    expect(workflow).toContain('--target "$RELEASE_SOURCE"');
    expect(workflow).toContain(
      'gh release view "$RELEASE_TAG" --json isDraft --jq .isDraft'
    );
    expect(workflow).toContain(
      'gh release view "$RELEASE_TAG" --json targetCommitish --jq .targetCommitish'
    );
    expect(workflow).toContain('gh release download "$RELEASE_TAG"');
    expect(workflow).toContain('release:verify-update-publication');
    expect(workflow).toContain(
      'gh release edit "$RELEASE_TAG" --draft=false --latest'
    );
    expect(workflow).not.toContain('npm run build');
    expect(workflow).not.toContain('npm run package:');
    expect(workflow).toContain('npm ci');
    expect(workflow).not.toContain('--clobber');
    expect(notes).toContain('In-application signed updates');
    expect(notes).toContain('SHA256SUMS');
    expect(notes).toContain('must be upgraded to `0.1.1` manually');
    expect(triage.indexOf('Data safety and security')).toBeLessThan(
      triage.indexOf('Reliability')
    );
    expect(triage.indexOf('Reliability')).toBeLessThan(
      triage.indexOf('Workflow friction')
    );
  });

  it('accepts only the exact signed Windows updater assets and stable feed keys', () => {
    const installer = {
      name: 'QueryNot_0.1.1_x64-setup.exe',
      bytes: 101,
      sha256: sha('1'),
      path: '/synthetic/QueryNot_0.1.1_x64-setup.exe',
      content: Buffer.from('installer')
    };
    const signature = {
      name: `${installer.name}.sig`,
      bytes: 80,
      sha256: sha('2'),
      path: '/synthetic/QueryNot_0.1.1_x64-setup.exe.sig',
      content: Buffer.from('A'.repeat(80))
    };
    const url = `https://github.com/not-projects/querynot/releases/download/v0.1.1/${installer.name}`;
    const latest = {
      version: '0.1.1',
      notes: 'Release notes',
      pub_date: '2026-08-14T00:00:00.000Z',
      platforms: {
        'windows-x86_64': { signature: 'A'.repeat(80), url },
        'windows-x86_64-nsis': { signature: 'A'.repeat(80), url }
      }
    };

    expect(
      validateUpdatePublicationContract({
        version: '0.1.1',
        requestedTag: 'v0.1.1',
        releaseNotes: 'Release notes',
        installer,
        signature,
        latest,
        checksumText: `${installer.sha256}  ${installer.name}\n`
      }).status
    ).toBe('pass');

    expect(() =>
      validateUpdatePublicationContract({
        version: '0.1.1',
        requestedTag: 'v0.1.1',
        releaseNotes: 'Release\nnotes',
        installer,
        signature,
        latest: { ...latest, notes: 'Release\r\nnotes' },
        checksumText: `${installer.sha256}  ${installer.name}\n`
      })
    ).toThrow('canonical LF text');

    latest.platforms['windows-x86_64'].signature = 'B'.repeat(80);
    expect(() =>
      validateUpdatePublicationContract({
        version: '0.1.1',
        requestedTag: 'v0.1.1',
        releaseNotes: 'Release notes',
        installer,
        signature,
        latest,
        checksumText: `${installer.sha256}  ${installer.name}\n`
      })
    ).toThrow('signature does not match');
  });
});
