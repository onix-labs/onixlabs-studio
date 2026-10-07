// Opens the design canvas instead of Studio when the page is loaded with `?canvas` (#855). Dev builds
// only: a production build replaces this file with `canvas-entry.prod.ts` (see angular.json), so the
// canvas and its fixtures never ship.

/**
 * Starts the design canvas when the page asks for it.
 * @returns Resolves true when the canvas was started, so Studio is not.
 */
export async function openDesignCanvas(): Promise<boolean> {
  if (!new URLSearchParams(window.location.search).has('canvas')) {
    return false;
  }
  const { bootstrapCanvas } = await import('./canvas-main');
  await bootstrapCanvas();
  return true;
}
