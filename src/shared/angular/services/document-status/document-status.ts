import { computed, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';

/**
 * Describes the status a document contributes to the well status strip. Every field beyond the
 * language is optional because different surfaces publish different shapes: a code document publishes
 * its caret position, end-of-line sequence and encoding, while a prose (markdown) document publishes
 * its word count and read time. The strip renders only the segments the publication carries.
 */
export interface DocumentStatusInfo {
  /**
   * Gets the one-based line number of the caret, for documents with a line-oriented caret.
   */
  readonly line?: number;

  /**
   * Gets the one-based column number of the caret, for documents with a line-oriented caret.
   */
  readonly column?: number;

  /**
   * Gets the number of whitespace-separated words in the document, for prose documents.
   */
  readonly words?: number;

  /**
   * Gets the document's estimated read time in minutes, for prose documents (zero when empty, in
   * which case no read-time segment is shown).
   */
  readonly readMinutes?: number;

  /**
   * Gets the number of changed regions in a comparison, for a diff document. Zero is meaningful and
   * is shown — "no changes" is the answer to the question the strip is being asked, and is quite
   * different from a document that is not a comparison at all.
   */
  readonly changes?: number;

  /**
   * Gets the one-based index of the changed region the caret is in or has last passed, for a diff
   * document. Undefined while the caret sits above the first change, which is where it starts.
   */
  readonly currentChange?: number;

  /**
   * Gets the number of lines the comparison adds, for a diff document.
   */
  readonly linesAdded?: number;

  /**
   * Gets the number of lines the comparison removes, for a diff document.
   */
  readonly linesRemoved?: number;

  /**
   * Gets the document's language identifier (for example "csharp").
   */
  readonly language: string;

  /**
   * Gets the document's end-of-line sequence (for example "LF" or "CRLF").
   */
  readonly eol?: string;

  /**
   * Gets the document's encoding label (for example "UTF-8" or "UTF-8 with BOM").
   */
  readonly encoding?: string;
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
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

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
      this.log.trace('DocumentStatus', 'Cleared status', ownerId);
    }
  }
}
