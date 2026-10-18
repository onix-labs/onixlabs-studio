import { computed, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import type { FindRequest } from '@shared/angular/components/find-panel/find-request';
import { Log } from '@shared/angular/services/log/log';

/**
 * Reveals a workspace's Search panel, answering a find request when one is given (#1007).
 */
export type WorkspaceFindReveal = (request?: FindRequest) => void;

/**
 * Routes the directory (workspace) ribbon's Find command to the active workspace.
 *
 * The active directory view registers a reveal callback here; the ribbon's Find button calls
 * {@link reveal}, which forwards to it (or does nothing when no directory tab is active). Unlike the
 * editor find commands, which target the focused editor, the workspace Find always reveals the
 * workspace's multi-file Search panel. This mirrors the workspace source-control command seam.
 */
@Service()
export class WorkspaceFind {
  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the active workspace's reveal callback, or null when no directory tab is active.
   */
  private readonly handler: WritableSignal<WorkspaceFindReveal | null> =
    signal<WorkspaceFindReveal | null>(null);

  /**
   * Gets whether a workspace is active to answer finds, so an editor's ⌘F goes to its Search panel
   * rather than the tab's own Find panel (#1007).
   */
  public readonly available: Signal<boolean> = computed((): boolean => this.handler() !== null);

  /**
   * Registers the active workspace's reveal callback.
   * @param reveal The callback that reveals the workspace Search panel.
   */
  public register(reveal: WorkspaceFindReveal): void {
    this.handler.set(reveal);
  }

  /**
   * Unregisters the given reveal callback, if it is the currently registered one.
   * @param reveal The callback to unregister.
   */
  public unregister(reveal: WorkspaceFindReveal): void {
    if (this.handler() === reveal) {
      this.handler.set(null);
    }
  }

  /**
   * Reveals the active workspace's Search panel, opened as the request asks when one is given.
   * @param request The find to open, or undefined to reveal the panel as it stands.
   */
  public reveal(request?: FindRequest): void {
    this.log.trace('find', 'Reveal workspace Search panel', request?.scope);
    this.handler()?.(request);
  }
}
