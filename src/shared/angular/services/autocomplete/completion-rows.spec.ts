import type * as MonacoApi from 'monaco-editor';
import { Icon } from '@shared/angular/icons/icon';
import type { SuggestItem } from '@shared/angular/services/monaco/monaco-suggest-commands';
import {
  canResolve,
  COMPLETION_KIND,
  CompletionRow,
  detailsOf,
  labelRuns,
  rowOf,
} from './completion-rows';

/**
 * Builds a completion as Monaco's suggest model holds it.
 * @param completion The provider's completion.
 * @param extra Members to override.
 * @returns Returns the completion.
 */
function item(
  completion: Partial<MonacoApi.languages.CompletionItem>,
  extra: Partial<SuggestItem> = {},
): SuggestItem {
  const label: string | MonacoApi.languages.CompletionItemLabel = completion.label ?? 'label';
  return {
    completion: { kind: COMPLETION_KIND.Method, insertText: '', ...completion, label } as never,
    textLabel: typeof label === 'string' ? label : label.label,
    score: [0, 0],
    provider: {},
    isResolved: true,
    resolve: (): Promise<void> => Promise.resolve(),
    ...extra,
  };
}

describe('completion rows (#1021)', () => {
  it('rowOf_showsTheKindIcon_theLabel_andTheDetail', () => {
    const row: CompletionRow = rowOf(
      item({ label: 'charAt', kind: COMPLETION_KIND.Method, detail: '(pos: number): string' }),
    );

    expect(row.icon).toBe(Icon.SYMBOL_FUNCTION);
    expect(row.kindName).toBe('method');
    expect(row.label).toBe('charAt');
    expect(row.detail).toBe('(pos: number): string');
    expect(row.labelDetail).toBeNull();
    expect(row.deprecated).toBe(false);
  });

  it('rowOf_preferTheLabelsOwnDetails_overTheCompletionsDetail', () => {
    const row: CompletionRow = rowOf(
      item({
        label: { label: 'push', detail: '(...items)', description: 'Array<T>' },
        detail: 'method push',
      }),
    );

    expect(row.labelDetail).toBe('(...items)');
    expect(row.detail).toBe('Array<T>');
  });

  it('rowOf_leavesOutADetailThatRepeatsTheLabel_andShowsOnlyTheFirstLineOfOne', () => {
    expect(rowOf(item({ label: 'int', detail: 'int' })).detail).toBeNull();
    expect(rowOf(item({ label: 'x', detail: 'first\nsecond' })).detail).toBe('first');
  });

  it('rowOf_strikesADeprecatedCompletion', () => {
    expect(rowOf(item({ tags: [1] })).deprecated).toBe(true);
  });

  it.each([
    [COMPLETION_KIND.Class, Icon.SYMBOL_CLASS],
    [COMPLETION_KIND.Keyword, Icon.SYMBOL_KEYWORD],
    [COMPLETION_KIND.Snippet, Icon.SYMBOL_SNIPPET],
    [COMPLETION_KIND.Text, Icon.SYMBOL_TEXT],
    [COMPLETION_KIND.Folder, Icon.FOLDER],
    [99, Icon.SYMBOL_OTHER],
  ])('rowOf_kind%s_hasItsIcon', (kind: number, icon: Icon) => {
    expect(rowOf(item({ kind })).icon).toBe(icon);
  });

  it('labelRuns_highlightTheMatchedCharacters', () => {
    // Monaco's fuzzy score: rank, word start, then matched positions (highest first).
    expect(labelRuns('toString', [10, 0, 2, 1, 0])).toEqual([
      { text: 'toS', match: true },
      { text: 'tring', match: false },
    ]);
    expect(labelRuns('getValue', [5, 0, 3])).toEqual([
      { text: 'get', match: false },
      { text: 'V', match: true },
      { text: 'alue', match: false },
    ]);
    expect(labelRuns('abc', [0, 0])).toEqual([{ text: 'abc', match: false }]);
  });

  it('detailsOf_showsTheDetailAsCode_andMarkdownDocumentation', () => {
    expect(
      detailsOf(
        item({
          label: 'charAt',
          detail: 'charAt(pos: number)',
          documentation: { value: '**Bold**' },
        }),
        'typescript',
      ),
    ).toEqual({ sections: ['```typescript\ncharAt(pos: number)\n```', '**Bold**'] });
  });

  it('detailsOf_escapesPlainTextDocumentation_andRawHtmlInMarkdown', () => {
    expect(detailsOf(item({ documentation: 'a *b*' }), 'go')?.sections).toEqual(['a \\*b\\*']);
    expect(detailsOf(item({ documentation: { value: 'List<string>' } }), 'go')?.sections).toEqual([
      'List&lt;string>',
    ]);
  });

  it('detailsOf_hasNothing_forABareCompletion', () => {
    expect(detailsOf(item({ label: 'x', detail: 'x' }), 'go')).toBeNull();
  });

  it('canResolve_onlyForAnUnresolvedItemOfAResolvingProvider', () => {
    const resolver: () => void = (): void => undefined;

    expect(
      canResolve(item({}, { provider: { resolveCompletionItem: resolver }, isResolved: false })),
    ).toBe(true);
    expect(
      canResolve(item({}, { provider: { resolveCompletionItem: resolver }, isResolved: true })),
    ).toBe(false);
    expect(canResolve(item({}, { isResolved: false }))).toBe(false);
  });
});
