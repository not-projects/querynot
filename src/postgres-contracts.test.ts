import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('PostgreSQL adapter boundaries', () => {
  it('routes PostgreSQL through the common native adapter and generated profile contract', () => {
    const adapter = read('crates/querynot-core/src/adapter.rs');
    const profile = read('crates/querynot-core/src/profile.rs');
    const runtime = read('src-tauri/src/phase1.rs');

    expect(adapter).toContain(
      'Postgres(Box<crate::postgres::PostgresSession>)'
    );
    expect(adapter).toContain('ConnectionTarget::Postgres');
    expect(profile).toContain('Postgres {');
    expect(runtime).toContain('"mysql_family" | "postgres"');
    expect(runtime).toContain('kind: "postgres".to_owned()');
  });

  it('keeps PostgreSQL TLS, cancellation, metadata, streaming, and mutations native', () => {
    const postgres = read('crates/querynot-core/src/postgres.rs');

    expect(postgres).toContain('PgSslMode::VerifyFull');
    expect(postgres).not.toContain('PgSslMode::Prefer');
    expect(postgres).toContain('SELECT pg_cancel_backend($1)');
    expect(postgres).toContain('pg_catalog.pg_namespace');
    expect(postgres).toContain('pg_get_function_identity_arguments');
    expect(postgres).toContain('fetch_many');
    expect(postgres).toContain('TableDialect::Postgres');
    expect(postgres).toContain('SqliteExecutionEvent::ResultTerminal');
  });

  it('selects PostgreSQL parsing and engine-aware UI labels without bypassing capabilities', () => {
    const app = read('src/App.svelte');
    const fileBranchStart = app.indexOf("{#if profileForm.kind === 'sqlite'}");
    const serverBranchStart = app.indexOf('{:else}', fileBranchStart);
    const fileBranch = app.slice(fileBranchStart, serverBranchStart);
    const serverBranch = app.slice(serverBranchStart);
    const editor = read('src/lib/components/SqlEditor.svelte');
    const connections = read('src/lib/components/ConnectionList.svelte');

    expect(serverBranch).toContain(
      '<option value="postgres">PostgreSQL</option>'
    );
    expect(fileBranch).not.toContain(
      '<option value="postgres">PostgreSQL</option>'
    );
    expect(app).toContain("kind === 'postgres' ? 5432 : 3306");
    expect(editor).toContain('PostgreSQL,');
    expect(editor).toContain("dialect === 'postgresql'");
    expect(connections).toContain("profile.kind === 'postgres'");
    expect(app).toContain('activeConnection?.dialect');
  });
});
