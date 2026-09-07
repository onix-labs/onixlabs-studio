import { describe, expect, it } from 'vitest';
import { entriesForFormat, FormatSlotEntry, resolveForFormat } from './format-slot';

/**
 * Builds a decoder entry for the tests.
 * @param id The identifier.
 * @param formats The formats it decodes.
 * @param priority The priority, defaulting to 100.
 * @returns Returns the entry.
 */
function decoder(id: string, formats: readonly string[], priority: number = 100): FormatSlotEntry {
  return { id, displayName: id, formats, priority };
}

describe('entriesForFormat', (): void => {
  it('returns only the entries decoding the format, in registration order', (): void => {
    const entries: readonly FormatSlotEntry[] = [
      decoder('native', ['elf/x64', 'macho/x64']),
      decoder('jvm', ['jvm']),
      decoder('other-native', ['elf/x64']),
    ];
    expect(
      entriesForFormat('elf/x64', entries).map((entry: FormatSlotEntry): string => entry.id),
    ).toEqual(['native', 'other-native']);
  });

  it('returns nothing for a format no entry decodes', (): void => {
    expect(entriesForFormat('wasm', [decoder('jvm', ['jvm'])])).toEqual([]);
  });
});

describe('resolveForFormat', (): void => {
  it('resolves to null when nothing decodes the format, which is how "not installed" is expressed', (): void => {
    expect(resolveForFormat('wasm', [], {})).toBeNull();
    expect(resolveForFormat('wasm', [decoder('jvm', ['jvm'])], {})).toBeNull();
  });

  it('prefers the highest priority when the user has expressed no choice', (): void => {
    const entries: readonly FormatSlotEntry[] = [
      decoder('low', ['jvm'], 10),
      decoder('high', ['jvm'], 90),
    ];
    expect(resolveForFormat('jvm', entries, {})).toBe('high');
  });

  it('breaks ties on registration order', (): void => {
    const entries: readonly FormatSlotEntry[] = [
      decoder('first', ['jvm'], 50),
      decoder('second', ['jvm'], 50),
    ];
    expect(resolveForFormat('jvm', entries, {})).toBe('first');
  });

  it('honours the user choice over priority', (): void => {
    const entries: readonly FormatSlotEntry[] = [
      decoder('low', ['jvm'], 10),
      decoder('high', ['jvm'], 90),
    ];
    expect(resolveForFormat('jvm', entries, { jvm: 'low' })).toBe('low');
  });

  it('falls back to the default rather than failing when a choice is stale', (): void => {
    // Uninstalling the chosen decoder must not strand the format.
    const entries: readonly FormatSlotEntry[] = [decoder('remaining', ['jvm'], 10)];
    expect(resolveForFormat('jvm', entries, { jvm: 'uninstalled' })).toBe('remaining');
  });

  it('ignores a choice made for a different format', (): void => {
    const entries: readonly FormatSlotEntry[] = [decoder('only', ['jvm'], 10)];
    expect(resolveForFormat('jvm', entries, { wasm: 'something-else' })).toBe('only');
  });
});
