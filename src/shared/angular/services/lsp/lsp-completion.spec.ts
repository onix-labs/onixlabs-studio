import type * as MonacoApi from 'monaco-editor';
import {
  completionAnswer,
  completionContext,
  completionKind,
  completionSupportOf,
  LspCompletionAnswer,
  LspCompletionItem,
  resolvedParts,
  signatureHelpSupportOf,
  toCompletionItem,
  toLspSignatureHelp,
  toSignatureHelp,
} from './lsp-completion';

/**
 * A Monaco namespace with only the enumerations the mapping reads, numbered as Monaco numbers them.
 */
const MONACO: typeof MonacoApi = {
  languages: {
    CompletionItemKind: {
      Method: 0,
      Function: 1,
      Constructor: 2,
      Field: 3,
      Variable: 4,
      Class: 5,
      Struct: 6,
      Interface: 7,
      Module: 8,
      Property: 9,
      Event: 10,
      Operator: 11,
      Unit: 12,
      Value: 13,
      Constant: 14,
      Enum: 15,
      EnumMember: 16,
      Keyword: 17,
      Text: 18,
      Color: 19,
      File: 20,
      Reference: 21,
      Folder: 23,
      TypeParameter: 24,
      Snippet: 28,
    },
    CompletionItemInsertTextRule: { KeepWhitespace: 1, InsertAsSnippet: 4 },
  },
} as unknown as typeof MonacoApi;

/**
 * The span the word typed so far covers, which a completion with no edit replaces.
 */
const WORD: MonacoApi.IRange = {
  startLineNumber: 3,
  startColumn: 5,
  endLineNumber: 3,
  endColumn: 8,
};

/**
 * Maps a completion with no command mapping.
 * @param item The server's completion.
 * @returns Returns Monaco's.
 */
function map(item: LspCompletionItem): MonacoApi.languages.CompletionItem {
  return toCompletionItem(MONACO, item, WORD, (): undefined => undefined);
}

/**
 * A protocol range on line 2 (zero-based), between two characters.
 * @param start The start character.
 * @param end The end character.
 * @returns Returns the range.
 */
function range(
  start: number,
  end: number,
): { start: { line: number; character: number }; end: { line: number; character: number } } {
  return { start: { line: 2, character: start }, end: { line: 2, character: end } };
}

describe('lsp completion mapping (#1021)', () => {
  it('readsHowAServerCompletes', () => {
    expect(
      completionSupportOf({
        completionProvider: { triggerCharacters: ['.', 7, ''], resolveProvider: true },
      }),
    ).toEqual({ triggerCharacters: ['.'], resolve: true });
    expect(completionSupportOf({ completionProvider: {} })).toEqual({
      triggerCharacters: [],
      resolve: false,
    });
    expect(completionSupportOf({})).toBeNull();
  });

  it('readsHowAServerAnswersSignatureHelp', () => {
    expect(
      signatureHelpSupportOf({
        signatureHelpProvider: { triggerCharacters: ['(', ','], retriggerCharacters: [')'] },
      }),
    ).toEqual({ triggerCharacters: ['(', ','], retriggerCharacters: [')'] });
    expect(signatureHelpSupportOf(undefined)).toBeNull();
  });

  it('mapsALabelsDetails_kind_tags_preselect_andDocumentation', () => {
    const mapped: MonacoApi.languages.CompletionItem = map({
      label: 'push',
      labelDetails: { detail: '(...items: T[])', description: 'Array<T>' },
      kind: 2,
      tags: [1],
      preselect: true,
      detail: 'method',
      documentation: { kind: 'markdown', value: 'Adds **items**.' },
      sortText: '0001',
      filterText: 'push',
    });

    expect(mapped.label).toEqual({
      label: 'push',
      detail: '(...items: T[])',
      description: 'Array<T>',
    });
    expect(mapped.kind).toBe(0);
    expect(mapped.tags).toEqual([1]);
    expect(mapped.preselect).toBe(true);
    expect(mapped.documentation).toEqual({ value: 'Adds **items**.' });
    expect(mapped.sortText).toBe('0001');
    expect(mapped.filterText).toBe('push');
    expect(mapped.range).toEqual(WORD);
    expect(mapped.insertText).toBe('push');
  });

  it('takesTheOlderDeprecatedFlag_asTheTag_andPlainDocumentationAsText', () => {
    const mapped: MonacoApi.languages.CompletionItem = map({
      label: 'old',
      deprecated: true,
      documentation: { kind: 'plaintext', value: 'Old *thing*' },
    });

    expect(mapped.tags).toEqual([1]);
    expect(mapped.documentation).toBe('Old *thing*');
  });

  it('insertsASnippetWithTabStops_keepingItsWhitespaceWhenAsked', () => {
    const mapped: MonacoApi.languages.CompletionItem = map({
      label: 'for',
      insertText: 'for (${1:i}) {\n\t$0\n}',
      insertTextFormat: 2,
      insertTextMode: 1,
    });

    expect(mapped.insertText).toBe('for (${1:i}) {\n\t$0\n}');
    expect(mapped.insertTextRules).toBe(4 | 1);
  });

  it('mapsAnInsertReplaceEdit_toAnInsertAndAReplaceSpan', () => {
    const mapped: MonacoApi.languages.CompletionItem = map({
      label: 'toString',
      textEdit: { newText: 'toString', insert: range(4, 6), replace: range(4, 10) },
    });

    expect(mapped.range).toEqual({
      insert: { startLineNumber: 3, startColumn: 5, endLineNumber: 3, endColumn: 7 },
      replace: { startLineNumber: 3, startColumn: 5, endLineNumber: 3, endColumn: 11 },
    });
  });

  it('mapsExtraEdits_commitCharacters_andTheCommand', () => {
    const mapped: MonacoApi.languages.CompletionItem = toCompletionItem(
      MONACO,
      {
        label: 'List',
        additionalTextEdits: [{ range: range(0, 0), newText: 'import List;\n' }],
        commitCharacters: ['.', '('],
        command: { command: 'x' },
      },
      WORD,
      (raw: unknown): MonacoApi.languages.Command => ({
        id: (raw as { command: string }).command,
        title: '',
      }),
    );

    expect(mapped.additionalTextEdits).toEqual([
      {
        range: { startLineNumber: 3, startColumn: 1, endLineNumber: 3, endColumn: 1 },
        text: 'import List;\n',
      },
    ]);
    expect(mapped.commitCharacters).toEqual(['.', '(']);
    expect(mapped.command).toEqual({ id: 'x', title: '' });
  });

  it('readsAListsItemDefaults_forItemsThatSayNothing', () => {
    const answer: LspCompletionAnswer = completionAnswer({
      isIncomplete: true,
      itemDefaults: {
        commitCharacters: ['.'],
        editRange: { insert: range(1, 3), replace: range(1, 5) },
        insertTextFormat: 2,
        data: { session: 9 },
      },
      items: [
        { label: 'a', textEditText: 'a($1)' },
        { label: 'b', commitCharacters: [';'], insertTextFormat: 1, data: { own: true } },
        { notACompletion: true },
      ],
    });

    expect(answer.incomplete).toBe(true);
    expect(answer.items).toHaveLength(2);
    expect(answer.items[0]).toEqual(
      expect.objectContaining({
        commitCharacters: ['.'],
        insertTextFormat: 2,
        data: { session: 9 },
        textEdit: { newText: 'a($1)', insert: range(1, 3), replace: range(1, 5) },
      }),
    );
    expect(answer.items[1]).toEqual(
      expect.objectContaining({
        commitCharacters: [';'],
        insertTextFormat: 1,
        data: { own: true },
        textEdit: { newText: 'b', insert: range(1, 3), replace: range(1, 5) },
      }),
    );
  });

  it('readsADefaultEditRange_ofOneSpan', () => {
    expect(
      completionAnswer({
        items: [{ label: 'x', insertText: 'xy' }],
        itemDefaults: { editRange: range(0, 2) },
      }).items[0].textEdit,
    ).toEqual({ newText: 'xy', range: range(0, 2) });
  });

  it('readsABareArray_andNothingElse', () => {
    expect(completionAnswer([{ label: 'a' }, 4]).items).toEqual([{ label: 'a' }]);
    expect(completionAnswer(null)).toEqual({ items: [], incomplete: false });
  });

  it('resolvedParts_takesOnlyWhatTheServerFilledIn', () => {
    expect(resolvedParts({ label: 'a', detail: 'd' })).toEqual({ detail: 'd' });
    expect(resolvedParts({ label: 'a', documentation: 'docs', additionalTextEdits: [] })).toEqual({
      documentation: 'docs',
      additionalTextEdits: [],
    });
    expect(resolvedParts(null)).toEqual({});
  });

  it('completionContext_numbersTheTriggerAsTheProtocolDoes', () => {
    expect(completionContext(undefined)).toEqual({ triggerKind: 1 });
    expect(completionContext({ triggerKind: 1, triggerCharacter: '.' })).toEqual({
      triggerKind: 2,
      triggerCharacter: '.',
    });
    expect(completionContext({ triggerKind: 2 })).toEqual({ triggerKind: 3 });
  });

  it('completionKind_mapsEveryProtocolKind_andFallsBackToText', () => {
    expect(completionKind(MONACO, 7)).toBe(5);
    expect(completionKind(MONACO, 15)).toBe(28);
    expect(completionKind(MONACO, 25)).toBe(24);
    expect(completionKind(MONACO, undefined)).toBe(18);
    expect(completionKind(MONACO, 99)).toBe(18);
  });

  it('toSignatureHelp_dropsMalformedSignatures_andClampsTheActiveOne', () => {
    expect(
      toSignatureHelp({
        signatures: [{ label: 'f(a)', parameters: [{ label: 'a' }, { label: 3 }] }, { nope: 1 }],
        activeSignature: 4,
      }),
    ).toEqual({
      signatures: [
        {
          label: 'f(a)',
          documentation: undefined,
          parameters: [{ label: 'a', documentation: undefined }],
        },
      ],
      activeSignature: 0,
      activeParameter: 0,
    });
    expect(toSignatureHelp({ signatures: [] })).toBeNull();
    expect(toSignatureHelp(null)).toBeNull();
  });

  it('toLspSignatureHelp_mapsTheSignaturesShowingBack', () => {
    expect(
      toLspSignatureHelp({
        signatures: [
          {
            label: 'f(a)',
            documentation: { value: '**f**' },
            parameters: [{ label: [2, 3], documentation: 'a' }],
            activeParameter: 0,
          },
        ],
        activeSignature: 0,
        activeParameter: 0,
      }),
    ).toEqual({
      signatures: [
        {
          label: 'f(a)',
          documentation: { kind: 'markdown', value: '**f**' },
          parameters: [{ label: [2, 3], documentation: 'a' }],
          activeParameter: 0,
        },
      ],
      activeSignature: 0,
      activeParameter: 0,
    });
  });
});
