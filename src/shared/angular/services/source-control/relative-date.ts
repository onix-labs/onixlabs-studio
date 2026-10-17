/**
 * Phrases a count with its unit, singular for one.
 * @param count The count.
 * @param unit The singular unit.
 * @returns Returns the phrase, such as `1 day` or `3 days`.
 */
function units(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'}`;
}

/**
 * Phrases how long ago an ISO date was, the way git's `%ar` does (#816).
 *
 * The history used to show git's own phrase. Behind the version-control protocol a plugin reports the
 * absolute date and the renderer phrases it — a plugin cannot know when its answer will be read — so
 * this follows git's rounding and thresholds (`show_date_relative` in git's `date.c`), and the commit
 * list reads exactly as it did.
 * @param isoDate The date, ISO 8601.
 * @param now The current time, in epoch milliseconds.
 * @returns Returns the phrase, or empty for an unreadable date.
 */
export function relativeDate(isoDate: string, now: number = Date.now()): string {
  const then: number = Date.parse(isoDate);
  if (Number.isNaN(then)) {
    return '';
  }
  const diff: number = Math.floor((now - then) / 1000);
  if (diff < 0) {
    return 'in the future';
  }
  if (diff < 90) {
    return `${units(diff, 'second')} ago`;
  }
  const minutes: number = Math.floor((diff + 30) / 60);
  if (minutes < 90) {
    return `${units(minutes, 'minute')} ago`;
  }
  const hours: number = Math.floor((minutes + 30) / 60);
  if (hours < 36) {
    return `${units(hours, 'hour')} ago`;
  }
  const days: number = Math.floor((hours + 12) / 24);
  if (days < 14) {
    return `${units(days, 'day')} ago`;
  }
  if (days < 70) {
    return `${units(Math.floor((days + 3) / 7), 'week')} ago`;
  }
  if (days < 365) {
    return `${units(Math.floor((days + 15) / 30), 'month')} ago`;
  }
  if (days < 1825) {
    const totalMonths: number = Math.floor((days * 12 * 2 + 365) / (365 * 2));
    const years: number = Math.floor(totalMonths / 12);
    const months: number = totalMonths % 12;
    return months === 0
      ? `${units(years, 'year')} ago`
      : `${units(years, 'year')}, ${units(months, 'month')} ago`;
  }
  return `${units(Math.floor((days + 183) / 365), 'year')} ago`;
}
