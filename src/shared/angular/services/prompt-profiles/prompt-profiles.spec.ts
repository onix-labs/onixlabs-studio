import { TestBed } from '@angular/core/testing';

import { PromptProfile, PromptProfiles, ResolvedPrompts } from './prompt-profiles';

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

  it('update_whenCalled_changesTheNamedFields', () => {
    const created: PromptProfile = profiles.create('One');

    profiles.update(created.id, {
      system: 'Be terse.',
      scope: { surfaces: ['terminal'], languages: [] },
    });

    expect(profiles.profiles()[0].system).toBe('Be terse.');
    expect(profiles.profiles()[0].scope.surfaces).toEqual(['terminal']);
  });

  it('delete_whenCalled_removesTheProfile', () => {
    const created: PromptProfile = profiles.create('One');

    profiles.delete(created.id);

    expect(profiles.profiles()).toHaveLength(0);
  });

  it('resolve_whenNothingMatches_returnsEmptyLayers', () => {
    const created: PromptProfile = profiles.create('C#');
    profiles.update(created.id, {
      scope: { surfaces: [], languages: ['csharp'] },
      user: 'Use var.',
    });

    expect(profiles.resolve('editor', 'markdown')).toEqual({ system: '', user: '' });
  });

  it('resolve_whenSeveralMatch_composesGlobalThenSurfaceThenLanguage', () => {
    const language: PromptProfile = profiles.create('C#');
    profiles.update(language.id, {
      scope: { surfaces: [], languages: ['csharp'] },
      user: 'Explicit types.',
    });
    const global: PromptProfile = profiles.create('Everywhere');
    profiles.update(global.id, { user: 'British English.' });
    const surface: PromptProfile = profiles.create('Editor');
    profiles.update(surface.id, {
      scope: { surfaces: ['editor'], languages: [] },
      user: 'Be terse.',
    });

    const resolved: ResolvedPrompts = profiles.resolve('editor', 'csharp');

    expect(resolved.user).toBe(
      '### Everywhere\nBritish English.\n\n### Editor\nBe terse.\n\n### C#\nExplicit types.',
    );
    expect(resolved.system).toBe('');
  });

  it('resolve_whenProfileDisabled_skipsIt', () => {
    const created: PromptProfile = profiles.create('Parked');
    profiles.update(created.id, { system: 'Ignored.', enabled: false });

    expect(profiles.resolve('project', null).system).toBe('');
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
});
