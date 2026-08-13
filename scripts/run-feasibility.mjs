import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const temporaryRoot = process.platform === 'linux' ? '/tmp' : tmpdir();
const composeFile = resolve(root, 'fixtures/docker-compose.feasibility.yml');
const runtimeDirectory = mkdtempSync(
  join(temporaryRoot, 'querynot-feasibility-')
);
const initSqlPath = resolve(runtimeDirectory, 'init.sql');
const manifestPath = resolve(runtimeDirectory, 'manifest.json');
const tlsDirectory = resolve(runtimeDirectory, 'tls-server');
const tlsAuthorityDirectory = resolve(runtimeDirectory, 'tls-authority');
const password = randomBytes(24).toString('base64url');
const markerToken = randomBytes(32).toString('hex');
const composeProject = `querynot-feasibility-${process.pid}`;
const composeEnvironment = {
  ...process.env,
  QUERYNOT_FIXTURE_PASSWORD: password,
  QUERYNOT_FIXTURE_INIT_SQL: initSqlPath,
  QUERYNOT_FIXTURE_TLS: tlsDirectory
};

function command(program, commandArguments, options = {}) {
  const result = spawnSync(program, commandArguments, {
    cwd: root,
    encoding: 'utf8',
    env: options.env ?? process.env,
    maxBuffer: 16 * 1024 * 1024,
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = options.capture ? `\n${result.stderr}` : '';
    throw new Error(`${program} ${commandArguments.join(' ')} failed${detail}`);
  }
  return result.stdout?.trim() ?? '';
}

function compose(commandArguments, capture = false) {
  return command(
    'docker',
    [
      'compose',
      '--project-name',
      composeProject,
      '--file',
      composeFile,
      ...commandArguments
    ],
    { env: composeEnvironment, capture }
  );
}

function portFor(service) {
  const published = compose(['port', service, '3306'], true);
  const match = published.match(/(?:127\.0\.0\.1|0\.0\.0\.0|\[::\]):(\d+)$/);
  if (!match)
    throw new Error(
      `Docker returned an unsafe or unreadable port for ${service}`
    );
  return Number(match[1]);
}

function initSql() {
  const sequenceRows = Array.from(
    { length: 1_024 },
    (_, index) => `(${index + 1})`
  ).join(',\n');
  return `CREATE DATABASE querynot_fixture CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE querynot_fixture;
CREATE TABLE __querynot_fixture_marker (marker_token VARCHAR(128) NOT NULL);
INSERT INTO __querynot_fixture_marker VALUES ('${markerToken}');
CREATE TABLE stream_fixture (sequence_number INTEGER PRIMARY KEY);
INSERT INTO stream_fixture (sequence_number) VALUES
${sequenceRows};
CREATE TABLE typed_fixture (
  signed_value BIGINT NOT NULL,
  unsigned_value BIGINT UNSIGNED NOT NULL,
  decimal_value DECIMAL(30, 10) NOT NULL,
  binary_value VARBINARY(16) NOT NULL,
  text_value VARCHAR(64) NOT NULL,
  null_value VARCHAR(64) NULL
);
INSERT INTO typed_fixture VALUES (
  -9223372036854775000,
  18446744073709551000,
  12345678901234567890.1234567890,
  X'00FF1080',
  'QueryNot Ω',
  NULL
);
CREATE TABLE transaction_fixture (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  value_text VARCHAR(128) NOT NULL
);
`;
}

function generateCertificates() {
  mkdirSync(tlsDirectory, { mode: 0o700 });
  mkdirSync(tlsAuthorityDirectory, { mode: 0o700 });
  const caKey = resolve(tlsAuthorityDirectory, 'ca-key.pem');
  const caCertificate = resolve(tlsDirectory, 'ca.pem');
  const serverKey = resolve(tlsDirectory, 'server-key.pem');
  const serverRequest = resolve(tlsAuthorityDirectory, 'server.csr');
  const serverCertificate = resolve(tlsDirectory, 'server.pem');
  const extensions = resolve(tlsAuthorityDirectory, 'extensions.cnf');
  writeFileSync(extensions, 'subjectAltName=IP:127.0.0.1,DNS:localhost\n', {
    mode: 0o600
  });
  command('openssl', ['genrsa', '-traditional', '-out', caKey, '2048']);
  command('openssl', [
    'req',
    '-x509',
    '-new',
    '-sha256',
    '-days',
    '2',
    '-key',
    caKey,
    '-subj',
    '/CN=QueryNot Disposable Fixture CA',
    '-out',
    caCertificate
  ]);
  command('openssl', ['genrsa', '-traditional', '-out', serverKey, '2048']);
  command('openssl', [
    'req',
    '-new',
    '-sha256',
    '-key',
    serverKey,
    '-subj',
    '/CN=127.0.0.1',
    '-out',
    serverRequest
  ]);
  command('openssl', [
    'x509',
    '-req',
    '-sha256',
    '-days',
    '2',
    '-in',
    serverRequest,
    '-CA',
    caCertificate,
    '-CAkey',
    caKey,
    '-CAcreateserial',
    '-extfile',
    extensions,
    '-out',
    serverCertificate
  ]);
  chmodSync(caCertificate, 0o644);
  chmodSync(serverCertificate, 0o644);
  chmodSync(serverKey, 0o644);
  return caCertificate;
}

function target(
  id,
  product,
  version,
  authenticationPlugin,
  port,
  caCertificate
) {
  const encodedPassword = encodeURIComponent(password);
  const query = new URLSearchParams({
    'ssl-mode': 'verify_identity',
    'ssl-ca': caCertificate
  });
  return {
    id,
    family: 'my_sql_family',
    expected_product: product,
    expected_version_prefix: version,
    expected_authentication_plugin: authenticationPlugin,
    connection_url: `mysql://root:${encodedPassword}@127.0.0.1:${port}/querynot_fixture?${query}`,
    require_tls_version: 'TLSv1.2',
    require_verified_tls: true
  };
}

try {
  writeFileSync(initSqlPath, initSql(), { encoding: 'utf8', mode: 0o600 });
  const caCertificate = generateCertificates();
  compose(['up', '--detach', '--wait', '--quiet-pull']);

  const manifest = {
    generated_for: 'querynot-disposable-fixture-v1',
    marker_token: markerToken,
    targets: [
      target(
        'mysql-5.7.44',
        'mysql',
        '5.7.44',
        'mysql_native_password',
        portFor('mysql57'),
        caCertificate
      ),
      target(
        'mysql-8.4.10',
        'mysql',
        '8.4.10',
        'caching_sha2_password',
        portFor('mysql84'),
        caCertificate
      ),
      target(
        'mariadb-11.4.12',
        'mariadb',
        '11.4.12',
        'mysql_native_password',
        portFor('mariadb114'),
        caCertificate
      )
    ]
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  });
  chmodSync(manifestPath, 0o600);

  const reportJson = command(
    'cargo',
    [
      'run',
      '--locked',
      '--quiet',
      '-p',
      'querynot-fixture-harness',
      '--',
      '--manifest',
      manifestPath
    ],
    { capture: true }
  );
  const harnessReport = JSON.parse(reportJson);
  const evidence = {
    schema_version: 1,
    status: 'pass',
    tested_source:
      'working tree; exact committed rerun is required before the Phase 0 exit gate closes',
    fixture: 'querynot-disposable-fixture-v1',
    command: 'npm run test:feasibility',
    image_tags: ['mysql:5.7.44', 'mysql:8.4.10', 'mariadb:11.4.12'],
    sqlite_test: 'cargo test -p querynot-core --test sqlite_feasibility',
    network_results: harnessReport.results
  };
  const evidenceDirectory = resolve(root, 'evidence', 'phase-0');
  mkdirSync(evidenceDirectory, { recursive: true });
  writeFileSync(
    resolve(evidenceDirectory, 'feasibility-report.json'),
    `${JSON.stringify(evidence, null, 2)}\n`
  );
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
} finally {
  try {
    compose(['down', '--volumes', '--remove-orphans']);
  } catch {
    process.stderr.write(
      `warning: Docker cleanup for ${composeProject} needs manual review\n`
    );
  }
  rmSync(runtimeDirectory, { recursive: true, force: true });
}
