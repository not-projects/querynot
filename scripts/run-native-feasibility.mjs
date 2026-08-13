import { createHash, randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  createReadStream,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const temporaryRoot = process.platform === 'linux' ? '/tmp' : tmpdir();
const cacheArgument = process.argv[2] === '--cache' ? process.argv[3] : null;
if (process.argv.length > (cacheArgument ? 4 : 2)) {
  throw new Error(
    'usage: node scripts/run-native-feasibility.mjs [--cache /absolute/path]'
  );
}
const cache = resolve(
  cacheArgument ?? join(temporaryRoot, 'querynot-native-fixture-cache')
);
const runtimeDirectory = mkdtempSync(
  join(temporaryRoot, 'querynot-native-feasibility-')
);
const manifestPath = resolve(runtimeDirectory, 'manifest.json');
const password = randomBytes(24).toString('base64url');
const markerToken = randomBytes(32).toString('hex');
const runningServers = [];
const inputManifest = JSON.parse(
  readFileSync(
    resolve(root, 'fixtures', 'native-feasibility-inputs.json'),
    'utf8'
  )
);
if (
  inputManifest.schema_version !== 1 ||
  inputManifest.platform !== 'linux-x86_64' ||
  !Array.isArray(inputManifest.inputs)
) {
  throw new Error('native feasibility input manifest is invalid');
}
const inputs = new Map(inputManifest.inputs.map((input) => [input.id, input]));
function requiredInput(id, kind) {
  const input = inputs.get(id);
  if (!input || input.kind !== kind || !/^[a-f0-9]{64}$/.test(input.sha256)) {
    throw new Error(`native feasibility input ${id} is missing or invalid`);
  }
  return input;
}
const archives = Object.fromEntries(
  ['mysql57', 'mysql84', 'mariadb114'].map((id) => {
    const input = requiredInput(id, 'database_archive');
    const tarArguments =
      input.format === 'tar.gz'
        ? ['-xzf']
        : input.format === 'tar.xz'
          ? ['-xJf']
          : null;
    if (!tarArguments) throw new Error(`unsupported archive format for ${id}`);
    return [
      id,
      { ...input, algorithm: 'sha256', digest: input.sha256, tarArguments }
    ];
  })
);
const runtimePackages = ['libaio1', 'libncurses5', 'libtinfo5'].map((id) => {
  const input = requiredInput(id, 'runtime_package');
  return { ...input, digest: input.sha256 };
});

function command(program, commandArguments, options = {}) {
  const result = spawnSync(program, commandArguments, {
    cwd: options.cwd ?? root,
    encoding: 'utf8',
    env: options.env ?? process.env,
    input: options.input,
    maxBuffer: 16 * 1024 * 1024,
    stdio: options.input
      ? ['pipe', options.capture ? 'pipe' : 'ignore', 'pipe']
      : options.capture
        ? ['ignore', 'pipe', 'pipe']
        : 'ignore'
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = (result.stderr ?? result.stdout ?? '')
      .replaceAll(password, '[redacted-password]')
      .replaceAll(markerToken, '[redacted-marker]')
      .replaceAll(runtimeDirectory, '[fixture-runtime]')
      .trim()
      .slice(0, 1_000);
    throw new Error(
      `${basename(program)} failed for the disposable fixture${detail ? `: ${detail}` : ''}`
    );
  }
  return result.stdout?.trim() ?? '';
}

async function digest(path, algorithm) {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function verifyInput(path, algorithm, expected) {
  if ((await digest(path, algorithm)) !== expected) {
    throw new Error(`${basename(path)} failed its published checksum`);
  }
}

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('could not reserve a loopback fixture port'));
        return;
      }
      server.close((error) =>
        error ? reject(error) : resolvePort(address.port)
      );
    });
  });
}

function initSql(authenticationSql) {
  const sequenceRows = Array.from(
    { length: 1_024 },
    (_, index) => `(${index + 1})`
  ).join(',\n');
  return `${authenticationSql}
CREATE DATABASE querynot_fixture CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON querynot_fixture.* TO 'querynot'@'127.0.0.1';
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
FLUSH PRIVILEGES;
`;
}

function generateCertificates() {
  const tlsDirectory = resolve(runtimeDirectory, 'tls');
  mkdirSync(tlsDirectory, { mode: 0o700 });
  const caKey = resolve(tlsDirectory, 'ca-key.pem');
  const caCertificate = resolve(tlsDirectory, 'ca.pem');
  const serverKey = resolve(tlsDirectory, 'server-key.pem');
  const serverRequest = resolve(tlsDirectory, 'server.csr');
  const serverCertificate = resolve(tlsDirectory, 'server.pem');
  const extensions = resolve(tlsDirectory, 'extensions.cnf');
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
  chmodSync(caKey, 0o600);
  chmodSync(serverKey, 0o600);
  return { caCertificate, serverCertificate, serverKey };
}

async function waitUntilReady(server) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.child.exitCode !== null) {
      throw new Error(
        `${server.id} exited before its disposable fixture became ready`
      );
    }
    const result = spawnSync(
      server.admin,
      [
        '--no-defaults',
        '--protocol=SOCKET',
        `--socket=${server.socket}`,
        '--user=root',
        'ping',
        '--silent'
      ],
      { env: server.environment, stdio: 'ignore' }
    );
    if (result.status === 0) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw new Error(`${server.id} did not become ready within 60 seconds`);
}

async function startServer({
  id,
  basedir,
  binary,
  client,
  admin,
  environment,
  initialize,
  port,
  tls
}) {
  const serverDirectory = resolve(runtimeDirectory, id);
  const dataDirectory = resolve(serverDirectory, 'data');
  const socket = resolve(serverDirectory, 'server.sock');
  mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
  initialize(dataDirectory);
  const logPath = resolve(serverDirectory, 'server.log');
  const logDescriptor = openSync(logPath, 'a', 0o600);
  const child = spawn(
    binary,
    [
      '--no-defaults',
      `--basedir=${basedir}`,
      `--datadir=${dataDirectory}`,
      '--bind-address=127.0.0.1',
      `--port=${port}`,
      `--socket=${socket}`,
      `--pid-file=${resolve(serverDirectory, 'server.pid')}`,
      `--secure-file-priv=${serverDirectory}`,
      '--skip-name-resolve',
      '--tls-version=TLSv1.2',
      `--ssl-ca=${tls.caCertificate}`,
      `--ssl-cert=${tls.serverCertificate}`,
      `--ssl-key=${tls.serverKey}`
    ],
    { env: environment, stdio: ['ignore', logDescriptor, logDescriptor] }
  );
  const server = { id, child, client, admin, environment, socket };
  runningServers.push(server);
  await waitUntilReady(server);
  return server;
}

function seed(server, sql) {
  command(
    server.client,
    [
      '--no-defaults',
      '--protocol=SOCKET',
      `--socket=${server.socket}`,
      '--user=root',
      '--default-character-set=utf8mb4'
    ],
    { env: server.environment, input: sql }
  );
}

function target(
  id,
  product,
  version,
  authenticationPlugin,
  port,
  caCertificate
) {
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
    connection_url: `mysql://querynot:${encodeURIComponent(password)}@127.0.0.1:${port}/querynot_fixture?${query}`,
    require_tls_version: 'TLSv1.2',
    require_verified_tls: true
  };
}

async function stopServers() {
  for (const server of [...runningServers].reverse()) {
    spawnSync(
      server.admin,
      [
        '--no-defaults',
        '--protocol=SOCKET',
        `--socket=${server.socket}`,
        '--user=root',
        'shutdown'
      ],
      { env: server.environment, stdio: 'ignore', timeout: 10_000 }
    );
    if (server.child.exitCode === null) server.child.kill('SIGTERM');
  }
}

try {
  for (const archive of Object.values(archives)) {
    await verifyInput(
      resolve(cache, archive.file),
      archive.algorithm,
      archive.digest
    );
  }
  for (const runtimePackage of runtimePackages) {
    await verifyInput(
      resolve(cache, runtimePackage.file),
      'sha256',
      runtimePackage.digest
    );
  }

  const installs = {};
  for (const [id, archive] of Object.entries(archives)) {
    const destination = resolve(runtimeDirectory, 'install', id);
    mkdirSync(destination, { recursive: true });
    command('tar', [
      ...archive.tarArguments,
      resolve(cache, archive.file),
      '-C',
      destination,
      '--strip-components=1'
    ]);
    installs[id] = destination;
  }
  const runtimeLibraries = resolve(runtimeDirectory, 'runtime-libraries');
  mkdirSync(runtimeLibraries, { recursive: true });
  for (const runtimePackage of runtimePackages) {
    command('dpkg-deb', [
      '-x',
      resolve(cache, runtimePackage.file),
      runtimeLibraries
    ]);
  }
  const libraryPaths = [
    resolve(runtimeLibraries, 'lib', 'x86_64-linux-gnu'),
    resolve(runtimeLibraries, 'usr', 'lib', 'x86_64-linux-gnu')
  ];
  const mysqlEnvironment = {
    ...process.env,
    LD_LIBRARY_PATH: [...libraryPaths, process.env.LD_LIBRARY_PATH]
      .filter(Boolean)
      .join(':')
  };
  const tls = generateCertificates();
  const [mysql57Port, mysql84Port, mariadb114Port] = await Promise.all([
    freePort(),
    freePort(),
    freePort()
  ]);

  const mysql57 = await startServer({
    id: 'mysql57',
    basedir: installs.mysql57,
    binary: resolve(installs.mysql57, 'bin', 'mysqld'),
    client: resolve(installs.mysql57, 'bin', 'mysql'),
    admin: resolve(installs.mysql57, 'bin', 'mysqladmin'),
    environment: mysqlEnvironment,
    port: mysql57Port,
    tls,
    initialize: (dataDirectory) =>
      command(
        resolve(installs.mysql57, 'bin', 'mysqld'),
        [
          '--no-defaults',
          '--initialize-insecure',
          `--basedir=${installs.mysql57}`,
          `--datadir=${dataDirectory}`
        ],
        { env: mysqlEnvironment }
      )
  });
  seed(
    mysql57,
    initSql(
      `CREATE USER 'querynot'@'127.0.0.1' IDENTIFIED WITH mysql_native_password BY '${password}' REQUIRE SSL;`
    )
  );

  const mysql84 = await startServer({
    id: 'mysql84',
    basedir: installs.mysql84,
    binary: resolve(installs.mysql84, 'bin', 'mysqld'),
    client: resolve(installs.mysql84, 'bin', 'mysql'),
    admin: resolve(installs.mysql84, 'bin', 'mysqladmin'),
    environment: mysqlEnvironment,
    port: mysql84Port,
    tls,
    initialize: (dataDirectory) =>
      command(
        resolve(installs.mysql84, 'bin', 'mysqld'),
        [
          '--no-defaults',
          '--initialize-insecure',
          `--basedir=${installs.mysql84}`,
          `--datadir=${dataDirectory}`
        ],
        { env: mysqlEnvironment }
      )
  });
  seed(
    mysql84,
    initSql(
      `CREATE USER 'querynot'@'127.0.0.1' IDENTIFIED WITH caching_sha2_password BY '${password}' REQUIRE SSL;`
    )
  );

  const mariadb114 = await startServer({
    id: 'mariadb114',
    basedir: installs.mariadb114,
    binary: resolve(installs.mariadb114, 'bin', 'mariadbd'),
    client: resolve(installs.mariadb114, 'bin', 'mariadb'),
    admin: resolve(installs.mariadb114, 'bin', 'mariadb-admin'),
    environment: process.env,
    port: mariadb114Port,
    tls,
    initialize: (dataDirectory) =>
      command(
        resolve(installs.mariadb114, 'scripts', 'mariadb-install-db'),
        [
          '--no-defaults',
          `--basedir=${installs.mariadb114}`,
          `--datadir=${dataDirectory}`,
          '--auth-root-authentication-method=normal',
          '--skip-test-db'
        ],
        { env: process.env }
      )
  });
  seed(
    mariadb114,
    initSql(
      `CREATE USER 'querynot'@'127.0.0.1' IDENTIFIED VIA mysql_native_password USING PASSWORD('${password}') REQUIRE SSL;`
    )
  );

  const manifest = {
    generated_for: 'querynot-disposable-fixture-v1',
    marker_token: markerToken,
    targets: [
      target(
        'mysql-5.7.44',
        'mysql',
        '5.7.44',
        'mysql_native_password',
        mysql57Port,
        tls.caCertificate
      ),
      target(
        'mysql-8.4.10',
        'mysql',
        '8.4.10',
        'caching_sha2_password',
        mysql84Port,
        tls.caCertificate
      ),
      target(
        'mariadb-11.4.12',
        'mariadb',
        '11.4.12',
        'mysql_native_password',
        mariadb114Port,
        tls.caCertificate
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
      command('git', ['status', '--porcelain'], { capture: true }) === ''
        ? command('git', ['rev-parse', 'HEAD'], { capture: true })
        : 'working tree; exact committed rerun is required before the Phase 0 exit gate closes',
    environment: {
      os: process.platform,
      architecture: process.arch,
      kernel: command('uname', ['-sr'], { capture: true }),
      node: process.version,
      rustc: command('rustc', ['--version'], { capture: true })
    },
    fixture: 'querynot-disposable-fixture-v1',
    command: 'npm run test:feasibility:native',
    archive_checksums: Object.values(archives).map(
      ({ file, algorithm, digest: value, vendor_digest }) => ({
        file,
        algorithm,
        digest: value,
        vendor_digest
      })
    ),
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
  await stopServers();
  rmSync(runtimeDirectory, { recursive: true, force: true });
}
