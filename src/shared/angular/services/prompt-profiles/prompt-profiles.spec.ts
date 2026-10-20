import { TestBed } from '@angular/core/testing';

import { PromptProfile, PromptProfiles } from './prompt-profiles';

describe('PromptProfiles', () => {
  let profiles: PromptProfiles;

  beforeEach(() => {
    localStorage.clear();
    profiles = TestBed.inject(PromptProfiles);
  });

  it('create_whenCalled_persistsAcrossInstances', () => {
    const created: PromptProfile = profiles.create('House style');

    expect(profiles.profiles()).toHaveLength(1);
    expect(created.enabled).toBe(true);

    TestBed.resetTestingModule();
    const fresh: PromptProfiles = TestBed.inject(PromptProfiles);
    expect(fresh.profiles()[0].name).toBe('House style');
  });

  it('followsProfilesEditedInAnotherWindow', () => {
    // #955: the AI Manager is usually in another window; the agent here must send the edit next turn.
    localStorage.setItem(
      'ai.promptProfiles',
      JSON.stringify([
        {
          id: 'p1',
          name: 'Fox',
          scope: { surfaces: [], languages: [] },
          instructions: 'End with 🦊',
        },
      ]),
    );
    globalThis.dispatchEvent(new StorageEvent('storage', { key: 'ai.promptProfiles' }));

    expect(profiles.profiles().map((profile: PromptProfile): string => profile.name)).toEqual([
      'Fox',
    ]);
    expect(profiles.resolve('editor', null)).toContain('End with 🦊');
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

  it('load_whenStoreHoldsJunk_dropsIt', () => {
    localStorage.setItem(
      'ai.promptProfiles',
      JSON.stringify([
        { id: 'a', name: 'ok', scope: { surfaces: ['kitchen'] } },
        'junk',
        { name: 'no id' },
      ]),
    );

    TestBed.resetTestingModule();
    const fresh: PromptProfiles = TestBed.inject(PromptProfiles);

    expect(fresh.profiles()).toHaveLength(1);
    expect(fresh.profiles()[0].scope).toEqual({ surfaces: [], languages: [] });
  });

  it('load_whenStoreHoldsTheOldTwoLayerShape_joinsThemIntoOneInstructionsText_andRewritesTheStore', () => {
    // #948 dropped the layer added beneath each message. A profile saved before keeps all it said:
    // the standing text first, then what used to go beneath the message.
    localStorage.setItem(
      'ai.promptProfiles',
      JSON.stringify([
        { id: 'a', name: 'Both', system: 'Explicit types.', user: 'British English.' },
        { id: 'b', name: 'User only', system: '', user: 'Be brief.' },
      ]),
    );

    TestBed.resetTestingModule();
    const fresh: PromptProfiles = TestBed.inject(PromptProfiles);

    expect(fresh.profiles().map((profile: PromptProfile): string => profile.instructions)).toEqual([
      'Explicit types.\n\nBritish English.',
      'Be brief.',
    ]);
    const stored: readonly Record<string, unknown>[] = JSON.parse(
      localStorage.getItem('ai.promptProfiles') ?? '[]',
    ) as readonly Record<string, unknown>[];
    expect(stored[0]).toMatchObject({ instructions: 'Explicit types.\n\nBritish English.' });
    expect(stored[0]).not.toHaveProperty('system');
    expect(stored[0]).not.toHaveProperty('user');
  });
});
