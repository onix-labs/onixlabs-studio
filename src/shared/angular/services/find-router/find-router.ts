import { inject, Service } from '@angular/core';
import type * as MonacoApi from 'monaco-editor';
import type {
  FindMode,
  FindRange,
  FindRequest,
  FindScope,
} from '@shared/angular/components/find-panel/find-request';
import { Editors } from '@shared/angular/services/editors/editors';
import { Log } from '@shared/angular/services/log/log';
import { FindAttachment, FindHost, FindWorkspace } from './find-host';

/**
 * Routes every find in the application to the surface that answers it (#1007). Monaco's own find
 * widget never does: its chords are removed, and ⌘F / ⌘⌥F (Ctrl+F / Ctrl+H) in an editor run
 * Studio's find commands, which land here with the focused editor — as do the strip, ribbon and menu
 * Find items.
 *
 * Inside a workspace the request goes to its Search panel (through the {@link FindWorkspace} the
 * workspace feature contributes). Elsewhere it goes to the tab's own Find panel — the
 * {@link FindHost} the editor was attached with, or the one a caller names.
 */
@Service()
export class FindRouter {
  /**
   * Holds the editor registry, which knows the file each document editor shows.
   */
  private readonly editors: Editors = inject(Editors);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds what is known of each attached editor. Weak, so a disposed editor's entry goes with it.
   */
  private readonly attachments: WeakMap<MonacoApi.editor.ICodeEditor, FindAttachment> = new WeakMap<
    MonacoApi.editor.ICodeEditor,
    FindAttachment
  >();

  /**
   * Holds the workspace's side of find, or null until the workspace feature contributes it.
   */
  private workspace: FindWorkspace | null = null;

  /**
   * Sets the workspace's side of find, called once by the workspace feature at start-up.
   * @param workspace The workspace's find seam.
   */
  public useWorkspace(workspace: FindWorkspace): void {
    this.workspace = workspace;
  }

  /**
   * Attaches an editor, recording the tab that answers its finds and, where its model does not say,
   * the file it shows.
   * @param editor The Monaco editor.
   * @param attachment What is known of it.
   * @returns Returns a function that detaches the editor.
   */
  public attach(editor: MonacoApi.editor.ICodeEditor, attachment: FindAttachment): () => void {
    this.attachments.set(editor, attachment);
    return (): void => {
      if (this.attachments.get(editor) === attachment) {
        this.attachments.delete(editor);
      }
    };
  }

  /**
   * Opens a find: the workspace's Search panel when a workspace is active, otherwise the given tab's
   * own Find panel. Does nothing when neither can answer.
   * @param request The find to open.
   * @param host The tab whose Find panel answers outside a workspace, or null when there is none.
   * @param editor The editor the request came from, or null when it came from a strip or menu.
   */
  public open(
    request: FindRequest,
    host: FindHost | null = null,
    editor: MonacoApi.editor.ICodeEditor | null = null,
  ): void {
    if (this.workspace?.available() === true) {
      this.log.debug('find', 'Route find to the workspace Search panel', request.scope);
      this.workspace.reveal(request);
      return;
    }
    if (host !== null) {
      this.log.debug('find', "Route find to the tab's Find panel", request.scope);
      host.openFind(request, editor);
      return;
    }
    this.log.debug('find', 'No surface answers this find', request.scope);
  }

  /**
   * Determines whether a find from an editor would open anywhere: the workspace's Search panel is
   * there, or the editor was attached with a tab whose Find panel answers it. The right-click menu
   * offers Find only then (#1012).
   * @param editor The editor.
   * @returns Returns true when a surface answers.
   */
  public answers(editor: MonacoApi.editor.ICodeEditor): boolean {
    return (
      this.workspace?.available() === true || (this.attachments.get(editor)?.host ?? null) !== null
    );
  }

  /**
   * Opens a find from an editor — Studio's ⌘F / ⌘⌥F commands — seeded from its selection and routed
   * through the tab it was attached with.
   * @param editor The focused editor.
   * @param mode Whether to open for find or for replace.
   */
  public openFromEditor(editor: MonacoApi.editor.ICodeEditor, mode: FindMode): void {
    this.open(this.requestFrom(editor, mode), this.attachments.get(editor)?.host ?? null, editor);
  }

  /**
   * Builds a find request from an editor's state: its single-line selection as the seed, the file it
   * shows, and a snapshot of the selection for a find limited to it.
   * @param editor The editor.
   * @param mode Whether to open for find or for replace.
   * @param scope Where to look; the current file unless the caller asks otherwise.
   * @returns Returns the request.
   */
  public requestFrom(
    editor: MonacoApi.editor.ICodeEditor,
    mode: FindMode,
    scope: FindScope = 'file',
  ): FindRequest {
    const model: MonacoApi.editor.ITextModel | null = editor.getModel();
    const selection: MonacoApi.Selection | null = editor.getSelection();
    const selected: boolean = model !== null && selection !== null && !selection.isEmpty();
    const range: FindRange | null =
      selected && selection !== null
        ? {
            startLineNumber: selection.startLineNumber,
            startColumn: selection.startColumn,
            endLineNumber: selection.endLineNumber,
            endColumn: selection.endColumn,
          }
        : null;
    // Only a selection on one line seeds the query: several lines are a region to search within, not
    // text to search for.
    const seed: string | undefined =
      range !== null && model !== null && range.startLineNumber === range.endLineNumber
        ? model.getValueInRange(range)
        : undefined;
    return { mode, scope, seed, filePath: this.filePathOf(editor, model), selection: range };
  }

  /**
   * Resolves the file an editor shows: its attachment's answer when it has one, else the editor
   * registry's for its model.
   * @param editor The editor.
   * @param model The editor's model, or null when it has none.
   * @returns Returns the absolute path, or null for an editor with no file.
   */
  private filePathOf(
    editor: MonacoApi.editor.ICodeEditor,
    model: MonacoApi.editor.ITextModel | null,
  ): string | null {
    const attached: (() => string | null) | undefined = this.attachments.get(editor)?.filePath;
    if (attached !== undefined) {
      return attached();
    }
    return model === null ? null : (this.editors.locate(model.uri.toString())?.path ?? null);
  }
}
