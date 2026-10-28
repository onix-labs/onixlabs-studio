import type * as MonacoApi from 'monaco-editor';
import { applyAutoInsert, installAutoInsert, typedCharacter } from './monaco-auto-insert';

/**
 * Builds a content change event.
 * @param text The text the change inserted.
 * @param rangeLength The length of what it replaced.
 * @param flags The event's flags.
 * @returns Returns the event.
 */
function change(
  text: string,
  rangeLength: number = 0,
  flags: Partial<MonacoApi.editor.IModelContentChangedEvent> = {},
): MonacoApi.editor.IModelContentChangedEvent {
  return {
    changes: [{ text, rangeLength } as MonacoApi.editor.IModelContentChange],
    isUndoing: false,
    isRedoing: false,
    isFlush: false,
    ...flags,
  } as MonacoApi.editor.IModelContentChangedEvent;
}

describe('typedCharacter (#1148)', () => {
  it('readsOneCharacterTyped_andEnterWithItsIndentation_asANewline', () => {
    expect(typedCharacter(change('/'))).toBe('/');
    expect(typedCharacter(change('"'))).toBe('"');
    expect(typedCharacter(change('\n    '))).toBe('\n');
    expect(typedCharacter(change('\r\n\t'))).toBe('\n');
  });

  it('readsNothingFromAPasteAReplacementAnUndoOrSeveralChanges', () => {
    expect(typedCharacter(change('///'))).toBeNull();
    expect(typedCharacter(change('/', 3))).toBeNull();
    expect(typedCharacter(change('/', 0, { isUndoing: true }))).toBeNull();
    expect(typedCharacter(change('/', 0, { isFlush: true }))).toBeNull();
    expect(
      typedCharacter({
        ...change('/'),
        changes: [
          { text: '/', rangeLength: 0 } as MonacoApi.editor.IModelContentChange,
          { text: '/', rangeLength: 0 } as MonacoApi.editor.IModelContentChange,
        ],
      }),
    ).toBeNull();
  });
});

describe('installAutoInsert (#1148)', () => {
  it('handsOnWhatIsTypedIntoAFocusedEditor_madeBeforeOrAfter', () => {
    const listeners: Map<string, (event: MonacoApi.editor.IModelContentChangedEvent) => void> =
      new Map<string, (event: MonacoApi.editor.IModelContentChangedEvent) => void>();
    const editor: (id: string, focused: boolean) => MonacoApi.editor.ICodeEditor = (
      id: string,
      focused: boolean,
    ): MonacoApi.editor.ICodeEditor =>
      ({
        hasTextFocus: (): boolean => focused,
        onDidChangeModelContent: (
          listener: (event: MonacoApi.editor.IModelContentChangedEvent) => void,
        ): void => void listeners.set(id, listener),
      }) as unknown as MonacoApi.editor.ICodeEditor;
    let created: (editor: MonacoApi.editor.ICodeEditor) => void = (): void => undefined;
    const before: MonacoApi.editor.ICodeEditor = editor('before', true);
    const monaco: typeof MonacoApi = {
      editor: {
        getEditors: (): MonacoApi.editor.ICodeEditor[] => [before],
        onDidCreateEditor: (listener: (editor: MonacoApi.editor.ICodeEditor) => void): void => {
          created = listener;
        },
      },
    } as unknown as typeof MonacoApi;
    const typed: string[] = [];

    installAutoInsert(monaco, (_editor: MonacoApi.editor.ICodeEditor, ch: string): void => {
      typed.push(ch);
    });
    created(editor('after', true));
    created(editor('unfocused', false));
    listeners.get('before')?.(change('/'));
    listeners.get('after')?.(change('\n  '));
    listeners.get('unfocused')?.(change('/'));
    listeners.get('before')?.(change('pasted'));

    expect(typed).toEqual(['/', '\n']);
  });
});

describe('applyAutoInsert (#1148)', () => {
  const RANGE: MonacoApi.IRange = {
    startLineNumber: 8,
    startColumn: 8,
    endLineNumber: 8,
    endColumn: 8,
  };

  it('insertsASnippetThroughTheSnippetController_asTheServerIndentedIt', () => {
    const calls: unknown[] = [];
    const editor: MonacoApi.editor.ICodeEditor = {
      getContribution: (): unknown => ({
        insert: (template: string, options: unknown): void =>
          void calls.push({ template, options }),
      }),
      setSelection: (range: MonacoApi.IRange): void => void calls.push({ select: range }),
    } as unknown as MonacoApi.editor.ICodeEditor;

    expect(applyAutoInsert(editor, RANGE, ' <summary>\n    /// $0', true)).toBe(true);

    expect(calls).toEqual([
      { select: RANGE },
      {
        template: ' <summary>\n    /// $0',
        options: { undoStopBefore: true, undoStopAfter: true, adjustWhitespace: false },
      },
    ]);
  });

  it('appliesPlainTextAsAnEdit', () => {
    const edits: unknown[] = [];
    const editor: MonacoApi.editor.ICodeEditor = {
      executeEdits: (source: string, operations: unknown[]): boolean => {
        edits.push(source, ...operations);
        return true;
      },
    } as unknown as MonacoApi.editor.ICodeEditor;

    expect(applyAutoInsert(editor, RANGE, '/// ', false)).toBe(true);

    expect(edits).toEqual([
      'studio.autoInsert',
      { range: RANGE, text: '/// ', forceMoveMarkers: true },
    ]);
  });
});
