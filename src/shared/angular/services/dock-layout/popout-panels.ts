import { Service, signal, WritableSignal } from '@angular/core';

/**
 * Tracks which of this view's dock panels are popped out into their own OS windows, and which
 * window each lives in. `DockReveal` consults it so a reveal of a popped panel focuses its window
 * instead of touching the dock; the panel's pop-out coordinator writes it. Provided per view
 * alongside the rest of the dock services.
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
