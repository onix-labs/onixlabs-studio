import { computed, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import type {
  ReferenceList,
  ReferencesWorkspace,
} from '@shared/angular/services/references/reference-list';

/**
 * Shows a references list in a workspace's References panel (#1014).
 */
export type WorkspaceReferencesReveal = (list: ReferenceList) => void;

/**
 * Opens a file in a workspace's document well by absolute path, resolving whether it opened.
 */
export type WorkspaceReferencesOpen = (path: string) => Promise<boolean>;

/**
 * Routes references lists to the active workspace (#1014), as {@link import('../workspace-find/workspace-find').WorkspaceFind}
 * routes finds: the active directory view registers a reveal callback here, and the shared
 * {@link import('@shared/angular/services/references/references-router').ReferencesRouter} — handed
 * this seam by the workspace feature — forwards every list to it while a workspace is active.
 *
 * The active view registers its file opener alongside, so a chosen reference — or a definition — in
 * another file opens in that view's well. Each directory view provides its own opener over its own
 * dock and documents; the application-wide opener has no well anyone sees, so a file it "opens" never
 * shows an editor.
 */
@Service()
export class WorkspaceReferences implements ReferencesWorkspace {
  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the active workspace's reveal callback, or null when no directory tab is active.
   */
  private readonly handler: WritableSignal<WorkspaceReferencesReveal | null> =
    signal<WorkspaceReferencesReveal | null>(null);

  /**
   * Holds the active workspace's file opener, or null when no directory tab is active.
   */
  private opener: WorkspaceReferencesOpen | null = null;

  /**
   * Gets whether a workspace is active to show references lists.
   */
  public readonly available: Signal<boolean> = computed((): boolean => this.handler() !== null);

  /**
   * Registers the active workspace's reveal callback, and the opener its files open through.
   * @param reveal The callback that shows a list in the workspace's References panel.
   * @param open The callback that opens a file in the workspace's well, or null when it has none.
   */
  public register(
    reveal: WorkspaceReferencesReveal,
    open: WorkspaceReferencesOpen | null = null,
  ): void {
    this.opener = open;
    this.handler.set(reveal);
  }

  /**
   * Unregisters the given reveal callback, with its opener, if it is the currently registered one.
   * @param reveal The callback to unregister.
   */
  public unregister(reveal: WorkspaceReferencesReveal): void {
    if (this.handler() === reveal) {
      this.opener = null;
      this.handler.set(null);
    }
  }

  /**
   * Opens a file in the active workspace's well.
   * @param path The file's absolute path.
   * @returns Returns a promise resolving whether it opened — false when no workspace is active.
   */
  public open(path: string): Promise<boolean> {
    this.log.trace('references', 'Open in the workspace well', path);
    return this.opener === null ? Promise.resolve(false) : this.opener(path);
  }

  /**
   * Shows a list in the active workspace's References panel.
   * @param list The list.
   */
  public reveal(list: ReferenceList): void {
    this.log.trace('references', 'Reveal workspace References panel', list.kind, list.status);
    this.handler()?.(list);
  }
}
