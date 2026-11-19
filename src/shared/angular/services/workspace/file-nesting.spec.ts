import {
  DEFAULT_FILE_NESTING_RULES,
  FileNesting,
  FileNestingRule,
  fileNestingRules,
  nestedRename,
  nestFiles,
} from './file-nesting';

describe('nestFiles', () => {
  /**
   * Nests names by rules, and describes the result as `parent: child, child` lines.
   * @param names The folder's file names.
   * @param rules The rules; the defaults when omitted.
   * @returns Returns one line per parent, in the order the names were given.
   */
  function nest(
    names: readonly string[],
    rules: readonly FileNestingRule[] = DEFAULT_FILE_NESTING_RULES,
  ): readonly string[] {
    const nesting: FileNesting<string> = nestFiles<string>(
      names,
      (name: string): string => name,
      rules,
    );
    return names
      .filter((name: string): boolean => nesting.children.has(name))
      .map((name: string): string => `${name}: ${(nesting.children.get(name) ?? []).join(', ')}`);
  }

  it('gathersAPartialClassUnderItsOwnFile', () => {
    expect(
      nest([
        'Enumeration.Comparable.cs',
        'Enumeration.cs',
        'Enumeration.Equatable.cs',
        'Enumeration.From.cs',
      ]),
    ).toEqual([
      'Enumeration.cs: Enumeration.Comparable.cs, Enumeration.Equatable.cs, Enumeration.From.cs',
    ]);
  });

  it('leavesFilesWithNoParentWhereTheyAre', () => {
    expect(nest(['Extensions.Array.cs', 'Extensions.DateTime.cs', 'Extensions.String.cs'])).toEqual(
      [],
    );
  });

  it('gathersACodeBehindUnderItsWindow', () => {
    expect(nest(['MainWindow.CodeBehind.cs', 'MainWindow.cs', 'Program.cs'])).toEqual([
      'MainWindow.cs: MainWindow.CodeBehind.cs',
    ]);
  });

  it('nestsOneLevelDeep_underTheShortestParent', () => {
    expect(nest(['A.B.C.cs', 'A.B.cs', 'A.cs'])).toEqual(['A.cs: A.B.C.cs, A.B.cs']);
  });

  it('letsALongerParentGather_whenTheShorterIsMissing', () => {
    expect(nest(['A.B.C.cs', 'A.B.cs'])).toEqual(['A.B.cs: A.B.C.cs']);
  });

  it('doesNotGatherAFileWithASimilarButDifferentName', () => {
    expect(nest(['Enum.cs', 'Enumeration.cs', 'Enumerations.cs'])).toEqual([]);
  });

  it('gathersARazorComponentsFiles_ratherThanLettingItsCodeBecomeAParent', () => {
    expect(nest(['Counter.razor', 'Counter.razor.cs', 'Counter.razor.css'])).toEqual([
      'Counter.razor: Counter.razor.cs, Counter.razor.css',
    ]);
  });

  it('matchesWithoutRegardToCase', () => {
    expect(nest(['form.cs', 'Form.Designer.cs'])).toEqual(['form.cs: Form.Designer.cs']);
  });

  it('readsBasenameAndExtname', () => {
    const rules: readonly FileNestingRule[] = [
      { parent: '*.ts', children: '${basename}.spec.${extname}' },
    ];

    expect(nest(['app.spec.ts', 'app.ts'], rules)).toEqual(['app.ts: app.spec.ts']);
  });

  it('nestsByFixedNames', () => {
    const rules: readonly FileNestingRule[] = [
      { parent: 'package.json', children: 'package-lock.json, .npmrc' },
    ];

    expect(nest(['.npmrc', 'package-lock.json', 'package.json', 'tsconfig.json'], rules)).toEqual([
      'package.json: .npmrc, package-lock.json',
    ]);
  });

  it('treatsACapturedWildcardAsLiteralText', () => {
    const rules: readonly FileNestingRule[] = [{ parent: '*.txt', children: '${capture}.md' }];

    expect(nest(['a*.txt', 'a*.md', 'ab.md'], rules)).toEqual(['a*.txt: a*.md']);
  });

  it('nestsNothingWithoutRules', () => {
    expect(nest(['Enumeration.cs', 'Enumeration.From.cs'], [])).toEqual([]);
  });

  it('marksTheGatheredFilesAsNested', () => {
    const nesting: FileNesting<string> = nestFiles<string>(
      ['A.cs', 'A.B.cs', 'C.cs'],
      (name: string): string => name,
      DEFAULT_FILE_NESTING_RULES,
    );

    expect([...nesting.nested]).toEqual(['A.B.cs']);
  });
});

describe('nestedRename', () => {
  it('keepsTheChildsOwnPartOfTheName', () => {
    expect(nestedRename('Enumeration.Comparable.cs', 'Enumeration.cs', 'Ordinal.cs')).toBe(
      'Ordinal.Comparable.cs',
    );
  });

  it('renamesARazorComponentsCode', () => {
    expect(nestedRename('Counter.razor.cs', 'Counter.razor', 'Clicker.razor')).toBe(
      'Clicker.razor.cs',
    );
  });

  it('leavesAChildThatDoesNotShareTheName', () => {
    expect(nestedRename('.npmrc', 'package.json', 'manifest.json')).toBe('.npmrc');
  });

  it('leavesAChildWhoseNameOnlyStartsTheSame', () => {
    expect(nestedRename('Enumerations.cs', 'Enumeration.cs', 'Ordinal.cs')).toBe('Enumerations.cs');
  });
});

describe('fileNestingRules', () => {
  it('keepsOnlyWellFormedRules', () => {
    expect(
      fileNestingRules([
        { parent: '*.cs', children: '${capture}.*.cs' },
        { parent: '', children: 'x' },
        { parent: '*.ts' },
        'nonsense',
        null,
      ]),
    ).toEqual([{ parent: '*.cs', children: '${capture}.*.cs' }]);
  });

  it('readsAnythingButAListAsNoRules', () => {
    expect(fileNestingRules('*.cs')).toEqual([]);
  });
});
