import { Service, signal, Signal, WritableSignal } from '@angular/core';

/**
 * Tracks which dock stack currently has focus, so only the focused panel is accented while the
 * others render a neutral border.
 */
@Service()
export class DockFocus {
  /**
   * Holds the identifier of the focused stack, or null when none is focused.
   */
  private readonly focused: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Gets the identifier of the focused stack, or null when none is focused.
   */
  public readonly focusedStackId: Signal<string | null> = this.focused.asReadonly();

  /**
   * Focuses the stack with the given identifier.
   * @param stackId The identifier of the stack to focus.
   */
  public focus(stackId: string): void {
    this.focused.set(stackId);
  }
}
