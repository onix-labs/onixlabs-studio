import { signal, Signal, WritableSignal } from '@angular/core';

/**
 * A once-a-second clock for a flyout that shows live running times (#1419). It ticks only between
 * {@link start} and {@link stop} — wired to the menu opening and closing — so a closed menu costs no
 * change detection, and nothing ticks for a list nobody can see.
 */
export class MenuClock {
  /**
   * Holds the current time, in epoch milliseconds, as of the last tick.
   */
  private readonly current: WritableSignal<number> = signal<number>(Date.now());

  /**
   * Holds the ticking interval, or null while the menu is closed.
   */
  private timer: ReturnType<typeof setInterval> | null = null;

  /**
   * Gets the current time as of the last tick.
   */
  public readonly now: Signal<number> = this.current.asReadonly();

  /**
   * Starts ticking, from now.
   */
  public start(): void {
    this.current.set(Date.now());
    this.timer ??= setInterval((): void => this.current.set(Date.now()), 1000);
  }

  /**
   * Stops ticking.
   */
  public stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
