import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import {
  accessibilityChecks,
  aggregateSamples,
  coreJourneyChecks,
  expectedArtifacts,
  familyNetworkChecks,
  osArchitectures,
  osArtifacts,
  osFamilies,
  osMatrix,
  performanceMeasurements
} from '../scripts/release-evidence-contract.mjs';

const temporaryDirectories: string[] = [];

function directory(path: string) {
  mkdirSync(path, { recursive: true });
}

function text(path: string, contents: string) {
  directory(join(path, '..'));
  writeFileSync(path, contents, 'utf8');
}

function json(path: string, value: unknown) {
  text(path, `${JSON.stringify(value, null, 2)}\n`);
}

function git(root: string, ...args: string[]) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

const passChecks = (ids: string[]) =>
  Object.fromEntries(ids.map((id) => [id, 'pass']));

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe('complete Phase 5 evidence audit', () => {
  it('accepts one exact internally consistent synthetic contract fixture', () => {
    const root = mkdtempSync(join(tmpdir(), 'querynot-release-audit-'));
    temporaryDirectories.push(root);
    directory(join(root, 'scripts'));
    copyFileSync(
      'scripts/audit-release-evidence.mjs',
      join(root, 'scripts/audit-release-evidence.mjs')
    );
    copyFileSync(
      'scripts/release-evidence-contract.mjs',
      join(root, 'scripts/release-evidence-contract.mjs')
    );
    json(join(root, 'package.json'), { name: 'querynot', version: '0.1.0' });
    text(
      join(root, 'application-source.txt'),
      'synthetic application source\n'
    );

    git(root, 'init', '--quiet');
    git(root, 'config', 'user.name', 'QueryNot contract test');
    git(root, 'config', 'user.email', 'querynot-contract@example.invalid');
    git(root, 'add', '.');
    git(root, 'commit', '--quiet', '-m', 'source');
    const sourceCommit = git(root, 'rev-parse', 'HEAD');

    const phase5 = join(root, 'evidence', 'phase-5');
    const supportLink = 'evidence/phase-5/supporting-evidence.txt';
    text(
      join(root, supportLink),
      'synthetic supporting material for the gate contract test\n'
    );

    const artifactNames = new Map([
      ['windows-nsis-x64', 'QueryNot_0.1.0_x64-setup.exe'],
      ['macos-dmg-intel', 'QueryNot_0.1.0_x64.dmg'],
      ['macos-dmg-apple', 'QueryNot_0.1.0_aarch64.dmg'],
      ['linux-appimage-x64', 'QueryNot_0.1.0_amd64.AppImage'],
      ['linux-deb-x64', 'QueryNot_0.1.0_amd64.deb']
    ]);
    const artifacts = [...expectedArtifacts].map(([id, format], index) => ({
      id,
      format,
      name: artifactNames.get(id),
      bytes: 100 + index,
      sha256: String(index + 1).repeat(64),
      unsigned: true,
      evidence_link: supportLink
    }));
    const artifactById = new Map(
      artifacts.map((artifact) => [artifact.id, artifact])
    );
    text(
      join(phase5, 'SHA256SUMS'),
      `${artifacts
        .map((artifact) => `${artifact.sha256}  ${artifact.name}`)
        .join('\n')}\n`
    );

    const osResults = osMatrix.map((id) => ({
      id,
      os_version: `${id}-exact-patch`,
      runtime_version: `${id}-exact-runtime`,
      architecture: osArchitectures.get(id),
      packages: osArtifacts.get(id)?.map((artifactId) => {
        const artifact = artifactById.get(artifactId);
        return {
          id: artifactId,
          name: artifact?.name,
          sha256: artifact?.sha256,
          install: 'pass',
          core_journey: 'pass',
          journey_checks: passChecks(coreJourneyChecks),
          uninstall: 'pass',
          unsigned_warning_observed: true,
          evidence_links: [supportLink]
        };
      })
    }));
    json(join(phase5, 'operating-system-results.json'), {
      schema_version: 1,
      source_commit: sourceCommit,
      status: 'pass',
      results: osResults,
      family_network_journeys: [...osFamilies].map(([id, matrixIds]) => ({
        id,
        platform_matrix_id: matrixIds[0],
        checks: passChecks(familyNetworkChecks),
        evidence_links: [supportLink]
      }))
    });

    json(join(phase5, 'packaging-results.json'), {
      schema_version: 1,
      source_commit: sourceCommit,
      status: 'pass',
      updater_artifacts: false,
      checksum_verification: 'pass',
      artifacts,
      checksum_manifest: 'evidence/phase-5/SHA256SUMS'
    });

    json(join(phase5, 'accessibility-results.json'), {
      schema_version: 1,
      source_commit: sourceCommit,
      status: 'pass',
      reviewer: 'synthetic-reviewer',
      results: osMatrix.map((id) => ({
        id,
        reviewed_at: '2026-08-14',
        assistive_technology: 'synthetic-screen-reader 1.0',
        themes: { light: 'pass', dark: 'pass', forest: 'pass' },
        viewport_widths: { 1280: 'pass', 960: 'pass', 720: 'pass' },
        ui_scales: { 80: 'pass', 100: 'pass', 200: 'pass' },
        combinations_reviewed: 27,
        checks: passChecks(accessibilityChecks),
        evidence_links: [supportLink]
      }))
    });

    const rawSamples = Object.fromEntries(
      [...performanceMeasurements].map(([name, contract]) => {
        const sample = name.includes('fps')
          ? 60
          : name === 'cleanup_ratio_after_10s'
            ? 1
            : 50;
        return [
          name,
          { aggregation: contract.aggregation, samples: Array(30).fill(sample) }
        ];
      })
    );
    const rawLink = 'evidence/phase-5/performance-raw.json';
    json(join(root, rawLink), {
      schema_version: 1,
      source_commit: sourceCommit,
      status: 'pass',
      measurements: rawSamples
    });
    json(join(phase5, 'performance-results.json'), {
      schema_version: 1,
      source_commit: sourceCommit,
      status: 'pass',
      environment: {
        native: true,
        os: 'synthetic-os exact-patch',
        cpu: 'synthetic four-core CPU',
        physical_cpu_cores: 4,
        memory_gib: 16,
        storage: 'synthetic SSD',
        ssd: true,
        power_mode: 'balanced',
        display_scale: '100%',
        webview_runtime: 'synthetic-runtime 1.0',
        commands: ['synthetic benchmark command']
      },
      fixtures: {
        ordinary_result: {
          rows: 10000,
          columns: 12,
          approx_encoded_bytes_per_row: 1024,
          nulls: true,
          unicode: true,
          variable_width_text: true
        },
        large_schema: { namespaces: 100, objects: 10000 }
      },
      discarded_setup_runs: 1,
      measurements: Object.fromEntries(
        [...performanceMeasurements].map(([name, contract]) => [
          name,
          {
            samples: rawSamples[name].samples.length,
            value: aggregateSamples(
              rawSamples[name].samples,
              contract.aggregation as 'nearest_rank_p95' | 'maximum'
            ),
            aggregation: contract.aggregation,
            raw_evidence_link: rawLink
          }
        ])
      ),
      large_schema_progressive: 'pass',
      rendered_rows_bounded: 'pass'
    });

    const safetyIds = [
      'credential_persistence',
      'tls_modes',
      'diagnostic_redaction',
      'history_clear',
      'destructive_confirmations',
      'transaction_close',
      'export_overwrite',
      'unsigned_installation',
      'fixture_isolation'
    ];
    json(join(phase5, 'manual-safety-review.json'), {
      schema_version: 1,
      source_commit: sourceCommit,
      status: 'pass',
      reviewer: 'synthetic-safety-reviewer',
      reviewed_at: '2026-08-14',
      checks: safetyIds.map((id) => ({
        id,
        status: 'pass',
        evidence_link: supportLink
      }))
    });
    json(join(phase5, 'security-review.json'), {
      schema_version: 1,
      source_commit: sourceCommit,
      status: 'pass',
      reviewer: 'synthetic-security-reviewer',
      reviewed_at: '2026-08-14',
      known_critical: 0,
      known_high: 0,
      areas: passChecks([
        'credential_handling',
        'tls',
        'sql_targeting',
        'transactions',
        'row_editing',
        'exports',
        'local_file_access',
        'secret_redaction'
      ]),
      findings: [],
      evidence_links: [supportLink]
    });

    const dogfoodDates = [
      '2026-08-10',
      '2026-08-11',
      '2026-08-12',
      '2026-08-13',
      '2026-08-14'
    ];
    json(join(phase5, 'dogfood-record.json'), {
      schema_version: 1,
      source_commit: sourceCommit,
      status: 'pass',
      owner: 'synthetic-project-owner',
      fallback_client_used: false,
      metrics: {
        profile_to_editable_tab_ms: [100, 100, 100, 100, 100],
        table_to_known_row_copy_ms: [200, 200, 200, 200, 200]
      },
      failures: [],
      days: dogfoodDates.map((date, index) => {
        const ids = ['DOG-1', 'DOG-2', 'DOG-3', 'DOG-4', 'DOG-6', 'DOG-9'];
        if (index === 0) ids.push('DOG-5', 'DOG-7');
        if (index > 0) ids.push('DOG-8');
        return {
          date,
          unrecoverable_workspace_loss: false,
          tasks: ids.map((id) => ({
            id,
            status: 'pass',
            fallback_used: false,
            modes:
              id === 'DOG-1'
                ? ['profile_created_or_edited_and_tested']
                : id === 'DOG-4'
                  ? ['selection', 'cursor_statement', 'run_all']
                  : id === 'DOG-6'
                    ? ['copy', 'filter_or_sort', 'load_more', 'export_csv']
                    : id === 'DOG-7'
                      ? ['successful_apply', 'rollback_or_conflict']
                      : undefined,
            evidence_link: supportLink
          }))
        };
      })
    });

    json(join(phase5, 'beta-record.json'), {
      schema_version: 1,
      source_commit: sourceCommit,
      status: 'pass',
      participants: Array.from({ length: 5 }, (_, index) => ({
        id: `synthetic-participant-${index + 1}`,
        opt_in: true,
        attempted: true,
        completed_core_journey: index < 4,
        maintainer_intervention: index === 4,
        unresolved_data_safety_issue: false,
        unresolved_workspace_loss: false,
        evidence_link: supportLink
      }))
    });

    json(join(phase5, 'local-validation-report.json'), {
      status: 'pass_local_automation',
      source_commit: sourceCommit
    });
    json(join(phase5, 'dependency-review.json'), {
      status: 'pass',
      source_commit: sourceCommit,
      npm: { audit_vulnerabilities: { critical: 0, high: 0 } },
      rust: {
        new_advisories: 0,
        cargo_deny_version: 'cargo-deny 0.20.2'
      }
    });
    const targetIds = [
      'mysql-5.7.44',
      'mysql-8.0.46',
      'mysql-8.4.10',
      'mariadb-10.11.18',
      'mariadb-11.4.12'
    ];
    json(join(phase5, 'adapter-conformance-report.json'), {
      status: 'pass',
      tested_source: sourceCommit,
      network_results: targetIds.map((id) => ({
        id,
        marker_verified: true,
        adapter: {
          supported_capability_profile: true,
          table_editing: { optimistic_conflict_atomic_rollback: true }
        }
      }))
    });

    const traceabilityRecords = [
      ...Array.from({ length: 101 }, (_, index) => ({
        id: `REQ-${String(index + 1).padStart(3, '0')}`,
        kind: 'requirement',
        priority: 'must',
        status: 'verified',
        automated_test_ids: ['P5-AUTO-SYNTHETIC'],
        manual_procedure_ids: ['P5-MAN-SYNTHETIC'],
        evidence_links: [supportLink]
      })),
      ...Array.from({ length: 20 }, (_, index) => ({
        id: `AC-${String(index + 1).padStart(2, '0')}`,
        kind: 'acceptance_criterion',
        priority: 'must',
        status: 'verified',
        automated_test_ids: ['P5-AUTO-SYNTHETIC'],
        manual_procedure_ids: ['P5-MAN-SYNTHETIC'],
        evidence_links: [supportLink]
      }))
    ];
    json(join(root, 'traceability', 'requirements.json'), {
      schema_version: 1,
      records: traceabilityRecords
    });
    json(join(root, 'evidence', 'release', 'manifest.json'), {
      schema_version: 1,
      release_status: 'ready_to_publish',
      source_commit: sourceCommit,
      application_version: '0.1.0',
      release_tag: 'v0.1.0',
      reviewed_artifacts: artifacts.map(({ id, name, bytes, sha256 }) => ({
        id,
        name,
        bytes,
        sha256
      })),
      checksums: ['evidence/phase-5/SHA256SUMS'],
      approved_exceptions: []
    });

    git(root, 'add', '.');
    git(root, 'commit', '--quiet', '-m', 'evidence');
    const result = spawnSync(
      process.execPath,
      [join(root, 'scripts', 'audit-release-evidence.mjs')],
      { cwd: root, encoding: 'utf8' }
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      'all 101 requirements and 20 criteria are verified'
    );
  });
});
