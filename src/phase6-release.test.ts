import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  parseChecksumManifest,
  validatePublicationContract
} from '../scripts/release-publication.mjs';
import {
  validateRoundTripPlan,
  validateUpdatePublicationContract
} from '../scripts/release-update-publication.mjs';
import { validateReleaseAssetMetadata } from '../scripts/verify-release-asset-metadata.mjs';
import {
  distributableArtifacts,
  updaterPlatformBindings,
  updaterPayloads
} from '../scripts/release-platform-contract.mjs';
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

  it('publishes only by manual confirmation after exact GitHub digest checks', () => {
    const workflow = read('.github/workflows/release.yml');
    const notes = read('docs/release/0.1.1-notes.md');
    const triage = read('docs/release/failure-triage.md');

    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('permissions: {}');
    expect(workflow).toContain('actions: read');
    expect(workflow).toContain('contents: write');
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).toContain('candidate_run_id');
    expect(workflow).toContain('actions/workflows/release-candidate.yml/runs');
    expect(workflow).toContain('run-id: ${{ steps.candidate.outputs.run_id }}');
    expect(workflow).toContain('publish-v<package-version>');
    expect(workflow).toContain(
      'PUBLISH_CONFIRMATION: ${{ inputs.confirmation }}'
    );
    expect(workflow).not.toContain('--confirm "${{ inputs.confirmation }}"');
    expect(workflow).toContain('release:prepare-update-publication');
    expect(workflow.match(/QUERYNOT_UPDATER_PUBLIC_KEY:/g)).toHaveLength(1);
    expect(read('scripts/release-update-publication.mjs')).toContain(
      'verifyUpdaterSignature'
    );
    expect(workflow).toContain('gh release create "$RELEASE_TAG"');
    expect(workflow).toContain('if gh release view "$RELEASE_TAG"');
    expect(workflow).toContain('--draft');
    expect(workflow).toContain('--target "$RELEASE_SOURCE"');
    expect(workflow).toContain(
      'gh release view "$RELEASE_TAG" --json isDraft --jq .isDraft'
    );
    expect(workflow).toContain(
      'gh release view "$RELEASE_TAG" --json targetCommitish --jq .targetCommitish'
    );
    expect(workflow).toContain(
      'gh release view "$RELEASE_TAG" --json databaseId --jq .databaseId'
    );
    expect(workflow).toContain(
      'releases/${release_id}" > artifacts/release-draft.json'
    );
    expect(workflow).not.toContain(
      'releases/tags/${RELEASE_TAG}" > artifacts/release-draft.json'
    );
    expect(workflow).not.toContain('gh release download "$RELEASE_TAG"');
    expect(workflow).toContain('release:verify-asset-metadata');
    expect(workflow).toContain('--plan artifacts/publication-plan.json');
    expect(workflow).toContain('--draft true');
    expect(workflow).toContain('--draft false');
    expect(workflow).toContain('releases/latest/download/latest.json');
    expect(read('scripts/verify-release-asset-metadata.mjs')).toContain(
      'github_release_asset_sha256_digests'
    );
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

  it('accepts only the exact signed cross-platform updater assets and feed keys', () => {
    const names = {
      'windows-nsis-x64': 'QueryNot_0.1.9_x64-setup.exe',
      'windows-msi-x64': 'QueryNot_0.1.9_x64_en-US.msi',
      'linux-appimage-x64': 'QueryNot_0.1.9_amd64.AppImage',
      'linux-deb-x64': 'QueryNot_0.1.9_amd64.deb',
      'linux-rpm-x64': 'QueryNot-0.1.9-1.x86_64.rpm',
      'macos-dmg-x64': 'QueryNot_0.1.9_x64.dmg',
      'macos-dmg-aarch64': 'QueryNot_0.1.9_aarch64.dmg',
      'macos-updater-x64': 'QueryNot_x64.app.tar.gz',
      'macos-updater-aarch64': 'QueryNot_aarch64.app.tar.gz'
    } as const;
    const artifacts = distributableArtifacts.map(({ id }, index) => ({
      id,
      name: names[id as keyof typeof names],
      bytes: 100 + index,
      sha256: String(index + 1).repeat(64),
      path: `/synthetic/${names[id as keyof typeof names]}`,
      content: Buffer.from(`package-${id}`)
    }));
    const artifactById = new Map(
      artifacts.map((artifact) => [artifact.id, artifact])
    );
    const payloads = updaterPayloads.map(({ id }, index) => {
      const name = names[id as keyof typeof names];
      const sharedArtifact = artifactById.get(id);
      return {
        id,
        name,
        bytes: sharedArtifact?.bytes ?? 200 + index,
        sha256: sharedArtifact?.sha256 ?? String(index + 1).repeat(64),
        path: `/synthetic/${name}`,
        content: sharedArtifact?.content ?? Buffer.from(`payload-${id}`),
        signature: {
          name: `${name}.sig`,
          bytes: 80,
          sha256: 'a'.repeat(64),
          path: `/synthetic/${name}.sig`,
          content: Buffer.from('A'.repeat(80))
        }
      };
    });
    const payloadById = new Map(
      payloads.map((payload) => [payload.id, payload])
    );
    const latest = {
      version: '0.1.9',
      notes: 'Release notes',
      pub_date: '2026-08-14T00:00:00.000Z',
      platforms: Object.fromEntries(
        updaterPlatformBindings.map(({ key, payloadId }) => {
          const payload = payloadById.get(payloadId)!;
          return [
            key,
            {
              signature: 'A'.repeat(80),
              url: `https://github.com/not-projects/querynot/releases/download/v0.1.9/${payload.name}`
            }
          ];
        })
      )
    };
    const checksumText = `${artifacts
      .map(({ name, sha256 }) => `${sha256}  ${name}`)
      .join('\n')}\n`;

    const publicationPlan = validateUpdatePublicationContract({
      version: '0.1.9',
      requestedTag: 'v0.1.9',
      releaseNotes: 'Release notes',
      artifacts,
      payloads,
      latest,
      checksumText
    });
    expect(publicationPlan.status).toBe('pass');

    const latestText = `${JSON.stringify(latest, null, 2)}\n`;
    const publicRecords = [
      ...artifacts,
      ...payloads,
      ...payloads.map(({ signature }) => signature),
      {
        name: 'latest.json',
        bytes: Buffer.byteLength(latestText),
        sha256: 'b'.repeat(64)
      },
      {
        name: 'SHA256SUMS',
        bytes: Buffer.byteLength(checksumText),
        sha256: publicationPlan.checksum.sha256
      }
    ];
    const uniquePublicRecords = [
      ...new Map(publicRecords.map((record) => [record.name, record])).values()
    ];
    const sourceCommit = 'c'.repeat(40);
    const completePlan = {
      ...publicationPlan,
      source_commit: sourceCommit,
      staging_verification: 'pass',
      latest: {
        ...publicationPlan.latest,
        sha256: 'b'.repeat(64)
      }
    };
    expect(() =>
      validateRoundTripPlan(
        completePlan,
        { publicRecords: uniquePublicRecords } as never,
        '0.1.9',
        'v0.1.9',
        sourceCommit
      )
    ).not.toThrow();
    expect(() =>
      validateRoundTripPlan(
        completePlan,
        {
          publicRecords: uniquePublicRecords.map((record, index) =>
            index === 0 ? { ...record, sha256: 'f'.repeat(64) } : record
          )
        } as never,
        '0.1.9',
        'v0.1.9',
        sourceCommit
      )
    ).toThrow('do not byte-match');

    const draftMetadata = {
      tag_name: 'v0.1.9',
      target_commitish: sourceCommit,
      draft: true,
      prerelease: false,
      assets: uniquePublicRecords.map((record, index) => ({
        id: index + 1,
        name: record.name,
        state: 'uploaded',
        size: record.bytes,
        digest: `sha256:${record.sha256}`
      }))
    };
    expect(() =>
      validateReleaseAssetMetadata({
        plan: completePlan,
        release: draftMetadata,
        version: '0.1.9',
        requestedTag: 'v0.1.9',
        sourceCommit,
        expectedDraft: true
      })
    ).not.toThrow();
    expect(() =>
      validateReleaseAssetMetadata({
        plan: completePlan,
        release: {
          ...draftMetadata,
          assets: draftMetadata.assets.map((asset, index) =>
            index === 0 ? { ...asset, digest: null } : asset
          )
        },
        version: '0.1.9',
        requestedTag: 'v0.1.9',
        sourceCommit,
        expectedDraft: true
      })
    ).toThrow('size or SHA-256 digest');
    expect(() =>
      validateReleaseAssetMetadata({
        plan: completePlan,
        release: { ...draftMetadata, draft: false },
        version: '0.1.9',
        requestedTag: 'v0.1.9',
        sourceCommit,
        expectedDraft: true
      })
    ).toThrow('expected tag, source, or state');

    expect(() =>
      validateUpdatePublicationContract({
        version: '0.1.9',
        requestedTag: 'v0.1.9',
        releaseNotes: 'Release\nnotes',
        artifacts,
        payloads,
        latest: { ...latest, notes: 'Release\r\nnotes' },
        checksumText
      })
    ).toThrow('canonical LF text');

    latest.platforms['linux-x86_64'].signature = 'B'.repeat(80);
    expect(() =>
      validateUpdatePublicationContract({
        version: '0.1.9',
        requestedTag: 'v0.1.9',
        releaseNotes: 'Release notes',
        artifacts,
        payloads,
        latest,
        checksumText
      })
    ).toThrow('signature does not match');
  });
});
