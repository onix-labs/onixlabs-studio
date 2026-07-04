import type { EditorProfile, PartialTextEditorSettings, TextEditorSettings } from './settings';

/**
 * Holds the outcome of adding a profile: the created profile and the resulting profile list.
 */
export interface AddProfileResult {
  /**
   * Gets the newly created profile.
   */
  readonly profile: EditorProfile;

  /**
   * Gets the profile list with the new profile appended.
   */
  readonly next: readonly EditorProfile[];
}

/**
 * Builds a new editor profile and appends it to the given list. Pure — the caller persists the result.
 * @param profiles The current profile list.
 * @param name The display name of the profile.
 * @param languages The Monaco language identifiers the profile applies to.
 * @param settings The settings overrides applied by the profile.
 * @returns Returns the created profile and the updated list.
 */
export function addProfile(
  profiles: readonly EditorProfile[],
  name: string,
  languages: readonly string[],
  settings: PartialTextEditorSettings,
): AddProfileResult {
  const profile: EditorProfile = {
    id: crypto.randomUUID(),
    name,
    languages,
    settings,
  };
  return { profile, next: [...profiles, profile] };
}

/**
 * Applies updates to the profile with the given id, returning a new list.
 * @param profiles The current profile list.
 * @param id The identifier of the profile to update.
 * @param updates The updates to apply.
 * @returns Returns the updated list.
 */
export function updateProfileIn(
  profiles: readonly EditorProfile[],
  id: string,
  updates: Partial<Omit<EditorProfile, 'id'>>,
): readonly EditorProfile[] {
  return profiles.map(
    (profile: EditorProfile): EditorProfile =>
      profile.id === id ? { ...profile, ...updates } : profile,
  );
}

/**
 * Removes the profile with the given id, returning a new list.
 * @param profiles The current profile list.
 * @param id The identifier of the profile to remove.
 * @returns Returns the list without the removed profile.
 */
export function removeProfile(
  profiles: readonly EditorProfile[],
  id: string,
): readonly EditorProfile[] {
  return profiles.filter((profile: EditorProfile): boolean => profile.id !== id);
}

/**
 * Resolves the effective text editor settings for a language, merging the first matching profile's
 * overrides over the global settings. Falls back to the global settings when no profile matches.
 * @param global The global text editor settings.
 * @param profiles The profile list.
 * @param language The Monaco language identifier.
 * @returns Returns the resolved settings for the language.
 */
export function resolveForLanguage(
  global: TextEditorSettings,
  profiles: readonly EditorProfile[],
  language: string,
): TextEditorSettings {
  const profile: EditorProfile | undefined = profiles.find((candidate: EditorProfile): boolean =>
    candidate.languages.includes(language),
  );

  if (profile === undefined) {
    return global;
  }

  return {
    showLineNumbers: profile.settings.showLineNumbers ?? global.showLineNumbers,
    showMinimap: profile.settings.showMinimap ?? global.showMinimap,
    currentLineHighlight: profile.settings.currentLineHighlight ?? global.currentLineHighlight,
    wordWrap: profile.settings.wordWrap ?? global.wordWrap,
    stickyScroll: profile.settings.stickyScroll ?? global.stickyScroll,
    cursorBlinking: profile.settings.cursorBlinking ?? global.cursorBlinking,
    cursorSmoothCaretAnimation:
      profile.settings.cursorSmoothCaretAnimation ?? global.cursorSmoothCaretAnimation,
    insertSpaces: profile.settings.insertSpaces ?? global.insertSpaces,
    tabSize: profile.settings.tabSize ?? global.tabSize,
    fontFamily: profile.settings.fontFamily ?? global.fontFamily,
    fontSize: profile.settings.fontSize ?? global.fontSize,
    braceStyle: profile.settings.braceStyle ?? global.braceStyle,
  };
}
