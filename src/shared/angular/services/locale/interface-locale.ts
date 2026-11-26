/**
 * Gets the locale this launch formats dates and numbers in, as the startup loader chose it (see
 * `load-language.ts`). `$localize.locale` is where Angular itself reads it from, for `LOCALE_ID`, so
 * the two can never disagree.
 * @returns Returns the locale, as a BCP 47 tag; British English before the loader has run, as in tests.
 */
export function interfaceLocale(): string {
  return typeof $localize === 'undefined' ? 'en-GB' : ($localize.locale ?? 'en-GB');
}
