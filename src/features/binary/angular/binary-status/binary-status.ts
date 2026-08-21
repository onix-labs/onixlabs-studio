import { Service, signal, Signal, WritableSignal } from '@angular/core';

/**
 * Describes the contextual information a binary editor publishes to the status strip.
 */
export interface BinaryContext {
  /**
   * Gets the absolute file path.
   */
  readonly path: string;

  /**
   * Gets the cursor's byte offset, or null when there is no cursor.
   */
  readonly offset: number | null;

  /**
   * Gets the number of selected bytes (zero when nothing is selected).
   */
  readonly selectionLength: number;

  /**
   * Gets the total file size in bytes.
   */
  readonly size: number;

  /**
   * Gets the sniffed container-format label (for example "PE · x64" or "Binary").
   */
  readonly format: string;

  /**
   * Gets a value indicating whether the document has unsaved edits.
   */
  readonly dirty: boolean;

  /**
   * Gets a value indicating whether typing inserts (true) or overwrites (false).
   */
  readonly insertMode: boolean;
}

/**
 * Holds one binary view's editor context for its status strip. Mirrors `CodeStatus`.
 *
 * Provided by the binary view, so there is one instance per binary tab and its lifetime is the view's.
 * The strip reaches it through the active view's injector and is torn down with the view, so there is
 * no owner key to collide with a sibling tab and nothing to clear on a tab switch.
 */
@Service()
export class BinaryStatus {
  /**
   * Holds the view's editor context, or null before the editor has a document.
   */
  private readonly contextSignal: WritableSignal<BinaryContext | null> =
    signal<BinaryContext | null>(null);

  /**
   * Gets the view's editor context, or null when it has no document to report.
   */
  public readonly context: Signal<BinaryContext | null> = this.contextSignal.asReadonly();

  /**
   * Publishes the view's editor context.
   * @param context The editor context.
   */
  public publish(context: BinaryContext): void {
    this.contextSignal.set(context);
  }

  /**
   * Drops the view's editor context, so its status strip reports nothing.
   */
  public clear(): void {
    this.contextSignal.set(null);
  }
}
