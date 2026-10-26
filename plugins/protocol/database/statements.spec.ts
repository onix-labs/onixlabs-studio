import { describe, expect, it } from 'vitest';
import { ScriptStatement, splitStatements } from './statements';

describe('splitStatements', (): void => {
  it('splitsAtSemicolonsAndNumbersEachStatementByItsFirstLine', (): void => {
    const statements: readonly ScriptStatement[] = splitStatements(
      'select 1;\n\nselect 2;\nselect 3',
    );
    expect(statements).toEqual([
      { text: 'select 1', line: 1 },
      { text: 'select 2', line: 3 },
      { text: 'select 3', line: 4 },
    ]);
  });

  it('numbersInTheDocumentsTermsWhenGivenTheFirstLine', (): void => {
    // A selection starting on line 10 reports its statements on lines 10 and 11, not 1 and 2.
    expect(
      splitStatements('select 1;\nselect 2;', 10).map((s: ScriptStatement): number => s.line),
    ).toEqual([10, 11]);
  });

  it('ignoresSemicolonsInsideQuotesIdentifiersAndComments', (): void => {
    const statements: readonly ScriptStatement[] = splitStatements(
      `select 'a;b', "c;d", [e;f], \`g;h\`; -- i;j\nselect 2 /* k;l */;`,
    );
    expect(statements.map((s: ScriptStatement): string => s.text)).toEqual([
      `select 'a;b', "c;d", [e;f], \`g;h\``,
      '-- i;j\nselect 2 /* k;l */',
    ]);
  });

  it('skipsLeadingCommentsWhenNumberingAStatement', (): void => {
    // An error in the statement belongs on the statement's line, not on the comment above it.
    expect(splitStatements('select 1;\n-- seed\n/* more */\nselect 2;')[1]?.line).toBe(4);
  });

  it('keepsDollarQuotedBodiesWhole', (): void => {
    const body: string =
      'create function f() returns int as $$ begin return 1; end; $$ language plpgsql';
    expect(
      splitStatements(`${body};\nselect f();`).map((s: ScriptStatement): string => s.text),
    ).toEqual([body, 'select f()']);
  });

  it('keepsATriggerBodyWhole', (): void => {
    const trigger: string = 'CREATE TRIGGER t AFTER INSERT ON x BEGIN select 1; select 2; END';
    expect(
      splitStatements(`${trigger};\nselect 3;`).map((s: ScriptStatement): string => s.text),
    ).toEqual([trigger, 'select 3']);
  });

  it('treatsDoubleSlashAsACommentOnlyWhenAsked', (): void => {
    // Cypher comments with `//`; SQL does not, so a SQL `//` is left for the database to judge.
    expect(splitStatements('// a;\nMATCH (n) RETURN n;', 1, true)).toEqual([
      { text: '// a;\nMATCH (n) RETURN n', line: 2 },
    ]);
    expect(splitStatements('// a;\nselect 1;')).toHaveLength(2);
  });

  it('dropsEmptyAndCommentOnlyStatements', (): void => {
    expect(splitStatements(';;\n-- nothing here\n')).toEqual([]);
  });
});
