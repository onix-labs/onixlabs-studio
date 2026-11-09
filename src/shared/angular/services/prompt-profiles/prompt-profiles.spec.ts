import { TestBed } from '@angular/core/testing';
import type { Bridge } from '@shared/api/bridge';
import { PromptProfileChannel, PromptProfileListing } from '@shared/api/prompt-profile-channels';

import { PromptProfile, PromptProfiles } from './prompt-profiles';

/**
 * A stand-in for the main process's profile folder (#1263): the files by id, or null while the
 * folder does not exist yet.
 */
interface FakeFolder {
  files: Map<string, PromptProfile> | null;
  saves: PromptProfile[];
  changed: (() => void) | null;
}

/**
 * Installs a bridge over a fake profile folder.
 * @param files The files already there, or null for no folder.
 * @returns Returns the folder, to inspect.
 */
function installBridge(files: readonly PromptProfile[] | null): FakeFolder {
  const folder: FakeFolder = {
    files: files === null ? null : new Map(files.map((profile) => [profile.id, profile])),
    saves: [],
    changed: null,
  };
  const bridge: Partial<Bridge> = {
    invoke: <T>(channel: string, ...args: unknown[]): Promise<T> => {
      if (channel === (PromptProfileChannel.List as string)) {
        const existed: boolean = folder.files !== null;
        folder.files ??= new Map();
        const listing: PromptProfileListing = {
          profiles: [...folder.files.values()].sort((a, b) => a.id.localeCompare(b.id)),
          existed,
        };
        return Promise.resolve(listing as T);
      }
      if (channel === (PromptProfileChannel.Save as string)) {
        const profile: PromptProfile = args[0] as PromptProfile;
        folder.saves.push(profile);
        (folder.files ??= new Map()).set(profile.id, profile);
        return Promise.resolve(null as T);
      }
      if (channel === (PromptProfileChannel.Delete as string)) {
        folder.files?.delete(args[0] as string);
      }
      return Promise.resolve(undefined as T);
    },
    on: (channel: string, listener: (...args: unknown[]) => void): (() => void) => {
      if (channel === (PromptProfileChannel.Changed as string)) {
        folder.changed = (): void => listener();
      }
      return (): void => undefined;
    },
  };
  (window as unknown as { bridge?: Partial<Bridge> }).bridge = bridge;
  return folder;
}

describe('PromptProfiles on disk (#1263)', () => {
  afterEach(() => {
    delete (window as unknown as { bridge?: Bridge }).bridge;
    localStorage.clear();
    vi.useRealTimers();
  });

  it('ready_whenFolderHoldsProfiles_listsThem', async () => {
    installBridge([
      {
        id: 'terse',
        name: 'Terse',
        scope: { surfaces: [], languages: [] },
        instructions: 'x',
        enabled: true,
      },
    ]);
    const profiles: PromptProfiles = TestBed.inject(PromptProfiles);
    await profiles.ready;

    expect(profiles.profiles().map((profile: PromptProfile): string => profile.id)).toEqual([
      'terse',
    ]);
  });

  it('create_whenCalled_filesItUnderItsNameAndWritesIt', async () => {
    const folder: FakeFolder = installBridge([]);
    const profiles: PromptProfiles = TestBed.inject(PromptProfiles);
    await profiles.ready;

    const first: PromptProfile = profiles.create('House style');
    const second: PromptProfile = profiles.create('House style');

    expect([first.id, second.id]).toEqual(['house-style', 'house-style-2']);
    expect(folder.saves.map((profile: PromptProfile): string => profile.id)).toEqual([
      'house-style',
      'house-style-2',
    ]);
  });

  it('update_whenTyping_writesOnceAfterThePause', async () => {
    const folder: FakeFolder = installBridge([]);
    const profiles: PromptProfiles = TestBed.inject(PromptProfiles);
    await profiles.ready;
    const created: PromptProfile = profiles.create('One');
    vi.useFakeTimers();

    profiles.update(created.id, { instructions: 'B' });
    profiles.update(created.id, { instructions: 'Be' });
    vi.advanceTimersByTime(1_000);

    expect(folder.saves.map((profile: PromptProfile): string => profile.instructions)).toEqual([
      '',
      'Be',
    ]);
  });

  it('followsProfilesEditedInAnotherWindow', async () => {
    // #955: the AI Manager is usually in another window; the agent here must send the edit next turn.
    const folder: FakeFolder = installBridge([]);
    const profiles: PromptProfiles = TestBed.inject(PromptProfiles);
    await profiles.ready;

    folder.files?.set('fox', {
      id: 'fox',
      name: 'Fox',
      scope: { surfaces: [], languages: [] },
      instructions: 'End with 🦊',
      enabled: true,
    });
    folder.changed?.();
    await profiles.ready;
    await Promise.resolve();
    await Promise.resolve();

    expect(profiles.resolve('editor', null)).toContain('End with 🦊');
  });

  it('migrate_whenFolderIsNew_copiesTheStoredProfilesAndLeavesTheStore', async () => {
    const stored: string = JSON.stringify([
      { id: '5f0c-uuid', name: 'Both', system: 'Explicit types.', user: 'British English.' },
      { id: 'b', name: 'User only', system: '', user: 'Be brief.' },
      'junk',
      { name: 'no id' },
      { id: 'c', name: 'Odd scope', scope: { surfaces: ['kitchen'] }, instructions: 'x' },
    ]);
    localStorage.setItem('ai.promptProfiles', stored);
    const folder: FakeFolder = installBridge(null);
    const profiles: PromptProfiles = TestBed.inject(PromptProfiles);
    await profiles.ready;

    expect(
      profiles
        .profiles()
        .map((profile: PromptProfile): [string, string] => [profile.id, profile.instructions]),
    ).toEqual([
      ['both', 'Explicit types.\n\nBritish English.'],
      ['odd-scope', 'x'],
      ['user-only', 'Be brief.'],
    ]);
    expect(folder.saves).toHaveLength(3);
    expect(profiles.profiles()[1].scope).toEqual({ surfaces: [], languages: [] });
    expect(localStorage.getItem('ai.promptProfiles')).toBe(stored);
  });

  it('migrate_whenFolderAlreadyExisted_doesNothing', async () => {
    localStorage.setItem(
      'ai.promptProfiles',
      JSON.stringify([{ id: 'a', name: 'Old', instructions: 'x' }]),
    );
    const folder: FakeFolder = installBridge([]);
    const profiles: PromptProfiles = TestBed.inject(PromptProfiles);
    await profiles.ready;

    expect(profiles.profiles()).toEqual([]);
    expect(folder.saves).toEqual([]);
  });
});

describe('PromptProfiles', () => {
  let profiles: PromptProfiles;

  beforeEach(() => {
    localStorage.clear();
    profiles = TestBed.inject(PromptProfiles);
  });

  it('update_whenCalled_changesTheNamedFields', () => {
    const created: PromptProfile = profiles.create('One');

    profiles.update(created.id, {
      instructions: 'Be terse.',
      scope: { surfaces: ['terminal'], languages: [] },
    });

    expect(profiles.profiles()[0].instructions).toBe('Be terse.');
    expect(profiles.profiles()[0].scope.surfaces).toEqual(['terminal']);
  });

  it('delete_whenCalled_removesTheProfile', () => {
    const created: PromptProfile = profiles.create('One');

    profiles.delete(created.id);

    expect(profiles.profiles()).toHaveLength(0);
  });

  it('resolve_whenNothingMatches_returnsNothing', () => {
    const created: PromptProfile = profiles.create('C#');
    profiles.update(created.id, {
      scope: { surfaces: [], languages: ['csharp'] },
      instructions: 'Use var.',
    });

    expect(profiles.resolve('editor', 'markdown')).toBe('');
  });

  it('resolve_whenSeveralMatch_composesGlobalThenSurfaceThenLanguage', () => {
    const language: PromptProfile = profiles.create('C#');
    profiles.update(language.id, {
      scope: { surfaces: [], languages: ['csharp'] },
      instructions: 'Explicit types.',
    });
    const global: PromptProfile = profiles.create('Everywhere');
    profiles.update(global.id, { instructions: 'British English.' });
    const surface: PromptProfile = profiles.create('Editor');
    profiles.update(surface.id, {
      scope: { surfaces: ['editor'], languages: [] },
      instructions: 'Be terse.',
    });

    expect(profiles.resolve('editor', 'csharp')).toBe(
      '### Everywhere\nBritish English.\n\n### Editor\nBe terse.\n\n### C#\nExplicit types.',
    );
  });

  it('resolve_whenProfileDisabled_skipsIt', () => {
    const created: PromptProfile = profiles.create('Parked');
    profiles.update(created.id, { instructions: 'Ignored.', enabled: false });

    expect(profiles.resolve('project', null)).toBe('');
  });
});
