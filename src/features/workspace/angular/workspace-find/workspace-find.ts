import { Service, signal, WritableSignal } from '@angular/core';

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
   * Holds the active workspace's reveal callback, or null when no directory tab is active.
   */
  private readonly handler: WritableSignal<(() => void) | null> = signal<(() => void) | null>(null);

  /**
   * Registers the active workspace's reveal callback.
   * @param reveal The callback that reveals the workspace Search panel.
   */
  public register(reveal: () => void): void {
    this.handler.set(reveal);
  }

  /**
   * Unregisters the given reveal callback, if it is the currently registered one.
   * @param reveal The callback to unregister.
   */
  public unregister(reveal: () => void): void {
    if (this.handler() === reveal) {
      this.handler.set(null);
    }
  }

  /**
   * Reveals the active workspace's Search panel.
   */
  public reveal(): void {
    this.handler()?.();
  }
}
