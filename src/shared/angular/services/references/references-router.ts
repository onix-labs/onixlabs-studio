import { inject, Service } from '@angular/core';
import type * as MonacoApi from 'monaco-editor';
import { Log } from '@shared/angular/services/log/log';
import { ReferenceList, ReferencesHost, ReferencesWorkspace } from './reference-list';

/**
 * Routes every references list in the application to the surface that shows it (#1014), as the
 * {@link import('@shared/angular/services/find-router/find-router').FindRouter} routes a find. Monaco's
 * peek never does: its chords are removed, and Find All References — Shift+F12, or the right-click
 * row — and a Go to Definition with several answers land here with the editor they came from.
 *
 * Inside a workspace the list goes to its References panel, at the bottom beside the Error List
 * (through the {@link ReferencesWorkspace} the workspace feature contributes). Elsewhere it goes to
 * the tab's own References panel — the {@link ReferencesHost} the editor was attached with.
 */
@Service()
export class ReferencesRouter {
  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the tab whose References panel answers each attached editor. Weak, so a disposed editor's
   * entry goes with it.
   */
  private readonly hosts: WeakMap<MonacoApi.editor.ICodeEditor, ReferencesHost> = new WeakMap<
    MonacoApi.editor.ICodeEditor,
    ReferencesHost
  >();

  /**
   * Holds the workspace's side of references, or null until the workspace feature contributes it.
   */
  private workspace: ReferencesWorkspace | null = null;

  /**
   * Sets the workspace's side of references, called once by the workspace feature at start-up.
   * @param workspace The workspace's references seam.
   */
  public useWorkspace(workspace: ReferencesWorkspace): void {
    this.workspace = workspace;
  }

  /**
   * Attaches an editor with the tab whose References panel answers it outside a workspace.
   * @param editor The Monaco editor.
   * @param host The tab, or null when the editor sits in none (a workspace well document).
   * @returns Returns a function that detaches the editor.
   */
  public attach(editor: MonacoApi.editor.ICodeEditor, host: ReferencesHost | null): () => void {
    if (host === null) {
      return (): void => undefined;
    }
    this.hosts.set(editor, host);
    return (): void => {
      if (this.hosts.get(editor) === host) {
        this.hosts.delete(editor);
      }
    };
  }

  /**
   * Determines whether a references list from an editor would be shown anywhere: a workspace's
   * References panel is there, or the editor was attached with a tab that has one.
   * @param editor The editor.
   * @returns Returns true when a surface answers.
   */
  public answers(editor: MonacoApi.editor.ICodeEditor): boolean {
    return this.workspace?.available() === true || this.hosts.has(editor);
  }

  /**
   * Shows a list: in the workspace's References panel when a workspace is active, otherwise in the
   * References panel of the tab the editor was attached with. Does nothing when neither answers.
   * @param list The list.
   * @param editor The editor the search was made in.
   * @returns Returns true when a surface took the list.
   */
  public show(list: ReferenceList, editor: MonacoApi.editor.ICodeEditor): boolean {
    if (this.workspace?.available() === true) {
      this.log.debug('references', 'Route references to the workspace panel', list.kind);
      this.workspace.reveal(list);
      return true;
    }
    const host: ReferencesHost | undefined = this.hosts.get(editor);
    if (host !== undefined) {
      this.log.debug('references', "Route references to the tab's panel", list.kind);
      host.openReferences(list, editor);
      return true;
    }
    this.log.debug('references', 'No surface answers this references list', list.kind);
    return false;
  }
}
