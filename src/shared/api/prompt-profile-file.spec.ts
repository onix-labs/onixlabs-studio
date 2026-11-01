import { describe, expect, it } from 'vitest';
import { profileIdFor, slugify, type PromptProfile } from './prompt-profile-channels';
import { parseProfileFile, serializeProfileFile } from './prompt-profile-file';

describe('prompt profile files', () => {
  const profile: PromptProfile = {
    id: 'british-english',
    name: 'British English: always',
    scope: { surfaces: ['editor'], languages: ['markdown'] },
    instructions: 'Write in British English.\n\nNo Oxford commas.',
    enabled: false,
  };

  it('serializeProfileFile_thenParse_roundTrips', () => {
    expect(parseProfileFile('british-english', serializeProfileFile(profile))).toEqual(profile);
  });

  it('parseProfileFile_whenNoFrontmatter_readsTheIdAsName', () => {
    expect(parseProfileFile('terse', 'Be terse.\n')).toEqual({
      id: 'terse',
      name: 'terse',
      scope: { surfaces: [], languages: [] },
      instructions: 'Be terse.',
      enabled: true,
    });
  });

  it('slugify_whenPunctuationAndAccents_keepsASafeSegment', () => {
    expect(slugify('  Café — C# Style!  ')).toBe('cafe-c-style');
  });

  it('profileIdFor_whenTaken_addsTheFirstFreeSuffix', () => {
    expect(profileIdFor('Terse', ['terse', 'terse-2'])).toBe('terse-3');
    expect(profileIdFor('!!!', [])).toBe('profile');
  });
});
