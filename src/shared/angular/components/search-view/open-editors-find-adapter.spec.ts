import { describe, expect, it } from 'vitest';
import { FindQuery, FindResultItem } from '@shared/angular/components/find-panel/find-adapter';
import { FindScope } from '@shared/angular/components/find-panel/find-request';
import { ReplaceResponse } from '@shared/api/search-channels';
import { EditorSearchTarget, OpenEditorsFindAdapter } from './open-editors-find-adapter';
import { FakeCodeEditor, FakeTextModel } from './testing/fake-text-model';

/**
 * Builds a plain query for the given text.
 * @param text The text.
 * @param overrides Any option to change.
 * @returns Returns the query.
 */
function query(text: string, overrides: Partial<FindQuery> = {}): FindQuery {
  return { text, caseSensitive: false, wholeWord: false, regexp: false, ...overrides };
}

/**
 * Builds a target over a fake model, shown in a fake editor.
 * @param model The model.
 * @param label The file's label.
 * @param extra Any field to add.
 * @returns Returns the target and its editor.
 */
function target(
  model: FakeTextModel,
  label: string,
  extra: Partial<EditorSearchTarget> = {},
): { readonly target: EditorSearchTarget; readonly editor: FakeCodeEditor } {
  const editor: FakeCodeEditor = new FakeCodeEditor(model);
  return {
    editor,
    target: {
      model: model.asModel(),
      editor: () => editor.asEditor(),
      path: `/ws/${label}`,
      label,
      ...extra,
    },
  };
}

/**
 * Lets a reveal's awaited activation settle.
 * @returns Returns a promise that resolves on the next turn.
 */
function settle(): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 0);
  });
}

describe('OpenEditorsFindAdapter (#1007)', () => {
  it('setQuery_findsInEveryOpenEditor_includingUnsavedText_labelledByFile', () => {
    const a: FakeTextModel = new FakeTextModel(['const todo = 1;']);
    const b: FakeTextModel = new FakeTextModel(['// todo later', 'todo()']);
    // Unsaved text is the point: the model holds what the editor shows, not what is on disk.
    b.type(['// todo later', 'todo()', 'todo again']);
    const adapter: OpenEditorsFindAdapter = new OpenEditorsFindAdapter(() => [
      target(a, 'a.ts').target,
      target(b, 'b.ts').target,
    ]);

    adapter.setQuery(query('todo'));

    expect(
      adapter.matches().map((item: FindResultItem): string => `${item.file}:${item.line}`),
    ).toEqual(['a.ts:1', 'b.ts:1', 'b.ts:2', 'b.ts:3']);
    expect(adapter.matches()[0]).toEqual(
      expect.objectContaining({ before: 'const ', text: 'todo', after: ' = 1;', column: 7 }),
    );
    expect(a.highlights()).toHaveLength(1);
    expect(b.highlights()).toHaveLength(3);
  });

  it('setQuery_withASelectionRange_findsOnlyWithinIt', () => {
    const model: FakeTextModel = new FakeTextModel(['todo', 'todo todo', 'todo']);
    const adapter: OpenEditorsFindAdapter = new OpenEditorsFindAdapter(() => [
      target(model, 'a.ts', {
        range: { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 5 },
      }).target,
    ]);

    adapter.setQuery(query('todo'));

    expect(
      adapter.matches().map((item: FindResultItem): number[] => [item.line, item.column]),
    ).toEqual([[2, 1]]);
  });

  it('select_bringsTheEditorForward_thenSelectsCentresAndFocusesTheMatch', async () => {
    const model: FakeTextModel = new FakeTextModel(['x todo']);
    const activated: string[] = [];
    const { target: entry, editor } = target(model, 'a.ts', {
      activate: (): void => void activated.push('a.ts'),
    });
    const adapter: OpenEditorsFindAdapter = new OpenEditorsFindAdapter(() => [entry]);
    adapter.setQuery(query('todo'));

    adapter.select(0);
    await settle();

    expect(activated).toEqual(['a.ts']);
    expect(editor.selection).toEqual({
      startLineNumber: 1,
      startColumn: 3,
      endLineNumber: 1,
      endColumn: 7,
    });
    expect(editor.revealed).toEqual(editor.selection);
    // The click that chose the match left focus in the results: without taking it back, the editor
    // draws no caret and only a faint selection, and the jump looked like nothing at all.
    expect(editor.focused).toBe(true);
  });

  it('select_whenTheEditorNoLongerShowsTheModel_movesNothing', async () => {
    const model: FakeTextModel = new FakeTextModel(['x todo']);
    const other: FakeCodeEditor = new FakeCodeEditor(new FakeTextModel(['elsewhere']));
    const { target: entry } = target(model, 'a.ts', { editor: () => other.asEditor() });
    const adapter: OpenEditorsFindAdapter = new OpenEditorsFindAdapter(() => [entry]);
    adapter.setQuery(query('todo'));

    adapter.select(0);
    await settle();

    expect(other.selection).toBeNull();
    expect(other.focused).toBe(false);
  });

  it('setScope_resolvesTheTargetsForTheChosenScope_andClearsWhatTheLastOneFound', () => {
    const model: FakeTextModel = new FakeTextModel(['todo']);
    const asked: string[] = [];
    const adapter: OpenEditorsFindAdapter = new OpenEditorsFindAdapter(
      (scope: FindScope): readonly EditorSearchTarget[] => {
        asked.push(scope);
        return [target(model, 'a.ts').target];
      },
    );
    adapter.setQuery(query('todo'));
    expect(adapter.matches()).toHaveLength(1);

    adapter.setScope('selection');

    expect(adapter.scope()).toBe('selection');
    expect(adapter.matches()).toEqual([]);
    expect(model.highlights()).toEqual([]);
    adapter.setQuery(query('todo'));
    expect(asked).toEqual(['file', 'selection']);
  });

  it('replaceMatch_editsTheModel_undoably_andMovesOnToTheNextMatch', () => {
    const model: FakeTextModel = new FakeTextModel(['todo one', 'todo two']);
    const adapter: OpenEditorsFindAdapter = new OpenEditorsFindAdapter(() => [
      target(model, 'a.ts').target,
    ]);
    adapter.setQuery(query('todo'));
    adapter.select(0);

    const response: ReplaceResponse | null = adapter.replaceMatch('done');

    expect(response).toEqual({ replaced: 1, files: 1, failed: [] });
    expect(model.text()).toBe('done one\ntodo two');
    expect(adapter.matches()).toHaveLength(1);
    expect(adapter.activeIndex()).toBe(0);
    // On the model's own undo stack: the editor's ⌘Z takes it back, and so does the adapter's undo.
    expect(model.canUndo()).toBe(true);
    expect(adapter.canUndo()).toBe(true);

    adapter.undo();

    expect(model.text()).toBe('todo one\ntodo two');
    expect(adapter.matches()).toHaveLength(2);
    expect(adapter.canUndo()).toBe(false);
  });

  it('replaceEvery_editsEveryEditableModel_asOneUndoableStep', () => {
    const a: FakeTextModel = new FakeTextModel(['todo todo']);
    const b: FakeTextModel = new FakeTextModel(['todo']);
    const adapter: OpenEditorsFindAdapter = new OpenEditorsFindAdapter(() => [
      target(a, 'a.ts').target,
      target(b, 'b.ts').target,
    ]);
    adapter.setQuery(query('todo'));

    const response: ReplaceResponse | null = adapter.replaceEvery('done');

    expect(response).toEqual({ replaced: 3, files: 2, failed: [] });
    expect(a.text()).toBe('done done');
    expect(b.text()).toBe('done');
    expect(adapter.matches()).toEqual([]);

    adapter.undo();

    expect(a.text()).toBe('todo todo');
    expect(b.text()).toBe('todo');
  });

  it('replace_inAReadOnlyDiff_isRefused_andReplaceAllPassesItOver', () => {
    const diff: FakeTextModel = new FakeTextModel(['todo']);
    const file: FakeTextModel = new FakeTextModel(['todo']);
    const adapter: OpenEditorsFindAdapter = new OpenEditorsFindAdapter(() => [
      target(diff, 'diff.ts', { readOnly: true }).target,
      target(file, 'file.ts').target,
    ]);
    adapter.setQuery(query('todo'));
    adapter.select(0);

    expect(adapter.activeReplaceable()).toBe(false);
    expect(adapter.replaceMatch('done')).toEqual({
      replaced: 0,
      files: 0,
      failed: [{ path: '/ws/diff.ts', reason: 'It is read-only, so it cannot be edited.' }],
    });

    adapter.replaceEvery('done');

    expect(diff.text()).toBe('todo');
    expect(file.text()).toBe('done');
    expect(adapter.hasReplaceable()).toBe(false);
  });

  it('replaceMatch_afterTheTextChanged_refreshesInsteadOfReplacingBlind', () => {
    const model: FakeTextModel = new FakeTextModel(['todo']);
    const adapter: OpenEditorsFindAdapter = new OpenEditorsFindAdapter(() => [
      target(model, 'a.ts').target,
    ]);
    adapter.setQuery(query('todo'));
    adapter.select(0);
    model.type(['xx todo']);

    const response: ReplaceResponse | null = adapter.replaceMatch('done');

    expect(response?.replaced).toBe(0);
    expect(model.text()).toBe('xx todo');
    expect(adapter.matches()[0].column).toBe(4);
  });

  it('replaceMatch_withARegex_fillsInTheGroups', () => {
    const model: FakeTextModel = new FakeTextModel(['let a = b;']);
    const adapter: OpenEditorsFindAdapter = new OpenEditorsFindAdapter(() => [
      target(model, 'a.ts').target,
    ]);
    adapter.setQuery(query('(?<left>\\w) = (\\w)', { regexp: true }));
    adapter.select(0);

    adapter.replaceMatch('$2 = $<left> ($&, $$)');

    expect(model.text()).toBe('let b = a (a = b, $);');
  });

  it('clear_removesEveryHighlightAndResult', () => {
    const model: FakeTextModel = new FakeTextModel(['todo']);
    const adapter: OpenEditorsFindAdapter = new OpenEditorsFindAdapter(() => [
      target(model, 'a.ts').target,
    ]);
    adapter.setQuery(query('todo'));

    adapter.clear();

    expect(adapter.matches()).toEqual([]);
    expect(model.highlights()).toEqual([]);
  });

  it('setQuery_passesOverADisposedModel', () => {
    const model: FakeTextModel = new FakeTextModel(['todo']);
    model.disposed = true;
    const adapter: OpenEditorsFindAdapter = new OpenEditorsFindAdapter(() => [
      target(model, 'a.ts').target,
    ]);

    adapter.setQuery(query('todo'));

    expect(adapter.matches()).toEqual([]);
  });
});
