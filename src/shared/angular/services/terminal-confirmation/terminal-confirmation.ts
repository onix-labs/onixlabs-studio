import { Service, signal, Signal, WritableSignal } from '@angular/core';

/**
 * Describes a question a terminal asks before it acts: pasting several lines, or closing while a
 * program is still running.
 */
export interface TerminalQuestion {
  /**
   * Gets the dialog's title, a question.
   */
  readonly title: string;

  /**
   * Gets what will happen, in a sentence or two.
   */
  readonly body: string;

  /**
   * Gets text shown beneath the body in a monospace box, such as the lines about to be pasted, or
   * undefined for none.
   */
  readonly detail?: string;

  /**
   * Gets the label of the button that goes ahead.
   */
  readonly confirmLabel: string;
}

/**
 * Asks the user to confirm something a terminal is about to do. One question is open at a time: a new
 * one answers the open one No, and the answer resolves the promise {@link ask} returned. Rendered by
 * the root's `app-terminal-confirm-modal`.
 */
@Service()
export class TerminalConfirmation {
  /**
   * Holds the open question, or null when none is.
   */
  private readonly pendingState: WritableSignal<TerminalQuestion | null> =
    signal<TerminalQuestion | null>(null);

  /**
   * Gets the open question, or null when none is.
   */
  public readonly pending: Signal<TerminalQuestion | null> = this.pendingState.asReadonly();

  /**
   * Holds how the open question's promise resolves, or null when none is open.
   */
  private resolve: ((confirmed: boolean) => void) | null = null;

  /**
   * Asks a question.
   * @param question The question.
   * @returns Resolves true when the user goes ahead, false when they do not.
   */
  public ask(question: TerminalQuestion): Promise<boolean> {
    this.answer(false);
    this.pendingState.set(question);
    return new Promise<boolean>((resolve: (confirmed: boolean) => void): void => {
      this.resolve = resolve;
    });
  }

  /**
   * Answers the open question, closing it.
   * @param confirmed Whether the user goes ahead.
   */
  public answer(confirmed: boolean): void {
    const resolve: ((confirmed: boolean) => void) | null = this.resolve;
    this.resolve = null;
    this.pendingState.set(null);
    resolve?.(confirmed);
  }
}
