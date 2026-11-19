import { describe, expect, it } from 'vitest';
import type { PersonaEntry } from './persona-channels';
import {
  memoriesInScope,
  renderPersonaHits,
  searchPersona,
  searchTerms,
  type PersonaSearchHit,
} from './persona-search';

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
    text: '',
    why: '',
    tags: [],
    links: [],
    scope: { surfaces: [], languages: [] },
    layer: 'memory',
    enabled: true,
    confidence: 1,
    confirmed: '',
    author: 'pete',
    locked: false,
    ...patch,
  };
}

/**
 * Lists the ids of hits.
 * @param hits The hits.
 * @returns Returns the ids.
 */
function ids(hits: readonly PersonaSearchHit[]): readonly string[] {
  return hits.map((hit: PersonaSearchHit): string => hit.entry.id);
}

describe('persona search (#1515)', () => {
  const oneRecommendation: PersonaEntry = memory('one-recommendation', {
    name: 'One recommendation',
    text: 'Prefers a single recommendation to a list of options when choosing between things.',
    tags: ['preferences', 'decisions'],
  });
  const trains: PersonaEntry = memory('trains', {
    name: 'Trains over flights',
    text: 'Avoids flying.',
    why: 'The carbon cost.',
    tags: ['travel'],
  });
  const dotnet: PersonaEntry = memory('dotnet', {
    name: 'Explicit types',
    text: 'Writes C# with explicit types.',
    tags: ['c#'],
    scope: { surfaces: ['editor'], languages: ['csharp'] },
  });

  it('memoriesInScope_dropsTheCoreSwitchedOffAndThoseScopedElsewhere', () => {
    const core: PersonaEntry = memory('core', { layer: 'core' });
    const off: PersonaEntry = memory('off', { enabled: false });

    expect(
      ids(
        searchPersona(memoriesInScope([core, off, trains, dotnet], 'terminal', null), {
          words: 'flying',
          tags: [],
          limit: 5,
        }),
      ),
    ).toEqual(['trains']);
    expect(memoriesInScope([dotnet], 'editor', 'csharp')).toEqual([dotnet]);
    expect(memoriesInScope([dotnet], 'editor', 'markdown')).toEqual([]);
  });

  it('searchTerms_dropsCommonWordsAndPlurals', () => {
    expect(searchTerms('Which laptops does the user prefer, and how many options?')).toEqual([
      'laptop',
      'many',
      'option',
    ]);
  });

  it('search_ranksATagAboveAWordInTheText', () => {
    const hits: readonly PersonaSearchHit[] = searchPersona([trains, oneRecommendation, dotnet], {
      words: 'choosing',
      tags: ['travel'],
      limit: 5,
    });

    expect(ids(hits)).toEqual(['trains', 'one-recommendation']);
  });

  it('search_findsTheReasonToo', () => {
    expect(ids(searchPersona([trains], { words: 'carbon', tags: [], limit: 5 }))).toEqual([
      'trains',
    ]);
  });

  it('search_aboutALaptop_stillOffersTheGeneralPreferenceAboutChoosing', () => {
    // The example the epic is built on: a preference learned about databases applies to laptops.
    const hits: readonly PersonaSearchHit[] = searchPersona([trains, oneRecommendation], {
      words: 'laptop',
      tags: ['hardware'],
      limit: 5,
    });

    expect(hits).toEqual([{ entry: oneRecommendation, matched: false }]);
    expect(renderPersonaHits(hits)).toContain('General preferences, which may apply here too:');
    expect(renderPersonaHits(hits)).toContain('Prefers a single recommendation');
  });

  it('search_keepsToTheLimit', () => {
    const many: readonly PersonaEntry[] = Array.from({ length: 30 }, (_: unknown, index: number) =>
      memory(`m${String(index).padStart(2, '0')}`, { tags: ['travel'] }),
    );

    expect(searchPersona(many, { words: '', tags: ['travel'], limit: 50 })).toHaveLength(12);
    expect(searchPersona(many, { words: '', tags: ['travel'], limit: 3 })).toHaveLength(3);
  });

  it('render_showsTheIdForForgetting_andMarksAnUncertainGuess', () => {
    const guess: PersonaEntry = memory('guess', { text: 'Maybe likes tea.', confidence: 0.4 });

    const text: string = renderPersonaHits([{ entry: guess, matched: true }]);

    expect(text).toContain('(id: guess)');
    expect(text).toContain('treat it as a guess');
  });

  it('render_whenNothing_suggestsBroaderWords', () => {
    expect(renderPersonaHits([])).toContain('Nothing in the persona matches');
  });
});
