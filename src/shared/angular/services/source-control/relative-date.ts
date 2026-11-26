import { interfaceLocale } from '@shared/angular/services/locale/interface-locale';

/**
 * Phrases how long ago a count of units was, in the language's own grammar: its plurals, and whether
 * "ago" comes before or after (`3 days ago`, `il y a 3 jours`, `vor 3 Tagen`).
 * @param count The count.
 * @param unit The unit.
 * @param locale The locale to phrase it in.
 * @returns Returns the phrase.
 */
function ago(count: number, unit: Intl.RelativeTimeFormatUnit, locale: string): string {
  return new Intl.RelativeTimeFormat(locale, { numeric: 'always' }).format(-count, unit);
}

/**
 * Phrases a count with its unit, as a part of a longer phrase.
 * @param count The count.
 * @param unit The unit.
 * @param locale The locale to phrase it in.
 * @returns Returns the phrase, such as `1 year` or `3 months`.
 */
function units(count: number, unit: 'year' | 'month', locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'long' }).format(count);
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
 * @param locale The locale to phrase it in; the interface's by default.
 * @returns Returns the phrase, or empty for an unreadable date.
 */
export function relativeDate(
  isoDate: string,
  now: number = Date.now(),
  locale: string = interfaceLocale(),
): string {
  const then: number = Date.parse(isoDate);
  if (Number.isNaN(then)) {
    return '';
  }
  const diff: number = Math.floor((now - then) / 1000);
  if (diff < 0) {
    return $localize`:How long ago a commit was, when its date is later than now:in the future`;
  }
  if (diff < 90) {
    return ago(diff, 'second', locale);
  }
  const minutes: number = Math.floor((diff + 30) / 60);
  if (minutes < 90) {
    return ago(minutes, 'minute', locale);
  }
  const hours: number = Math.floor((minutes + 30) / 60);
  if (hours < 36) {
    return ago(hours, 'hour', locale);
  }
  const days: number = Math.floor((hours + 12) / 24);
  if (days < 14) {
    return ago(days, 'day', locale);
  }
  if (days < 70) {
    return ago(Math.floor((days + 3) / 7), 'week', locale);
  }
  if (days < 365) {
    return ago(Math.floor((days + 15) / 30), 'month', locale);
  }
  if (days < 1825) {
    const totalMonths: number = Math.floor((days * 12 * 2 + 365) / (365 * 2));
    const years: number = Math.floor(totalMonths / 12);
    const months: number = totalMonths % 12;
    if (months === 0) {
      return ago(years, 'year', locale);
    }
    const yearsText: string = units(years, 'year', locale);
    const monthsText: string = units(months, 'month', locale);
    return $localize`:How long ago a commit was, such as "1 year, 2 months ago":${yearsText}:years:, ${monthsText}:months: ago`;
  }
  return ago(Math.floor((days + 183) / 365), 'year', locale);
}
