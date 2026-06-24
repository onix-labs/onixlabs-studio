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
   * Replaces the source range `[start, end)` with the given text, editing the live document.
   * @param start The start offset of the range to replace.
   * @param end The end offset (exclusive) of the range to replace.
   * @param replacement The replacement text.
   */
  applyEdit(start: number, end: number, replacement: string): void;

  /**
   * Scrolls the flagged text of an issue into view and briefly highlights it.
   * @param issue The issue to reveal.
   */
  reveal(issue: ReviewIssue): void;
}
