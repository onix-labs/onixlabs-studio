import {
  addProfile,
  AddProfileResult,
  removeProfile,
  resolveForLanguage,
  updateProfileIn,
} from './settings-profiles';
import { EditorProfile, PartialTextEditorSettings, TextEditorSettings } from './settings';

/**
 * Builds a minimal editor profile for the tests.
 * @param id The profile id (also its name).
 * @param languages The languages the profile applies to.
 * @param settings The profile's setting overrides.
 * @returns Returns the profile.
 */
function profile(
  id: string,
  languages: readonly string[],
  settings: PartialTextEditorSettings = {},
): EditorProfile {
  return { id, name: id, languages, settings };
}

describe('settings-profiles', () => {
  it('addProfile_appendsAProfileWithAGeneratedId', () => {
    const result: AddProfileResult = addProfile([], 'JS', ['javascript'], {});

    expect(result.profile.id).toBeTruthy();
    expect(result.next).toHaveLength(1);
    expect(result.next[0]).toBe(result.profile);
  });

  it('updateProfileIn_updatesOnlyTheMatchingProfile', () => {
    const list: readonly EditorProfile[] = [profile('a', ['js']), profile('b', ['ts'])];

    const next: readonly EditorProfile[] = updateProfileIn(list, 'a', { name: 'renamed' });

    expect(next[0].name).toBe('renamed');
    expect(next[1]).toBe(list[1]);
  });

  it('removeProfile_dropsTheMatchingProfile', () => {
    const list: readonly EditorProfile[] = [profile('a', ['js']), profile('b', ['ts'])];

    expect(removeProfile(list, 'a').map((p: EditorProfile): string => p.id)).toEqual(['b']);
  });

  it('resolveForLanguage_whenNoProfileMatches_returnsGlobalByReference', () => {
    const global: TextEditorSettings = { fontSize: 14 } as unknown as TextEditorSettings;

    expect(resolveForLanguage(global, [], 'python')).toBe(global);
  });

  it('resolveForLanguage_mergesTheMatchingProfileOverGlobal', () => {
    const global: TextEditorSettings = {
      fontSize: 14,
      showMinimap: true,
    } as unknown as TextEditorSettings;
    const list: readonly EditorProfile[] = [profile('a', ['python'], { fontSize: 20 })];

    const resolved: TextEditorSettings = resolveForLanguage(global, list, 'python');

    expect(resolved.fontSize).toBe(20);
    expect(resolved.showMinimap).toBe(true);
  });
});
