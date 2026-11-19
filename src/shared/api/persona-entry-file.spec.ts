import { describe, expect, it } from 'vitest';
import {
  coreLineCount,
  isOverCoreLimit,
  normalizeTags,
  personaIdFor,
  type PersonaEntry,
} from './persona-channels';
import { parseEntryFile, serializeEntryFile } from './persona-entry-file';

describe('persona entry files', () => {
  const entry: PersonaEntry = {
    id: 'one-recommendation',
    name: 'One recommendation: not a list',
    text: 'Prefers a single recommendation to a list of options.',
    why: 'Finds long comparisons tiring: "just tell me which one you\'d pick".',
    tags: ['preferences', 'decisions', 'c#'],
    links: ['short-replies'],
    scope: { surfaces: ['editor'], languages: [] },
    layer: 'memory',
    enabled: true,
    confidence: 0.75,
    confirmed: '2026-11-19',
    author: 'learned',
    locked: false,
  };

  it('serializeEntryFile_thenParse_roundTrips', () => {
    expect(parseEntryFile(entry.id, serializeEntryFile(entry))).toEqual(entry);
  });

  it('parseEntryFile_whenAProfileFile_readsAUserWrittenLockedCoreEntry', () => {
    // Exactly what a prompt profile's file held (#1263).
    const file: string =
      '---\nname: "British English"\nsurfaces: []\nlanguages:\n  - markdown\nenabled: false\n---\nWrite in British English.\n';

    expect(parseEntryFile('british-english', file)).toEqual({
      id: 'british-english',
      name: 'British English',
      text: 'Write in British English.',
      why: '',
      tags: [],
      links: [],
      scope: { surfaces: [], languages: ['markdown'] },
      layer: 'core',
      enabled: false,
      confidence: 1,
      confirmed: '',
      author: 'user',
      locked: true,
    });
  });

  it('parseEntryFile_whenLearnedAndAndLockedIsMissing_readsItUnlocked', () => {
    expect(parseEntryFile('x', '---\nauthor: learned\n---\nLikes trains.\n').locked).toBe(false);
  });

  it('parseEntryFile_dropsLinksThatAreNotIdsOrPointAtItself', () => {
    const parsed: PersonaEntry = parseEntryFile('x', '---\nlinks: [x, ../etc, good-one]\n---\nA\n');

    expect(parsed.links).toEqual(['good-one']);
  });

  it('parseEntryFile_clampsConfidenceAndIgnoresABadDate', () => {
    const parsed: PersonaEntry = parseEntryFile(
      'x',
      '---\nconfidence: 7\nconfirmed: yesterday\n---\nA\n',
    );

    expect(parsed.confidence).toBe(1);
    expect(parsed.confirmed).toBe('');
  });

  it('normalizeTags_lowerCasesDropsHashesAndRepeats', () => {
    expect(normalizeTags(['#Travel', 'travel', ' Garden Design ', '', 'C#'])).toEqual([
      'travel',
      'garden-design',
      'c#',
    ]);
  });

  it('personaIdFor_whenTaken_addsASuffix', () => {
    expect(personaIdFor('Short replies', ['short-replies'])).toBe('short-replies-2');
  });

  it('coreLineCount_countsEnabledCoreEntriesOnly', () => {
    const core: PersonaEntry = { ...entry, layer: 'core', text: 'One.\n\nTwo.', why: 'Because.' };

    expect(coreLineCount([core, entry, { ...core, id: 'off', enabled: false }])).toBe(3);
  });

  it('isOverCoreLimit_whenOneEntryIsLongerThanTheCore_isTrue', () => {
    const long: PersonaEntry = {
      ...entry,
      layer: 'core',
      why: '',
      text: Array.from({ length: 13 }, (_: unknown, index: number): string => `Line ${index}`).join(
        '\n',
      ),
    };

    expect(isOverCoreLimit(long)).toBe(true);
    expect(isOverCoreLimit({ ...long, layer: 'memory' })).toBe(false);
  });
});
