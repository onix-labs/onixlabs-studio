/**
 * Single-character step used when scanning rendered text for the next occurrence of a word.
 */
export const WORD_STEP: number = 1;

/**
 * Divisor that centres a revealed range within the scroll viewport.
 */
export const REVEAL_CENTRE_DIVISOR: number = 2;

/**
 * Determines whether the CSS Custom Highlight API is available for review and read-along highlighting.
 * Both collaborators paint over the rendered text through this API, which is absent under unit tests.
 * @returns Returns true when the API can be used.
 */
export function supportsHighlight(): boolean {
  return typeof Highlight !== 'undefined' && typeof CSS !== 'undefined' && Boolean(CSS.highlights);
}
