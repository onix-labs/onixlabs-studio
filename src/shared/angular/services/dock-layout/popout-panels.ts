import { Service, signal, WritableSignal } from '@angular/core';

/**
 * The pop-out seam of this view's dock: which panels CAN pop out into their own OS windows, and
 * which currently ARE popped out. The dock group chrome offers the pop-out action for poppable
 * panels; `DockReveal` consults the popped set so revealing a popped panel focuses its window
 * instead of touching the dock.
 *
 * Capability comes in two layers: a panel-specific handler (the terminal's mirror-based
 * coordinator) wins; otherwise the registered FALLBACK — the generic auxiliary-window pop-out that
 * hosts any panel component in a child window — covers every panel. Provided per view alongside
 * the rest of the dock services.
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
   * Holds the panel-specific pop-out handlers.
   */
  private readonly handlers: WritableSignal<ReadonlyMap<string, () => void>> = signal<
    ReadonlyMap<string, () => void>
  >(new Map<string, () => void>());

  /**
   * Holds the fallback pop-out handler covering panels without a specific one, or null when none
   * is registered.
   */
  private readonly fallback: WritableSignal<((panelId: string) => void) | null> = signal<
    ((panelId: string) => void) | null
  >(null);

  /**
   * Registers a panel's specific pop-out handler.
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
   * Registers the fallback pop-out handler covering every panel without a specific one.
   * @param handler The action that pops a panel out, given its identifier.
   * @returns Returns a function that deregisters the fallback (unless it was replaced since).
   */
  public registerFallback(handler: (panelId: string) => void): () => void {
    this.fallback.set(handler);
    return (): void => {
      if (this.fallback() === handler) {
        this.fallback.set(null);
      }
    };
  }

  /**
   * Determines whether a panel can pop out. Reactive: reading it inside a computation tracks the
   * handler registrations.
   * @param panelId The panel identifier.
   * @returns Returns true when the panel can pop out.
   */
  public canPopOut(panelId: string): boolean {
    return this.handlers().has(panelId) || this.fallback() !== null;
  }

  /**
   * Pops a panel out through its specific handler, falling back to the generic one. Panels with
   * neither are ignored.
   * @param panelId The panel identifier.
   */
  public popOut(panelId: string): void {
    const specific: (() => void) | undefined = this.handlers().get(panelId);
    if (specific !== undefined) {
      specific();
      return;
    }
    this.fallback()?.(panelId);
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
