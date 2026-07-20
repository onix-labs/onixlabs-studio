import type * as MonacoApi from 'monaco-editor';
import { computeFoldingRanges } from './monaco-folding';

/**
 * The stand-in fold kinds the fake Monaco returns, compared by reference in the assertions.
 */
const REGION_KIND: MonacoApi.languages.FoldingRangeKind = { value: 'region' };
const COMMENT_KIND: MonacoApi.languages.FoldingRangeKind = { value: 'comment' };

/**
 * A single line's tokens for the fake tokenizer.
 */
type LineTokens = { offset: number; type: string }[];

/**
 * Builds a minimal fake text model over the given lines, implementing only the methods the folding
 * computation reads.
 * @param lines The document lines.
 * @returns Returns the fake model.
 */
function fakeModel(lines: readonly string[]): MonacoApi.editor.ITextModel {
  return {
    getLineCount: (): number => lines.length,
    getValue: (): string => lines.join('\n'),
    getLanguageId: (): string => 'csharp',
    getLineContent: (line: number): string => lines[line - 1],
    getLineFirstNonWhitespaceColumn: (line: number): number => {
      const match: RegExpExecArray | null = /\S/.exec(lines[line - 1]);
      return match === null ? 0 : match.index + 1;
    },
  } as unknown as MonacoApi.editor.ITextModel;
}

/**
 * Builds a minimal fake Monaco namespace whose tokenizer returns the given per-line tokens.
 * @param tokens The per-line tokens.
 * @returns Returns the fake namespace.
 */
function fakeMonaco(tokens: readonly LineTokens[]): typeof MonacoApi {
  return {
    editor: { tokenize: (): readonly LineTokens[] => tokens },
    languages: { FoldingRangeKind: { Region: REGION_KIND, Comment: COMMENT_KIND } },
  } as unknown as typeof MonacoApi;
}

/**
 * The default tokenizer: a line that reads as a comment gets a comment token, everything else a source
 * token — enough for the brace/comment classification the folding computation relies on.
 * @param lines The document lines.
 * @returns Returns the per-line tokens.
 */
function defaultTokens(lines: readonly string[]): LineTokens[] {
  return lines.map(
    (line: string): LineTokens => [
      { offset: 0, type: /^\s*(?:\/\/|\/\*|\*)/.test(line) ? 'comment.cs' : 'source.cs' },
    ],
  );
}

/**
 * Runs the folding computation over the given lines.
 * @param lines The document lines.
 * @param tokens The per-line tokens, defaulting to {@link defaultTokens}.
 * @returns Returns the computed folding ranges.
 */
function fold(
  lines: readonly string[],
  tokens: readonly LineTokens[] = defaultTokens(lines),
): MonacoApi.languages.FoldingRange[] {
  return computeFoldingRanges(fakeMonaco(tokens), fakeModel(lines));
}

describe('computeFoldingRanges', () => {
  it('foldsAnAllmanBraceBlockFromItsSignatureLine', () => {
    expect(fold(['class Program', '{', '    int x;', '}'])).toEqual([{ start: 1, end: 4 }]);
  });

  it('foldsAKAndRBraceBlockFromTheBraceLine', () => {
    expect(fold(['void f() {', '    x();', '}'])).toEqual([{ start: 1, end: 3 }]);
  });

  it('skipsBlankLinesWhenFindingAnAllmanSignature', () => {
    expect(fold(['class Program', '', '{', '    int x;', '}'])).toEqual([{ start: 1, end: 5 }]);
  });

  it('foldsNestedBraceBlocksIndependently', () => {
    const ranges: MonacoApi.languages.FoldingRange[] = fold([
      'class C',
      '{',
      '    void M()',
      '    {',
      '        x();',
      '    }',
      '}',
    ]);
    expect(ranges).toEqual([
      { start: 3, end: 6 },
      { start: 1, end: 7 },
    ]);
  });

  it('doesNotFoldASingleLineBraceBlock', () => {
    expect(fold(['void f() { return; }'])).toEqual([]);
  });

  it('ignoresBracesInsideStrings', () => {
    // `var s = "{";` — the `{` at index 9 falls inside the string token, so it is not a block brace.
    const tokens: LineTokens[] = [
      [
        { offset: 0, type: 'source.cs' },
        { offset: 8, type: 'string.cs' },
        { offset: 11, type: 'source.cs' },
      ],
    ];
    expect(fold(['var s = "{";'], tokens)).toEqual([]);
  });

  it('foldsARegionFromItsMarkerToItsEndMarker', () => {
    expect(fold(['#region Helpers', 'int x;', '#endregion'])).toEqual([
      { start: 1, end: 3, kind: REGION_KIND },
    ]);
  });

  it('foldsARunOfConsecutiveCommentLines', () => {
    expect(fold(['// a', '// b', '// c', 'code'])).toEqual([
      { start: 1, end: 3, kind: COMMENT_KIND },
    ]);
  });

  it('doesNotFoldASingleCommentLine', () => {
    expect(fold(['// a', 'code'])).toEqual([]);
  });

  it('keepsRegionMarkersOutOfCommentRuns', () => {
    // `//region` / `//endregion` are region folds, not part of a comment run, so the lone `// b`
    // between them is too short to fold on its own.
    expect(fold(['//region A', '// b', '//endregion'])).toEqual([
      { start: 1, end: 3, kind: REGION_KIND },
    ]);
  });
});
