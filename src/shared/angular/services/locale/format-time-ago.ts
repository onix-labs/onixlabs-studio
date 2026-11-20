import { interfaceLocale } from './interface-locale';

/**
 * Holds a minute, in milliseconds.
 */
const MINUTE: number = 60_000;

/**
 * Holds an hour, in milliseconds.
 */
const HOUR: number = 60 * MINUTE;

/**
 * Holds a day, in milliseconds.
 */
const DAY: number = 24 * HOUR;

/**
 * Phrases how long ago something happened, briefly, as a list's time column does: `Now`, `5 min ago`,
 * `Yesterday`, `3 days ago`. The language's own short forms and grammar are used (`Il y a 5 min`,
 * `Hace 5 min`, `Vor 5 Min.`), so no unit or plural is spelled out here.
 * @param elapsedMs How long ago it happened, in milliseconds; a negative figure reads as now.
 * @param locale The locale to phrase it in; the interface's by default.
 * @returns Returns the phrase, its first letter capitalised to stand at the start of a label.
 */
export function formatTimeAgo(elapsedMs: number, locale: string = interfaceLocale()): string {
  const format: Intl.RelativeTimeFormat = new Intl.RelativeTimeFormat(locale, {
    numeric: 'auto',
    style: 'short',
  });
  const elapsed: number = Math.max(0, elapsedMs);
  const days: number = Math.floor(elapsed / DAY);
  let phrase: string;
  if (elapsed < MINUTE) {
    phrase = format.format(0, 'second');
  } else if (elapsed < HOUR) {
    phrase = format.format(-Math.floor(elapsed / MINUTE), 'minute');
  } else if (elapsed < DAY) {
    phrase = format.format(-Math.floor(elapsed / HOUR), 'hour');
  } else if (days < 7) {
    phrase = format.format(-days, 'day');
  } else if (days < 30) {
    phrase = format.format(-Math.floor(days / 7), 'week');
  } else if (days < 365) {
    phrase = format.format(-Math.floor(days / 30), 'month');
  } else {
    phrase = format.format(-Math.floor(days / 365), 'year');
  }
  return phrase.charAt(0).toLocaleUpperCase(locale) + phrase.slice(1);
}
