import type { InterfaceLanguage } from '@shared/api/startup-settings';
import type { SpokenLanguage } from './spoken-language';
import { spokenLanguageOf } from './spoken-language-of';

/**
 * Resolves the Language setting to the language the interface is shown in. System takes the first of
 * the operating system's preferred languages that Studio speaks, whatever its region (`fr-CA` is
 * French, `zh-CN` Simplified Chinese; see `spokenLanguageOf`), and falls back to English when it
 * speaks none of them.
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
    const match: SpokenLanguage | undefined = spokenLanguageOf(tag);
    if (match !== undefined) {
      return match;
    }
  }
  return 'en';
}
