import { signal, Signal, WritableSignal } from '@angular/core';

/**
 * A latch that, once begun, stays on for at least a minimum duration — used to keep transient
 * feedback (a spinner, a "saved" flash) visible long enough to register even when the work it stands
 * for finishes near-instantly.
 */
export interface MinimumHold {
  /**
   * Gets whether the latch is currently on.
   */
  readonly active: Signal<boolean>;

  /**
   * Turns the latch on and (re)starts its minimum-duration timer; a fresh call while already on
   * extends the hold from now.
   */
  begin(): void;

  /**
   * Cancels the pending timer, so a destroyed owner leaves nothing scheduled. Does not clear the
   * latch (the owner is going away regardless).
   */
  dispose(): void;
}

/**
 * Creates a {@link MinimumHold} that stays on for at least {@link durationMs} after each
 * {@link MinimumHold.begin}. Compose it with the real in-progress signal (`hold.active() || busy()`)
 * so the flag reads on for the longer of the two — the actual work, or the minimum visible window.
 * @param durationMs The minimum time, in milliseconds, the latch stays on after begin.
 * @returns Returns the hold.
 */
export function createMinimumHold(durationMs: number): MinimumHold {
  const active: WritableSignal<boolean> = signal<boolean>(false);
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clear: () => void = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    active: active.asReadonly(),
    begin(): void {
      active.set(true);
      clear();
      timer = setTimeout((): void => {
        active.set(false);
        timer = null;
      }, durationMs);
    },
    dispose(): void {
      clear();
    },
  };
}
