import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PersonaEntry } from '@shared/api/persona-channels';
import type { PersonaSearchHit } from '@shared/api/persona-search';
import type { PersonaAccess } from '../agent-provider';
import { bindPersona } from './persona-access';
import { PersonaLibrary } from './persona-library';

/**
 * Builds a memory.
 * @param id The id.
 * @param patch The fields to change.
 * @returns Returns the memory.
 */
function memory(id: string, patch: Partial<PersonaEntry> = {}): PersonaEntry {
  return {
    id,
    name: id,
    text: `About ${id}.`,
    why: '',
    tags: [],
    links: [],
    scope: { surfaces: [], languages: [] },
    layer: 'memory',
    enabled: true,
    confidence: 1,
    confirmed: '',
    author: 'user',
    locked: true,
    ...patch,
  };
}

describe('bindPersona (#1515)', () => {
  let base: string;
  let library: PersonaLibrary;

  beforeEach(async () => {
    base = mkdtempSync(join(tmpdir(), 'persona-access-'));
    library = new PersonaLibrary(join(base, 'persona'));
    await library.save(memory('trains', { tags: ['travel', 'preferences'] }));
    await library.save(memory('flights', { tags: ['travel'] }));
    await library.save(
      memory('csharp', { tags: ['c#'], scope: { surfaces: ['editor'], languages: [] } }),
    );
    await library.save(memory('core', { layer: 'core', tags: ['ignored'] }));
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it('countsTheMemoriesInScope_andListsTheirTagsMostUsedFirst', async () => {
    const access: PersonaAccess | null = await bindPersona(
      library,
      'terminal',
      null,
      (): void => undefined,
    );

    expect(access?.memories).toBe(2);
    expect(access?.tags).toEqual(['travel', 'preferences']);
  });

  it('search_findsAMemoryAddedAfterTheRunBegan', async () => {
    const access: PersonaAccess | null = await bindPersona(
      library,
      'terminal',
      null,
      (): void => undefined,
    );
    await library.save(memory('tea', { text: 'Drinks green tea.' }));

    const hits: readonly PersonaSearchHit[] =
      (await access?.search({ words: 'green tea', tags: [], limit: 5 })) ?? [];

    expect(hits.map((hit: PersonaSearchHit): string => hit.entry.id)).toContain('tea');
  });

  it('forget_deletesWhatItNames_andTellsTheWindowsOnce', async () => {
    const changed: () => void = vi.fn();
    const access: PersonaAccess | null = await bindPersona(library, 'terminal', null, changed);

    expect(await access?.forget(['trains', 'nope'])).toEqual(['trains']);
    expect(await library.read('trains')).toBeNull();
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('forget_whenNothingMatches_tellsNobody', async () => {
    const changed: () => void = vi.fn();
    const access: PersonaAccess | null = await bindPersona(library, 'terminal', null, changed);

    expect(await access?.forget(['nope'])).toEqual([]);
    expect(changed).not.toHaveBeenCalled();
  });
});
