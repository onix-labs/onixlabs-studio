import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MenuClock } from './menu-clock';

describe('MenuClock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ticksEverySecond_whileStarted_andNotOnceStopped', () => {
    // #1419: a closed flyout costs nothing.
    const clock: MenuClock = new MenuClock();
    clock.start();
    const opened: number = clock.now();

    vi.advanceTimersByTime(2000);
    expect(clock.now()).toBe(opened + 2000);

    clock.stop();
    vi.advanceTimersByTime(5000);
    expect(clock.now()).toBe(opened + 2000);
  });

  it('start_whenStartedAgain_readsTheTimeAtOnce_withoutASecondTimer', () => {
    const clock: MenuClock = new MenuClock();
    clock.start();
    vi.advanceTimersByTime(10_000);
    clock.stop();
    vi.advanceTimersByTime(60_000);

    clock.start();
    clock.start();
    const reopened: number = clock.now();
    vi.advanceTimersByTime(1000);

    expect(reopened).toBe(Date.now() - 1000);
    expect(clock.now()).toBe(reopened + 1000);
    expect(vi.getTimerCount()).toBe(1);
    clock.stop();
  });
});
