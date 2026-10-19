import { TestBed } from '@angular/core/testing';
import type * as MonacoApi from 'monaco-editor';
import type { Mock } from 'vitest';
import type { MenuItem } from '@shared/angular/components/menu/menu';
import { EditorContextMenu } from '@shared/angular/services/editor-context-menu/editor-context-menu';
import { Editors } from '@shared/angular/services/editors/editors';
import {
  LspCodeAction,
  LspCommand,
  LspCommandOutcome,
  LspFeatures,
} from '@shared/angular/services/lsp/lsp-features';
import { captureEditorCapabilities } from '@shared/angular/services/monaco/monaco-editor-capabilities';
import {
  NotificationRequest,
  Notifications,
} from '@shared/angular/services/notifications/notifications';
import {
  RenameConfirmation,
  RenameConfirmationRequest,
} from '@shared/angular/services/rename/rename-confirmation';
import type {
  WorkspaceEditOutcome,
  WorkspaceTextEdits,
} from '@shared/angular/services/workspace-edit/workspace-edit';
import { WorkspaceEditApplier } from '@shared/angular/services/workspace-edit/workspace-edit-applier';
import { NO_QUICK_FIXES_LABEL } from './quick-fix-menu';
import { QuickFixes } from './quick-fixes';

/**
 * Monaco's `EditorOption.readOnly`, as the fake instance numbers it.
 */
const READ_ONLY_OPTION: number = 104;

/**
 * The model URI of the editor under test.
 */
const MODEL_URI: string = 'inmemory://model/1';

/**
 * Builds a one-line edit to a file.
 * @param path The file.
 * @param text The text it puts in.
 * @returns Returns the file's edits.
 */
function fileEdit(path: string, text: string): WorkspaceTextEdits['files'][number] {
  return {
    path,
    edits: [
      { range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }, text },
    ],
  };
}

/**
 * Builds a server's code action.
 * @param title The title.
 * @param extra What else it is.
 * @returns Returns the action.
 */
function served(title: string, extra: Partial<LspCodeAction> = {}): LspCodeAction {
  return {
    title,
    kind: 'quickfix',
    isPreferred: false,
    disabledReason: null,
    edit: null,
    command: null,
    raw: { title },
    ...extra,
  };
}

/**
 * Builds a stand-in editor.
 * @param readOnly Whether it rejects edits.
 * @returns Returns the editor and the calls made on it.
 */
function fakeEditor(readOnly: boolean = false): {
  editor: MonacoApi.editor.ICodeEditor;
  calls: string[];
} {
  const calls: string[] = [];
  const model: unknown = {
    uri: { toString: (): string => MODEL_URI },
    getLanguageId: (): string => 'typescript',
  };
  const container: HTMLElement = document.createElement('div');
  const editor: unknown = {
    getModel: (): unknown => model,
    getContainerDomNode: (): HTMLElement => container,
    getOption: (id: number): unknown => (id === READ_ONLY_OPTION ? readOnly : undefined),
    getRawOptions: (): MonacoApi.editor.IEditorOptions => ({ readOnly }),
    getSelection: (): MonacoApi.IRange => ({
      startLineNumber: 2,
      startColumn: 5,
      endLineNumber: 2,
      endColumn: 5,
    }),
    getPosition: (): MonacoApi.IPosition => ({ lineNumber: 2, column: 5 }),
    focus: (): void => void calls.push('focus'),
  };
  return { editor: editor as MonacoApi.editor.ICodeEditor, calls };
}

/**
 * Builds a fake Monaco instance for the editor's window, prepared as the real one is so code-action
 * providers can register, holding the given markers.
 * @param markers The markers on the model.
 * @returns Returns the instance.
 */
function fakeMonaco(markers: MonacoApi.editor.IMarker[] = []): typeof MonacoApi {
  const monaco: typeof MonacoApi = {
    editor: {
      EditorOption: { readOnly: READ_ONLY_OPTION },
      getModels: (): MonacoApi.editor.ITextModel[] => [],
      getModelMarkers: (): MonacoApi.editor.IMarker[] => markers,
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
      CodeActionTriggerType: { Invoke: 1, Auto: 2 },
    },
    Range: class {
      public constructor(
        public readonly startLineNumber: number,
        public readonly startColumn: number,
        public readonly endLineNumber: number,
        public readonly endColumn: number,
      ) {}
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
 * Lets queued promises settle.
 * @returns Returns a promise that resolves on the next macrotask.
 */
function flush(): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 0);
  });
}

describe('QuickFixes (#1016)', () => {
  let monaco: typeof MonacoApi;
  let lsp: {
    servesCodeActions: Mock<LspFeatures['servesCodeActions']>;
    codeActions: Mock<LspFeatures['codeActions']>;
    resolveCodeAction: Mock<LspFeatures['resolveCodeAction']>;
    executeCommand: Mock<LspFeatures['executeCommand']>;
  };
  let applied: WorkspaceTextEdits[];
  let outcome: WorkspaceEditOutcome;
  let menu: { openAtCaret: Mock<EditorContextMenu['openAtCaret']> };
  let notified: NotificationRequest[];
  let order: string[];

  /**
   * Builds the service.
   * @returns Returns it.
   */
  function build(): QuickFixes {
    TestBed.configureTestingModule({
      providers: [
        { provide: LspFeatures, useValue: lsp },
        { provide: EditorContextMenu, useValue: menu },
        {
          provide: WorkspaceEditApplier,
          useValue: {
            apply: (edit: WorkspaceTextEdits): Promise<WorkspaceEditOutcome> => {
              order.push('apply');
              applied.push(edit);
              return Promise.resolve(outcome);
            },
          },
        },
      ],
    });
    vi.spyOn(TestBed.inject(Notifications), 'notify').mockImplementation(
      (request: NotificationRequest): void => void notified.push(request),
    );
    return TestBed.inject(QuickFixes);
  }

  /**
   * Opens the menu, then chooses the row with the given label.
   * @param fixes The service.
   * @param editor The editor.
   * @param label The row's label.
   * @returns Returns the rows the menu opened with.
   */
  async function choose(
    fixes: QuickFixes,
    editor: MonacoApi.editor.ICodeEditor,
    label: string,
  ): Promise<readonly MenuItem[]> {
    await fixes.open(editor);
    const [, rows, run] = menu.openAtCaret.mock.calls.at(-1) as [
      MonacoApi.editor.ICodeEditor,
      readonly MenuItem[],
      (id: string) => void,
    ];
    const row: MenuItem | undefined = rows.find((item: MenuItem): boolean => item.label === label);
    if (row !== undefined) {
      run(row.id);
    }
    await flush();
    return rows;
  }

  beforeEach(() => {
    monaco = fakeMonaco();
    (window as unknown as { monaco?: unknown }).monaco = monaco;
    order = [];
    applied = [];
    notified = [];
    outcome = { applied: [{ path: '/root/app.ts', edits: 1, where: 'editor' }], skipped: [] };
    lsp = {
      servesCodeActions: vi.fn<LspFeatures['servesCodeActions']>((): boolean => true),
      codeActions: vi.fn<LspFeatures['codeActions']>((): Promise<readonly LspCodeAction[] | null> =>
        Promise.resolve([]),
      ),
      resolveCodeAction: vi.fn<LspFeatures['resolveCodeAction']>(
        (_model: MonacoApi.editor.ITextModel, action: LspCodeAction): Promise<LspCodeAction> =>
          Promise.resolve(action),
      ),
      executeCommand: vi.fn<LspFeatures['executeCommand']>((): Promise<LspCommandOutcome> => {
        order.push('command');
        return Promise.resolve({ ran: true });
      }),
    };
    menu = {
      openAtCaret: vi.fn<EditorContextMenu['openAtCaret']>((): boolean => true),
    };
  });

  afterEach(() => {
    delete (window as unknown as { monaco?: unknown }).monaco;
  });

  it('offersQuickFixes_whereAServerOrAProviderOffersCodeActions_neverInAReadOnlyEditor', () => {
    const fixes: QuickFixes = build();
    expect(fixes.offersQuickFixes(fakeEditor().editor)).toBe(true);
    expect(fixes.offersQuickFixes(fakeEditor(true).editor)).toBe(false);

    lsp.servesCodeActions.mockReturnValue(false);
    expect(fixes.offersQuickFixes(fakeEditor().editor)).toBe(false);
    monaco.languages.registerCodeActionProvider('typescript', {
      provideCodeActions: () => null,
    });
    expect(fixes.offersQuickFixes(fakeEditor().editor)).toBe(true);
  });

  it('open_asksTheServerAtTheCaret_andOpensStudiosMenuThere_fixesFirst', async () => {
    lsp.codeActions.mockResolvedValue([
      served('Extract method', { kind: 'refactor.extract' }),
      served('Add import', { isPreferred: true }),
    ]);
    const fixes: QuickFixes = build();
    const { editor } = fakeEditor();

    await fixes.open(editor);

    expect(lsp.codeActions).toHaveBeenCalledWith(
      editor.getModel(),
      { startLineNumber: 2, startColumn: 5, endLineNumber: 2, endColumn: 5 },
      undefined,
      false,
    );
    const [target, rows] = menu.openAtCaret.mock.calls[0];
    expect(target).toBe(editor);
    expect(rows.map((row: MenuItem): string => (row.separator === true ? '|' : row.label))).toEqual(
      ['Add import', '|', 'Extract method'],
    );
  });

  it('asksAboutTheCaretsWholeProblemArea_soAFixIsFoundAnywhereOnItsLine', async () => {
    // Matthew's live test: the icon showed only "sometimes" — when the caret rested on the squiggle.
    // At the bare caret, off the squiggle (at the line's end, say), the server was told of no problem.
    monaco = fakeMonaco([
      {
        startLineNumber: 2,
        startColumn: 9,
        endLineNumber: 2,
        endColumn: 21,
        message: "Cannot find name 'readFileSync'.",
      } as MonacoApi.editor.IMarker,
      {
        startLineNumber: 7,
        startColumn: 1,
        endLineNumber: 7,
        endColumn: 4,
      } as MonacoApi.editor.IMarker,
    ]);
    (window as unknown as { monaco?: unknown }).monaco = monaco;
    const fixes: QuickFixes = build();
    const { editor } = fakeEditor();

    await fixes.open(editor);

    // The caret (2:5) together with the problem on its line (2:9–21); the one on line 7 is not its.
    expect(lsp.codeActions).toHaveBeenCalledWith(
      editor.getModel(),
      { startLineNumber: 2, startColumn: 5, endLineNumber: 2, endColumn: 21 },
      undefined,
      false,
    );
  });

  it('open_withNothingToOffer_saysSo', async () => {
    const fixes: QuickFixes = build();

    await fixes.open(fakeEditor().editor);

    expect(menu.openAtCaret.mock.calls[0][1]).toEqual([
      { id: 'quick-fix-none', label: NO_QUICK_FIXES_LABEL, disabled: true },
    ]);
  });

  it('open_inAReadOnlyEditor_opensNothing', async () => {
    const fixes: QuickFixes = build();

    await fixes.open(fakeEditor(true).editor);

    expect(lsp.codeActions).not.toHaveBeenCalled();
    expect(menu.openAtCaret).not.toHaveBeenCalled();
  });

  it('choosing_appliesTheEditThroughTheApplier_thenRunsTheCommandOnTheServer', async () => {
    const command: LspCommand = { title: 'Restore', command: 'server.restore', arguments: [1] };
    const edit: WorkspaceTextEdits = {
      files: [fileEdit('/root/app.ts', 'using System;')],
      refused: [],
    };
    lsp.codeActions.mockResolvedValue([served('Add using', { edit, command })]);
    const fixes: QuickFixes = build();
    const { editor, calls } = fakeEditor();

    await choose(fixes, editor, 'Add using');

    expect(applied).toEqual([edit]);
    expect(lsp.resolveCodeAction).not.toHaveBeenCalled();
    expect(lsp.executeCommand).toHaveBeenCalledWith(editor.getModel(), command);
    expect(order).toEqual(['apply', 'command']);
    expect(calls.at(-1)).toBe('focus');
    expect(notified).toEqual([]);
  });

  it('choosing_anActionWithoutItsEdit_resolvesItFirst', async () => {
    const edit: WorkspaceTextEdits = { files: [fileEdit('/root/app.ts', 'x')], refused: [] };
    lsp.codeActions.mockResolvedValue([served('Fix')]);
    lsp.resolveCodeAction.mockImplementation(
      (_model: MonacoApi.editor.ITextModel, action: LspCodeAction): Promise<LspCodeAction> => {
        order.push('resolve');
        return Promise.resolve({ ...action, edit });
      },
    );
    const fixes: QuickFixes = build();

    await choose(fixes, fakeEditor().editor, 'Fix');

    expect(order).toEqual(['resolve', 'apply']);
    expect(applied).toEqual([edit]);
  });

  it('choosing_anEditAcrossFiles_asksTheRenameConfirmationFirst', async () => {
    const edit: WorkspaceTextEdits = {
      files: [fileEdit('/root/a.ts', 'x'), fileEdit('/root/lib/b.ts', 'y')],
      refused: [],
    };
    lsp.codeActions.mockResolvedValue([served('Move to file', { kind: 'refactor.move', edit })]);
    const fixes: QuickFixes = build();
    const confirmation: RenameConfirmation = TestBed.inject(RenameConfirmation);
    const { editor } = fakeEditor();

    await choose(fixes, editor, 'Move to file');
    const request: RenameConfirmationRequest | null = confirmation.pending();
    expect(request).toMatchObject({
      title: 'Apply “Move to file”?',
      confirmLabel: 'Apply',
      files: [
        { path: '/root/a.ts', name: 'a.ts', folder: '', edits: 1, open: false },
        { path: '/root/lib/b.ts', name: 'b.ts', folder: 'lib', edits: 1, open: false },
      ],
    });
    confirmation.answer(false);
    await flush();
    expect(applied).toEqual([]);

    await choose(fixes, editor, 'Move to file');
    confirmation.answer(true);
    await flush();
    expect(applied).toEqual([edit]);
  });

  it('aCommandTheServerCannotRun_isTold', async () => {
    lsp.codeActions.mockResolvedValue([
      served('Fix all', { command: { title: 'Fix all', command: 'client.fixAll' } }),
    ]);
    lsp.executeCommand.mockResolvedValue({ ran: false, reason: 'It is a client command.' });
    const fixes: QuickFixes = build();

    await choose(fixes, fakeEditor().editor, 'Fix all');

    expect(notified).toEqual([
      expect.objectContaining({
        severity: 'warning',
        title: "Couldn't apply “Fix all”",
        detail: 'It is a client command.',
      }),
    ]);
  });

  it('skippedEdits_areNamed', async () => {
    outcome = {
      applied: [],
      skipped: [{ path: '/root/app.ts', reason: 'Its edits overlap.' }],
    };
    lsp.codeActions.mockResolvedValue([
      served('Fix', { edit: { files: [fileEdit('/root/app.ts', 'x')], refused: [] } }),
    ]);
    const fixes: QuickFixes = build();

    await choose(fixes, fakeEditor().editor, 'Fix');

    expect(notified[0]).toMatchObject({
      title: "Couldn't apply “Fix”",
      detail: 'app.ts — Its edits overlap.',
    });
  });

  it('noServer_asksMonacosProviders_withTheMarkersAtTheCaret_keyingEditsByFile_andRunsNoCommandOfTheirs', async () => {
    const atCaret: MonacoApi.editor.IMarker = {
      startLineNumber: 2,
      startColumn: 1,
      endLineNumber: 2,
      endColumn: 9,
      message: 'Cannot find name',
    } as MonacoApi.editor.IMarker;
    const elsewhere: MonacoApi.editor.IMarker = {
      startLineNumber: 7,
      startColumn: 1,
      endLineNumber: 7,
      endColumn: 2,
      message: 'Unused',
    } as MonacoApi.editor.IMarker;
    monaco = fakeMonaco([atCaret, elsewhere]);
    (window as unknown as { monaco?: unknown }).monaco = monaco;
    lsp.codeActions.mockResolvedValue(null);
    const contexts: MonacoApi.languages.CodeActionContext[] = [];
    let released: number = 0;
    const resource: MonacoApi.Uri = { toString: (): string => MODEL_URI } as MonacoApi.Uri;
    monaco.languages.registerCodeActionProvider('typescript', {
      provideCodeActions: (
        _model: MonacoApi.editor.ITextModel,
        _range: MonacoApi.Range,
        context: MonacoApi.languages.CodeActionContext,
      ): MonacoApi.languages.CodeActionList => {
        contexts.push(context);
        return {
          actions: [
            {
              title: 'Add import',
              kind: 'quickfix',
              edit: {
                edits: [
                  {
                    resource,
                    textEdit: {
                      range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
                      text: 'import x;\n',
                    },
                    versionId: undefined,
                  },
                ],
              },
            },
            { title: 'Open the widget', command: { id: 'editor.action.quickFix', title: '' } },
          ],
          dispose: (): void => void (released += 1),
        };
      },
    });
    const fixes: QuickFixes = build();
    TestBed.inject(Editors).register(MODEL_URI, {
      documentId: 'doc-1',
      path: '/root/app.ts',
      name: 'app.ts',
    });
    const { editor } = fakeEditor();

    await choose(fixes, editor, 'Add import');

    expect(contexts[0].markers).toEqual([atCaret]);
    expect(applied).toEqual([
      {
        files: [
          {
            path: '/root/app.ts',
            edits: [
              {
                range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
                text: 'import x;\n',
              },
            ],
          },
        ],
        refused: [],
      },
    ]);
    expect(released).toBe(1);

    await choose(fixes, editor, 'Open the widget');
    expect(lsp.executeCommand).not.toHaveBeenCalled();
    expect(notified.at(-1)).toMatchObject({ title: "Couldn't apply “Open the widget”" });
  });

  it('hasFixes_asksForFixesAlone_withoutTheUserAsking_andCountsOnlyThoseThatCanRun', async () => {
    const fixes: QuickFixes = build();
    const { editor } = fakeEditor();
    lsp.codeActions.mockResolvedValue([
      served('Extract', { kind: 'refactor' }),
      served('Fix', { disabledReason: 'Not here.' }),
    ]);

    expect(await fixes.hasFixes(editor)).toBe(false);
    expect(lsp.codeActions).toHaveBeenCalledWith(
      editor.getModel(),
      expect.anything(),
      ['quickfix'],
      true,
    );

    lsp.codeActions.mockResolvedValue([served('Fix')]);
    expect(await fixes.hasFixes(editor)).toBe(true);
    expect(await fixes.hasFixes(fakeEditor(true).editor)).toBe(false);
  });
});
