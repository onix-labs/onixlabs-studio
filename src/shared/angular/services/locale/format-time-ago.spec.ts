import { describe, expect, it } from 'vitest';
import { formatTimeAgo } from './format-time-ago';

/**
 * Holds a minute, in milliseconds.
 */
const MINUTE: number = 60_000;

/**
 * Holds a day, in milliseconds.
 */
const DAY: number = 24 * 60 * MINUTE;

describe('formatTimeAgo', () => {
  it('reads the last minute as now', () => {
    expect(formatTimeAgo(20_000, 'en-GB')).toBe('Now');
  });

  it('reads a time in the future as now', () => {
    expect(formatTimeAgo(-5 * MINUTE, 'en-GB')).toBe('Now');
  });

  it('counts minutes, then hours', () => {
    expect(formatTimeAgo(5 * MINUTE, 'en-GB')).toBe('5 min ago');
    expect(formatTimeAgo(125 * MINUTE, 'en-GB')).toBe('2 hr ago');
  });

  it('reads one day ago as yesterday', () => {
    expect(formatTimeAgo(DAY, 'en-GB')).toBe('Yesterday');
  });

  it('counts days, then weeks, months and years', () => {
    expect(formatTimeAgo(3 * DAY, 'en-GB')).toBe('3 days ago');
    expect(formatTimeAgo(14 * DAY, 'en-GB')).toBe('2 wk ago');
    expect(formatTimeAgo(120 * DAY, 'en-GB')).toBe('4 mo ago');
    expect(formatTimeAgo(800 * DAY, 'en-GB')).toBe('2 yr ago');
  });

  it('phrases it in the language’s own grammar', () => {
    expect(formatTimeAgo(5 * MINUTE, 'fr')).toBe('Il y a 5\u00a0min');
    expect(formatTimeAgo(DAY, 'es')).toBe('Ayer');
    expect(formatTimeAgo(3 * DAY, 'de')).toBe('Vor 3 Tagen');
  });
});
