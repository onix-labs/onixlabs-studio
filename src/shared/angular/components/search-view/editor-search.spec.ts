import { describe, expect, it } from 'vitest';
import type * as MonacoApi from 'monaco-editor';
import { FindQuery, FindResultItem } from '@shared/angular/components/find-panel/find-adapter';
import { FindRange, FindScope } from '@shared/angular/components/find-panel/find-request';
import { EditorSearch } from './editor-search';
import { FakeCodeEditor, FakeTextModel } from './testing/fake-text-model';

/**
 * Builds a plain query for the given text.
 * @param text The text.
 * @returns Returns the query.
 */
function query(text: string): FindQuery {
  return { text, caseSensitive: false, wholeWord: false, regexp: false };
}

/**
 * Builds a tab's find over a main editor, naming every editor "main.ts" or "other".
 * @param main The main editor, or null for a tab with none.
 * @returns Returns the find.
 */
function searchOver(main: FakeCodeEditor | null): EditorSearch {
  return new EditorSearch({
    mainEditor: (): MonacoApi.editor.ICodeEditor | null => main?.asEditor() ?? null,
    labelOf: (editor: MonacoApi.editor.ICodeEditor): string =>
      editor === main?.asEditor() ? 'main.ts' : 'other',
  });
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

describe('EditorSearch (#1007)', () => {
  const selection: FindRange = {
    startLineNumber: 2,
    startColumn: 1,
    endLineNumber: 2,
    endColumn: 10,
  };

  it('open_withNoEditorNamed_searchesTheMainOne_andShowsItself', () => {
    const main: FakeCodeEditor = new FakeCodeEditor(new FakeTextModel(['todo', 'todo todo']));
    const search: EditorSearch = searchOver(main);

    search.open({ mode: 'find', scope: 'file', seed: 'todo' }, null);
    search.adapter.setQuery(query('todo'));

    expect(search.visible()).toBe(true);
    expect(search.scopes).toEqual(['file', 'selection']);
    expect(search.replaceable()).toBe(true);
    expect(search.adapter.matches().map((item: FindResultItem): string => item.file!)).toEqual([
      'main.ts',
      'main.ts',
      'main.ts',
    ]);
  });

  it('open_withNoEditorAtAll_staysHidden', () => {
    const search: EditorSearch = searchOver(null);

    search.open({ mode: 'find', scope: 'file' }, null);

    expect(search.visible()).toBe(false);
  });

  it('theSelectionScope_searchesOnlyTheSnapshottedSelection_andIsDisabledWithoutOne', () => {
    const main: FakeCodeEditor = new FakeCodeEditor(new FakeTextModel(['todo', 'todo todo']));
    const search: EditorSearch = searchOver(main);

    search.open({ mode: 'find', scope: 'file' }, null);
    expect([...search.disabledScopes()]).toEqual<FindScope[]>(['selection']);

    search.open({ mode: 'find', scope: 'selection', selection }, null);
    search.adapter.setScope('selection');
    search.adapter.setQuery(query('todo'));

    expect(search.disabledScopes().size).toBe(0);
    expect(search.adapter.matches().map((item: FindResultItem): number => item.line)).toEqual([
      2, 2,
    ]);
  });

  it('aReadOnlyEditor_isSearchedWithoutReplace', () => {
    const generated: FakeCodeEditor = new FakeCodeEditor(new FakeTextModel(['todo']));
    generated.readOnly = true;
    const search: EditorSearch = searchOver(null);

    search.open({ mode: 'replace', scope: 'file' }, generated.asEditor());
    search.adapter.setQuery(query('todo'));
    search.adapter.select(0);

    expect(search.replaceable()).toBe(false);
    expect(search.adapter.activeReplaceable()).toBe(false);
    expect(search.adapter.matches()[0].file).toBe('other');
  });

  it('aFindFromAnotherEditor_clearsWhatTheLastOneFound', () => {
    const mainModel: FakeTextModel = new FakeTextModel(['todo']);
    const main: FakeCodeEditor = new FakeCodeEditor(mainModel);
    const other: FakeCodeEditor = new FakeCodeEditor(new FakeTextModel(['nothing here']));
    const search: EditorSearch = searchOver(main);
    search.open({ mode: 'find', scope: 'file' }, null);
    search.adapter.setQuery(query('todo'));
    expect(mainModel.highlights()).toHaveLength(1);

    search.open({ mode: 'find', scope: 'file' }, other.asEditor());

    expect(search.adapter.matches()).toEqual([]);
    expect(mainModel.highlights()).toEqual([]);
  });

  it('choosingAMatch_selectsCentresAndFocusesItInTheEditor', async () => {
    const main: FakeCodeEditor = new FakeCodeEditor(new FakeTextModel(['a', 'b todo']));
    const search: EditorSearch = searchOver(main);
    search.open({ mode: 'find', scope: 'file' }, null);
    search.adapter.setQuery(query('todo'));

    search.adapter.select(0);
    await settle();

    expect(main.selection).toEqual({
      startLineNumber: 2,
      startColumn: 3,
      endLineNumber: 2,
      endColumn: 7,
    });
    expect(main.revealed).toEqual(main.selection);
    expect(main.focused).toBe(true);
  });
});
