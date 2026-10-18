import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type * as MonacoApi from 'monaco-editor';
import type { FindRange, FindRequest } from '@shared/angular/components/find-panel/find-request';
import { Editors } from '@shared/angular/services/editors/editors';
import { FindHost, FindWorkspace } from './find-host';
import { FindRouter } from './find-router';

/**
 * A workspace find seam that records what it reveals.
 */
class FakeWorkspace implements FindWorkspace {
  public readonly available: WritableSignal<boolean> = signal<boolean>(true);
  public readonly revealed: FindRequest[] = [];

  /**
   * Records the revealed request.
   * @param request The request.
   */
  public reveal(request: FindRequest): void {
    this.revealed.push(request);
  }
}

/**
 * A tab Find panel that records what it opens.
 */
class FakeHost implements FindHost {
  public readonly opened: { request: FindRequest; editor: MonacoApi.editor.ICodeEditor | null }[] =
    [];

  /**
   * Records the opened request.
   * @param request The request.
   * @param editor The editor.
   */
  public openFind(request: FindRequest, editor: MonacoApi.editor.ICodeEditor | null): void {
    this.opened.push({ request, editor });
  }
}

/**
 * Builds a fake editor over a model of the given lines, with the given selection.
 * @param lines The model's lines.
 * @param selection The selection, or null for a caret with nothing selected.
 * @param uri The model's URI.
 * @returns Returns the editor.
 */
function editorOver(
  lines: readonly string[],
  selection: FindRange | null,
  uri: string = 'inmemory://model/1',
): MonacoApi.editor.ICodeEditor {
  const model: Partial<MonacoApi.editor.ITextModel> = {
    uri: { toString: (): string => uri } as MonacoApi.Uri,
    getValueInRange: (range: MonacoApi.IRange): string =>
      range.startLineNumber === range.endLineNumber
        ? lines[range.startLineNumber - 1].slice(range.startColumn - 1, range.endColumn - 1)
        : 'multi-line',
  };
  const caret: FindRange = { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 };
  const current: FindRange = selection ?? caret;
  return {
    getModel: (): MonacoApi.editor.ITextModel => model as MonacoApi.editor.ITextModel,
    getSelection: (): MonacoApi.Selection =>
      ({
        ...current,
        isEmpty: (): boolean => selection === null,
      }) as unknown as MonacoApi.Selection,
  } as unknown as MonacoApi.editor.ICodeEditor;
}

describe('FindRouter', () => {
  let router: FindRouter;
  let workspace: FakeWorkspace;
  let host: FakeHost;

  beforeEach(() => {
    router = TestBed.inject(FindRouter);
    workspace = new FakeWorkspace();
    host = new FakeHost();
  });

  describe('routing', () => {
    it('open_whenAWorkspaceIsActive_revealsItsSearchPanel_notTheTabsFindPanel', () => {
      router.useWorkspace(workspace);
      const request: FindRequest = { mode: 'find', scope: 'file' };

      router.open(request, host);

      expect(workspace.revealed).toEqual([request]);
      expect(host.opened).toEqual([]);
    });

    it('open_whenNoWorkspaceIsActive_opensTheTabsFindPanel', () => {
      workspace.available.set(false);
      router.useWorkspace(workspace);
      const request: FindRequest = { mode: 'replace', scope: 'file' };

      router.open(request, host);

      expect(workspace.revealed).toEqual([]);
      expect(host.opened).toEqual([{ request, editor: null }]);
    });

    it('open_beforeTheWorkspaceFeatureContributes_opensTheTabsFindPanel', () => {
      router.open({ mode: 'find', scope: 'file' }, host);

      expect(host.opened.length).toBe(1);
    });

    it('open_whenNothingAnswers_doesNothing', () => {
      workspace.available.set(false);
      router.useWorkspace(workspace);

      expect((): void => router.open({ mode: 'find', scope: 'file' })).not.toThrow();
    });

    it('openFromEditor_outsideAWorkspace_opensTheAttachedTabsPanelOverThatEditor', () => {
      const editor: MonacoApi.editor.ICodeEditor = editorOver(['alpha'], null);
      router.attach(editor, { host });

      router.openFromEditor(editor, 'replace');

      expect(host.opened).toEqual([
        {
          request: {
            mode: 'replace',
            scope: 'file',
            seed: undefined,
            filePath: null,
            selection: null,
          },
          editor,
        },
      ]);
    });

    it('openFromEditor_onceDetached_hasNoTabToOpen', () => {
      const editor: MonacoApi.editor.ICodeEditor = editorOver(['alpha'], null);
      const detach: () => void = router.attach(editor, { host });

      detach();
      router.openFromEditor(editor, 'find');

      expect(host.opened).toEqual([]);
    });
  });

  describe('requestFrom', () => {
    it('seedsFromASingleLineSelection_andSnapshotsIt', () => {
      const selection: FindRange = {
        startLineNumber: 1,
        startColumn: 7,
        endLineNumber: 1,
        endColumn: 12,
      };

      const request: FindRequest = router.requestFrom(
        editorOver(['const value = 1;'], selection),
        'find',
      );

      expect(request).toEqual({
        mode: 'find',
        scope: 'file',
        seed: 'value',
        filePath: null,
        selection,
      });
    });

    it('aMultiLineSelection_seedsNothing_butIsStillSnapshotted', () => {
      const selection: FindRange = {
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 2,
        endColumn: 4,
      };

      const request: FindRequest = router.requestFrom(
        editorOver(['one', 'two'], selection),
        'find',
      );

      expect(request.seed).toBeUndefined();
      expect(request.selection).toEqual(selection);
    });

    it('nothingSelected_seedsNothing_andSnapshotsNoSelection', () => {
      const request: FindRequest = router.requestFrom(editorOver(['one'], null), 'replace');

      expect(request.seed).toBeUndefined();
      expect(request.selection).toBeNull();
      expect(request.mode).toBe('replace');
    });

    it('takesTheFilePath_fromTheEditorRegistry', () => {
      TestBed.inject(Editors).register('file:///src/a.ts', {
        documentId: 'doc-1',
        path: '/src/a.ts',
        name: 'a.ts',
      });

      const request: FindRequest = router.requestFrom(
        editorOver(['one'], null, 'file:///src/a.ts'),
        'find',
      );

      expect(request.filePath).toBe('/src/a.ts');
    });

    it('takesTheFilePath_fromTheAttachment_whenTheModelCannotName_it', () => {
      // A diff's models are anonymous; the diff names its file when it attaches.
      const editor: MonacoApi.editor.ICodeEditor = editorOver(['one'], null);
      router.attach(editor, { filePath: (): string => '/src/diffed.ts' });

      expect(router.requestFrom(editor, 'find').filePath).toBe('/src/diffed.ts');
    });

    it('honoursTheScopeAsked', () => {
      expect(router.requestFrom(editorOver(['one'], null), 'find', 'selection').scope).toBe(
        'selection',
      );
    });
  });
});
