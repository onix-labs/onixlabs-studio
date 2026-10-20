import { signal } from '@angular/core';
import type * as MonacoApi from 'monaco-editor';
import { describe, expect, it } from 'vitest';
import { CodeDocument } from '@shared/angular/services/documents/documents';
import { OpenDiffEditor } from '@shared/angular/services/diffs/diffs';
import { EditorSearchOrigin, EditorSearchTargets } from './editor-search-targets';
import { EditorSearchTarget } from '@shared/angular/components/search-view/open-editors-find-adapter';
import {
  FakeCodeEditor,
  FakeTextModel,
} from '@shared/angular/components/search-view/testing/fake-text-model';

/**
 * A selection on the first line.
 */
const SELECTION: EditorSearchOrigin['selection'] = {
  startLineNumber: 1,
  startColumn: 1,
  endLineNumber: 1,
  endColumn: 3,
};

/**
 * Builds the resolver over a workspace with documents `a.ts` (with a model), `b.md` (without one) and
 * an untitled document, and a diff of `a.ts` and of `c.ts`.
 * @returns Returns the resolver, the models, the editors and what was brought forward.
 */
function build(): {
  readonly targets: EditorSearchTargets;
  readonly a: FakeTextModel;
  readonly diffA: FakeTextModel;
  readonly diffC: FakeTextModel;
  readonly opened: string[];
} {
  const a: FakeTextModel = new FakeTextModel(['a']);
  const diffA: FakeTextModel = new FakeTextModel(['diff a']);
  const diffC: FakeTextModel = new FakeTextModel(['diff c']);
  const editorA: FakeCodeEditor = new FakeCodeEditor(a);
  const opened: string[] = [];
  const documents: readonly CodeDocument[] = ['/ws/a.ts', '/ws/b.md', null].map(
    (path: string | null): CodeDocument => ({ filePath: signal(path) }) as unknown as CodeDocument,
  );
  const diffs: readonly OpenDiffEditor[] = [
    {
      id: 'diff:a',
      path: () => '/ws/a.ts',
      modifiedEditor: () => new FakeCodeEditor(diffA).asEditor(),
    },
    {
      id: 'diff:c',
      path: () => '/ws/c.ts',
      modifiedEditor: () => new FakeCodeEditor(diffC).asEditor(),
    },
  ];
  const monaco: typeof MonacoApi = {
    Uri: { parse: (uri: string): string => uri },
    editor: {
      getModel: (uri: string): MonacoApi.editor.ITextModel | null =>
        uri === 'inmemory://a' ? a.asModel() : null,
      getEditors: (): MonacoApi.editor.ICodeEditor[] => [editorA.asEditor()],
    },
  } as unknown as typeof MonacoApi;
  const targets: EditorSearchTargets = new EditorSearchTargets({
    documents: () => documents,
    diffs: () => diffs,
    modelUriForPath: (path: string): string | undefined =>
      path === '/ws/a.ts' ? 'inmemory://a' : path === '/ws/b.md' ? 'inmemory://b' : undefined,
    monaco: () => monaco,
    rootOf: (): string => '/ws',
    openFile: (path: string): Promise<boolean> => {
      opened.push(path);
      return Promise.resolve(true);
    },
    activatePanel: (id: string): void => void opened.push(id),
  });
  return { targets, a, diffA, diffC, opened };
}

/**
 * Describes targets as their labels, marking read-only ones.
 * @param list The targets.
 * @returns Returns the descriptions.
 */
function labels(list: readonly EditorSearchTarget[]): string[] {
  return list.map((entry: EditorSearchTarget): string =>
    entry.readOnly === true ? `${entry.label} (diff)` : entry.label,
  );
}

describe('EditorSearchTargets (#1007)', () => {
  it('openFiles_isEveryDocumentWithAModel_thenEveryDiffOfAFileNotOpen', () => {
    const { targets } = build();

    // b.md has no Monaco model (a markdown document) and the untitled one no path: both passed over.
    // The diff of a.ts gives way to a.ts itself; the diff of c.ts is searched, read-only.
    expect(
      labels(targets.resolve('open-files', { filePath: null, selection: null, fromDiff: false })),
    ).toEqual(['a.ts', 'c.ts (diff)']);
  });

  it('currentFile_isTheFilesOwnEditor_unlessTheFindCameFromItsDiff', () => {
    const { targets, a, diffA } = build();

    const own: readonly EditorSearchTarget[] = targets.resolve('file', {
      filePath: '/ws/a.ts',
      selection: null,
      fromDiff: false,
    });
    const fromDiff: readonly EditorSearchTarget[] = targets.resolve('file', {
      filePath: '/ws/a.ts',
      selection: null,
      fromDiff: true,
    });

    expect(own[0].model).toBe(a.asModel());
    expect(own[0].readOnly).toBeUndefined();
    expect(fromDiff[0].model).toBe(diffA.asModel());
    expect(fromDiff[0].readOnly).toBe(true);
  });

  it('currentFile_openOnlyAsADiff_isTheDiff', () => {
    const { targets, diffC } = build();

    const found: readonly EditorSearchTarget[] = targets.resolve('file', {
      filePath: '/ws/c.ts',
      selection: null,
      fromDiff: false,
    });

    expect(found[0].model).toBe(diffC.asModel());
  });

  it('currentSelection_isTheFileLimitedToTheSnapshot_andNothingWithoutOne', () => {
    const { targets } = build();

    expect(
      targets.resolve('selection', {
        filePath: '/ws/a.ts',
        selection: SELECTION,
        fromDiff: false,
      })[0].range,
    ).toEqual(SELECTION);
    expect(
      targets.resolve('selection', { filePath: '/ws/a.ts', selection: null, fromDiff: false }),
    ).toEqual([]);
  });

  it('aFileWithNoEditor_andTheDiskScopes_haveNothingToSearch', () => {
    const { targets } = build();

    expect(
      targets.resolve('file', { filePath: '/ws/b.md', selection: null, fromDiff: false }),
    ).toEqual([]);
    expect(
      targets.resolve('workspace', { filePath: '/ws/a.ts', selection: null, fromDiff: false }),
    ).toEqual([]);
  });

  it('activate_bringsAFileForwardByPath_andADiffByItsPanel', async () => {
    const { targets, opened } = build();
    const [file, diff] = targets.resolve('open-files', {
      filePath: null,
      selection: null,
      fromDiff: false,
    });

    await file.activate?.();
    await diff.activate?.();

    expect(opened).toEqual(['/ws/a.ts', 'diff:c']);
  });
});
