/**
 * Identifies the IPC channels between the renderer, which owns the spell-checking settings, and the
 * main process, which applies them to the session's spell checker.
 */
export enum SpellingChannel {
  /**
   * Applies the spell-checking settings to the session (renderer→main, invoke).
   */
  Configure = 'spelling:configure',

  /**
   * Lists the languages the spell checker can check, as language codes (renderer→main, invoke).
   * Empty on macOS, where the system language is checked and cannot be changed.
   */
  AvailableLanguages = 'spelling:available-languages',
}

/**
 * Asks the window's spell checker — the same one that underlines text boxes, so it follows the chosen
 * languages (the system's on macOS) and the personal dictionary — about single words. Exposed to the
 * renderer as `window.spelling`; the calls are synchronous because Chromium answers them in-process.
 */
export interface SpellingProbe {
  /**
   * Determines whether a word is misspelled. Always false while spell checking is off, or before a
   * downloaded dictionary has arrived (Windows and Linux).
   * @param word The word to check.
   * @returns Returns true when the spell checker flags the word.
   */
  isMisspelled(word: string): boolean;

  /**
   * Suggests corrections for a misspelled word.
   * @param word The misspelled word.
   * @returns Returns the suggestions, best first; none for a correctly spelled word.
   */
  suggestions(word: string): string[];
}

/**
 * Describes the spell-checking settings the main process applies to the session.
 */
export interface SpellingConfiguration {
  /**
   * Gets a value indicating whether text boxes are spell checked.
   */
  readonly enabled: boolean;

  /**
   * Gets the language codes checked together; empty to check the system's language. Ignored on
   * macOS, which checks the system language only.
   */
  readonly languages: readonly string[];

  /**
   * Gets the personal dictionary: words never flagged as misspelled.
   */
  readonly words: readonly string[];
}

/**
 * Reads a spelling configuration from untrusted input, dropping anything that is not a string list.
 * @param raw The value received.
 * @returns Returns the configuration, or undefined when the value is not one.
 */
export function parseSpellingConfiguration(raw: unknown): SpellingConfiguration | undefined {
  if (raw === null || typeof raw !== 'object') {
    return undefined;
  }
  const record: Record<string, unknown> = raw as Record<string, unknown>;
  const strings: (value: unknown) => readonly string[] = (value: unknown): readonly string[] =>
    Array.isArray(value)
      ? value.filter((item: unknown): item is string => typeof item === 'string' && item !== '')
      : [];
  return {
    enabled: record['enabled'] !== false,
    languages: strings(record['languages']),
    words: strings(record['words']),
  };
}
