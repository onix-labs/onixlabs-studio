import { Service, signal, WritableSignal } from '@angular/core';

/**
 * The pop-out seam of this view's dock: whether panels can pop out into their own OS windows, and
 * which currently ARE popped out. The dock group chrome offers the pop-out action when a handler is
 * registered; `DockReveal` consults the popped set so revealing a popped panel focuses its window
 * instead of touching the dock.
 *
 * Capability comes from ONE registered handler — the auxiliary-window pop-out that hosts any panel
 * component in a child window. Provided per view alongside the rest of the dock services.
 */
@Service()
export class PopoutPanels {
  /**
   * Holds the popped panels: panel identifier → the action focusing its window.
   */
  private readonly popped: WritableSignal<ReadonlyMap<string, () => void>> = signal<
    ReadonlyMap<string, () => void>
  >(new Map<string, () => void>());

  /**
   * Holds the pop-out handler covering every panel, or null when none is registered.
   */
  private readonly handler: WritableSignal<((panelId: string) => void) | null> = signal<
    ((panelId: string) => void) | null
  >(null);

  /**
   * Registers the pop-out handler covering every panel.
   * @param handler The action that pops a panel out, given its identifier.
   * @returns Returns a function that deregisters the handler (unless it was replaced since).
   */
  public register(handler: (panelId: string) => void): () => void {
    this.handler.set(handler);
    return (): void => {
      if (this.handler() === handler) {
        this.handler.set(null);
      }
    };
  }

  /**
   * Determines whether panels can pop out (a handler is registered). Reactive: reading it inside a
   * computation tracks the handler registration.
   * @returns Returns true when panels can pop out.
   */
  public canPopOut(): boolean {
    return this.handler() !== null;
  }

  /**
   * Pops a panel out through the registered handler. Ignored when none is registered.
   * @param panelId The panel identifier.
   */
  public popOut(panelId: string): void {
    this.handler()?.(panelId);
  }

  /**
   * Records that a panel now lives in a pop-out window.
   * @param panelId The panel identifier.
   * @param focus The action that brings the panel's window to the front.
   */
  public markPopped(panelId: string, focus: () => void): void {
    this.popped.update(
      (current: ReadonlyMap<string, () => void>): ReadonlyMap<string, () => void> =>
        new Map<string, () => void>(current).set(panelId, focus),
    );
  }

  /**
   * Records that a panel has returned from its pop-out window. Unknown panels are ignored.
   * @param panelId The panel identifier.
   */
  public clear(panelId: string): void {
    this.popped.update(
      (current: ReadonlyMap<string, () => void>): ReadonlyMap<string, () => void> => {
        if (!current.has(panelId)) {
          return current;
        }
        const next: Map<string, () => void> = new Map<string, () => void>(current);
        next.delete(panelId);
        return next;
      },
    );
  }

  /**
   * Determines whether a panel currently lives in a pop-out window. Reactive: reading it inside a
   * computation tracks the popped set.
   * @param panelId The panel identifier.
   * @returns Returns true when the panel is popped out.
   */
  public isPopped(panelId: string): boolean {
    return this.popped().has(panelId);
  }

  /**
   * Brings a popped panel's window to the front. Panels that are not popped are ignored.
   * @param panelId The panel identifier.
   */
  public focusPopped(panelId: string): void {
    this.popped().get(panelId)?.();
  }
}
