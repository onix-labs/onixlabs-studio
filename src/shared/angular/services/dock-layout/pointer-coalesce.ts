/**
 * A pointer-move stream coalesced to the frame rate: {@link move} receives the raw events, and
 * {@link flush} runs the handler on the newest unprocessed one (release paths call it so a gesture
 * always ends exactly where the pointer did).
 */
export interface CoalescedPointerMoves {
  /**
   * Receives one raw pointer move.
   */
  readonly move: (event: MouseEvent) => void;

  /**
   * Runs the handler on the newest unprocessed move, if any.
   */
  readonly flush: () => void;
}

/**
 * Wraps a per-move handler so it runs at most twice per frame — once immediately for the first move
 * in a frame window (a drag must engage without waiting on a frame, and tests observe state
 * synchronously), and once on the trailing frame for whatever flood arrived behind it. High-rate
 * mice report at 500–1000Hz; work driven per event (signal writes, array rebuilds, target
 * resolution) runs several times between paints and nobody sees any of it. Without
 * `requestAnimationFrame` (jsdom without a rAF shim) every move processes synchronously, so
 * behaviour degrades to exactly what it was before coalescing existed.
 * @param handler The handler to run per processed move.
 * @returns Returns the coalesced stream.
 */
export function coalescePointerMoves(handler: (event: MouseEvent) => void): CoalescedPointerMoves {
  let pending: MouseEvent | null = null;
  let scheduled: boolean = false;
  const flush: () => void = (): void => {
    if (pending !== null) {
      const event: MouseEvent = pending;
      pending = null;
      handler(event);
    }
  };
  return {
    flush,
    move: (event: MouseEvent): void => {
      pending = event;
      if (scheduled) {
        return;
      }
      flush();
      if (typeof requestAnimationFrame !== 'undefined') {
        scheduled = true;
        requestAnimationFrame((): void => {
          scheduled = false;
          flush();
        });
      }
    },
  };
}
