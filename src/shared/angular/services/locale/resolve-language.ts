import type { InterfaceLanguage } from '@shared/api/startup-settings';
import type { SpokenLanguage } from './spoken-language';

/**
 * Holds the languages System can resolve to. Pseudo is never one: it is only ever chosen by name.
 */
const TRANSLATED: readonly SpokenLanguage[] = ['en', 'fr', 'es', 'de'];

/**
 * Resolves the Language setting to the language the interface is shown in. System takes the first of
 * the operating system's preferred languages that Studio speaks, whatever its region (`fr-CA` is
 * French), and falls back to English when it speaks none of them.
 * @param setting The Language setting.
 * @param preferred The operating system's preferred languages, most preferred first, as BCP 47 tags.
 * @returns Returns the language.
 */
export function resolveLanguage(
  setting: InterfaceLanguage,
  preferred: readonly string[],
): SpokenLanguage {
  if (setting !== 'system') {
    return setting;
  }
  for (const tag of preferred) {
    const base: string = tag.split('-')[0]?.toLowerCase() ?? '';
    const match: SpokenLanguage | undefined = TRANSLATED.find(
      (language: SpokenLanguage): boolean => language === base,
    );
    if (match !== undefined) {
      return match;
    }
  }
  return 'en';
}
