import { describe, expect, it } from 'vitest';
import { entriesForLanguage, LanguageSlotEntry, resolveForLanguage } from './language-slot';

/**
 * Builds a slot entry for the tests.
 * @param id The entry identifier.
 * @param languages The languages the entry serves.
 * @param priority The entry priority.
 * @returns Returns the entry.
 */
function entry(id: string, languages: readonly string[], priority: number): LanguageSlotEntry {
  return { id, displayName: id, languages, priority };
}

describe('language slots', (): void => {
  const pyright: LanguageSlotEntry = entry('pyright', ['python'], 100);
  const ty: LanguageSlotEntry = entry('ty', ['python'], 50);
  const clangd: LanguageSlotEntry = entry('clangd', ['cpp', 'c'], 100);
  const catalogue: readonly LanguageSlotEntry[] = [pyright, ty, clangd];

  describe('entriesForLanguage', (): void => {
    it('returns every entry serving the language, in registration order', (): void => {
      expect(
        entriesForLanguage('python', catalogue).map((e: LanguageSlotEntry): string => e.id),
      ).toEqual(['pyright', 'ty']);
    });

    it('matches an entry that serves several languages', (): void => {
      expect(entriesForLanguage('c', catalogue)).toEqual([clangd]);
    });

    it('returns nothing for an unserved language', (): void => {
      expect(entriesForLanguage('cobol', catalogue)).toEqual([]);
    });
  });

  describe('resolveForLanguage', (): void => {
    it('picks the highest-priority entry when the user has chosen nothing', (): void => {
      expect(resolveForLanguage('python', catalogue, {})).toBe('pyright');
    });

    it("honours the user's choice over the default", (): void => {
      expect(resolveForLanguage('python', catalogue, { python: 'ty' })).toBe('ty');
    });

    it('falls back to the default when the chosen entry is no longer registered', (): void => {
      expect(resolveForLanguage('python', catalogue, { python: 'basilisk' })).toBe('pyright');
    });

    it('falls back to the default when the chosen entry does not serve the language', (): void => {
      expect(resolveForLanguage('python', catalogue, { python: 'clangd' })).toBe('pyright');
    });

    it('ignores a choice made for a different language', (): void => {
      expect(resolveForLanguage('cpp', catalogue, { python: 'ty' })).toBe('clangd');
    });

    it('returns null when nothing serves the language', (): void => {
      expect(resolveForLanguage('cobol', catalogue, {})).toBeNull();
    });

    it('returns null for an empty catalogue, so an unloaded catalogue is not a wrong answer', (): void => {
      expect(resolveForLanguage('python', [], { python: 'ty' })).toBeNull();
    });

    it('breaks a priority tie on registration order', (): void => {
      const first: LanguageSlotEntry = entry('first', ['go'], 100);
      const second: LanguageSlotEntry = entry('second', ['go'], 100);
      expect(resolveForLanguage('go', [first, second], {})).toBe('first');
      expect(resolveForLanguage('go', [second, first], {})).toBe('second');
    });
  });
});
