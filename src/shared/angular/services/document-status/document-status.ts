import { computed, Service, signal, Signal, WritableSignal } from '@angular/core';

/**
 * Describes the status a document contributes to the well status strip: the caret position, the
 * language mode, the end-of-line sequence and the encoding label.
 */
export interface DocumentStatusInfo {
  /**
   * Gets the one-based line number of the caret.
   */
  readonly line: number;

  /**
   * Gets the one-based column number of the caret.
   */
  readonly column: number;

  /**
   * Gets the document's language identifier (for example "csharp").
   */
  readonly language: string;

  /**
   * Gets the document's end-of-line sequence (for example "LF" or "CRLF").
   */
  readonly eol: string;

  /**
   * Gets the document's encoding label (for example "UTF-8" or "UTF-8 with BOM").
   */
  readonly encoding: string;

  /**
   * Gets the editor zoom level, as a percentage (100 at the default zoom).
   */
  readonly zoom: number;
}

/**
 * Holds the active document's status for a dock well's status strip.
 *
 * The active document surface publishes its status here and the shared {@link DockStatusStrip} renders
 * it, so the dock (which must not know about any feature) stays generic. Publications are keyed by an
 * owner id so a deactivating document only clears the strip when it still owns it — never wiping out
 * the document that just became active.
 */
@Service()
export class DocumentStatus {
  /**
   * Holds the current status and the owner that published it, or null when no document is publishing.
   */
  private readonly current: WritableSignal<{ ownerId: string; info: DocumentStatusInfo } | null> =
    signal<{ ownerId: string; info: DocumentStatusInfo } | null>(null);

  /**
   * Gets the active document's status, or null when no document is publishing.
   */
  public readonly info: Signal<DocumentStatusInfo | null> = computed(
    (): DocumentStatusInfo | null => this.current()?.info ?? null,
  );

  /**
   * Publishes the given owner's document status as the active status.
   * @param ownerId The identifier of the publishing document.
   * @param info The document status.
   */
  public set(ownerId: string, info: DocumentStatusInfo): void {
    this.current.set({ ownerId, info });
  }

  /**
   * Clears the status, but only when the given owner is the one currently shown, so a deactivating
   * document never wipes out the document that just became active.
   * @param ownerId The identifier of the deactivating document.
   */
  public clear(ownerId: string): void {
    if (this.current()?.ownerId === ownerId) {
      this.current.set(null);
    }
  }
}
