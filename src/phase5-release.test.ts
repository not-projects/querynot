import { readFileSync, readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  expectedArtifacts,
  osMatrix
} from '../scripts/release-evidence-contract.mjs';

const read = (path: string) => readFileSync(path, 'utf8');

describe('Phase 5 Windows-first release boundary', () => {
  it('keeps versions aligned, updater generation disabled, and Windows packaging constrained', () => {
    const packageJson = JSON.parse(read('package.json'));
    const tauri = JSON.parse(read('src-tauri/tauri.conf.json'));
    const cargo = read('Cargo.toml');

    expect(packageJson.version).toBe('0.1.0');
    expect(tauri.version).toBe(packageJson.version);
    expect(cargo).toContain(`version = "${packageJson.version}"`);
    expect(tauri.bundle.active).toBe(true);
    expect(tauri.bundle.targets).toEqual([]);
    expect(tauri.bundle.createUpdaterArtifacts).toBe(false);
    expect(tauri.bundle.icon).toContain('icons/icon.ico');
    expect(tauri.bundle.windows.webviewInstallMode.type).toBe('skip');
    expect(tauri.bundle.windows.nsis.installMode).toBe('currentUser');
    expect([...expectedArtifacts]).toEqual([['windows-nsis-x64', 'nsis']]);
    expect(osMatrix).toEqual(['windows-11-x64']);
  });

  it('builds exactly one Windows NSIS candidate only on manual dispatch', () => {
    const workflow = read('.github/workflows/ci.yml');
    const candidate = workflow.split('  release-candidate-packages:')[1];

    expect(candidate).toContain("if: github.event_name == 'workflow_dispatch'");
    expect(candidate).toContain('runner: windows-2022');
    expect(candidate).toContain('package_script: package:windows');
    expect(candidate).toContain('expected_formats: nsis');
    expect(candidate).toContain('artifact_name: querynot-windows-x64');
    expect(candidate).not.toContain('expected_formats: dmg');
    expect(candidate).not.toContain('expected_formats: deb,appimage');
    expect(candidate).toContain('npm run release:inspect');
    expect(candidate).toContain('npm run release:checksums');
    expect(workflow).not.toContain('release-action');
    expect(workflow).not.toContain('create-release');
  });

  it('matches PostNot shared CI action and toolchain conventions', () => {
    const ci = read('.github/workflows/ci.yml');
    const release = read('.github/workflows/release.yml');
    const toolchain = read('rust-toolchain.toml');

    for (const workflow of [ci, release]) {
      expect(workflow).toContain('actions/checkout@v5');
      expect(workflow).toContain('actions/setup-node@v5');
      expect(workflow).toContain('node-version: 24');
    }
    expect(ci).toContain('dtolnay/rust-toolchain@1.97.0');
    expect(ci).toContain('swatinem/rust-cache@v2');
    expect(ci).toContain('workspaces: ./ -> target');
    expect(toolchain).toContain('channel = "1.97.0"');
    expect(ci).toContain('npx playwright install --with-deps chromium');
    expect(ci).toContain('npm run test:ui-layout');
  });

  it('keeps matrix build caches OS-runner specific', () => {
    const ci = read('.github/workflows/ci.yml');

    expect(ci.match(/key: \$\{\{ matrix\.runner \}\}/g)).toHaveLength(4);
  });

  it('invokes the pinned Tauri CLI without a platform shell shim', () => {
    const packaging = read('scripts/package-platform.mjs');
    const attributes = read('.gitattributes');

    expect(packaging).toContain("'@tauri-apps',\n  'cli',\n  'tauri.js'");
    expect(packaging).toContain('process.execPath');
    expect(packaging).not.toContain('npm.cmd');
    expect(packaging).toContain(
      'candidate packaging refuses uncommitted application or packaging inputs'
    );
    expect(attributes).toContain('*.toml text eol=lf');
  });

  it('makes disposable TLS mounts traversable and redacts failed-service diagnostics', () => {
    const feasibility = read('scripts/run-feasibility.mjs');
    const compose = read('fixtures/docker-compose.feasibility.yml');

    expect(feasibility).toContain('mkdirSync(tlsDirectory, { mode: 0o755 })');
    expect(feasibility).toContain(
      "writeFileSync(initSqlPath, initSql(), { encoding: 'utf8', mode: 0o644 })"
    );
    expect(feasibility).toContain("server.listen(0, '127.0.0.1'");
    expect(feasibility).toContain('QUERYNOT_MYSQL57_PORT');
    expect(feasibility).toContain('QUERYNOT_MYSQL84_PORT');
    expect(feasibility).toContain('QUERYNOT_MARIADB114_PORT');
    expect(compose).toContain('127.0.0.1:${QUERYNOT_MYSQL57_PORT}:3306');
    expect(compose).toContain('127.0.0.1:${QUERYNOT_MYSQL84_PORT}:3306');
    expect(compose).toContain('127.0.0.1:${QUERYNOT_MARIADB114_PORT}:3306');
    expect(compose).not.toContain('127.0.0.1::3306');
    expect(compose).toContain('driver: bridge');
    expect(compose).not.toContain('internal: true');
    expect(feasibility).toContain(".replaceAll(password, '[REDACTED]')");
    expect(feasibility).toContain(
      "['logs', '--no-color', '--timestamps', '--tail', '200']"
    );
  });

  it('retains cross-platform compile checks without making release claims', () => {
    const workflow = read('.github/workflows/ci.yml');
    const compatibility = read('docs/compatibility-matrix.md');

    expect(workflow).toContain('ubuntu-22.04');
    expect(workflow).toContain('ubuntu-24.04');
    expect(workflow).toContain('macos-15');
    expect(workflow).toContain('macos-15-intel');
    expect(workflow).toContain('windows-2022');
    expect(compatibility).toContain('Sole supported and published 0.1.0 row');
    expect(compatibility).toContain(
      'Deferred; no `0.1.0` support or artifact claim'
    );
  });

  it('documents the unsigned Windows install and checksum flow without a global bypass', () => {
    const installation = read('docs/release/unsigned-installation.md');

    expect(installation).toContain('Get-FileHash -Algorithm SHA256');
    expect(installation).toContain('Microsoft Edge WebView2 runtime');
    expect(installation).toContain('Windows 11');
    expect(installation).toContain('has no self-updater');
    expect(installation).not.toContain('Open Anyway');
    expect(installation).not.toContain('shasum -a 256');
    expect(installation).not.toContain('sha256sum');
  });

  it('keeps superseded manual templates explicitly unperformed', () => {
    const templates = readdirSync('evidence/phase-5/templates').filter((name) =>
      name.endsWith('.example.json')
    );

    expect(templates.length).toBeGreaterThanOrEqual(9);
    for (const name of templates) {
      const record = JSON.parse(read(`evidence/phase-5/templates/${name}`));
      expect(record.schema_version).toBe(1);
      expect(record.source_commit).toBeNull();
      expect(record.status).toBe('not_run');
    }
  });

  it('fails closed on source-tied automation, package evidence, scope, and traceability', () => {
    const audit = read('scripts/audit-release-evidence.mjs');
    const procedures = read('docs/release/phase5-manual-procedures.md');
    const traceability = JSON.parse(read('traceability/requirements.json'));

    for (const evidence of [
      'local-validation-report.json',
      'dependency-review.json',
      'adapter-conformance-report.json',
      'ui-layout-report.json',
      'windows-artifact-inspection.json',
      'windows-checksums.json',
      'packaging-results.json',
      'product-owner-scope.json'
    ]) {
      expect(audit).toContain(evidence);
    }
    expect(audit).toContain("manifest?.release_status === 'ready_to_publish'");
    expect(audit).toContain('manifest?.approved_exceptions?.length === 0');
    expect(audit).toContain('Unperformed checks are not represented as pass.');
    expect(audit).toContain("record?.priority === 'must'");

    const verificationIds = traceability.records.flatMap(
      (record: {
        automated_test_ids: string[];
        manual_procedure_ids: string[];
      }) => [...record.automated_test_ids, ...record.manual_procedure_ids]
    );
    expect(
      verificationIds.some((id: string) =>
        /^(PLANNED|PENDING|P5-MAN)-/.test(id)
      )
    ).toBe(false);
    expect(procedures).toContain('post-release');
    expect(procedures).toContain('never `pass`');
  });

  it('does not attribute dirty application inputs to a committed release source', () => {
    const inspection = read('scripts/inspect-release-artifacts.mjs');
    const checksums = read('scripts/release-checksums.mjs');

    expect(inspection).toContain(
      "['status', '--porcelain', '--untracked-files=all']"
    );
    expect(inspection).toContain('allowGeneratedOutputs: true');
    expect(inspection).toContain(
      'release artifact inspection refuses uncommitted application or packaging inputs'
    );
    expect(checksums).toContain('allowGeneratedOutputs: true');
    expect(checksums).toContain(
      'release checksums refuse uncommitted application or packaging inputs'
    );
  });
});
