// The production stand-in for `canvas-entry.ts` (#855): the conversation canvas is a development tool, and
// this replacement keeps it — and its fixtures — out of the shipped bundle.

/**
 * Never starts the canvas.
 * @returns Resolves false.
 */
export function openDesignCanvas(): Promise<boolean> {
  return Promise.resolve(false);
}
