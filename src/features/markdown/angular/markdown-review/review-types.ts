/**
 * The category of a review issue, driving its accent colour and filter chip.
 */
export type ReviewKind = 'spelling' | 'grammar' | 'style';

/**
 * A single review finding in the active document.
 */
export interface ReviewIssue {
  /**
   * Gets the stable id for list tracking (`kind:start:end`).
   */
  readonly id: string;

  /**
   * Gets the issue category.
   */
  readonly kind: ReviewKind;

  /**
   * Gets the human rule name shown on the card (for example `Unknown word`).
   */
  readonly ruleName: string;

  /**
   * Gets the flagged text.
   */
  readonly word: string;

  /**
   * Gets the context text immediately before the flagged word (clipped).
   */
  readonly before: string;

  /**
   * Gets the context text immediately after the flagged word (clipped).
   */
  readonly after: string;

  /**
   * Gets the start offset of the flagged text in the source.
   */
  readonly start: number;

  /**
   * Gets the end offset (exclusive) of the flagged text in the source.
   */
  readonly end: number;

  /**
   * Gets the suggested replacements (may be empty for advisory issues).
   */
  readonly suggestions: readonly string[];
}

/**
 * A replacement of the source range `[start, end)`.
 */
export interface ReviewEdit {
  /**
   * Gets the start offset of the range to replace.
   */
  readonly start: number;

  /**
   * Gets the end offset (exclusive) of the range to replace.
   */
  readonly end: number;

  /**
   * Gets the replacement text.
   */
  readonly replacement: string;
}

/**
 * A review action the panel's Undo can take back.
 */
export interface ReviewUndoStep {
  /**
   * Gets the offset of the issue the action was taken on, which Undo returns to.
   */
  readonly start: number;

  /**
   * Gets the source the action left behind when it edited the document, or null when it did not. The
   * editor's history undoes whatever came last, so an edit can only be undone while this still holds.
   */
  readonly sourceAfter: string | null;

  /**
   * Reverts the action.
   * @param start The offset of the issue, carried through any edits since.
   */
  revert(start: number): void;
}

/**
 * Counts of issues per category (plus the total) for the filter chips.
 */
export interface ReviewCounts {
  /**
   * Gets the total number of issues.
   */
  readonly all: number;

  /**
   * Gets the number of spelling issues.
   */
  readonly spelling: number;

  /**
   * Gets the number of grammar issues.
   */
  readonly grammar: number;

  /**
   * Gets the number of style issues.
   */
  readonly style: number;
}

/**
 * The seam the active markdown editor registers with the review service. The editor owns the live
 * document, so the service reads its source, applies accepted suggestions, and reveals flagged ranges
 * through this session rather than touching the editor directly.
 */
export interface ReviewSession {
  /**
   * Gets the current markdown source of the active document.
   * @returns Returns the markdown source.
   */
  getSource(): string;

  /**
   * Applies edits to the live document as a single undoable step.
   * @param edits The non-overlapping edits, each against the current source.
   */
  applyEdits(edits: readonly ReviewEdit[]): void;

  /**
   * Undoes the last step in the editor's history.
   */
  undo(): void;

  /**
   * Scrolls the flagged text of an issue into view and highlights it until told otherwise.
   * @param issue The issue to reveal.
   */
  reveal(issue: ReviewIssue): void;

  /**
   * Highlights the flagged text of an issue without scrolling, so typing keeps its place.
   * @param issue The issue to highlight.
   */
  highlight(issue: ReviewIssue): void;

  /**
   * Clears the highlight.
   */
  clearHighlight(): void;
}
