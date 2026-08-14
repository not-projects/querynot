import { readFileSync, readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  accessibilityChecks,
  aggregateSamples,
  coreJourneyChecks,
  familyNetworkChecks,
  osMatrix,
  performanceMeasurements
} from '../scripts/release-evidence-contract.mjs';

const read = (path: string) => readFileSync(path, 'utf8');

describe('Phase 5 release-candidate boundaries', () => {
  it('keeps versions aligned and updater generation disabled', () => {
    const packageJson = JSON.parse(read('package.json'));
    const tauri = JSON.parse(read('src-tauri/tauri.conf.json'));
    const cargo = read('Cargo.toml');

    expect(packageJson.version).toBe('0.1.0');
    expect(tauri.version).toBe(packageJson.version);
    expect(cargo).toContain(`version = "${packageJson.version}"`);
    expect(tauri.bundle.active).toBe(true);
    expect(tauri.bundle.targets).toEqual([]);
    expect(tauri.bundle.createUpdaterArtifacts).toBe(false);
    expect(tauri.bundle.icon).toContain('icons/128x128.png');
    expect(tauri.bundle.icon).toContain('icons/icon.icns');
    expect(tauri.bundle.icon).toContain('icons/icon.ico');
    expect(tauri.bundle.windows.webviewInstallMode.type).toBe('skip');
    expect(tauri.bundle.windows.nsis.installMode).toBe('currentUser');
    expect(tauri.bundle.macOS.minimumSystemVersion).toBe('13.0');
    expect(tauri.bundle.macOS.signingIdentity).toBe('-');
    expect(tauri.bundle.macOS.hardenedRuntime).toBe(true);
  });

  it('builds exactly the five requested package families only on manual dispatch', () => {
    const workflow = read('.github/workflows/ci.yml');

    expect(workflow).toContain('release-candidate-packages:');
    expect(workflow).toContain("if: github.event_name == 'workflow_dispatch'");
    expect(workflow).toContain('expected_formats: deb,appimage');
    expect(workflow).toContain('expected_formats: nsis');
    expect(workflow.match(/expected_formats: dmg/g)).toHaveLength(2);
    expect(workflow).toContain('macos-15-intel');
    expect(workflow).toContain('macos-15');
    expect(workflow).toContain('npm run release:inspect');
    expect(workflow).toContain('npm run release:checksums');
    expect(workflow).not.toContain('release-action');
    expect(workflow).not.toContain('create-release');
  });

  it('pins every on-demand AppImage packaging helper before Tauri runs', () => {
    const packageJson = JSON.parse(read('package.json'));
    const inputs = JSON.parse(read('fixtures/release-tool-inputs.json'));
    const fetcher = read('scripts/fetch-release-tools.mjs');
    const packager = read('scripts/package-platform.mjs');

    expect(packageJson.scripts['package:linux']).toBe(
      'node scripts/package-platform.mjs linux'
    );
    expect(inputs.inputs).toHaveLength(5);
    for (const input of inputs.inputs) {
      expect(input.url).toMatch(
        /^https:\/\/(github\.com|raw\.githubusercontent\.com)\//
      );
      expect(input.bytes).toBeGreaterThan(0);
      expect(input.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(fetcher).toContain("createHash('sha256')");
    expect(fetcher).toContain('exceeded its reviewed byte count');
    expect(fetcher).toContain("resolve(cacheRoot, 'reviewed')");
    expect(fetcher).toContain('copyFileSync(reviewed, working, 0)');
    expect(packager).toContain('XDG_CACHE_HOME: cacheRoot');
    expect(packager).toContain('CARGO_TARGET_DIR: targetRoot');
    expect(packager).toContain(
      'rmSync(targetRoot, { recursive: true, force: true })'
    );
    expect(packager.indexOf('fetch-release-tools.mjs')).toBeLessThan(
      packager.indexOf("'build', '--bundles'")
    );
  });

  it('documents checksum verification without global security bypasses', () => {
    const installation = read('docs/release/unsigned-installation.md');

    expect(installation).toContain('Get-FileHash -Algorithm SHA256');
    expect(installation).toContain('shasum -a 256');
    expect(installation).toContain('sha256sum');
    expect(installation).toContain('Microsoft Edge WebView2 runtime');
    expect(installation).toContain('Open Anyway');
    expect(installation).toContain('Do not disable Gatekeeper globally');
    expect(installation).toContain('has no self-updater');
  });

  it('keeps every human evidence template explicitly unperformed', () => {
    const templates = readdirSync('evidence/phase-5/templates').filter((name) =>
      name.endsWith('.example.json')
    );

    expect(templates).toHaveLength(9);
    for (const name of templates) {
      const record = JSON.parse(read(`evidence/phase-5/templates/${name}`));
      expect(record.schema_version).toBe(1);
      expect(record.source_commit).toBeNull();
      expect(record.status).toBe('not_run');
    }
  });

  it('pre-expands the native and accessibility evidence to the exact release matrix', () => {
    const operatingSystems = JSON.parse(
      read('evidence/phase-5/templates/operating-system-results.example.json')
    );
    const accessibility = JSON.parse(
      read('evidence/phase-5/templates/accessibility-results.example.json')
    );

    expect(
      operatingSystems.results.map(({ id }: { id: string }) => id)
    ).toEqual(osMatrix);
    for (const result of operatingSystems.results) {
      for (const packageJourney of result.packages) {
        expect(Object.keys(packageJourney.journey_checks)).toEqual(
          coreJourneyChecks
        );
      }
    }
    expect(
      operatingSystems.family_network_journeys.map(
        ({ id }: { id: string }) => id
      )
    ).toEqual(['windows', 'macos', 'linux']);
    for (const journey of operatingSystems.family_network_journeys) {
      expect(Object.keys(journey.checks)).toEqual(familyNetworkChecks);
    }

    expect(accessibility.results.map(({ id }: { id: string }) => id)).toEqual(
      osMatrix
    );
    for (const result of accessibility.results) {
      expect(Object.keys(result.checks)).toEqual(accessibilityChecks);
      expect(result.combinations_reviewed).toBe(0);
    }
  });

  it('defines recomputable statistics for every native performance measurement', () => {
    const summary = JSON.parse(
      read('evidence/phase-5/templates/performance-results.example.json')
    );
    const raw = JSON.parse(
      read('evidence/phase-5/templates/performance-raw.example.json')
    );

    expect(Object.keys(summary.measurements)).toEqual([
      ...performanceMeasurements.keys()
    ]);
    expect(Object.keys(raw.measurements)).toEqual([
      ...performanceMeasurements.keys()
    ]);
    for (const [name, contract] of performanceMeasurements) {
      expect(summary.measurements[name].aggregation).toBe(contract.aggregation);
      expect(raw.measurements[name].aggregation).toBe(contract.aggregation);
    }
    expect(aggregateSamples([1, 2, 3, 4, 5], 'nearest_rank_p95')).toBe(5);
    expect(aggregateSamples([1, 2, 3, 4, 5], 'maximum')).toBe(5);
  });

  it('fails closed on all external release evidence and traceability gates', () => {
    const audit = read('scripts/audit-release-evidence.mjs');
    const procedures = read('docs/release/phase5-manual-procedures.md');
    const traceability = JSON.parse(read('traceability/requirements.json'));

    for (const evidence of [
      'operating-system-results.json',
      'packaging-results.json',
      'accessibility-results.json',
      'performance-results.json',
      'manual-safety-review.json',
      'security-review.json',
      'dogfood-record.json',
      'beta-record.json'
    ]) {
      expect(audit).toContain(evidence);
    }
    for (const id of [
      'windows-10-22h2-x64',
      'windows-11-x64',
      'macos-13-intel',
      'macos-13-apple',
      'macos-current-intel',
      'macos-current-apple',
      'ubuntu-22.04-x64',
      'ubuntu-24.04-x64'
    ]) {
      expect(osMatrix).toContain(id);
    }
    expect(audit).toContain('days.length === 5');
    expect(audit).toContain('participants.length >= 5');
    expect(audit).toContain('raw sample set is incomplete');
    expect(audit).toContain('family_network_journeys');
    expect(audit).toContain('templates/');
    expect(audit).toContain("record.priority === 'must'");
    expect(audit).toContain(
      "releaseManifest?.release_status === 'ready_to_publish'"
    );
    expect(audit).toContain('releaseManifest.approved_exceptions.length === 0');
    expect(audit).toContain('must rows without Phase 5 evidence');
    const verificationIds = traceability.records.flatMap(
      (record: {
        automated_test_ids: string[];
        manual_procedure_ids: string[];
      }) => [...record.automated_test_ids, ...record.manual_procedure_ids]
    );
    expect(
      verificationIds.some((id: string) => id.startsWith('PLANNED-'))
    ).toBe(false);
    expect(
      verificationIds.some((id: string) => id.startsWith('PENDING-'))
    ).toBe(false);
    expect(procedures).toContain('P5-MAN-OS-CORE');
    expect(procedures).toContain('P5-MAN-A11Y');
    expect(procedures).toContain('P5-MAN-PERF');
    expect(procedures).toContain('P5-MAN-SAFETY');
    expect(procedures).toContain('P5-MAN-SECURITY');
    expect(procedures).toContain('P5-MAN-DOGFOOD');
    expect(procedures).toContain('P5-MAN-BETA');
    expect(procedures).toContain('P5-MAN-EVIDENCE');
  });

  it('does not attribute dirty application inputs to a committed release source', () => {
    const inspection = read('scripts/inspect-release-artifacts.mjs');
    const checksums = read('scripts/release-checksums.mjs');

    expect(inspection).toContain(
      "['status', '--porcelain', '--untracked-files=all']"
    );
    expect(inspection).toContain(
      'release artifact inspection refuses uncommitted application or packaging inputs'
    );
    expect(inspection).toContain('architecture: arch()');
    expect(checksums).toContain(
      'release checksums refuse uncommitted application or packaging inputs'
    );
  });
});
