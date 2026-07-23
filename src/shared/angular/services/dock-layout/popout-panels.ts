import { Service, signal, WritableSignal } from '@angular/core';

/**
 * The pop-out seam of this view's dock: which panels CAN pop out into their own OS windows (their
 * coordinators register handlers here, and the dock group chrome shows its pop-out button for
 * them), and which panels currently ARE popped out and where (`DockReveal` consults it so a reveal
 * of a popped panel focuses its window instead of touching the dock). Provided per view alongside
 * the rest of the dock services.
 */
@Service()
export class PopoutPanels {
  /**
   * Holds the popped panels: panel identifier → pop-out window identifier.
   */
  private readonly popped: WritableSignal<ReadonlyMap<string, number>> = signal<
    ReadonlyMap<string, number>
  >(new Map<string, number>());

  /**
   * Holds the pop-out handlers: panel identifier → the action that pops it out (or focuses its
   * window when it is already popped).
   */
  private readonly handlers: WritableSignal<ReadonlyMap<string, () => void>> = signal<
    ReadonlyMap<string, () => void>
  >(new Map<string, () => void>());

  /**
   * Registers a panel's pop-out handler, making the dock chrome offer the pop-out action for it.
   * @param panelId The panel identifier.
   * @param handler The action that pops the panel out.
   * @returns Returns a function that deregisters the handler (unless it was replaced since).
   */
  public registerPopOut(panelId: string, handler: () => void): () => void {
    this.handlers.update(
      (current: ReadonlyMap<string, () => void>): ReadonlyMap<string, () => void> =>
        new Map<string, () => void>(current).set(panelId, handler),
    );
    return (): void => {
      this.handlers.update(
        (current: ReadonlyMap<string, () => void>): ReadonlyMap<string, () => void> => {
          if (current.get(panelId) !== handler) {
            return current;
          }
          const next: Map<string, () => void> = new Map<string, () => void>(current);
          next.delete(panelId);
          return next;
        },
      );
    };
  }

  /**
   * Determines whether a panel can pop out (a handler is registered for it). Reactive: reading it
   * inside a computation tracks the handler set.
   * @param panelId The panel identifier.
   * @returns Returns true when the panel can pop out.
   */
  public canPopOut(panelId: string): boolean {
    return this.handlers().has(panelId);
  }

  /**
   * Pops a panel out through its registered handler. Panels without a handler are ignored.
   * @param panelId The panel identifier.
   */
  public popOut(panelId: string): void {
    this.handlers().get(panelId)?.();
  }

  /**
   * Gets the pop-out window a panel lives in. Reactive: reading it inside a computation tracks the
   * popped set.
   * @param panelId The panel identifier.
   * @returns Returns the pop-out's window identifier, or null when the panel is not popped out.
   */
  public windowIdFor(panelId: string): number | null {
    return this.popped().get(panelId) ?? null;
  }

  /**
   * Records that a panel now lives in a pop-out window.
   * @param panelId The panel identifier.
   * @param windowId The pop-out's window identifier.
   */
  public markPopped(panelId: string, windowId: number): void {
    this.popped.update((current: ReadonlyMap<string, number>): ReadonlyMap<string, number> => {
      const next: Map<string, number> = new Map<string, number>(current);
      next.set(panelId, windowId);
      return next;
    });
  }

  /**
   * Records that a panel has returned from its pop-out window. Unknown panels are ignored.
   * @param panelId The panel identifier.
   */
  public clear(panelId: string): void {
    this.popped.update((current: ReadonlyMap<string, number>): ReadonlyMap<string, number> => {
      if (!current.has(panelId)) {
        return current;
      }
      const next: Map<string, number> = new Map<string, number>(current);
      next.delete(panelId);
      return next;
    });
  }
}
