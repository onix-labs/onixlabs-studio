import { TestBed } from '@angular/core/testing';
import type * as MonacoApi from 'monaco-editor';
import type { Mock } from 'vitest';
import { Editors } from '@shared/angular/services/editors/editors';
import { GoToRouter } from '@shared/angular/services/go-to/go-to-router';
import {
  LspFeatures,
  LspRenameAnswer,
  LspRenamePreparation,
} from '@shared/angular/services/lsp/lsp-features';
import { captureEditorCapabilities } from '@shared/angular/services/monaco/monaco-editor-capabilities';
import {
  NotificationRequest,
  Notifications,
} from '@shared/angular/services/notifications/notifications';
import type {
  WorkspaceEditOutcome,
  WorkspaceTextEdits,
} from '@shared/angular/services/workspace-edit/workspace-edit';
import { WorkspaceEditApplier } from '@shared/angular/services/workspace-edit/workspace-edit-applier';
import { RenameConfirmation, RenameConfirmationRequest } from './rename-confirmation';
import { RenameSymbol } from './rename-symbol';

/**
 * Monaco's `EditorOption.readOnly`, as the fake instance numbers it.
 */
const READ_ONLY_OPTION: number = 104;

/**
 * The model URI of the editor under test.
 */
const MODEL_URI: string = 'inmemory://model/1';

/**
 * A stand-in editor, and what was done to it.
 */
interface FakeEditor {
  readonly editor: MonacoApi.editor.ICodeEditor;
  readonly calls: string[];
}

/**
 * Builds a stand-in editor with its caret on `greet`.
 * @param readOnly Whether it rejects edits.
 * @returns Returns the editor and its recorder.
 */
function fakeEditor(readOnly: boolean = false): FakeEditor {
  const calls: string[] = [];
  const model: unknown = {
    uri: { toString: (): string => MODEL_URI },
    getLanguageId: (): string => 'typescript',
    getWordAtPosition: (): MonacoApi.editor.IWordAtPosition => ({
      word: 'greet',
      startColumn: 5,
      endColumn: 10,
    }),
  };
  const editor: unknown = {
    getModel: (): unknown => model,
    getPosition: (): MonacoApi.IPosition => ({ lineNumber: 3, column: 6 }),
    getContainerDomNode: (): HTMLElement => document.createElement('div'),
    getOption: (id: number): unknown => (id === READ_ONLY_OPTION ? readOnly : undefined),
    getRawOptions: (): MonacoApi.editor.IEditorOptions => ({ readOnly }),
    focus: (): number => calls.push('focus'),
  };
  return { editor: editor as MonacoApi.editor.ICodeEditor, calls };
}

/**
 * Builds a fake Monaco instance, prepared as the real one is so rename providers can register.
 * @returns Returns the instance.
 */
function fakeMonaco(): typeof MonacoApi {
  const monaco: typeof MonacoApi = {
    editor: {
      EditorOption: { readOnly: READ_ONLY_OPTION },
      getModels: (): MonacoApi.editor.ITextModel[] => [],
    },
    languages: {
      registerDefinitionProvider: (): MonacoApi.IDisposable => ({ dispose: (): void => undefined }),
      registerReferenceProvider: (): MonacoApi.IDisposable => ({ dispose: (): void => undefined }),
      registerRenameProvider: (): MonacoApi.IDisposable => ({ dispose: (): void => undefined }),
      registerCodeActionProvider: (): MonacoApi.IDisposable => ({
        dispose: (): void => undefined,
      }),
      registerHoverProvider: (): MonacoApi.IDisposable => ({ dispose: (): void => undefined }),
      setLanguageConfiguration: (): MonacoApi.IDisposable => ({ dispose: (): void => undefined }),
    },
    CancellationTokenSource: class {
      public readonly token: MonacoApi.CancellationToken = {
        isCancellationRequested: false,
      } as MonacoApi.CancellationToken;
      public dispose(): void {
        // Nothing to release.
      }
    },
  } as unknown as typeof MonacoApi;
  captureEditorCapabilities(monaco);
  return monaco;
}

/**
 * Builds a one-line edit renaming `greet` to `salute`.
 * @param line The one-based line.
 * @returns Returns the edit.
 */
function renameAt(line: number): { range: MonacoApi.IRange; text: string } {
  return {
    range: { startLineNumber: line, startColumn: 5, endLineNumber: line, endColumn: 10 },
    text: 'salute',
  };
}

describe('RenameSymbol (#1015)', () => {
  let monaco: typeof MonacoApi;
  let lsp: {
    servesRename: Mock<LspFeatures['servesRename']>;
    prepareRename: Mock<LspFeatures['prepareRename']>;
    rename: Mock<LspFeatures['rename']>;
  };
  let applied: WorkspaceTextEdits[];
  let outcome: WorkspaceEditOutcome;
  let notified: NotificationRequest[];
  let prompts: string[];
  let promptAnswer: string | null;

  beforeEach(() => {
    monaco = fakeMonaco();
    (window as unknown as { monaco?: unknown }).monaco = monaco;
    lsp = {
      servesRename: vi.fn<LspFeatures['servesRename']>((): boolean => true),
      prepareRename: vi.fn<LspFeatures['prepareRename']>((): Promise<LspRenamePreparation | null> =>
        Promise.resolve({ kind: 'ready', range: renameAt(3).range, placeholder: 'greet' }),
      ),
      rename: vi.fn<LspFeatures['rename']>((): Promise<LspRenameAnswer | null> =>
        Promise.resolve({
          kind: 'edits',
          edits: { files: [{ path: '/ws/src/a.ts', edits: [renameAt(3)] }], refused: [] },
        }),
      ),
    };
    applied = [];
    outcome = { applied: [{ path: '/ws/src/a.ts', edits: 1, where: 'editor' }], skipped: [] };
    notified = [];
    prompts = [];
    promptAnswer = 'salute';
    TestBed.configureTestingModule({
      providers: [
        { provide: LspFeatures, useValue: lsp },
        {
          provide: WorkspaceEditApplier,
          useValue: {
            apply: (edits: WorkspaceTextEdits): Promise<WorkspaceEditOutcome> => {
              applied.push(edits);
              return Promise.resolve(outcome);
            },
          },
        },
      ],
    });
    vi.spyOn(TestBed.inject(Notifications), 'notify').mockImplementation(
      (request: NotificationRequest): void => void notified.push(request),
    );
    vi.spyOn(TestBed.inject(GoToRouter), 'promptRename').mockImplementation(
      (_editor: MonacoApi.editor.ICodeEditor, currentName: string): Promise<string | null> => {
        prompts.push(currentName);
        return Promise.resolve(promptAnswer);
      },
    );
  });

  afterEach(() => {
    delete (window as unknown as { monaco?: unknown }).monaco;
  });

  it('inOneFile_asksForTheNameSeededFromTheServer_andAppliesStraightAway', async () => {
    const { editor, calls } = fakeEditor();

    await TestBed.inject(RenameSymbol).rename(editor);

    expect(prompts).toEqual(['greet']);
    expect(lsp.rename).toHaveBeenCalledWith(
      editor.getModel(),
      { lineNumber: 3, column: 6 },
      'salute',
    );
    expect(applied).toEqual([
      { files: [{ path: '/ws/src/a.ts', edits: [renameAt(3)] }], refused: [] },
    ]);
    expect(TestBed.inject(RenameConfirmation).pending()).toBeNull();
    expect(notified).toEqual([]);
    expect(calls).toEqual(['focus']);
  });

  it('aSymbolTheServerRefuses_saysSo_withItsReason_andAsksNothing', async () => {
    lsp.prepareRename.mockResolvedValue({ kind: 'refused', reason: 'You cannot rename this.' });

    await TestBed.inject(RenameSymbol).rename(fakeEditor().editor);

    expect(prompts).toEqual([]);
    expect(notified).toEqual([
      expect.objectContaining({
        severity: 'warning',
        title: "Can't rename this",
        detail: 'You cannot rename this.',
      }),
    ]);
  });

  it('noServerAndNoProvider_saysThereIsNothingToRename', async () => {
    lsp.prepareRename.mockResolvedValue(null);

    await TestBed.inject(RenameSymbol).rename(fakeEditor().editor);

    expect(prompts).toEqual([]);
    expect(notified[0]?.title).toBe("Can't rename this");
  });

  it('aPromptClosedWithoutAName_changesNothing', async () => {
    promptAnswer = null;

    await TestBed.inject(RenameSymbol).rename(fakeEditor().editor);

    expect(lsp.rename).not.toHaveBeenCalled();
    expect(applied).toEqual([]);
  });

  it('aReadOnlyEditor_doesNothing', async () => {
    await TestBed.inject(RenameSymbol).rename(fakeEditor(true).editor);

    expect(lsp.prepareRename).not.toHaveBeenCalled();
    expect(TestBed.inject(RenameSymbol).offersRename(fakeEditor(true).editor)).toBe(false);
  });

  it('acrossSeveralFiles_listsThemWithTheirCountsForConfirmation_thenApplies', async () => {
    TestBed.inject(Editors).register(MODEL_URI, {
      documentId: 'doc-1',
      path: '/ws/src/a.ts',
      name: 'a.ts',
    });
    lsp.rename.mockResolvedValue({
      kind: 'edits',
      edits: {
        files: [
          { path: '/ws/src/a.ts', edits: [renameAt(3), renameAt(8)] },
          { path: '/ws/lib/b.ts', edits: [renameAt(1)] },
        ],
        refused: [],
      },
    });
    outcome = {
      applied: [
        { path: '/ws/src/a.ts', edits: 2, where: 'editor' },
        { path: '/ws/lib/b.ts', edits: 1, where: 'disk' },
      ],
      skipped: [],
    };
    const confirmation: RenameConfirmation = TestBed.inject(RenameConfirmation);

    const renaming: Promise<void> = TestBed.inject(RenameSymbol).rename(fakeEditor().editor);
    await vi.waitFor((): void => expect(confirmation.pending()).not.toBeNull());
    const request: RenameConfirmationRequest | null = confirmation.pending();
    expect(applied).toEqual([]);
    confirmation.answer(true);
    await renaming;

    expect(request).toEqual({
      oldName: 'greet',
      newName: 'salute',
      files: [
        { path: '/ws/src/a.ts', name: 'a.ts', folder: 'src', edits: 2, open: true },
        { path: '/ws/lib/b.ts', name: 'b.ts', folder: 'lib', edits: 1, open: false },
      ],
    });
    expect(applied.length).toBe(1);
    expect(notified).toEqual([
      expect.objectContaining({
        severity: 'success',
        title: 'Renamed “greet” to “salute” in 2 files',
        detail: 'Open files are changed but not saved.',
      }),
    ]);
  });

  it('acrossSeveralFiles_cancelled_changesNothing', async () => {
    lsp.rename.mockResolvedValue({
      kind: 'edits',
      edits: {
        files: [
          { path: '/ws/a.ts', edits: [renameAt(3)] },
          { path: '/ws/b.ts', edits: [renameAt(1)] },
        ],
        refused: [],
      },
    });
    const confirmation: RenameConfirmation = TestBed.inject(RenameConfirmation);

    const renaming: Promise<void> = TestBed.inject(RenameSymbol).rename(fakeEditor().editor);
    await vi.waitFor((): void => expect(confirmation.pending()).not.toBeNull());
    confirmation.answer(false);
    await renaming;

    expect(applied).toEqual([]);
  });

  it('namesEveryFileSkipped_withWhy', async () => {
    outcome = {
      applied: [],
      skipped: [{ path: '/elsewhere/b.ts', reason: 'It is outside the workspace.' }],
    };

    await TestBed.inject(RenameSymbol).rename(fakeEditor().editor);

    expect(notified).toEqual([
      expect.objectContaining({
        severity: 'warning',
        title: "Couldn't rename “greet”",
        detail: 'b.ts — It is outside the workspace.',
        sticky: true,
      }),
    ]);
  });

  it('aRenameTheServerRefuses_saysSo', async () => {
    lsp.rename.mockResolvedValue({ kind: 'refused', reason: 'The new name is not valid.' });

    await TestBed.inject(RenameSymbol).rename(fakeEditor().editor);

    expect(applied).toEqual([]);
    expect(notified[0]).toEqual(
      expect.objectContaining({
        title: "Couldn't rename “greet”",
        detail: 'The new name is not valid.',
      }),
    );
  });

  it('withNoServer_fallsBackToMonacosRenameProviders_mappingTheirModelsToFiles', async () => {
    lsp.servesRename.mockReturnValue(false);
    lsp.prepareRename.mockResolvedValue(null);
    lsp.rename.mockResolvedValue(null);
    TestBed.inject(Editors).register(MODEL_URI, {
      documentId: 'doc-1',
      path: '/ws/src/a.ts',
      name: 'a.ts',
    });
    const editor: MonacoApi.editor.ICodeEditor = fakeEditor().editor;
    expect(TestBed.inject(RenameSymbol).offersRename(editor)).toBe(false);
    monaco.languages.registerRenameProvider('typescript', {
      provideRenameEdits: (): MonacoApi.languages.WorkspaceEdit => ({
        edits: [
          {
            resource: { toString: (): string => MODEL_URI } as MonacoApi.Uri,
            textEdit: renameAt(3),
            versionId: 1,
          },
        ],
      }),
    });
    expect(TestBed.inject(RenameSymbol).offersRename(editor)).toBe(true);

    await TestBed.inject(RenameSymbol).rename(editor);

    expect(prompts).toEqual(['greet']);
    expect(applied).toEqual([
      { files: [{ path: '/ws/src/a.ts', edits: [renameAt(3)] }], refused: [] },
    ]);
  });
});
