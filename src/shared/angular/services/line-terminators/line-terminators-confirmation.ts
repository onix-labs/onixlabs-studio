import { Service, signal, Signal, WritableSignal } from '@angular/core';

/**
 * Asks whether to remove the unusual line terminators found in a document (#1024).
 */
export interface LineTerminatorsConfirmationRequest {
  /**
   * Gets the document's name as the question shows it: its quoted file name, or "This document".
   */
  readonly document: string;
}

/**
 * Holds the one question Studio asks when a document holds unusual line terminators — Line Separator
 * (U+2028) or Paragraph Separator (U+2029) characters, which some tools read as line breaks and others
 * do not (#1024): the request the dialog shows, and the answer it gives. It stands in for Monaco's own
 * question, which the browser's confirm box asked.
 *
 * One question is open at a time; asking another answers the first "leave them".
 */
@Service()
export class LineTerminatorsConfirmation {
  /**
   * Holds the open request, or null when none is.
   */
  private readonly pendingState: WritableSignal<LineTerminatorsConfirmationRequest | null> =
    signal<LineTerminatorsConfirmationRequest | null>(null);

  /**
   * Gets the open request, or null when none is. Read by the dialog.
   */
  public readonly pending: Signal<LineTerminatorsConfirmationRequest | null> =
    this.pendingState.asReadonly();

  /**
   * Answers the open request, or null when none is open.
   */
  private resolve: ((remove: boolean) => void) | null = null;

  /**
   * Asks whether to remove a document's unusual line terminators.
   * @param request The document asked about.
   * @returns Returns a promise resolving to true to remove them, false to leave them as they are.
   */
  public ask(request: LineTerminatorsConfirmationRequest): Promise<boolean> {
    this.answer(false);
    this.pendingState.set(request);
    return new Promise<boolean>((resolve: (remove: boolean) => void): void => {
      this.resolve = resolve;
    });
  }

  /**
   * Answers the open request, and closes it.
   * @param remove Whether to remove them.
   */
  public answer(remove: boolean): void {
    const resolve: ((remove: boolean) => void) | null = this.resolve;
    this.resolve = null;
    this.pendingState.set(null);
    resolve?.(remove);
  }
}
