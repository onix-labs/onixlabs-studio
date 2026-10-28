import { computed, Service, Signal, signal, WritableSignal } from '@angular/core';

/**
 * Routes Go to Symbol in Workspace (#1146) — from the ribbon, the application menu or its chord — to
 * the workspace in front, which searches its own language servers. The workspace registers itself
 * while it is the active tab, as it does for Find in Files, so the shared surfaces never reach into
 * the feature.
 */
@Service()
export class WorkspaceSymbolRouter {
  /**
   * Holds the active workspace's handler, or null when no workspace is in front.
   */
  private readonly handler: WritableSignal<(() => void) | null> = signal<(() => void) | null>(null);

  /**
   * Gets whether a workspace is in front to search.
   */
  public readonly available: Signal<boolean> = computed((): boolean => this.handler() !== null);

  /**
   * Registers the workspace in front.
   * @param handler Opens its search.
   */
  public register(handler: () => void): void {
    this.handler.set(handler);
  }

  /**
   * Unregisters a workspace, if it is the one registered.
   * @param handler The handler it registered.
   */
  public unregister(handler: () => void): void {
    if (this.handler() === handler) {
      this.handler.set(null);
    }
  }

  /**
   * Opens the search in the workspace in front; does nothing when none is.
   */
  public open(): void {
    this.handler()?.();
  }
}
