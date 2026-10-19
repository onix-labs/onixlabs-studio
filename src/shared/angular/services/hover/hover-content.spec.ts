import type * as MonacoApi from 'monaco-editor';
import {
  escapeRawHtml,
  hasContent,
  HoverProblem,
  hoverSections,
  MARKER_SEVERITY,
  prepareMarkdown,
  problemDetail,
  problemFrom,
  problemsAt,
} from './hover-content';

/**
 * Builds a problem of the model under test.
 * @param line The line it is on.
 * @param start Its first column.
 * @param end The column after its last.
 * @param severity Its severity.
 * @param extra Anything else it says.
 * @returns Returns the problem.
 */
function marker(
  line: number,
  start: number,
  end: number,
  severity: number = MARKER_SEVERITY.error,
  extra: Partial<MonacoApi.editor.IMarker> = {},
): MonacoApi.editor.IMarker {
  return {
    owner: 'test',
    resource: {} as MonacoApi.Uri,
    message: `problem at ${line}:${start}`,
    severity,
    startLineNumber: line,
    startColumn: start,
    endLineNumber: line,
    endColumn: end,
    ...extra,
  };
}

describe('hover-content (#1020)', () => {
  it('hoverSections_mergesEveryProvidersBlocksInRankOrder_thenDecorations_showingADuplicateOnce', () => {
    expect(
      hoverSections(
        [
          {
            contents: [{ value: '```ts\nconst x: number\n```' }, { value: 'Docs.' }],
            range: null,
            studio: false,
          },
          {
            contents: [{ value: ' ```ts\nconst x: number\n``` ' }, { value: 'More.' }],
            range: null,
            studio: false,
          },
        ],
        [{ value: 'Docs.' }, { value: 'A decoration says.' }, { value: '   ' }],
      ),
    ).toEqual(['```ts\nconst x: number\n```', 'Docs.', 'More.', 'A decoration says.']);
  });

  it('prepareMarkdown_showsRawHtmlAsText_unlessTheStringMayCarryHtml', () => {
    expect(prepareMarkdown({ value: 'Returns List<string>.' })).toBe('Returns List&lt;string>.');
    expect(prepareMarkdown({ value: '<b>bold</b>', supportHtml: true })).toBe('<b>bold</b>');
  });

  it('escapeRawHtml_leavesFencedBlocksInlineCodeAndAutolinksAlone', () => {
    const source: string = [
      'A <T> in prose, `List<T>` in code, ``a ` <b> b`` too, and <https://example.com>.',
      '```ts',
      'const x: Array<number> = [];',
      '```',
      '~~~~',
      '<kbd>~~~ is not a close</kbd>',
      '~~~~',
      'After <br> and an unclosed ` <i>',
    ].join('\n');

    expect(escapeRawHtml(source)).toBe(
      [
        'A &lt;T> in prose, `List<T>` in code, ``a ` <b> b`` too, and <https://example.com>.',
        '```ts',
        'const x: Array<number> = [];',
        '```',
        '~~~~',
        '<kbd>~~~ is not a close</kbd>',
        '~~~~',
        'After &lt;br> and an unclosed ` &lt;i>',
      ].join('\n'),
    );
  });

  it('problemsAt_listsTheProblemsHoldingThePosition_endsIncluded_mostSevereFirst', () => {
    const problems: readonly HoverProblem[] = problemsAt(
      [
        marker(1, 5, 9, MARKER_SEVERITY.warning, { source: 'ts', code: '6133' }),
        marker(1, 1, 5, MARKER_SEVERITY.error, {
          code: { value: 'CS0103', target: {} as MonacoApi.Uri },
        }),
        marker(2, 1, 3),
        marker(1, 6, 9, MARKER_SEVERITY.info, { source: '' }),
      ],
      { lineNumber: 1, column: 5 },
    );

    expect(problems).toEqual([
      {
        message: 'problem at 1:1',
        severity: MARKER_SEVERITY.error,
        source: null,
        code: 'CS0103',
        range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 5 },
      },
      {
        message: 'problem at 1:5',
        severity: MARKER_SEVERITY.warning,
        source: 'ts',
        code: '6133',
        range: { startLineNumber: 1, startColumn: 5, endLineNumber: 1, endColumn: 9 },
      },
    ]);
    expect(problems.map(problemDetail)).toEqual(['CS0103', 'ts(6133)']);
    expect(problemDetail({ ...problems[1], code: null })).toBe('ts');
    expect(problemDetail({ ...problems[0], code: null })).toBeNull();
  });

  it('problemFrom_goesToTheNextOrPreviousProblem_wrappingRound_andPassingOverHints', () => {
    const markers: readonly MonacoApi.editor.IMarker[] = [
      marker(5, 2, 4),
      marker(2, 3, 6, MARKER_SEVERITY.warning),
      marker(3, 1, 2, MARKER_SEVERITY.hint),
      marker(8, 1, 9, MARKER_SEVERITY.info),
    ];
    const at: (line: number, column: number) => MonacoApi.IPosition = (
      line: number,
      column: number,
    ): MonacoApi.IPosition => ({ lineNumber: line, column });

    expect(problemFrom(markers, at(1, 1), 'next')?.startLineNumber).toBe(2);
    // From a problem's own start, on to the next.
    expect(problemFrom(markers, at(2, 3), 'next')?.startLineNumber).toBe(5);
    expect(problemFrom(markers, at(9, 1), 'next')?.startLineNumber).toBe(2);
    expect(problemFrom(markers, at(5, 2), 'previous')?.startLineNumber).toBe(2);
    expect(problemFrom(markers, at(1, 1), 'previous')).toEqual({
      startLineNumber: 8,
      startColumn: 1,
      endLineNumber: 8,
      endColumn: 9,
    });
    expect(problemFrom([marker(1, 1, 2, MARKER_SEVERITY.hint)], at(1, 1), 'next')).toBeNull();
  });

  it('hasContent_needsSectionsOrProblems_notJustActions', () => {
    const actions: { definition: boolean; references: boolean; referencesListed: boolean } = {
      definition: true,
      references: true,
      referencesListed: true,
    };

    expect(hasContent({ sections: [], problems: [], quickFix: false, actions })).toBe(false);
    expect(hasContent({ sections: ['x'], problems: [], quickFix: false, actions: null })).toBe(
      true,
    );
  });
});
