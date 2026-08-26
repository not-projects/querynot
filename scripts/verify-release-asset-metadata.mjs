import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync
} from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';

import { publicationPlanRecords } from './release-update-publication.mjs';

const root = resolve(import.meta.dirname, '..');

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * Verify the exact draft or public release inventory using the SHA-256 digests
 * GitHub computes while accepting each uploaded asset.
 *
 * @param {{
 *   plan: any,
 *   release: any,
 *   version: string,
 *   requestedTag: string,
 *   sourceCommit: string,
 *   expectedDraft: boolean
 * }} input
 */
export function validateReleaseAssetMetadata({
  plan,
  release,
  version,
  requestedTag,
  sourceCommit,
  expectedDraft
}) {
  const plannedByName = publicationPlanRecords(
    plan,
    version,
    requestedTag,
    sourceCommit
  );
  requireCondition(
    release?.tag_name === requestedTag &&
      release?.target_commitish === sourceCommit &&
      release?.draft === expectedDraft &&
      release?.prerelease === false,
    'GitHub release metadata does not identify the expected tag, source, or state'
  );
  requireCondition(
    Array.isArray(release?.assets) &&
      release.assets.length === plannedByName.size,
    'GitHub release asset count does not match the publication plan'
  );

  const seen = new Set();
  /** @type {Array<{name: string, bytes: number, sha256: string, state: string}>} */
  const verifiedAssets = release.assets.map(
    /** @param {any} asset */ (asset) => {
      const planned = plannedByName.get(asset?.name);
      requireCondition(
        planned && !seen.has(asset.name),
        `GitHub release contains an unexpected or duplicate asset: ${String(asset?.name)}`
      );
      seen.add(asset.name);
      requireCondition(
        asset?.state === 'uploaded' &&
          asset?.size === planned.bytes &&
          asset?.digest === `sha256:${planned.sha256}`,
        `${asset.name} GitHub size or SHA-256 digest does not match the publication plan`
      );
      return {
        name: asset.name,
        bytes: asset.size,
        sha256: planned.sha256,
        state: asset.state
      };
    }
  );
  requireCondition(
    seen.size === plannedByName.size,
    'GitHub release is missing a planned public asset'
  );

  return {
    schema_version: 1,
    status: 'pass',
    verification: 'github_release_asset_sha256_digests',
    application_version: version,
    release_tag: requestedTag,
    source_commit: sourceCommit,
    release_state: expectedDraft ? 'draft' : 'public',
    assets: verifiedAssets.sort((left, right) =>
      left.name.localeCompare(right.name)
    )
  };
}

/** @param {string} path @param {string} label */
function artifactPath(path, label) {
  const resolved = resolve(root, path);
  const artifactsRoot = resolve(root, 'artifacts');
  requireCondition(
    resolved.startsWith(`${artifactsRoot}${sep}`),
    `${label} must stay under artifacts/`
  );
  return resolved;
}

/** @param {string} path @param {string} label */
function readArtifactJson(path, label) {
  const resolved = artifactPath(path, label);
  requireCondition(
    existsSync(resolved) &&
      lstatSync(resolved).isFile() &&
      realpathSync(resolved) === resolved,
    `${label} must be a real file under artifacts/`
  );
  try {
    return JSON.parse(readFileSync(resolved, 'utf8'));
  } catch {
    throw new Error(`${label} is invalid JSON`);
  }
}

function main() {
  const { values } = parseArgs({
    options: {
      release: { type: 'string' },
      plan: { type: 'string' },
      version: { type: 'string' },
      tag: { type: 'string' },
      source: { type: 'string' },
      draft: { type: 'string' },
      report: { type: 'string' }
    },
    strict: true
  });
  requireCondition(
    values.release &&
      values.plan &&
      values.version &&
      values.tag &&
      values.source &&
      values.report &&
      (values.draft === 'true' || values.draft === 'false'),
    'usage: node scripts/verify-release-asset-metadata.mjs --release <release.json> --plan <publication-plan.json> --version <version> --tag <tag> --source <commit> --draft <true|false> --report <report.json>'
  );
  requireCondition(
    /^[a-f0-9]{40}$/.test(values.source),
    'release source must be a full lowercase commit SHA'
  );
  const report = validateReleaseAssetMetadata({
    plan: readArtifactJson(values.plan, 'publication plan'),
    release: readArtifactJson(values.release, 'GitHub release metadata'),
    version: values.version,
    requestedTag: values.tag,
    sourceCommit: values.source,
    expectedDraft: values.draft === 'true'
  });
  const reportPath = artifactPath(values.report, 'metadata report');
  mkdirSync(dirname(reportPath), { recursive: true, mode: 0o755 });
  requireCondition(
    !existsSync(reportPath) || !lstatSync(reportPath).isSymbolicLink(),
    'metadata report must not be a symbolic link'
  );
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o644
  });
  process.stdout.write(
    `verified ${report.assets.length} ${report.release_state} GitHub asset digests for ${values.tag}\n`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  main();
}
