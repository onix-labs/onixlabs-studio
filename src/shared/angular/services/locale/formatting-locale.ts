import type { SpokenLanguage } from './spoken-language';

/**
 * Chooses the locale dates and numbers are formatted in. The language comes from the Language
 * setting, but the region comes from the operating system when it prefers a variant of that language:
 * someone in Canada who picks French reads `2026-11-20` and `1 234,5` as Canadians write them.
 * Otherwise English is British, as Studio's own text is, and the others take their language's default.
 * @param language The language the interface is shown in.
 * @param preferred The operating system's preferred languages, most preferred first, as BCP 47 tags.
 * @returns Returns the locale, as a BCP 47 tag.
 */
export function formattingLocale(language: SpokenLanguage, preferred: readonly string[]): string {
  // The test language formats as English does, so only its text looks odd.
  const base: string = language === 'pseudo' ? 'en' : language;
  const regional: string | undefined = preferred.find(
    (tag: string): boolean => tag.split('-')[0]?.toLowerCase() === base,
  );
  if (regional !== undefined) {
    return regional;
  }
  return base === 'en' ? 'en-GB' : base;
}
