import { Service, signal, Signal, WritableSignal } from '@angular/core';

/**
 * Names what the user chose when asked about a new branch's upstream: set it while pushing, push
 * without setting it, or not push at all.
 */
export type UpstreamChoice = 'set' | 'push-only' | 'cancel';

/**
 * Describes the push being asked about: the branch, and the remote branch that would become its
 * upstream.
 */
export interface UpstreamQuestion {
  /**
   * Gets the local branch being pushed.
   */
  readonly branch: string;

  /**
   * Gets the remote it is pushed to.
   */
  readonly remote: string;
}

/**
 * Asks, when Set Upstream Automatically on Push is Ask, whether a branch's first push should make the
 * remote branch its upstream. The question is shown by the shell's upstream dialog; whoever asks waits
 * for the answer.
 */
@Service()
export class UpstreamConfirmation {
  /**
   * Holds the question awaiting an answer, or null.
   */
  private readonly pendingState: WritableSignal<UpstreamQuestion | null> =
    signal<UpstreamQuestion | null>(null);

  /**
   * Gets the question awaiting an answer, or null when none is.
   */
  public readonly pending: Signal<UpstreamQuestion | null> = this.pendingState.asReadonly();

  /**
   * Holds the resolver of the question awaiting an answer.
   */
  private resolve: ((choice: UpstreamChoice) => void) | null = null;

  /**
   * Asks about a push, cancelling any earlier question still open.
   * @param question The push to ask about.
   * @returns Returns a promise that resolves with the user's choice.
   */
  public ask(question: UpstreamQuestion): Promise<UpstreamChoice> {
    this.answer('cancel');
    this.pendingState.set(question);
    return new Promise<UpstreamChoice>((resolve: (choice: UpstreamChoice) => void): void => {
      this.resolve = resolve;
    });
  }

  /**
   * Answers the open question.
   * @param choice The user's choice.
   */
  public answer(choice: UpstreamChoice): void {
    const resolve: ((choice: UpstreamChoice) => void) | null = this.resolve;
    this.resolve = null;
    this.pendingState.set(null);
    resolve?.(choice);
  }
}
