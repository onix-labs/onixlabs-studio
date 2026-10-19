import { inject, Injector, Service } from '@angular/core';
import type * as MonacoApi from 'monaco-editor';
import { Editors } from '@shared/angular/services/editors/editors';
import { GoToRouter } from '@shared/angular/services/go-to/go-to-router';
import { Log } from '@shared/angular/services/log/log';
import {
  LspFeatures,
  LspRenameAnswer,
  LspRenamePreparation,
} from '@shared/angular/services/lsp/lsp-features';
import {
  hasRenameProvider,
  ProvidedFileEdits,
  ProvidedRename,
  providedRenameEdits,
  providedRenameLocation,
} from '@shared/angular/services/monaco/monaco-editor-capabilities';
import { Notifications } from '@shared/angular/services/notifications/notifications';
import {
  FILE_OPERATION_REFUSED,
  FileTextEdits,
  SkippedEdit,
  WorkspaceEditOutcome,
  WorkspaceTextEdits,
} from '@shared/angular/services/workspace-edit/workspace-edit';
import { WorkspaceEditApplier } from '@shared/angular/services/workspace-edit/workspace-edit-applier';
import { RenameConfirmation, RenameConfirmationFile } from './rename-confirmation';

/**
 * Holds the reason shown when a symbol cannot be renamed and nothing said why.
 */
const NOTHING_TO_RENAME: string =
  'Put the caret on a symbol — a variable, a function, a type — to rename it.';

/**
 * Renames the symbol at an editor's caret the way Studio does it rather than Monaco (#1015): F2 and
 * the right-click menu's Rename Symbol reach it, and Monaco's rename box never opens.
 *
 * First it asks whether the symbol can be renamed, and what its name spans — the language server that
 * serves the document, or else the rename providers Monaco's own languages register; a symbol that
 * cannot be renamed says so. Then it asks for the new name the way the "Go to style" setting says — the
 * quick-open box or a dialog — opening with the name as it stands. The edits that rename it come back
 * by file: a rename in one file is applied straight away, and one across several files lists them,
 * with how many places change in each, for the user to confirm first. Open files change in their
 * editors, unsaved and undoable; closed files change on disk, confined to the workspace. Anything that
 * could not be changed is named.
 */
@Service()
export class RenameSymbol {
  /**
   * Holds the go-to router the new name is asked for through.
   */
  private readonly goToRouter: GoToRouter = inject(GoToRouter);

  /**
   * Holds the confirmation a rename across several files asks.
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
   * Holds the notifications a refusal, and anything skipped, are told through.
   */
  private readonly notifications: Notifications = inject(Notifications);

  /**
   * Holds the injector the language-server features are resolved from as they are needed. Resolved
   * then rather than injected here: they reach into Monaco, whose commands reach back here.
   */
  private readonly injector: Injector = inject(Injector);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Determines whether Rename Symbol can answer in an editor: it can be edited, and a rename provider
   * is registered for its language or a language server that renames serves it.
   * @param editor The editor.
   * @returns Returns true when it can.
   */
  public offersRename(editor: MonacoApi.editor.ICodeEditor): boolean {
    const model: MonacoApi.editor.ITextModel | null = editor.getModel();
    const monaco: typeof MonacoApi | undefined = instanceOf(editor);
    if (model === null || isReadOnly(editor, monaco)) {
      return false;
    }
    if (monaco !== undefined && hasRenameProvider(monaco, model.getLanguageId())) {
      return true;
    }
    return this.injector.get(LspFeatures).servesRename(model);
  }

  /**
   * Renames the symbol at the caret: says so when it cannot be renamed, asks for the new name, then
   * applies the rename — straight away in one file, after a confirmation across several.
   * @param editor The editor.
   * @returns Returns a promise that resolves once the rename is applied, refused or abandoned.
   */
  public async rename(editor: MonacoApi.editor.ICodeEditor): Promise<void> {
    const model: MonacoApi.editor.ITextModel | null = editor.getModel();
    const position: MonacoApi.Position | null = editor.getPosition();
    const monaco: typeof MonacoApi | undefined = instanceOf(editor);
    if (model === null || position === null) {
      return;
    }
    if (isReadOnly(editor, monaco)) {
      this.log.debug('rename', 'The editor is read-only');
      return;
    }
    const prepared: LspRenamePreparation = await this.prepare(model, position, monaco);
    if (prepared.kind === 'refused') {
      this.log.info('rename', 'The symbol cannot be renamed', prepared.reason ?? '');
      this.notifications.notify({
        severity: 'warning',
        title: "Can't rename this",
        detail: prepared.reason ?? NOTHING_TO_RENAME,
        key: 'rename-symbol',
      });
      return;
    }
    const newName: string | null = await this.goToRouter.promptRename(editor, prepared.placeholder);
    if (newName === null) {
      this.log.debug('rename', 'Rename abandoned');
      return;
    }
    const answer: LspRenameAnswer = await this.editsFor(model, position, newName, monaco);
    if (answer.kind === 'refused') {
      this.log.info('rename', 'The rename was refused', answer.reason ?? '');
      this.notifications.notify({
        severity: 'warning',
        title: `Couldn't rename “${prepared.placeholder}”`,
        detail: answer.reason ?? NOTHING_TO_RENAME,
        key: 'rename-symbol',
      });
      return;
    }
    const edits: WorkspaceTextEdits = answer.edits;
    if (edits.files.length === 0 && edits.refused.length === 0) {
      this.notifications.notify({
        severity: 'info',
        title: `Nothing to rename for “${prepared.placeholder}”`,
        key: 'rename-symbol',
      });
      return;
    }
    if (edits.files.length > 1) {
      const confirmed: boolean = await this.confirmation.ask({
        oldName: prepared.placeholder,
        newName,
        files: this.listFiles(edits.files, monaco),
      });
      if (!confirmed) {
        this.log.debug('rename', 'Rename across files cancelled');
        editor.focus();
        return;
      }
    }
    const outcome: WorkspaceEditOutcome = await this.applier.apply(edits, monaco);
    editor.focus();
    this.report(prepared.placeholder, newName, edits.files.length, outcome);
  }

  /**
   * Asks whether the symbol at a position can be renamed: the language server first, then the rename
   * providers.
   * @param model The model.
   * @param position The one-based position.
   * @param monaco The model's Monaco instance, or undefined when its window has none.
   * @returns Returns the name's span and text, or why it cannot be renamed.
   */
  private async prepare(
    model: MonacoApi.editor.ITextModel,
    position: MonacoApi.Position,
    monaco: typeof MonacoApi | undefined,
  ): Promise<LspRenamePreparation> {
    const served: LspRenamePreparation | null = await this.injector
      .get(LspFeatures)
      .prepareRename(model, position);
    if (served !== null) {
      return served;
    }
    const provided: LspRenamePreparation | null =
      monaco === undefined ? null : await providedRenameLocation(monaco, model, position);
    return provided ?? { kind: 'refused', reason: null };
  }

  /**
   * Asks for the edits that rename the symbol at a position: the language server's, by path, when one
   * serves the document; otherwise the rename providers', mapped to the files their models show.
   * @param model The model.
   * @param position The one-based position.
   * @param newName The new name.
   * @param monaco The model's Monaco instance, or undefined when its window has none.
   * @returns Returns the edits by document, or why there are none.
   */
  private async editsFor(
    model: MonacoApi.editor.ITextModel,
    position: MonacoApi.Position,
    newName: string,
    monaco: typeof MonacoApi | undefined,
  ): Promise<LspRenameAnswer> {
    const served: LspRenameAnswer | null = await this.injector
      .get(LspFeatures)
      .rename(model, position, newName);
    if (served !== null) {
      return served;
    }
    const provided: ProvidedRename | null =
      monaco === undefined ? null : await providedRenameEdits(monaco, model, position, newName);
    if (provided === null) {
      return { kind: 'refused', reason: null };
    }
    if (provided.kind === 'refused') {
      return provided;
    }
    const refused: SkippedEdit[] =
      provided.fileOperations === 0 ? [] : [{ path: '', reason: FILE_OPERATION_REFUSED }];
    return {
      kind: 'edits',
      edits: {
        files: provided.files.map((file: ProvidedFileEdits): FileTextEdits => ({
          // A document with no file stays keyed by its model, which is where its edits apply.
          path: this.editors.locate(file.uri)?.path ?? file.uri,
          edits: file.edits,
        })),
        refused,
      },
    };
  }

  /**
   * Lists the files a rename changes for its confirmation: each by name, in the folder it is in below
   * the one they all share, with how many places change and whether it is open.
   * @param files The files and their edits.
   * @param monaco The Monaco instance whose models hold the open files, or undefined.
   * @returns Returns the files, in the rename's order.
   */
  private listFiles(
    files: readonly FileTextEdits[],
    monaco: typeof MonacoApi | undefined,
  ): readonly RenameConfirmationFile[] {
    const models: ReadonlySet<string> = new Set<string>(
      (monaco?.editor.getModels() ?? []).map((model: MonacoApi.editor.ITextModel): string =>
        model.uri.toString(),
      ),
    );
    const shared: string = sharedFolder(files.map((file: FileTextEdits): string => file.path));
    return files.map((file: FileTextEdits): RenameConfirmationFile => {
      const slash: number = Math.max(file.path.lastIndexOf('/'), file.path.lastIndexOf('\\'));
      const folder: string = slash < 0 ? '' : file.path.slice(0, slash);
      return {
        path: file.path,
        name: file.path.slice(slash + 1),
        folder: folder.length > shared.length ? folder.slice(shared.length + 1) : '',
        edits: file.edits.length,
        open: this.editors.modelUriForPath(file.path) !== undefined || models.has(file.path),
      };
    });
  }

  /**
   * Tells the user how a rename went: nothing when it all applied in one file, which is in front of
   * them; a note when it applied across several; and each file skipped, with why, when any was.
   * @param oldName The symbol's old name.
   * @param newName Its new name.
   * @param fileCount How many files the rename was to change.
   * @param outcome What applying it did.
   */
  private report(
    oldName: string,
    newName: string,
    fileCount: number,
    outcome: WorkspaceEditOutcome,
  ): void {
    this.log.info(
      'rename',
      `Renamed in ${outcome.applied.length} of ${fileCount} file(s)`,
      outcome.skipped.length > 0 ? `${outcome.skipped.length} skipped` : '',
    );
    if (outcome.skipped.length > 0) {
      this.notifications.notify({
        severity: 'warning',
        title:
          outcome.applied.length === 0
            ? `Couldn't rename “${oldName}”`
            : `Renamed “${oldName}” in ${outcome.applied.length} of ${fileCount} files`,
        detail: outcome.skipped
          .map((skipped: SkippedEdit): string =>
            skipped.path.length === 0
              ? skipped.reason
              : `${skipped.path.slice(Math.max(skipped.path.lastIndexOf('/'), skipped.path.lastIndexOf('\\')) + 1)} — ${skipped.reason}`,
          )
          .join('\n'),
        sticky: true,
        key: 'rename-symbol',
      });
      return;
    }
    if (outcome.applied.length > 1) {
      this.notifications.notify({
        severity: 'success',
        title: `Renamed “${oldName}” to “${newName}” in ${outcome.applied.length} files`,
        detail: outcome.applied.some(
          (file: WorkspaceEditOutcome['applied'][number]): boolean => file.where === 'editor',
        )
          ? 'Open files are changed but not saved.'
          : undefined,
        key: 'rename-symbol',
      });
    }
  }
}

/**
 * Finds the folder every path shares: the longest run of whole folders they all start with.
 * @param paths The paths.
 * @returns Returns the folder, or empty when they share none.
 */
function sharedFolder(paths: readonly string[]): string {
  const folders: readonly string[][] = paths.map((path: string): string[] =>
    path.split(/[\\/]/).slice(0, -1),
  );
  const first: readonly string[] = folders[0] ?? [];
  let length: number = first.length;
  for (const folder of folders) {
    let index: number = 0;
    while (index < length && folder[index] === first[index]) {
      index++;
    }
    length = index;
  }
  return first.slice(0, length).join('/');
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
