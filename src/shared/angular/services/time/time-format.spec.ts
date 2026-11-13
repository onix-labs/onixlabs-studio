import { describe, expect, it } from 'vitest';
import { clockTime, formatDuration, formatElapsed, fullTime, taskTiming } from './time-format';

describe('time-format', () => {
  it.each([
    [0, '0s'],
    [45_900, '45s'],
    [100_000, '1m 40s'],
    [192_000, '3m 12s'],
    [3_840_000, '1h 04m'],
    [-5, '0s'],
  ])('formatElapsed(%s) is %s', (ms: number, expected: string) => {
    expect(formatElapsed(ms)).toBe(expected);
  });

  it.each([
    [undefined, ''],
    [450, '450 ms'],
    [12_400, '12.4 s'],
    [125_000, '2 min 5 s'],
  ])('formatDuration(%s) is %s', (ms: number | undefined, expected: string) => {
    expect(formatDuration(ms)).toBe(expected);
  });

  it('clockTime_isTheLocalTime_paddedToSeconds', () => {
    expect(clockTime(new Date(2026, 10, 10, 9, 5, 7).getTime())).toBe('09:05:07');
  });

  it('fullTime_endsWithHowLongAgo', () => {
    const now: number = Date.now();

    expect(fullTime(now - 4 * 60_000, now)).toMatch(/\(4 minutes ago\)$/);
  });

  it('taskTiming_startedTicksFromWhenItStarted_andFallsBackToTheReport', () => {
    const started: number = new Date(2026, 10, 10, 14, 32, 0).getTime();

    expect(taskTiming(started, 0, started + 192_000)).toBe('Started 14:32 · 3m 12s');
    expect(taskTiming(undefined, 15_000, 0)).toBe('15s');
    expect(taskTiming(undefined, 0, 0)).toBe('');
  });
});
