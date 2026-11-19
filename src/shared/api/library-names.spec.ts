import { describe, expect, it } from 'vitest';
import { slugify, uniqueName } from './library-names';

describe('library names', () => {
  it('slugify_whenPunctuationAndAccents_keepsASafeSegment', () => {
    expect(slugify('  Café — C# Style!  ')).toBe('cafe-c-style');
  });

  it('slugify_whenNothingUsable_isEmpty', () => {
    expect(slugify('—!—')).toBe('');
  });

  it('uniqueName_whenTaken_addsTheFirstFreeSuffix', () => {
    const taken: ReadonlySet<string> = new Set(['notes', 'notes-2']);

    expect(uniqueName('notes', (name: string): boolean => taken.has(name))).toBe('notes-3');
  });

  it('uniqueName_whenLong_shortensToFitTheSuffix', () => {
    const base: string = 'a'.repeat(64);

    expect(uniqueName(base, (name: string): boolean => name === base)).toBe(`${'a'.repeat(62)}-2`);
  });
});
