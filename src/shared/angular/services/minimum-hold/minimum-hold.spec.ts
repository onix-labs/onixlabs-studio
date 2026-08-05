import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMinimumHold, MinimumHold } from './minimum-hold';

describe('createMinimumHold', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('startsOff', () => {
    expect(createMinimumHold(5000).active()).toBe(false);
  });

  it('staysOnForAtLeastTheDuration_thenClears', () => {
    const hold: MinimumHold = createMinimumHold(5000);
    hold.begin();
    expect(hold.active()).toBe(true);

    vi.advanceTimersByTime(4999);
    expect(hold.active()).toBe(true);

    vi.advanceTimersByTime(1);
    expect(hold.active()).toBe(false);
  });

  it('extendsTheHoldFromTheLatestBegin', () => {
    const hold: MinimumHold = createMinimumHold(5000);
    hold.begin();
    vi.advanceTimersByTime(3000);

    // A second begin restarts the window: the first timer must not clear the latch early.
    hold.begin();
    vi.advanceTimersByTime(3000);
    expect(hold.active()).toBe(true);

    vi.advanceTimersByTime(2000);
    expect(hold.active()).toBe(false);
  });

  it('dispose_cancelsThePendingTimer_soNothingFiresAfterwards', () => {
    const hold: MinimumHold = createMinimumHold(5000);
    hold.begin();
    hold.dispose();

    // The latch is left as-is (the owner is going away), but no scheduled callback remains to run.
    vi.advanceTimersByTime(10000);
    expect(vi.getTimerCount()).toBe(0);
  });
});
