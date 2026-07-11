import { Service, Signal, signal, WritableSignal } from '@angular/core';

/**
 * Owns the visibility of the keyboard-shortcuts overlay. The shell's global accelerator toggles it
 * and the overlay component reads it, so the two stay decoupled: the root registers the chord, the
 * overlay renders the state.
 */
@Service()
export class ShortcutsOverlay {
  /**
   * Holds whether the overlay is visible.
   */
  private readonly visibleState: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets whether the overlay is visible.
   */
  public readonly visible: Signal<boolean> = this.visibleState.asReadonly();

  /**
   * Toggles the overlay's visibility.
   */
  public toggle(): void {
    this.visibleState.update((visible: boolean): boolean => !visible);
  }

  /**
   * Closes the overlay.
   */
  public close(): void {
    this.visibleState.set(false);
  }
}
