import { inject, Injector, Service } from '@angular/core';
import type * as MonacoApi from 'monaco-editor';
import { EditorContextMenu } from '@shared/angular/services/editor-context-menu/editor-context-menu';
import { Editors } from '@shared/angular/services/editors/editors';
import { Log } from '@shared/angular/services/log/log';
import {
  LspCodeAction,
  LspCommandOutcome,
  LspFeatures,
} from '@shared/angular/services/lsp/lsp-features';
import {
  groupWorkspaceEdit,
  hasCodeActionProvider,
  ProvidedCodeAction,
  ProvidedCodeActions,
  ProvidedFileEdits,
  ProvidedWorkspaceEdit,
  providedCodeActions,
  resolveProvidedCodeAction,
} from '@shared/angular/services/monaco/monaco-editor-capabilities';
import { Notifications } from '@shared/angular/services/notifications/notifications';
import {
  confirmationFiles,
  RenameConfirmation,
} from '@shared/angular/services/rename/rename-confirmation';
import {
  FILE_OPERATION_REFUSED,
  FileTextEdits,
  SkippedEdit,
  WorkspaceEditOutcome,
  WorkspaceTextEdits,
} from '@shared/angular/services/workspace-edit/workspace-edit';
import { WorkspaceEditApplier } from '@shared/angular/services/workspace-edit/workspace-edit-applier';
import { QuickFixIndicator } from './quick-fix-indicator';
import {
  buildQuickFixMenu,
  isQuickFixKind,
  QuickFixAction,
  quickFixIndexOf,
} from './quick-fix-menu';

/**
 * Holds the key every quick-fix notification is raised under, so a newer one replaces an older one.
 */
const NOTIFICATION_KEY: string = 'quick-fix';

/**
 * The code actions at an editor's caret, and how to release what their providers hold for them.
 */
interface QuickFixSession {
  /**
   * Gets the actions.
   */
  readonly actions: readonly QuickFixAction[];

  /**
   * Releases what the providers hold for the actions.
   */
  dispose(): void;
}

/**
 * Offers the code actions at an editor's caret the way Studio does it rather than Monaco (#1016):
 * fixes for the problems there, and the refactors and source actions the language offers. Three
 * routes open the same menu — Studio's `app-menu`, at the caret, in the editor's window — ⌘. (Ctrl+.),
 * the fix icon Studio draws beside the caret's line while fixes exist there, and the right-click
 * menu's Quick Fix. Monaco's lightbulb and code-action widget never appear.
 *
 * The actions come from the language server that serves the document, or else from the code-action
 * providers Monaco's own languages register. Choosing one fills in its edit when the server left it
 * out, applies the edit — straight away in one file, after the same confirmation a rename asks across
 * several — and then runs its command on the server, whose own edits come back through
 * `workspace/applyEdit`. A command of one of Monaco's providers is not run: Monaco's commands reach
 * into its own widgets, which Studio keeps closed.
 */
@Service()
export class QuickFixes {
  /**
   * Holds the confirmation an action changing several files asks, which a rename asks too.
   */
  private readonly confirmation: RenameConfirmation = inject(RenameConfirmation);

  /**
   * Holds the applier the edits go through.
   */
  private readonly applier: WorkspaceEditApplier = inject(WorkspaceEditApplier);

  /**
   * Holds the editor registry, which knows the file each open editor shows.
   */
  private readonly editors: Editors = inject(Editors);

  /**
   * Holds the notifications anything not applied is told through.
   */
  private readonly notifications: Notifications = inject(Notifications);

  /**
   * Holds the injector the language-server features and the menu host are resolved from as they are
   * needed. Resolved then rather than injected here: the features reach into Monaco, whose commands
   * reach back here, and the right-click menu opens this.
   */
  private readonly injector: Injector = inject(Injector);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the actions of the menu last opened, released when the next opens or one is applied.
   */
  private session: QuickFixSession | null = null;

  /**
   * Determines whether code actions can be offered in an editor: it can be edited, and a language
   * server that offers code actions serves it or a code-action provider is registered for its
   * language.
   * @param editor The editor.
   * @returns Returns true when they can.
   */
  public offersQuickFixes(editor: MonacoApi.editor.ICodeEditor): boolean {
    const model: MonacoApi.editor.ITextModel | null = editor.getModel();
    const monaco: typeof MonacoApi | undefined = instanceOf(editor);
    if (model === null || isReadOnly(editor, monaco)) {
      return false;
    }
    if (monaco !== undefined && hasCodeActionProvider(monaco, model.getLanguageId())) {
      return true;
    }
    return this.injector.get(LspFeatures).servesCodeActions(model);
  }

  /**
   * Attaches an editor's fix icon: Studio draws it in the glyph margin beside the caret's line while
   * fixes exist at the caret, and a click on it opens the menu.
   * @param editor The editor.
   * @param monaco The Monaco instance the editor was created by, whose problems the icon follows.
   * @returns Returns a function that detaches the icon.
   */
  public attach(
    editor: MonacoApi.editor.ICodeEditor,
    monaco: typeof MonacoApi | undefined,
  ): () => void {
    const indicator: QuickFixIndicator = new QuickFixIndicator(editor, monaco, {
      hasFixes: (): Promise<boolean> => this.hasFixes(editor),
      open: (): void => void this.open(editor),
      enabled: (): boolean => this.offersQuickFixes(editor),
      onMarkersChanged:
        monaco?.editor.onDidChangeMarkers === undefined
          ? undefined
          : (listener: (uris: readonly MonacoApi.Uri[]) => void): MonacoApi.IDisposable =>
              monaco.editor.onDidChangeMarkers(listener),
    });
    return (): void => indicator.dispose();
  }

  /**
   * Determines whether fixes exist at an editor's caret, for its fix icon: only fixes count, not the
   * refactors and source actions a language offers almost everywhere.
   * @param editor The editor.
   * @returns Returns a promise resolving to true when at least one fix can run there.
   */
  public async hasFixes(editor: MonacoApi.editor.ICodeEditor): Promise<boolean> {
    if (!this.offersQuickFixes(editor)) {
      return false;
    }
    const session: QuickFixSession = await this.actionsAt(editor, 'quickfix', true);
    session.dispose();
    return session.actions.some(
      (action: QuickFixAction): boolean =>
        action.disabledReason === null && isQuickFixKind(action.kind),
    );
  }

  /**
   * Opens the menu of code actions at an editor's caret: the fixes, then the refactors and source
   * actions below a divider — or one greyed row saying there are none. Choosing one applies it.
   * @param editor The editor.
   * @returns Returns a promise that resolves once the menu has opened, or could not.
   */
  public async open(editor: MonacoApi.editor.ICodeEditor): Promise<void> {
    if (editor.getModel() === null) {
      return;
    }
    if (isReadOnly(editor, instanceOf(editor))) {
      this.log.debug('quickFix', 'The editor is read-only');
      return;
    }
    const session: QuickFixSession = await this.actionsAt(editor);
    this.session?.dispose();
    this.session = session;
    this.log.info('quickFix', `Offering ${session.actions.length} code action(s)`);
    const opened: boolean = this.injector
      .get(EditorContextMenu)
      .openAtCaret(editor, buildQuickFixMenu(session.actions), (id: string): void => {
        const index: number | null = quickFixIndexOf(id);
        const action: QuickFixAction | undefined =
          index === null ? undefined : session.actions[index];
        if (action !== undefined) {
          void this.apply(editor, action);
        }
      });
    if (!opened) {
      this.log.debug('quickFix', 'No menu host is attached to the editor');
    }
  }

  /**
   * Applies a chosen code action: fills in its edit and command when they were left out, applies the
   * edit — after a confirmation when it changes several files — then runs its command on the server.
   * Anything not applied, or a command that could not run, is told.
   * @param editor The editor the menu was opened in.
   * @param chosen The action.
   * @returns Returns a promise that resolves once the action is applied, refused or abandoned.
   */
  public async apply(editor: MonacoApi.editor.ICodeEditor, chosen: QuickFixAction): Promise<void> {
    const model: MonacoApi.editor.ITextModel | null = editor.getModel();
    const monaco: typeof MonacoApi | undefined = instanceOf(editor);
    if (model === null || chosen.disabledReason !== null) {
      return;
    }
    const action: QuickFixAction =
      chosen.edit === null && chosen.resolve !== null ? await chosen.resolve() : chosen;
    const edit: WorkspaceTextEdits | null = action.edit;
    let changed: boolean = false;
    if (edit !== null && (edit.files.length > 0 || edit.refused.length > 0)) {
      if (edit.files.length > 1) {
        const confirmed: boolean = await this.confirmation.ask({
          oldName: action.title,
          newName: '',
          title: `Apply “${action.title}”?`,
          confirmLabel: 'Apply',
          files: confirmationFiles(edit.files, monaco, this.editors),
        });
        if (!confirmed) {
          this.log.debug('quickFix', 'Code action across files cancelled');
          editor.focus();
          return;
        }
      }
      const outcome: WorkspaceEditOutcome = await this.applier.apply(edit, monaco);
      changed = outcome.applied.length > 0;
      this.reportSkipped(action.title, edit.files.length, outcome);
    }
    if (action.command !== null) {
      await this.runCommand(model, action, changed);
    }
    this.session?.dispose();
    this.session = null;
    editor.focus();
  }

  /**
   * Runs a chosen action's command: on the language server for a server's action, and not at all for
   * one of Monaco's providers. A command that could not run is told — and so, when the action changed
   * nothing either, is a provider's.
   * @param model The model the action was offered in.
   * @param action The action.
   * @param changed Whether its edits changed anything.
   */
  private async runCommand(
    model: MonacoApi.editor.ITextModel,
    action: QuickFixAction,
    changed: boolean,
  ): Promise<void> {
    const command: QuickFixAction['command'] = action.command;
    if (command === null) {
      return;
    }
    if (action.origin === 'provider') {
      this.log.info('quickFix', "A provider's command is not run", command.command);
      if (!changed) {
        this.notifications.notify({
          severity: 'warning',
          title: `Couldn't apply “${action.title}”`,
          detail: 'It runs a step of the editor that Studio does not run.',
          key: NOTIFICATION_KEY,
        });
      }
      return;
    }
    const outcome: LspCommandOutcome = await this.injector
      .get(LspFeatures)
      .executeCommand(model, command);
    if (!outcome.ran) {
      this.log.warn('quickFix', 'The command did not run', outcome.reason);
      this.notifications.notify({
        severity: 'warning',
        title: changed
          ? `“${action.title}” is only partly applied`
          : `Couldn't apply “${action.title}”`,
        detail: outcome.reason,
        key: NOTIFICATION_KEY,
      });
    }
  }

  /**
   * Asks for the code actions at an editor's selection — the caret, when nothing is selected: the
   * language server's when one that offers code actions serves the document, the code-action
   * providers' otherwise.
   * @param editor The editor.
   * @param only The kind to ask for, or undefined for every kind.
   * @param automatic Whether the question is asked without the user asking (the fix icon).
   * @returns Returns the actions, with how to release them.
   */
  private async actionsAt(
    editor: MonacoApi.editor.ICodeEditor,
    only?: string,
    automatic: boolean = false,
  ): Promise<QuickFixSession> {
    const model: MonacoApi.editor.ITextModel | null = editor.getModel();
    const range: MonacoApi.IRange | null = spanOf(editor);
    const monaco: typeof MonacoApi | undefined = instanceOf(editor);
    const empty: QuickFixSession = { actions: [], dispose: (): void => undefined };
    if (model === null || range === null) {
      return empty;
    }
    const features: LspFeatures = this.injector.get(LspFeatures);
    const served: readonly LspCodeAction[] | null = await features.codeActions(
      model,
      range,
      only === undefined ? undefined : [only],
      automatic,
    );
    if (served !== null) {
      return {
        actions: served.map((action: LspCodeAction): QuickFixAction =>
          this.fromServer(model, action, features),
        ),
        dispose: (): void => undefined,
      };
    }
    if (monaco === undefined) {
      return empty;
    }
    const markers: readonly MonacoApi.editor.IMarkerData[] = monaco.editor
      .getModelMarkers({ resource: model.uri })
      .filter((marker: MonacoApi.editor.IMarker): boolean => touches(marker, range));
    const provided: ProvidedCodeActions = await providedCodeActions(
      monaco,
      model,
      range,
      markers,
      only,
    );
    return {
      actions: provided.actions.map((entry: ProvidedCodeAction): QuickFixAction =>
        this.fromProvider(monaco, entry),
      ),
      dispose: (): void => provided.dispose(),
    };
  }

  /**
   * Converts a language server's code action into the menu's shape.
   * @param model The model it was offered in.
   * @param action The server's action.
   * @param features The language-server features, which fill it in.
   * @returns Returns the action.
   */
  private fromServer(
    model: MonacoApi.editor.ITextModel,
    action: LspCodeAction,
    features: LspFeatures,
  ): QuickFixAction {
    return {
      title: action.title,
      kind: action.kind,
      isPreferred: action.isPreferred,
      disabledReason: action.disabledReason,
      edit: action.edit,
      command: action.command,
      origin: 'server',
      resolve: async (): Promise<QuickFixAction> =>
        this.fromServer(model, await features.resolveCodeAction(model, action), features),
    };
  }

  /**
   * Converts a code action of one of Monaco's providers into the menu's shape, its edit keyed by the
   * files its models show — a document with no file staying keyed by its model.
   * @param monaco The Monaco instance the provider is registered with.
   * @param entry The provider's action, and the provider.
   * @returns Returns the action.
   */
  private fromProvider(monaco: typeof MonacoApi, entry: ProvidedCodeAction): QuickFixAction {
    const action: MonacoApi.languages.CodeAction = entry.action;
    return {
      title: action.title,
      kind: action.kind ?? '',
      isPreferred: action.isPreferred === true,
      disabledReason:
        action.disabled === undefined
          ? null
          : action.disabled.length > 0
            ? action.disabled
            : "It can't be applied here.",
      edit: action.edit === undefined ? null : this.toEdits(groupWorkspaceEdit(action.edit)),
      command:
        action.command === undefined
          ? null
          : {
              title: action.command.title,
              command: action.command.id,
              ...(action.command.arguments === undefined
                ? {}
                : { arguments: action.command.arguments }),
            },
      origin: 'provider',
      resolve:
        entry.provider.resolveCodeAction === undefined
          ? null
          : async (): Promise<QuickFixAction> =>
              this.fromProvider(monaco, {
                action: await resolveProvidedCodeAction(monaco, entry),
                provider: entry.provider,
              }),
    };
  }

  /**
   * Keys a provider's edits by the files their models show.
   * @param provided The provider's edits, by model.
   * @returns Returns the edits, by file path (or model URI).
   */
  private toEdits(provided: ProvidedWorkspaceEdit): WorkspaceTextEdits {
    return {
      files: provided.files.map((file: ProvidedFileEdits): FileTextEdits => ({
        // A document with no file stays keyed by its model, which is where its edits apply.
        path: this.editors.locate(file.uri)?.path ?? file.uri,
        edits: file.edits,
      })),
      refused: provided.fileOperations === 0 ? [] : [{ path: '', reason: FILE_OPERATION_REFUSED }],
    };
  }

  /**
   * Tells the user what of an action's edits was not applied, if anything; an action applied whole
   * is in front of them, and says nothing.
   * @param title The action's title.
   * @param fileCount How many files it was to change.
   * @param outcome What applying it did.
   */
  private reportSkipped(title: string, fileCount: number, outcome: WorkspaceEditOutcome): void {
    this.log.info(
      'quickFix',
      `Applied “${title}” to ${outcome.applied.length} of ${fileCount} file(s)`,
      outcome.skipped.length > 0 ? `${outcome.skipped.length} skipped` : '',
    );
    if (outcome.skipped.length === 0) {
      return;
    }
    this.notifications.notify({
      severity: 'warning',
      title:
        outcome.applied.length === 0
          ? `Couldn't apply “${title}”`
          : `Applied “${title}” in ${outcome.applied.length} of ${fileCount} files`,
      detail: outcome.skipped
        .map((skipped: SkippedEdit): string =>
          skipped.path.length === 0
            ? skipped.reason
            : `${skipped.path.slice(Math.max(skipped.path.lastIndexOf('/'), skipped.path.lastIndexOf('\\')) + 1)} — ${skipped.reason}`,
        )
        .join('\n'),
      sticky: true,
      key: NOTIFICATION_KEY,
    });
  }
}

/**
 * Gets the span an editor's code actions are asked for: the selection, when there is one. With nothing
 * selected it is the caret's problem area — the caret together with every problem on its line — so a
 * fix is found wherever the caret sits on a line with a fixable problem, not only when it happens to
 * rest on the squiggle. Asking at the bare caret, the server was told of no problem whenever the
 * caret was off the squiggle (at the line's end, say), and answered that there was nothing to fix.
 * @param editor The editor.
 * @returns Returns the span, or null when the editor has no selection.
 */
function spanOf(editor: MonacoApi.editor.ICodeEditor): MonacoApi.IRange | null {
  const selection: MonacoApi.Selection | null = editor.getSelection();
  const model: MonacoApi.editor.ITextModel | null = editor.getModel();
  if (selection === null) {
    return null;
  }
  let span: MonacoApi.IRange = {
    startLineNumber: selection.startLineNumber,
    startColumn: selection.startColumn,
    endLineNumber: selection.endLineNumber,
    endColumn: selection.endColumn,
  };
  const monaco: typeof MonacoApi | undefined = instanceOf(editor);
  const empty: boolean =
    selection.startLineNumber === selection.endLineNumber &&
    selection.startColumn === selection.endColumn;
  if (!empty || model === null || monaco === undefined) {
    return span;
  }
  const line: number = selection.startLineNumber;
  for (const marker of monaco.editor.getModelMarkers({ resource: model.uri })) {
    if (marker.startLineNumber > line || marker.endLineNumber < line) {
      continue;
    }
    span = {
      ...(marker.startLineNumber < span.startLineNumber ||
      (marker.startLineNumber === span.startLineNumber && marker.startColumn < span.startColumn)
        ? { startLineNumber: marker.startLineNumber, startColumn: marker.startColumn }
        : { startLineNumber: span.startLineNumber, startColumn: span.startColumn }),
      ...(marker.endLineNumber > span.endLineNumber ||
      (marker.endLineNumber === span.endLineNumber && marker.endColumn > span.endColumn)
        ? { endLineNumber: marker.endLineNumber, endColumn: marker.endColumn }
        : { endLineNumber: span.endLineNumber, endColumn: span.endColumn }),
    };
  }
  return span;
}

/**
 * Determines whether a marker touches a span — overlaps it, or meets it at an end.
 * @param marker The marker.
 * @param range The span.
 * @returns Returns true when they touch.
 */
function touches(marker: MonacoApi.IRange, range: MonacoApi.IRange): boolean {
  const startsBeforeRangeEnds: boolean =
    marker.startLineNumber < range.endLineNumber ||
    (marker.startLineNumber === range.endLineNumber && marker.startColumn <= range.endColumn);
  const endsAfterRangeStarts: boolean =
    marker.endLineNumber > range.startLineNumber ||
    (marker.endLineNumber === range.startLineNumber && marker.endColumn >= range.startColumn);
  return startsBeforeRangeEnds && endsAfterRangeStarts;
}

/**
 * Resolves the Monaco instance an editor belongs to: the one loaded into its window, since each
 * window has its own.
 * @param editor The editor.
 * @returns Returns the instance, or undefined when its window has none.
 */
function instanceOf(editor: MonacoApi.editor.ICodeEditor): typeof MonacoApi | undefined {
  const view: Window | null = editor.getContainerDomNode().ownerDocument.defaultView;
  return view?.monaco ?? window.monaco;
}

/**
 * Determines whether an editor is read-only, as Monaco has computed it.
 * @param editor The editor.
 * @param monaco The editor's Monaco instance, or undefined when its window has none.
 * @returns Returns true when the editor rejects edits.
 */
function isReadOnly(
  editor: MonacoApi.editor.ICodeEditor,
  monaco: typeof MonacoApi | undefined,
): boolean {
  if (monaco !== undefined) {
    return editor.getOption(monaco.editor.EditorOption.readOnly);
  }
  return editor.getRawOptions().readOnly === true;
}
