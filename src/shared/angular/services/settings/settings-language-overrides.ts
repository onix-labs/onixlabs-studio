import type { LanguageOverrides, PartialTextEditorSettings, TextEditorSettings } from './settings';

/**
 * Resolves the effective text editor settings for a language: the global settings with that
 * language's overrides laid over them. A language with no overrides resolves to the global settings
 * unchanged. Pure — the caller supplies both sides.
 * @param global The global text editor settings.
 * @param overrides The per-language override map.
 * @param language The Monaco language identifier.
 * @returns Returns the resolved settings for the language.
 */
export function resolveForLanguage(
  global: TextEditorSettings,
  overrides: LanguageOverrides,
  language: string,
): TextEditorSettings {
  const own: PartialTextEditorSettings | undefined = overrides[language];
  return own === undefined ? global : { ...global, ...own };
}

/**
 * Sets one overridden field for a language, returning a new map. Pure — the caller persists it.
 * @param overrides The current override map.
 * @param language The Monaco language identifier.
 * @param field The text editor settings field.
 * @param value The overriding value.
 * @returns Returns the updated map.
 */
export function setLanguageOverride<K extends keyof TextEditorSettings>(
  overrides: LanguageOverrides,
  language: string,
  field: K,
  value: TextEditorSettings[K],
): LanguageOverrides {
  return { ...overrides, [language]: { ...overrides[language], [field]: value } };
}

/**
 * Clears one overridden field for a language, returning a new map. A language left with no overrides
 * drops out of the map entirely, so the map never carries empty entries for languages that are back
 * on the global settings.
 * @param overrides The current override map.
 * @param language The Monaco language identifier.
 * @param field The text editor settings field.
 * @returns Returns the updated map.
 */
export function clearLanguageOverride(
  overrides: LanguageOverrides,
  language: string,
  field: keyof TextEditorSettings,
): LanguageOverrides {
  const own: PartialTextEditorSettings | undefined = overrides[language];
  if (own === undefined || !(field in own)) {
    return overrides;
  }
  const rest: Record<string, unknown> = { ...own };
  delete rest[field];
  const next: Record<string, PartialTextEditorSettings> = { ...overrides };
  if (Object.keys(rest).length === 0) {
    delete next[language];
  } else {
    next[language] = rest;
  }
  return next;
}
