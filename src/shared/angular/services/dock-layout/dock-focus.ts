import { inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';

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
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Focuses the stack with the given identifier.
   * @param stackId The identifier of the stack to focus.
   */
  public focus(stackId: string): void {
    this.log.trace('DockFocus', `Focused stack '${stackId}'`);
    this.focused.set(stackId);
  }
}
