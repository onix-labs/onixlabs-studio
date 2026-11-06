import { ReviewEdit } from './review-types';

/**
 * Sorts edits into document order, leaving the given list untouched.
 * @param edits The edits.
 * @returns Returns the edits in ascending start order.
 */
function inDocumentOrder(edits: readonly ReviewEdit[]): ReviewEdit[] {
  return [...edits].sort((a: ReviewEdit, b: ReviewEdit): number => a.start - b.start);
}

/**
 * Applies non-overlapping edits to a source. They run from the end of the document backwards, so an
 * earlier edit never moves the offsets of one still to come.
 * @param source The source text.
 * @param edits The edits, each against the unedited source.
 * @returns Returns the edited source.
 */
export function applyReviewEdits(source: string, edits: readonly ReviewEdit[]): string {
  return inDocumentOrder(edits)
    .reverse()
    .reduce(
      (text: string, edit: ReviewEdit): string =>
        text.slice(0, edit.start) + edit.replacement + text.slice(edit.end),
      source,
    );
}

/**
 * Finds the one edit that turns a source into another, by trimming what the two share at each end.
 * @param before The earlier source.
 * @param after The later source.
 * @returns Returns the edit, or null when the two are identical.
 */
export function changedRange(before: string, after: string): ReviewEdit | null {
  if (before === after) {
    return null;
  }
  const shortest: number = Math.min(before.length, after.length);
  let prefix: number = 0;
  while (prefix < shortest && before[prefix] === after[prefix]) {
    prefix += 1;
  }
  let suffix: number = 0;
  while (
    suffix < shortest - prefix &&
    before[before.length - suffix - 1] === after[after.length - suffix - 1]
  ) {
    suffix += 1;
  }
  return {
    start: prefix,
    end: before.length - suffix,
    replacement: after.slice(prefix, after.length - suffix),
  };
}

/**
 * Gets whether an offset's text was replaced by an edit, so what stood there has gone.
 * @param offset The offset, in the unedited source.
 * @param edits The edits.
 * @returns Returns true when the offset falls inside a replaced range.
 */
export function isOffsetReplaced(offset: number, edits: readonly ReviewEdit[]): boolean {
  return edits.some((edit: ReviewEdit): boolean => offset >= edit.start && offset < edit.end);
}

/**
 * Carries an offset through edits, so it keeps pointing at the same text. An offset inside a replaced
 * range lands on the start of its replacement.
 * @param offset The offset, in the unedited source.
 * @param edits The edits.
 * @returns Returns the offset in the edited source.
 */
export function mapOffset(offset: number, edits: readonly ReviewEdit[]): number {
  let shift: number = 0;
  for (const edit of inDocumentOrder(edits)) {
    if (offset < edit.start) {
      break;
    }
    if (offset < edit.end) {
      return edit.start + shift;
    }
    shift += edit.replacement.length - (edit.end - edit.start);
  }
  return offset + shift;
}
