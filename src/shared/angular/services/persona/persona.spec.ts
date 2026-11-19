import { TestBed } from '@angular/core/testing';
import type { Bridge } from '@shared/api/bridge';
import { PersonaChannel, PersonaListing } from '@shared/api/persona-channels';

import { Persona, PersonaEntry } from './persona';

/**
 * A stand-in for the main process's persona folder: the entries by id, or null while the folder does
 * not exist yet.
 */
interface FakeFolder {
  files: Map<string, PersonaEntry> | null;
  saves: PersonaEntry[];
  converted: number;
  changed: (() => void) | null;
}

/**
 * Builds an entry with the defaults a user-written core entry has.
 * @param id The id.
 * @param patch The fields to change.
 * @returns Returns the entry.
 */
function entryOf(id: string, patch: Partial<PersonaEntry> = {}): PersonaEntry {
  return {
    id,
    name: id,
    text: 'x',
    why: '',
    tags: [],
    links: [],
    scope: { surfaces: [], languages: [] },
    layer: 'core',
    enabled: true,
    confidence: 1,
    confirmed: '',
    author: 'user',
    locked: true,
    ...patch,
  };
}

/**
 * Installs a bridge over a fake persona folder.
 * @param files The entries already there, or null for no folder.
 * @param converted How many profiles the main process reports converting.
 * @returns Returns the folder, to inspect.
 */
function installBridge(files: readonly PersonaEntry[] | null, converted: number = 0): FakeFolder {
  const folder: FakeFolder = {
    files: files === null ? null : new Map(files.map((entry) => [entry.id, entry])),
    saves: [],
    converted,
    changed: null,
  };
  const bridge: Partial<Bridge> = {
    invoke: <T>(channel: string, ...args: unknown[]): Promise<T> => {
      if (channel === (PersonaChannel.List as string)) {
        const existed: boolean = folder.files !== null;
        folder.files ??= new Map();
        const listing: PersonaListing = {
          entries: [...folder.files.values()].sort((a, b) => a.id.localeCompare(b.id)),
          convertedProfiles: folder.converted,
          existed,
        };
        return Promise.resolve(listing as T);
      }
      if (channel === (PersonaChannel.Save as string)) {
        const entry: PersonaEntry = args[0] as PersonaEntry;
        folder.saves.push(entry);
        (folder.files ??= new Map()).set(entry.id, entry);
        return Promise.resolve(null as T);
      }
      if (channel === (PersonaChannel.Delete as string)) {
        folder.files?.delete(args[0] as string);
      }
      return Promise.resolve(undefined as T);
    },
    on: (channel: string, listener: (...args: unknown[]) => void): (() => void) => {
      if (channel === (PersonaChannel.Changed as string)) {
        folder.changed = (): void => listener();
      }
      return (): void => undefined;
    },
  };
  (window as unknown as { bridge?: Partial<Bridge> }).bridge = bridge;
  return folder;
}

describe('Persona on disk (#1514)', () => {
  afterEach(() => {
    delete (window as unknown as { bridge?: Bridge }).bridge;
    localStorage.clear();
    vi.useRealTimers();
  });

  it('ready_whenFolderHoldsEntries_listsThemAndTheConvertedCount', async () => {
    installBridge([entryOf('terse'), entryOf('trains', { layer: 'memory' })], 2);
    const persona: Persona = TestBed.inject(Persona);
    await persona.ready;

    expect(persona.core().map((entry: PersonaEntry): string => entry.id)).toEqual(['terse']);
    expect(persona.memories().map((entry: PersonaEntry): string => entry.id)).toEqual(['trains']);
    expect(persona.convertedProfiles()).toBe(2);
  });

  it('create_whenCalled_filesItUnderItsNameAsALockedUserEntry', async () => {
    const folder: FakeFolder = installBridge([]);
    const persona: Persona = TestBed.inject(Persona);
    await persona.ready;

    const first: PersonaEntry = persona.create({ name: 'House style' });
    const second: PersonaEntry = persona.create({ name: 'House style', layer: 'memory' });

    expect([first.id, second.id]).toEqual(['house-style', 'house-style-2']);
    expect(second).toMatchObject({ layer: 'memory', author: 'user', locked: true });
    expect(folder.saves).toHaveLength(2);
  });

  it('update_whenTyping_writesOnceAfterThePause', async () => {
    const folder: FakeFolder = installBridge([]);
    const persona: Persona = TestBed.inject(Persona);
    await persona.ready;
    const created: PersonaEntry = persona.create({ name: 'One' });
    vi.useFakeTimers();

    persona.update(created.id, { text: 'B' });
    persona.update(created.id, { text: 'Be' });
    vi.advanceTimersByTime(1_000);

    expect(folder.saves.map((entry: PersonaEntry): string => entry.text)).toEqual(['', 'Be']);
  });

  it('followsEntriesChangedElsewhere', async () => {
    // Another window, or persona learning in the main process, changed the persona; the next turn must carry it.
    const folder: FakeFolder = installBridge([]);
    const persona: Persona = TestBed.inject(Persona);
    await persona.ready;

    folder.files?.set('fox', entryOf('fox', { name: 'Fox', text: 'End with 🦊' }));
    folder.changed?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(persona.resolve('editor', null)).toContain('End with 🦊');
  });

  it('convertLegacy_whenThePersonaIsNewAndNoFilesWereConverted_convertsTheStoredProfiles', async () => {
    const stored: string = JSON.stringify([
      { id: '5f0c-uuid', name: 'Both', system: 'Explicit types.', user: 'British English.' },
      'junk',
      { id: 'c', name: 'Odd scope', scope: { surfaces: ['kitchen'] }, instructions: 'x' },
    ]);
    localStorage.setItem('ai.promptProfiles', stored);
    const folder: FakeFolder = installBridge(null);
    const persona: Persona = TestBed.inject(Persona);
    await persona.ready;

    expect(
      persona.entries().map((entry: PersonaEntry): [string, string] => [entry.id, entry.text]),
    ).toEqual([
      ['both', 'Explicit types.\n\nBritish English.'],
      ['odd-scope', 'x'],
    ]);
    expect(persona.entries()[0]).toMatchObject({ layer: 'core', author: 'user', locked: true });
    expect(folder.saves).toHaveLength(2);
    expect(persona.convertedProfiles()).toBe(2);
    expect(localStorage.getItem('ai.promptProfiles')).toBe(stored);
  });

  it('convertLegacy_whenThePersonaAlreadyExisted_doesNothing', async () => {
    localStorage.setItem('ai.promptProfiles', JSON.stringify([{ name: 'Old', instructions: 'x' }]));
    const folder: FakeFolder = installBridge([]);
    const persona: Persona = TestBed.inject(Persona);
    await persona.ready;

    expect(persona.entries()).toEqual([]);
    expect(folder.saves).toEqual([]);
  });
});

describe('Persona', () => {
  let persona: Persona;

  beforeEach(() => {
    localStorage.clear();
    persona = TestBed.inject(Persona);
  });

  it('resolve_whenNothingMatches_returnsNothing', () => {
    const created: PersonaEntry = persona.create({ name: 'C#' });
    persona.update(created.id, {
      scope: { surfaces: [], languages: ['csharp'] },
      text: 'Use var.',
    });

    expect(persona.resolve('editor', 'markdown')).toBe('');
  });

  it('resolve_whenSeveralMatch_composesGlobalThenSurfaceThenLanguage', () => {
    const language: PersonaEntry = persona.create({ name: 'C#' });
    persona.update(language.id, {
      scope: { surfaces: [], languages: ['csharp'] },
      text: 'Explicit types.',
    });
    const global: PersonaEntry = persona.create({ name: 'Everywhere' });
    persona.update(global.id, { text: 'British English.', why: 'Writes for a UK team.' });
    const surface: PersonaEntry = persona.create({ name: 'Editor' });
    persona.update(surface.id, {
      scope: { surfaces: ['editor'], languages: [] },
      text: 'Be terse.',
    });

    expect(persona.resolve('editor', 'csharp')).toBe(
      '### Everywhere\nBritish English.\nWhy: Writes for a UK team.\n\n### Editor\nBe terse.\n\n### C#\nExplicit types.',
    );
  });

  it('resolve_neverIncludesMemoriesOrSwitchedOffEntries', () => {
    persona.create({ name: 'Trains', layer: 'memory', text: 'Prefers trains.' });
    const parked: PersonaEntry = persona.create({ name: 'Parked', text: 'Ignored.' });
    persona.update(parked.id, { enabled: false });

    expect(persona.resolve('project', null)).toBe('');
  });

  it('coreLines_countsTheEnabledCore', () => {
    persona.create({ name: 'A', text: 'One.\nTwo.' });
    persona.create({ name: 'B', layer: 'memory', text: 'Not counted.' });

    expect(persona.coreLines()).toBe(2);
  });
});
