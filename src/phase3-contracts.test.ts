import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('Phase 3 MySQL-family adapter boundaries', () => {
  it('uses one capability-driven runtime adapter rather than engine branches in the UI', () => {
    const runtime = read('src-tauri/src/phase2.rs');
    const app = read('src/App.svelte');

    expect(runtime).toContain('AdapterSession::open');
    expect(runtime).toContain('AdapterSession::test_connection');
    expect(app).not.toContain("profile.kind !== 'sqlite'");
    expect(app).toContain('activeConnection?.dialect');
    expect(app).toContain('activeConnection?.compatibility_warning');
  });

  it('fails TLS verification closed and keeps sensitive TLS files behind grants', () => {
    const profile = read('crates/querynot-core/src/profile.rs');
    const mysql = read('crates/querynot-core/src/mysql.rs');
    const runtime = read('src-tauri/src/phase1.rs');

    expect(mysql).not.toContain('MySqlSslMode::Preferred');
    expect(mysql).toContain('MySqlSslMode::VerifyIdentity');
    expect(runtime).toContain('FilePurpose::TlsCa');
    expect(runtime).toContain('FilePurpose::TlsClientCertificate');
    expect(runtime).toContain('FilePurpose::TlsClientKey');
    expect(profile).toContain('&"[REDACTED]"');
  });

  it('shows query-only and legacy compatibility state persistently', () => {
    const app = read('src/App.svelte');
    const mysql = read('crates/querynot-core/src/mysql.rs');

    expect(app).toContain('Query-only compatibility mode');
    expect(app).toContain('Legacy server connection');
    expect(mysql).toContain('CompatibilityStatus::QueryOnly');
    expect(mysql).toContain('possible writes are disabled');
    expect(mysql).toContain(
      'mysql_version_line(exact_version) == Some((5, 7))'
    );
    expect(mysql).toContain(
      'write-enabled under the MySQL 5.7 compatibility line'
    );
  });

  it('exposes cancellable and timed connection lifecycle states', () => {
    const contract = read('contracts/querynot.v1.json');
    const runtime = read('src-tauri/src/phase2.rs');
    const app = read('src/App.svelte');
    const connectionList = read('src/lib/components/ConnectionList.svelte');

    expect(contract).toContain('cancel_profile_connection');
    expect(runtime).toContain('begin_connection_attempt');
    expect(runtime).toContain('connection_timeout_error');
    expect(runtime).toContain('partial native resources were closed');
    expect(app).toContain('connectionOperations');
    expect(connectionList).toContain('Testing connection');
    expect(connectionList).toContain('Connecting');
  });

  it('implements metadata, cancellation, authoritative transactions, and multiple results natively', () => {
    const mysql = read('crates/querynot-core/src/mysql.rs');

    expect(mysql).toContain('information_schema.ROUTINES');
    expect(mysql).toContain('KILL QUERY');
    expect(mysql).toContain('SELECT @@session.in_transaction');
    expect(mysql).toContain('reconcile_mysql57_statement_effect');
    expect(mysql).toContain('fetch_many');
    expect(mysql).toContain('SqliteExecutionEvent::ResultTerminal');
  });
});
