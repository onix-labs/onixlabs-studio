import { Service, signal, Signal, WritableSignal } from '@angular/core';

/**
 * Describes the contextual information a terminal publishes to the status strip.
 */
export interface TerminalContext {
  /**
   * Gets the terminal's address (its full prompt title, e.g. `user@host:~/path`), or null when the
   * shell has not yet reported one.
   */
  readonly address: string | null;

  /**
   * Gets the terminal's shell name (its terminal type), or null when it is not yet known.
   */
  readonly shell: string | null;
}

/**
 * Holds one terminal view's context for its status strip.
 *
 * Provided by the terminal view, so there is one instance per terminal tab and its lifetime is the
 * view's. The strip reaches it through the active view's injector and is torn down with the view, so
 * there is no owner key to collide with a sibling tab and nothing to clear on a tab switch.
 */
@Service()
export class TerminalStatus {
  /**
   * Holds the view's terminal context, or null before the terminal's pane is ready.
   */
  private readonly contextSignal: WritableSignal<TerminalContext | null> =
    signal<TerminalContext | null>(null);

  /**
   * Gets the view's terminal context, or null when it has nothing to report.
   */
  public readonly context: Signal<TerminalContext | null> = this.contextSignal.asReadonly();

  /**
   * Publishes the view's terminal context.
   * @param context The terminal context (its address and shell).
   */
  public publish(context: TerminalContext): void {
    this.contextSignal.set(context);
  }

  /**
   * Drops the view's terminal context, so its status strip reports nothing.
   */
  public clear(): void {
    this.contextSignal.set(null);
  }
}
