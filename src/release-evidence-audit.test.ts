import { createHash } from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

const root = resolve('.');

function write(path: string, value: unknown) {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(
    path,
    typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`
  );
}

function git(directory: string, ...args: string[]) {
  const result = spawnSync('git', args, {
    cwd: directory,
    encoding: 'utf8'
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

function commit(directory: string, message: string) {
  git(directory, 'add', '.');
  git(directory, 'commit', '-m', message);
}

function createSyntheticEvidence() {
  mkdirSync(resolve(root, '.tmp'), { recursive: true });
  const directory = mkdtempSync(resolve(root, '.tmp', 'release-audit-'));
  mkdirSync(resolve(directory, 'scripts'), { recursive: true });
  copyFileSync(
    resolve(root, 'scripts/audit-release-evidence.mjs'),
    resolve(directory, 'scripts/audit-release-evidence.mjs')
  );
  copyFileSync(
    resolve(root, 'scripts/release-evidence-contract.mjs'),
    resolve(directory, 'scripts/release-evidence-contract.mjs')
  );
  write(resolve(directory, 'package.json'), {
    name: 'querynot-synthetic',
    version: '0.1.0',
    type: 'module'
  });
  write(
    resolve(directory, 'docs/compatibility-matrix.md'),
    'Windows 11 25H2 | Sole supported and published 0.1.0 row\nOther platforms | Deferred; no `0.1.0` support or artifact claim\n'
  );
  git(directory, 'init');
  git(directory, 'config', 'user.name', 'QueryNot Test');
  git(directory, 'config', 'user.email', 'querynot@example.invalid');
  commit(directory, 'source');
  const sourceCommit = git(directory, 'rev-parse', 'HEAD');
  const sha256 = createHash('sha256').update('synthetic-nsis').digest('hex');
  const artifact = {
    id: 'windows-nsis-x64',
    format: 'nsis',
    name: 'QueryNot_0.1.0_x64-setup.exe',
    bytes: 14,
    sha256,
    unsigned: true,
    evidence_link: 'evidence/phase-5/windows-artifact-inspection.json'
  };
  const sourceRecord = { schema_version: 1, source_commit: sourceCommit };

  write(resolve(directory, 'evidence/phase-5/local-validation-report.json'), {
    ...sourceRecord,
    phase: 5,
    status: 'pass_local_automation',
    checks: [{ id: 'P5-SYNTHETIC', status: 'pass' }]
  });
  write(resolve(directory, 'evidence/phase-5/dependency-review.json'), {
    ...sourceRecord,
    status: 'pass',
    npm: { audit_vulnerabilities: { high: 0, critical: 0 } },
    rust: {
      new_advisories: 0,
      cargo_deny_version: 'cargo-deny 0.20.2'
    }
  });
  const tableEditing = {
    deterministic_keyset_paging: true,
    bound_structured_filters: true,
    typed_validation: true,
    insert_update_delete: true,
    generated_value_refresh: true,
    optimistic_conflict_atomic_rollback: true
  };
  write(
    resolve(directory, 'evidence/phase-5/adapter-conformance-report.json'),
    {
      schema_version: 1,
      status: 'pass',
      tested_source: sourceCommit,
      network_results: [
        'mysql-5.7.44',
        'mysql-8.0.46',
        'mysql-8.4.10',
        'mariadb-10.11.18',
        'mariadb-11.4.12'
      ].map((id) => ({
        id,
        marker_verified: true,
        adapter: {
          supported_capability_profile: true,
          table_editing: tableEditing
        }
      }))
    }
  );
  const layouts = [2048, 1280, 960, 720].map((viewport_width) => ({
    viewport_width,
    document_scroll_width: viewport_width,
    workbench_bottom: 1039,
    footer_top: 1039,
    footer_bottom: 1068,
    footer_height: 29
  }));
  write(resolve(directory, 'evidence/phase-5/ui-layout-report.json'), {
    ...sourceRecord,
    status: 'pass',
    layouts,
    theme_labels: ['System', 'Light', 'Dark', 'Forest'],
    dialog_themes: ['system', 'light', 'dark', 'forest'].map((theme) => ({
      theme,
      inside_theme_context: true,
      background_color: 'rgb(255, 250, 240)'
    }))
  });
  write(
    resolve(directory, 'evidence/phase-5/windows-artifact-inspection.json'),
    {
      ...sourceRecord,
      application_version: '0.1.0',
      status: 'pass',
      environment: { os: 'win32', architecture: 'x64' },
      artifacts: [{ ...artifact }],
      updater_artifacts: false,
      capability_and_csp_review: 'pass'
    }
  );
  write(resolve(directory, 'evidence/phase-5/windows-checksums.json'), {
    ...sourceRecord,
    application_version: '0.1.0',
    algorithm: 'sha256',
    artifacts: [
      {
        name: artifact.name,
        bytes: artifact.bytes,
        sha256: artifact.sha256
      }
    ]
  });
  write(
    resolve(directory, 'evidence/phase-5/SHA256SUMS'),
    `${artifact.sha256}  ${artifact.name}\n`
  );
  write(resolve(directory, 'evidence/phase-5/packaging-results.json'), {
    ...sourceRecord,
    status: 'pass',
    updater_artifacts: false,
    checksum_verification: 'pass',
    checksum_manifest: 'evidence/phase-5/SHA256SUMS',
    artifacts: [artifact]
  });
  const postRelease = {
    native_windows_owner_journey: 'unperformed',
    manual_safety_accessibility_performance: 'unperformed',
    fixed_five_day_dogfood: 'unperformed',
    external_beta: 'deferred_single_participant'
  };
  write(resolve(directory, 'evidence/phase-5/product-owner-scope.json'), {
    ...sourceRecord,
    status: 'approved_revision',
    decision:
      'docs/architecture/0010-windows-first-release-validation-boundary.md',
    release_platforms: ['windows-11-x64'],
    initial_participants: 1,
    post_release_validation: postRelease,
    attestation: 'Unperformed checks are not represented as pass.'
  });
  const records = [
    ...Array.from({ length: 101 }, (_, index) => ({
      id: `REQ-${index + 1}`,
      kind: 'requirement'
    })),
    ...Array.from({ length: 20 }, (_, index) => ({
      id: `AC-${String(index + 1).padStart(2, '0')}`,
      kind: 'acceptance_criterion'
    }))
  ].map((record) => ({
    ...record,
    priority: 'must',
    status: 'verified',
    automated_test_ids: ['P5-AUTO-SYNTHETIC'],
    manual_procedure_ids: ['POST-RELEASE-OWNER-JOURNEY:SYNTHETIC'],
    evidence_links: [
      'evidence/phase-5/local-validation-report.json',
      'evidence/phase-5/product-owner-scope.json'
    ]
  }));
  write(resolve(directory, 'traceability/requirements.json'), {
    schema_version: 1,
    records
  });
  write(resolve(directory, 'evidence/release/manifest.json'), {
    schema_version: 1,
    release_status: 'ready_to_publish',
    source_commit: sourceCommit,
    application_version: '0.1.0',
    release_tag: 'v0.1.0',
    release_platforms: ['windows-11-x64'],
    reviewed_artifacts: [
      {
        id: artifact.id,
        name: artifact.name,
        bytes: artifact.bytes,
        sha256: artifact.sha256
      }
    ],
    checksums: ['evidence/phase-5/SHA256SUMS'],
    product_owner_scope: 'evidence/phase-5/product-owner-scope.json',
    approved_exceptions: []
  });
  commit(directory, 'evidence');
  return { directory, sourceCommit };
}

function audit(directory: string) {
  return spawnSync('node', ['scripts/audit-release-evidence.mjs'], {
    cwd: directory,
    encoding: 'utf8'
  });
}

describe('release evidence audit', () => {
  it('accepts the exact Windows-first contract with explicit post-release non-claims', () => {
    const fixture = createSyntheticEvidence();
    const result = audit(fixture.directory);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      '101 requirements, 20 acceptance criteria, 1 supported platform, and 1 reviewed artifact'
    );
  });

  it('rejects a fabricated passed owner journey', () => {
    const fixture = createSyntheticEvidence();
    const path = resolve(
      fixture.directory,
      'evidence/phase-5/product-owner-scope.json'
    );
    const scope = JSON.parse(readFileSync(path, 'utf8'));
    scope.post_release_validation.native_windows_owner_journey = 'pass';
    write(path, scope);
    commit(fixture.directory, 'fabricated pass');
    const result = audit(fixture.directory);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'product owner scope does not preserve the approved post-release non-claims'
    );
  });

  it('rejects extra artifacts and checksum substitution', () => {
    const fixture = createSyntheticEvidence();
    const packagingPath = resolve(
      fixture.directory,
      'evidence/phase-5/packaging-results.json'
    );
    const packaging = JSON.parse(readFileSync(packagingPath, 'utf8'));
    packaging.artifacts.push({
      ...packaging.artifacts[0],
      id: 'unreviewed-artifact',
      name: 'unreviewed.exe'
    });
    write(packagingPath, packaging);
    write(
      resolve(fixture.directory, 'evidence/phase-5/SHA256SUMS'),
      `${'f'.repeat(64)}  ${packaging.artifacts[0].name}\n`
    );
    commit(fixture.directory, 'tampered artifact evidence');
    const result = audit(fixture.directory);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unsupported artifact');
    expect(result.stderr).toContain('checksums do not match inspection');
  });
});
