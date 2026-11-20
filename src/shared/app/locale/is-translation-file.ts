import type { TranslationFile } from './translation-file';

/**
 * Determines whether a value is a translation file. The files are bundled with the app, but they are
 * edited by hand and by translation tools, so a malformed one is told apart rather than trusted.
 * @param value The value to test.
 * @returns Returns true when the value is a translation file.
 */
export function isTranslationFile(value: unknown): value is TranslationFile {
  if (value === null || typeof value !== 'object' || !('locale' in value)) {
    return false;
  }
  if (typeof value.locale !== 'string' || !('translations' in value)) {
    return false;
  }
  const translations: unknown = value.translations;
  return (
    translations !== null &&
    typeof translations === 'object' &&
    Object.values(translations).every((text: unknown): boolean => typeof text === 'string')
  );
}
