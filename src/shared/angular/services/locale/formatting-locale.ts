import type { SpokenLanguage } from './spoken-language';
import { spokenLanguageOf } from './spoken-language-of';

/**
 * Chooses the locale dates and numbers are formatted in. The language comes from the Language
 * setting, but the region comes from the operating system when it prefers a variant of that language:
 * someone in Canada who picks French reads `2026-11-20` and `1 234,5` as Canadians write them.
 * Otherwise English is British, as Studio's own text is, and the others take their language's default.
 *
 * Arabic is written with Western digits (`-u-nu-latn`) unless the system's preference names a
 * numbering system of its own. Studio's numbers are mostly line numbers, versions, ports and sizes,
 * which sit beside code written in Western digits; Arabic's default in most regions is Arabic-Indic
 * (`١٢٣`).
 * @param language The language the interface is shown in.
 * @param preferred The operating system's preferred languages, most preferred first, as BCP 47 tags.
 * @returns Returns the locale, as a BCP 47 tag.
 */
export function formattingLocale(language: SpokenLanguage, preferred: readonly string[]): string {
  // The test language formats as English does, so only its text looks odd.
  const spoken: SpokenLanguage = language === 'pseudo' ? 'en' : language;
  const regional: string =
    preferred.find((tag: string): boolean => spokenLanguageOf(tag) === spoken) ??
    (spoken === 'en' ? 'en-GB' : spoken);
  if (spoken !== 'ar') {
    return regional;
  }
  const locale: Intl.Locale = new Intl.Locale(regional);
  return locale.numberingSystem === undefined
    ? new Intl.Locale(regional, { numberingSystem: 'latn' }).toString()
    : regional;
}
