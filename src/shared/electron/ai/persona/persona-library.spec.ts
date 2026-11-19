import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PersonaEntry, PersonaListing } from '@shared/api/persona-channels';
import { PersonaLibrary, readEntry } from './persona-library';

describe('PersonaLibrary', () => {
  let base: string;
  let profiles: string;
  let library: PersonaLibrary;

  const memory: PersonaEntry = {
    id: 'one-recommendation',
    name: 'One recommendation',
    text: 'Prefers a single recommendation to a list of options.',
    why: '',
    tags: ['preferences'],
    links: [],
    scope: { surfaces: [], languages: [] },
    layer: 'memory',
    enabled: true,
    confidence: 1,
    confirmed: '',
    author: 'user',
    locked: true,
  };

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'persona-'));
    profiles = join(base, 'prompt-profiles');
    library = new PersonaLibrary(join(base, 'persona'), profiles);
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it('list_onFirstCall_convertsEveryProfileIntoALockedCoreEntryAndLeavesTheFiles', async () => {
    mkdirSync(profiles, { recursive: true });
    const profile: string =
      '---\nname: "British English"\nsurfaces: []\nlanguages:\n  - markdown\nenabled: false\n---\nWrite in British English.\n';
    writeFileSync(join(profiles, 'british-english.md'), profile, 'utf8');
    writeFileSync(join(profiles, 'terse.md'), 'Be terse.\n', 'utf8');

    const listing: PersonaListing = await library.list();

    expect(listing.existed).toBe(false);
    expect(listing.convertedProfiles).toBe(2);
    expect(listing.entries.map((entry: PersonaEntry): string => entry.id)).toEqual([
      'british-english',
      'terse',
    ]);
    expect(listing.entries[0]).toMatchObject({
      name: 'British English',
      text: 'Write in British English.',
      layer: 'core',
      author: 'user',
      locked: true,
      enabled: false,
      scope: { surfaces: [], languages: ['markdown'] },
    });
    expect(readFileSync(join(profiles, 'british-english.md'), 'utf8')).toBe(profile);
  });

  it('list_afterTheFirstCall_neitherConvertsAgainNorForgetsTheCount', async () => {
    mkdirSync(profiles, { recursive: true });
    writeFileSync(join(profiles, 'terse.md'), 'Be terse.\n', 'utf8');
    await library.list();
    await library.delete('terse');
    writeFileSync(join(profiles, 'later.md'), 'Added after.\n', 'utf8');

    const listing: PersonaListing = await library.list();

    expect(listing.existed).toBe(true);
    expect(listing.entries).toEqual([]);
    expect(listing.convertedProfiles).toBe(1);
  });

  it('list_whenTwoCallsRaceOnTheFirstLaunch_convertsOnce', async () => {
    mkdirSync(profiles, { recursive: true });
    writeFileSync(join(profiles, 'terse.md'), 'Be terse.\n', 'utf8');

    const [first, second]: PersonaListing[] = await Promise.all([library.list(), library.list()]);

    expect(first.entries).toHaveLength(1);
    expect(second.entries).toHaveLength(1);
  });

  it('list_whenThereAreNoProfiles_createsAnEmptyPersona', async () => {
    const listing: PersonaListing = await library.list();

    expect(listing.entries).toEqual([]);
    expect(listing.convertedProfiles).toBe(0);
    expect(existsSync(library.entriesDirectory)).toBe(true);
  });

  it('save_thenRead_roundTripsAndLeavesNoStagingFile', async () => {
    expect(await library.save(memory)).toBeNull();

    expect(await library.read(memory.id)).toEqual(memory);
    expect(readdirSync(library.entriesDirectory)).toEqual(['one-recommendation.md']);
  });

  it('save_whenTheIdWouldLeaveTheFolder_refuses', async () => {
    expect(await library.save({ ...memory, id: '../escape' })).not.toBeNull();
    expect(library.fileOf('../escape')).toBeNull();
  });

  it('readEntry_whenMalformed_isNull', () => {
    expect(readEntry({ id: 'x', name: 'x' })).toBeNull();
    expect(readEntry('nope')).toBeNull();
  });

  it('readEntry_whenValid_normalisesTagsAndDropsBadLinks', () => {
    expect(readEntry({ ...memory, tags: ['Travel', 3], links: ['../x', 'ok', memory.id] })).toEqual(
      { ...memory, tags: ['travel'], links: ['ok'] },
    );
  });
});
