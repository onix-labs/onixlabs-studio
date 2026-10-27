/**
 * The plugin runs under plain Node, and so does this spec: under the default DOM environment a blob
 * `node:sqlite` returns is Node's `Uint8Array`, not the DOM realm's, and `instanceof` would refuse it.
 * @vitest-environment node
 */
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EngineExecution, MAX_RESULT_ROWS } from '../../protocol/database/engine';
import { runScript, toValue } from './sqlite-run';

describe('runScript', (): void => {
  let database: DatabaseSync;

  beforeEach((): void => {
    database = new DatabaseSync(':memory:');
  });

  afterEach((): void => {
    database.close();
  });

  it('turnsARowReturningStatementIntoAResultSet_withItsColumnsAndLine', (): void => {
    const execution: EngineExecution = runScript(
      database,
      "select 1 as one, 'two' as two, null as three",
      1,
    );

    expect(execution.failed).toBe(false);
    expect(execution.cancelled).toBe(false);
    expect(execution.resultSets).toHaveLength(1);
    expect(execution.resultSets[0].columns.map((c: { name: string }): string => c.name)).toEqual([
      'one',
      'two',
      'three',
    ]);
    expect(execution.resultSets[0].rows).toEqual([[1, 'two', null]]);
    expect(execution.resultSets[0].line).toBe(1);
    expect(execution.messages).toEqual([{ severity: 'info', text: '1 row returned', line: 1 }]);
  });

  it('reportsRowCountsForStatementsThatReturnNoRows', (): void => {
    const execution: EngineExecution = runScript(
      database,
      "create table t (id integer primary key, name text);\ninsert into t (name) values ('a'), ('b');\ndelete from t where id = 1;",
      1,
    );

    expect(execution.failed).toBe(false);
    expect(execution.resultSets).toEqual([]);
    expect(execution.messages).toEqual([
      { severity: 'info', text: '0 rows affected', line: 1 },
      { severity: 'info', text: '2 rows affected', line: 2 },
      { severity: 'info', text: '1 row affected', line: 3 },
    ]);
  });

  it('takesTheDeclaredColumnTypeFromATable', (): void => {
    database.exec("create table t (id integer, label text); insert into t values (7, 'x');");

    const execution: EngineExecution = runScript(database, 'select id, label, 1 + 1 from t', 1);

    expect(execution.resultSets[0].columns).toEqual([
      { name: 'id', type: 'INTEGER' },
      { name: 'label', type: 'TEXT' },
      { name: '1 + 1', type: undefined },
    ]);
    expect(execution.resultSets[0].rows).toEqual([[7, 'x', 2]]);
  });

  it('stopsAtTheFirstError_reportingItOnItsStatementsLine_inTheDocumentsTerms', (): void => {
    const execution: EngineExecution = runScript(
      database,
      'select 1;\nselect * from missing;\nselect 3;',
      10,
    );

    expect(execution.failed).toBe(true);
    // The first statement ran; the third never did.
    expect(execution.resultSets).toHaveLength(1);
    expect(execution.resultSets[0].line).toBe(10);
    const error: { severity: string; text: string; line?: number } | undefined =
      execution.messages.at(-1);
    expect(error?.severity).toBe('error');
    expect(error?.line).toBe(11);
    expect(error?.text).toContain('missing');
    expect(execution.messages).toHaveLength(2);
  });

  it('runsNothingForAnEmptyScript', (): void => {
    expect(runScript(database, '  -- nothing\n', 1)).toEqual({
      resultSets: [],
      messages: [],
      failed: false,
      cancelled: false,
    });
  });

  it('keepsBigIntegersExact_andShowsBlobsAsSizeAndPreview', (): void => {
    const execution: EngineExecution = runScript(
      database,
      "select 9007199254740993 as big, 42 as small, x'00ff10' as blob, 1.5 as real",
      1,
    );

    expect(execution.resultSets[0].rows).toEqual([
      [
        { type: 'bigint', value: '9007199254740993' },
        42,
        { type: 'bytes', size: 3, preview: '00ff10' },
        1.5,
      ],
    ]);
  });

  it('truncatesAResultBeyondTheRowCeiling_withAWarning', (): void => {
    const total: number = MAX_RESULT_ROWS + 5;
    const execution: EngineExecution = runScript(
      database,
      `with recursive n(i) as (select 1 union all select i + 1 from n where i < ${total}) select i from n`,
      1,
    );

    expect(execution.failed).toBe(false);
    expect(execution.resultSets[0].rows).toHaveLength(MAX_RESULT_ROWS);
    expect(execution.messages).toEqual([
      {
        severity: 'warning',
        text: `${total} rows returned; the first ${MAX_RESULT_ROWS} are kept`,
        line: 1,
      },
    ]);
  });
});

describe('runScript column keys', (): void => {
  let database: DatabaseSync;

  beforeEach((): void => {
    database = new DatabaseSync(':memory:');
    database.exec(`
      create table parent (id integer primary key, email text unique);
      create table child (a int, b int, c text, d int references parent (id),
                          primary key (a, b), unique (c));
      create unique index child_d on child (d);
    `);
  });

  afterEach((): void => {
    database.close();
  });

  /**
   * Runs a query and reads its columns' keys.
   * @param sql The query.
   * @returns Returns each column's keys, by name.
   */
  function keysOf(sql: string): Record<string, unknown> {
    const execution: EngineExecution = runScript(database, sql, 1);
    return Object.fromEntries(
      execution.resultSets[0].columns.map((column) => [column.name, column.keys ?? []]),
    );
  }

  it('marksEachColumnOfACompositePrimaryKey_andNamesUnnamedKeysByWhatTheyCover', (): void => {
    expect(keysOf('select a, b, c, d, a + 1 as e from child')).toEqual({
      a: [{ kind: 'primary', name: 'PRIMARY KEY' }],
      b: [{ kind: 'primary', name: 'PRIMARY KEY' }],
      c: [{ kind: 'unique', name: 'UNIQUE (c)' }],
      // In two keys: a unique index of its own, and a reference to the parent's primary key.
      d: [
        { kind: 'unique', name: 'child_d' },
        { kind: 'foreign', name: 'REFERENCES parent (id)' },
      ],
      // An expression comes from no table column, so is in no key.
      e: [],
    });
  });

  it('tracesAnAliasedColumnBackToItsTable', (): void => {
    expect(keysOf('select id as identifier, email from parent')).toEqual({
      identifier: [{ kind: 'primary', name: 'PRIMARY KEY' }],
      email: [{ kind: 'unique', name: 'UNIQUE (email)' }],
    });
  });
});

describe('toValue', (): void => {
  it('passesPrimitivesThrough_andConvertsBigintsAndBytes', (): void => {
    expect(toValue(null)).toBeNull();
    expect(toValue('text')).toBe('text');
    expect(toValue(2.5)).toBe(2.5);
    expect(toValue(BigInt(12))).toBe(12);
    expect(toValue(BigInt('-9007199254740993'))).toEqual({
      type: 'bigint',
      value: '-9007199254740993',
    });
    expect(toValue(new Uint8Array(20).fill(1))).toEqual({
      type: 'bytes',
      size: 20,
      preview: '01'.repeat(16),
    });
  });
});
