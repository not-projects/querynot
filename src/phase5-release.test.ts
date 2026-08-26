import { readFileSync, readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  expectedArtifacts,
  osMatrix
} from '../scripts/release-evidence-contract.mjs';

const read = (path: string) => readFileSync(path, 'utf8');

describe('Phase 5 history and current release boundary', () => {
  it('keeps 0.1.7 versions aligned and updater generation enabled', () => {
    const packageJson = JSON.parse(read('package.json'));
    const packageLock = JSON.parse(read('package-lock.json'));
    const tauri = JSON.parse(read('src-tauri/tauri.conf.json'));
    const cargo = read('Cargo.toml');
    const cargoLock = read('Cargo.lock');
    const tauriCargo = read('src-tauri/Cargo.toml');
    const fixtureCargo = read('crates/querynot-fixture-harness/Cargo.toml');

    expect(packageJson.version).toBe('0.1.7');
    expect(packageLock.version).toBe(packageJson.version);
    expect(packageLock.packages[''].version).toBe(packageJson.version);
    expect(tauri.version).toBe(packageJson.version);
    expect(cargo).toContain(`version = "${packageJson.version}"`);
    expect(tauriCargo).toContain(`version = "${packageJson.version}"`);
    expect(fixtureCargo).toContain(`version = "${packageJson.version}"`);
    for (const crate of [
      'querynot',
      'querynot-core',
      'querynot-fixture-harness'
    ]) {
      expect(cargoLock).toContain(
        `name = "${crate}"\nversion = "${packageJson.version}"`
      );
    }
    expect(read(`docs/release/${packageJson.version}-notes.md`)).toContain(
      `# QueryNot ${packageJson.version}`
    );
    expect(tauri.bundle.active).toBe(true);
    expect(tauri.bundle.targets).toEqual([]);
    expect(tauri.bundle.createUpdaterArtifacts).toBe(true);
    expect(tauri.plugins.updater).toEqual({ endpoints: [], pubkey: '' });
    expect(tauri.bundle.icon).toContain('icons/icon.ico');
    expect(tauri.bundle.windows.webviewInstallMode.type).toBe('skip');
    expect(tauri.bundle.windows.nsis.installMode).toBe('currentUser');
  });

  it('builds and combines the PostNot-aligned desktop candidate matrix only on manual dispatch', () => {
    const workflow = read('.github/workflows/release-candidate.yml');
    const candidate = workflow.split('  release-candidate-packages:')[1];

    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('Reuse successful full CI');
    expect(workflow).toContain('-f head_sha="$GITHUB_SHA"');
    expect(candidate).toContain('runner: windows-2022');
    expect(candidate).toContain('runner: ubuntu-22.04');
    expect(candidate).toContain('runner: macos-15-intel');
    expect(candidate).toContain('runner: macos-15');
    expect(candidate).toContain('package_script: package:windows');
    expect(candidate).toContain('package_script: package:linux');
    expect(candidate).toContain('package_script: package:macos');
    expect(candidate).toContain('expected_formats: nsis,msi');
    expect(candidate).toContain('expected_formats: deb,rpm,appimage');
    expect(candidate).toContain('expected_formats: dmg');
    expect(candidate).toContain('artifact_name: querynot-windows-x64');
    expect(candidate).toContain('artifact_name: querynot-linux-x64');
    expect(candidate).toContain('artifact_name: querynot-macos-x64');
    expect(candidate).toContain('artifact_name: querynot-macos-aarch64');
    expect(candidate).toContain('npm run release:inspect');
    expect(candidate).toContain('npm run release:validate-updater-signing');
    expect(workflow).toContain('assemble-release-candidate:');
    expect(workflow).toContain('npm run release:create-updater-manifest');
    expect(workflow).toContain('npm run release:checksums');
    expect(workflow).toContain('npm run release:validate-update-candidate');
    expect(workflow).toContain('name: querynot-release-review');
    expect(workflow).toContain('compression-level: 0');
    expect(workflow).toContain('retention-days: 14');
    expect(candidate).toContain(
      'QUERYNOT_UPDATER_PUBLIC_KEY: ${{ vars.QUERYNOT_UPDATER_PUBLIC_KEY }}'
    );
    expect(candidate).toContain(
      'TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}'
    );
    expect(candidate).toContain('**/*.app.tar.gz');
    expect(candidate).toContain('**/*.sig');
    expect(workflow).not.toContain('release-action');
    expect(workflow).not.toContain('create-release');
  });

  it('matches PostNot shared CI action and toolchain conventions', () => {
    const ci = read('.github/workflows/ci.yml');
    const candidate = read('.github/workflows/release-candidate.yml');
    const release = read('.github/workflows/release.yml');
    const toolchain = read('rust-toolchain.toml');

    for (const workflow of [ci, candidate, release]) {
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
    expect(candidate).toContain('checksum-pinned-feasibility:');
    expect(candidate).toContain('npm run fixtures:fetch:native');
    expect(candidate).toContain('npm run test:feasibility:native');
    expect(candidate).not.toContain('- run: npm run test:feasibility\n');
    expect(read('scripts/fetch-native-feasibility.mjs')).toContain(
      "'--retry-all-errors'"
    );
  });

  it('keeps matrix build caches OS-runner specific', () => {
    const ci = read('.github/workflows/ci.yml');
    const candidate = read('.github/workflows/release-candidate.yml');

    expect(
      `${ci}\n${candidate}`.match(/key: \$\{\{ matrix\.runner \}\}/g)
    ).toHaveLength(4);
  });

  it('invokes the pinned Tauri CLI without a platform shell shim', () => {
    const packaging = read('scripts/package-platform.mjs');
    const attributes = read('.gitattributes');

    expect(packaging).toContain("'@tauri-apps',\n  'cli',\n  'tauri.js'");
    expect(packaging).toContain('process.execPath');
    expect(packaging).toContain("['macos', 'app,dmg']");
    expect(packaging).not.toContain('npm.cmd');
    expect(packaging).toContain(
      "buildArguments.push('--config', updaterConfig)"
    );
    expect(packaging).toContain('updaterBuildConfig');
    expect(packaging).toContain(
      'candidate packaging refuses uncommitted application or packaging inputs'
    );
    expect(attributes).toContain('*.toml text eol=lf');
  });

  it('keeps signed update checks and installation behind typed native commands', () => {
    const contract = JSON.parse(read('contracts/querynot.v1.json'));
    const native = read('src-tauri/src/updates.rs');
    const runtime = read('src-tauri/src/lib.rs');
    const cargo = read('src-tauri/Cargo.toml');
    const build = read('src-tauri/build.rs');
    const nativeDependencies = cargo
      .split('[dependencies]')[1]
      .split('[dev-dependencies]')[0];

    expect(contract.commands.check_for_updates).toEqual({
      request: null,
      response: 'UpdateCheckResponse'
    });
    expect(contract.commands.install_update).toEqual({
      request: 'ConfirmedActionRequest',
      response: 'FileActionResponse'
    });
    expect(contract.events.update_download_progress).toBe(
      'UpdateDownloadProgressView'
    );
    expect(native).toContain(
      'https://github.com/not-projects/querynot/releases/latest/download/latest.json'
    );
    expect(native).toContain('option_env!("QUERYNOT_UPDATER_PUBLIC_KEY")');
    expect(native).toContain('if !request.confirmed');
    expect(native).toContain('.download_and_install(');
    expect(native).not.toContain('#[cfg(target_os = "windows")]');
    expect(native).not.toContain('available only in the supported Windows');
    expect(runtime).toContain('tauri_plugin_updater::Builder::new().build()');
    expect(cargo).toContain('tauri-plugin-updater = "=2.10.1"');
    expect(nativeDependencies).toContain('serde_json.workspace = true');
    expect(build).toContain('QUERYNOT_UPDATER_PUBLIC_KEY');
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
    expect(feasibility).toContain("CREATE USER 'querynot'@'%'");
    expect(feasibility).toContain('mysql://querynot:');
    expect(compose).toContain('127.0.0.1:${QUERYNOT_MYSQL57_PORT}:3306');
    expect(compose).toContain('127.0.0.1:${QUERYNOT_MYSQL84_PORT}:3306');
    expect(compose).toContain('127.0.0.1:${QUERYNOT_MARIADB114_PORT}:3306');
    expect(compose).not.toContain('127.0.0.1::3306');
    expect(compose).toContain('driver: bridge');
    expect(compose).not.toContain('internal: true');
    expect(compose.match(/--bind-address=0\.0\.0\.0/g)).toHaveLength(3);
    expect(compose).not.toContain('ROOT_HOST');
    expect(feasibility).toContain(".replaceAll(password, '[REDACTED]')");
    expect(feasibility).toContain(".replaceAll(runtimeDirectory, '[TEMP]')");
    expect(feasibility).toContain(
      "['logs', '--no-color', '--timestamps', '--tail', '200']"
    );
  });

  it('retains cross-platform compile checks and declares the prepared release matrix', () => {
    const workflow = read('.github/workflows/ci.yml');
    const compatibility = read('docs/compatibility-matrix.md');

    expect(workflow).toContain('ubuntu-22.04');
    expect(workflow).toContain('ubuntu-24.04');
    expect(workflow).toContain('macos-15');
    expect(workflow).toContain('macos-15-intel');
    expect(workflow).toContain('windows-2022');
    expect(compatibility).toContain('Windows 11 x86-64');
    expect(compatibility).toContain('macOS 13 or later');
    expect(compatibility).toContain('Linux x86-64');
  });

  it('keeps the historical 0.1.0 unsigned install guidance immutable', () => {
    const installation = read('docs/release/unsigned-installation.md');

    expect(installation).toContain('Get-FileHash -Algorithm SHA256');
    expect(installation).toContain('Microsoft Edge WebView2 runtime');
    expect(installation).toContain('Windows 11');
    expect(installation).toContain('has no self-updater');
    expect(installation).not.toContain('Open Anyway');
    expect(installation).not.toContain('shasum -a 256');
    expect(installation).not.toContain('sha256sum');
  });

  it('keeps the immutable Phase 5 evidence contract Windows-only', () => {
    expect([...expectedArtifacts]).toEqual([['windows-nsis-x64', 'nsis']]);
    expect(osMatrix).toEqual(['windows-11-x64']);
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
    const localVerification = read('scripts/verify-phase5-local.mjs');
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
    expect(localVerification).toContain(
      'application or packaging inputs changed after the release source commit'
    );

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
