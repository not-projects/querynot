import {
  CompletionContext,
  type CompletionResult
} from '@codemirror/autocomplete';
import { MySQL, schemaCompletionSource, sql } from '@codemirror/lang-sql';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';

import {
  relationCompletionSource,
  sqlContextCompletionSource,
  type SqlContextCompletionConfig
} from './sql-completion';

const tables = [
  {
    namespace: 'main',
    name: 'users',
    columns: ['id', 'email', 'created_at']
  },
  {
    namespace: 'main',
    name: 'audit_log',
    columns: ['id', 'event_name', 'recorded_at']
  }
] as const;

function config(
  overrides: Partial<SqlContextCompletionConfig> = {}
): SqlContextCompletionConfig {
  return {
    dialect: 'mysql',
    engine: 'MySQL',
    exactVersion: '8.4.10',
    tables,
    selectedTable: { namespace: 'main', name: 'users' },
    ...overrides
  };
}

function complete(
  markedSql: string,
  completionConfig = config(),
  explicit = true
): CompletionResult | null {
  const cursor = markedSql.indexOf('|');
  if (cursor < 0) throw new Error('The test SQL needs a | cursor marker.');
  const sql = markedSql.replace('|', '');
  const state = EditorState.create({ doc: sql });
  return sqlContextCompletionSource(completionConfig)(
    new CompletionContext(state, cursor, explicit)
  ) as CompletionResult | null;
}

function labels(result: CompletionResult | null) {
  return result?.options.map((option) => option.label) ?? [];
}

function completeRelation(markedSql: string) {
  const cursor = markedSql.indexOf('|');
  const document = markedSql.replace('|', '');
  const source = relationCompletionSource(
    schemaCompletionSource({
      dialect: MySQL,
      schema: {
        users: ['id', 'email'],
        'main.users': ['id', 'email'],
        main: ['users']
      }
    })
  );
  return source(
    new CompletionContext(
      EditorState.create({
        doc: document,
        extensions: [sql({ dialect: MySQL })]
      }),
      cursor,
      true
    )
  ) as CompletionResult | null;
}

describe('SQL context completion', () => {
  it('offers MySQL-family functions in expression positions', () => {
    const result = complete('SELECT from_u| FROM main.users');

    expect(labels(result)).toContain('from_unixtime');
    expect(
      result?.options.find((option) => option.label === 'from_unixtime')
    ).toMatchObject({ type: 'function', detail: 'MySQL function' });
  });

  it('does not offer functions or columns where a table relation belongs', () => {
    expect(complete('SELECT * FROM from_u|')).toBeNull();
    expect(complete('UPDATE em|')).toBeNull();
  });

  it('scopes schema and table names to relation positions', () => {
    expect(labels(completeRelation('SELECT * FROM main.us|'))).toContain(
      'users'
    );
    expect(completeRelation('SELECT us|')).toBeNull();
  });

  it('offers columns from the selected table before a FROM clause exists', () => {
    const result = complete('SELECT em|');

    expect(labels(result)).toContain('email');
    expect(
      result?.options.find((option) => option.label === 'email')?.detail
    ).toBe('main.users · selected table column');
    expect(labels(result)).not.toContain('event_name');
  });

  it('uses the tables and aliases in the whole current statement', () => {
    const result = complete(
      'SELECT em| FROM main.users AS u JOIN main.audit_log AS a ON a.id = u.id'
    );

    expect(labels(result)).toContain('email');
    expect(labels(result)).toContain('event_name');
    expect(labels(result)).toContain('u');
    expect(labels(result)).toContain('a');
  });

  it('includes comma-joined statement tables', () => {
    const result = complete(
      'SELECT event| FROM main.users AS u, main.audit_log AS a WHERE a.id = u.id'
    );

    expect(labels(result)).toContain('email');
    expect(labels(result)).toContain('event_name');
    expect(labels(result)).toContain('a');
  });

  it('limits qualified completion to the referenced alias columns', () => {
    const result = complete(
      'SELECT u.em| FROM main.users AS u JOIN main.audit_log AS a ON a.id = u.id'
    );

    expect(labels(result)).toContain('email');
    expect(labels(result)).not.toContain('event_name');
    expect(labels(result)).not.toContain('from_unixtime');
  });

  it('offers columns but not functions in an INSERT target column list', () => {
    const result = complete(
      'INSERT INTO main.users (em|) VALUES (1)',
      config({ selectedTable: { namespace: 'main', name: 'audit_log' } })
    );

    expect(labels(result)).toContain('email');
    expect(labels(result)).not.toContain('from_unixtime');
  });

  it('keeps completions inside the statement containing the cursor', () => {
    const result = complete(
      'SELECT event| FROM main.audit_log; SELECT email FROM main.users'
    );

    expect(labels(result)).toContain('event_name');
    expect(labels(result)).not.toContain('email');
  });

  it('does not complete functions inside comments, strings, or quoted identifiers', () => {
    expect(complete("SELECT 'from_u|'")).toBeNull();
    expect(complete('SELECT 1 -- from_u|')).toBeNull();
    expect(complete('SELECT /* from_u| */ 1')).toBeNull();
    expect(complete('SELECT `from_u|`')).toBeNull();
  });

  it('uses engine-specific catalogs and version gates', () => {
    const sqlite = complete(
      'SELECT unix|',
      config({ dialect: 'sqlite', engine: 'SQLite', exactVersion: '3.46.0' })
    );
    const mysql57 = complete(
      'SELECT row_|',
      config({ exactVersion: '5.7.44' })
    );
    const mariaDb = complete(
      'SELECT json_d|',
      config({ engine: 'MariaDB', exactVersion: '11.4.12' })
    );

    expect(labels(sqlite)).toContain('unixepoch');
    expect(labels(sqlite)).not.toContain('from_unixtime');
    expect(labels(mysql57)).not.toContain('row_number');
    expect(labels(mariaDb)).toContain('json_detailed');
    expect(labels(mariaDb)).toContain('from_unixtime');
  });

  it('does not open an empty implicit completion list while typing', () => {
    expect(complete('SELECT |', config(), false)).toBeNull();
  });
});
