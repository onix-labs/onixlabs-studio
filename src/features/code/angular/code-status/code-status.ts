import { Service, signal, Signal, WritableSignal } from '@angular/core';

/**
 * Identifies the end-of-line sequence of the active document.
 */
export type EndOfLine = 'LF' | 'CRLF';

/**
 * Describes the contextual information a code editor publishes to the status strip.
 */
export interface CodeContext {
  /**
   * Gets the absolute file path, or null when the document is unsaved ("New Document").
   */
  readonly path: string | null;

  /**
   * Gets the one-based line number of the cursor.
   */
  readonly line: number;

  /**
   * Gets the one-based column number of the cursor.
   */
  readonly column: number;

  /**
   * Gets the document's end-of-line sequence.
   */
  readonly eol: EndOfLine;

  /**
   * Gets the document's encoding label (for example "UTF-8" or "UTF-8 with BOM").
   */
  readonly encoding: string;
}

/**
 * Holds one code view's editor context for its status strip.
 *
 * Provided by the code view, so there is one instance per code tab and its lifetime is the view's.
 * The strip reaches it through the active view's injector and is torn down with the view, so there is
 * no owner key to collide with a sibling tab and nothing to clear when the tab is switched away from.
 */
@Service()
export class CodeStatus {
  /**
   * Holds the view's editor context, or null before the editor has a document and a caret.
   */
  private readonly contextSignal: WritableSignal<CodeContext | null> = signal<CodeContext | null>(
    null,
  );

  /**
   * Gets the view's editor context, or null when it has no document and caret to report.
   */
  public readonly context: Signal<CodeContext | null> = this.contextSignal.asReadonly();

  /**
   * Publishes the view's editor context.
   * @param context The editor context.
   */
  public publish(context: CodeContext): void {
    this.contextSignal.set(context);
  }

  /**
   * Drops the view's editor context, so its status strip reports nothing.
   */
  public clear(): void {
    this.contextSignal.set(null);
  }
}
