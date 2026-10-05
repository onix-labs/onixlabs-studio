import { describe, expect, it } from 'vitest';
import { relativeDate } from './relative-date';

/**
 * A fixed "now".
 */
const NOW: number = Date.parse('2026-10-05T12:00:00Z');

/**
 * Builds the ISO date a number of seconds before {@link NOW}.
 * @param seconds How long before.
 * @returns Returns the date.
 */
function ago(seconds: number): string {
  return new Date(NOW - seconds * 1000).toISOString();
}

describe('relativeDate', () => {
  it('followsGitsThresholdsAndRounding', () => {
    const minute: number = 60;
    const hour: number = 60 * minute;
    const day: number = 24 * hour;
    expect(relativeDate(ago(1), NOW)).toBe('1 second ago');
    expect(relativeDate(ago(45), NOW)).toBe('45 seconds ago');
    expect(relativeDate(ago(10 * minute), NOW)).toBe('10 minutes ago');
    expect(relativeDate(ago(3 * hour), NOW)).toBe('3 hours ago');
    expect(relativeDate(ago(2 * day), NOW)).toBe('2 days ago');
    expect(relativeDate(ago(20 * day), NOW)).toBe('3 weeks ago');
    expect(relativeDate(ago(100 * day), NOW)).toBe('3 months ago');
    expect(relativeDate(ago(400 * day), NOW)).toBe('1 year, 1 month ago');
    expect(relativeDate(ago(730 * day), NOW)).toBe('2 years ago');
    expect(relativeDate(ago(3000 * day), NOW)).toBe('8 years ago');
  });

  it('handlesTheFutureAndUnreadableDates', () => {
    expect(relativeDate(new Date(NOW + 60_000).toISOString(), NOW)).toBe('in the future');
    expect(relativeDate('not a date', NOW)).toBe('');
  });
});
