import type { SpokenLanguage } from './spoken-language';

/**
 * Holds the languages a system preference can resolve to. Pseudo is never one: it is only ever chosen
 * by name.
 */
const TRANSLATED: readonly SpokenLanguage[] = ['en', 'fr', 'es', 'de', 'zh-Hans', 'ar'];

/**
 * Finds the language Studio speaks that a system's preferred language asks for, whatever its region
 * (`fr-CA` is French).
 *
 * Chinese is told apart by script, not by region: the region only implies one. `zh-CN`, `zh-SG` and a
 * bare `zh` are written in Simplified characters, so they are Simplified Chinese; `zh-TW`, `zh-HK` and
 * `zh-MO` are written in Traditional characters, which Studio does not have yet, so they match nothing
 * and the next preference is tried. The script is inferred from the region with the locale's likely
 * subtags, so an explicit `zh-Hant-CN` or `zh-Hans-HK` is read as it says.
 * @param tag A preferred language, as a BCP 47 tag.
 * @returns Returns the language, or undefined when Studio speaks none that matches.
 */
export function spokenLanguageOf(tag: string): SpokenLanguage | undefined {
  let locale: Intl.Locale;
  try {
    locale = new Intl.Locale(tag);
  } catch {
    // A malformed tag asks for nothing Studio can match.
    return undefined;
  }
  const language: string = locale.language.toLowerCase();
  if (language === 'zh') {
    return locale.maximize().script === 'Hans' ? 'zh-Hans' : undefined;
  }
  return TRANSLATED.find((spoken: SpokenLanguage): boolean => spoken === language);
}
