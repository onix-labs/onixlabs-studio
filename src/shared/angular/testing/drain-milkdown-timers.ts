/**
 * How long `@milkdown/ctx` gives one of its timers to be signalled before the watchdog fires, in
 * milliseconds — `createTimer`'s default, which the editor's timers all take.
 */
const MILKDOWN_TIMER_TIMEOUT_MS: number = 3_000;

/**
 * The margin added to the wait, so a watchdog armed in the very last moments of the last test is
 * still comfortably past its deadline when the wait ends.
 */
const DRAIN_MARGIN_MS: number = 250;

/**
 * Waits out the timer watchdogs a booted Milkdown editor leaves behind, so they fire while the test
 * environment is still standing.
 *
 * `@milkdown/ctx` arms every timer with a bare `setTimeout` and keeps no handle for it, so nothing —
 * not the timer resolving, not `Crepe.destroy()` — ever clears it. Each watchdog therefore stays
 * pending for its full three seconds after the editor that armed it has gone. That is harmless
 * mid-run: it fires, finds its timer already resolved, and removes a listener. It is not harmless at
 * the end of a run. The callback reaches for `removeEventListener`, and if the runner has torn the
 * environment down by then the global no longer exists — the watchdog throws
 * `ReferenceError: removeEventListener is not defined` with no test to attribute it to, and the run
 * fails on the uncaught error though every test passed.
 *
 * Whether that happens is pure timing, which is the trap: a suite can pass for weeks and then fail on
 * a machine that finishes a few hundred milliseconds sooner. Any spec that boots a Crepe editor
 * should therefore drain in `afterAll`, holding the environment open until the watchdogs it armed have
 * all had their moment.
 * @returns Resolves once every watchdog armed by this spec file has fired.
 */
export function drainMilkdownTimers(): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, MILKDOWN_TIMER_TIMEOUT_MS + DRAIN_MARGIN_MS);
  });
}
