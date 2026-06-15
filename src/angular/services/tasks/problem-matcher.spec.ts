import { COMPILER_MATCHER, GCC_MATCHER, MatchedProblem, parseProblems } from './problem-matcher';

describe('problem-matcher', () => {
  it('compiler_parsesTypeScriptDiagnostics', () => {
    const problem: MatchedProblem | null = COMPILER_MATCHER.match(
      "src/main.ts(12,5): error TS2304: Cannot find name 'foo'.",
    );

    expect(problem).toEqual({
      file: 'src/main.ts',
      line: 12,
      column: 5,
      severity: 'error',
      message: "Cannot find name 'foo'.",
      source: 'typescript',
      code: 'TS2304',
    });
  });

  it('compiler_parsesMsbuildDiagnosticsAndDropsTheProjectAnnotation', () => {
    const problem: MatchedProblem | null = COMPILER_MATCHER.match(
      'Program.cs(8,9): warning CS0168: The variable is declared but never used [/repo/App.csproj]',
    );

    expect(problem?.file).toBe('Program.cs');
    expect(problem?.severity).toBe('warning');
    expect(problem?.source).toBe('csharp');
    expect(problem?.message).toBe('The variable is declared but never used');
  });

  it('gcc_parsesClangStyleDiagnostics', () => {
    const problem: MatchedProblem | null = GCC_MATCHER.match(
      "main.c:3:7: error: use of undeclared identifier 'x'",
    );

    expect(problem).toEqual({
      file: 'main.c',
      line: 3,
      column: 7,
      severity: 'error',
      message: "use of undeclared identifier 'x'",
      source: 'gcc',
    });
  });

  it('gcc_mapsNotesToInfo', () => {
    expect(GCC_MATCHER.match('main.c:3:7: note: expanded from macro')?.severity).toBe('info');
  });

  it('parseProblems_stripsAnsiDeduplicatesAndIgnoresNonMatchingLines', () => {
    const esc: string = String.fromCharCode(27);
    const text: string = [
      'Building...',
      `${esc}[31msrc/a.ts(1,1): error TS1005: ';' expected.${esc}[0m`,
      "src/a.ts(1,1): error TS1005: ';' expected.",
      'Done.',
    ].join('\n');

    const problems: MatchedProblem[] = parseProblems(text);

    expect(problems).toHaveLength(1);
    expect(problems[0].file).toBe('src/a.ts');
    expect(problems[0].code).toBe('TS1005');
  });
});
