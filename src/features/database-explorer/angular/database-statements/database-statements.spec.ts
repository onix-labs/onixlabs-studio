import { describe, expect, it } from 'vitest';
import {
  destructiveStatements,
  StatementSpan,
  statementAt,
  statementSpans,
} from './database-statements';

describe('statementSpans', () => {
  it('cuts at semicolons outside strings and comments, keeping lines and offsets', () => {
    const script: string = "select ';' as a;\n-- one; two\nselect 2;";
    const spans: readonly StatementSpan[] = statementSpans(script);
    expect(spans.map((span) => span.text)).toEqual(["select ';' as a", 'select 2']);
    expect(spans.map((span) => span.line)).toEqual([1, 3]);
    expect(spans[0].end).toBe(script.indexOf(';\n') + 1);
  });

  it('keeps a trigger body in one statement', () => {
    const script: string =
      'create trigger t after insert on a begin select 1; select 2; end; select 3';
    expect(statementSpans(script)).toHaveLength(2);
  });

  it('leaves out what holds only comments', () => {
    expect(statementSpans('select 1;\n-- done\n')).toHaveLength(1);
  });
});

describe('statementAt', () => {
  const script: string = 'select 1;\nselect 2;\n\nselect 3;\n';

  it('finds the statement the caret is in', () => {
    expect(statementAt(script, 3)?.text).toBe('select 1');
    expect(statementAt(script, script.indexOf('select 2') + 2)?.text).toBe('select 2');
  });

  it('falls back on the last statement after the end of the text', () => {
    expect(statementAt(script, script.length)?.text).toBe('select 3');
  });

  it('finds nothing in empty text', () => {
    expect(statementAt('  ', 1)).toBeUndefined();
  });
});

describe('destructiveStatements', () => {
  it.each([
    ['drop table a'],
    ['TRUNCATE a'],
    ['delete from a'],
    ['update a set b = 1'],
    ['with x as (select 1) delete from a'],
  ])('flags %s', (sql: string): void => {
    expect(destructiveStatements(sql, 'sql')).toEqual([sql]);
  });

  it.each([
    ['delete from a where id = 1'],
    ['update a set b = 1 where id = 2'],
    ['select * from a'],
    ["select 'drop table a'"],
    ['-- drop table a\nselect 1'],
    ['create table dropped (a int)'],
  ])('leaves %s alone', (sql: string): void => {
    expect(destructiveStatements(sql, 'sql')).toEqual([]);
  });

  it('is not fooled by a WHERE in a string', () => {
    expect(destructiveStatements("update a set b = 'where'", 'sql')).toHaveLength(1);
  });

  it('flags a Cypher DELETE without a WHERE, and a DROP', () => {
    expect(destructiveStatements('MATCH (n) DETACH DELETE n', 'cypher')).toHaveLength(1);
    expect(destructiveStatements('DROP INDEX a', 'cypher')).toHaveLength(1);
    expect(destructiveStatements('MATCH (n) WHERE n.a = 1 DELETE n', 'cypher')).toEqual([]);
  });
});
