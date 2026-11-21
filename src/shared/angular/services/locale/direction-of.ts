import type { SpokenLanguage } from './spoken-language';
import type { TextDirection } from './text-direction';

/**
 * Gets the direction a language's interface is laid out in, as the document's `dir` takes it. Arabic
 * reads right to left, so the interface mirrors for it; code, terminals and paths stay left to right
 * whatever the language (see `docs/localisation.md`).
 * @param language The language the interface is shown in.
 * @returns Returns the direction.
 */
export function directionOf(language: SpokenLanguage): TextDirection {
  return language === 'ar' ? 'rtl' : 'ltr';
}
