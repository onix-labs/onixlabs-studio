import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { mkStack } from '@shared/angular/services/dock-layout/dock-node';
import { DockNode } from '@shared/angular/services/dock-layout/dock-node';
import { SettingsStore } from '@shared/angular/services/settings-store/settings-store';
import { LayoutPresets, LayoutPresetSession } from './layout-presets';

/**
 * A key-value store fake backed by a plain map, so specs control persisted state without touching
 * localStorage.
 */
class FakeStore {
  /**
   * Holds the stored values by key.
   */
  public readonly values: Map<string, unknown> = new Map<string, unknown>();

  /**
   * Reads a stored value.
   * @param key The storage key.
   * @param fallback The value returned when the key is absent.
   * @returns Returns the stored value or the fallback.
   */
  public get<T>(key: string, fallback: T): T {
    return this.values.has(key) ? (this.values.get(key) as T) : fallback;
  }

  /**
   * Stores a value.
   * @param key The storage key.
   * @param value The value to store.
   */
  public set<T>(key: string, value: T): void {
    this.values.set(key, value);
  }

  /**
   * Registers an external-change listener (never fired here).
   * @returns Returns a disposer.
   */
  public onExternalChange(): () => void {
    return (): void => undefined;
  }
}

describe('LayoutPresets', () => {
  let store: FakeStore;
  let root: WritableSignal<string | null>;
  let applied: number;
  let captured: DockNode;
  let session: LayoutPresetSession;

  beforeEach((): void => {
    store = new FakeStore();
    root = signal<string | null>('/repo');
    applied = 0;
    captured = mkStack('tool', ['errors', 'terminal']);
    session = {
      root,
      capture: (): DockNode => captured,
      apply: (): void => {
        applied++;
      },
    };
  });

  /**
   * Builds the service against the current fake-store contents.
   * @returns Returns the service under test.
   */
  function build(): LayoutPresets {
    TestBed.configureTestingModule({
      providers: [{ provide: SettingsStore, useValue: store }],
    });
    const presets: LayoutPresets = TestBed.inject(LayoutPresets);
    presets.registerBuiltIn({
      id: 'coding',
      name: 'Coding',
      createLayout: (): DockNode => mkStack('tool', ['files']),
    });
    return presets;
  }

  it('presets_listsBuiltInsFirst_andRegistrationIsIdempotent', (): void => {
    const presets: LayoutPresets = build();
    presets.registerBuiltIn({
      id: 'coding',
      name: 'Duplicate',
      createLayout: (): DockNode => mkStack('tool', []),
    });

    expect(presets.presets()).toEqual([{ id: 'coding', name: 'Coding', builtIn: true }]);
  });

  it('activeFor_prefersThePersistedPick_andFallsBackToTheDefault', (): void => {
    store.values.set('layout.active-presets', { '/repo': 'missing' });
    const presets: LayoutPresets = build();

    expect(presets.activeFor('/repo')).toBe('coding');
    expect(presets.activeFor('/other')).toBe('coding');
    expect(presets.activeFor(null)).toBe('coding');
  });

  it('defaultId_withNothingChosen_isTheFirstPreset', (): void => {
    const presets: LayoutPresets = build();

    expect(presets.defaultId()).toBe('coding');
    expect(presets.defaultPreset()?.name).toBe('Coding');
  });

  it('setDefault_persistsTheChoice_andRedirectsTheFallbackForRootsWithoutAPick', (): void => {
    const presets: LayoutPresets = build();
    presets.register(session);
    presets.saveAs('Custom');
    const customId: string = presets.presets().find((preset): boolean => !preset.builtIn)?.id ?? '';

    presets.setDefault(customId);

    expect(presets.defaultId()).toBe(customId);
    expect(store.values.get('layout.default-preset')).toBe(customId);
    // A root that has never picked follows the default; the one that saved the preset keeps its pick.
    expect(presets.activeFor('/untouched')).toBe(customId);
  });

  it('setDefault_ignoresAnUnknownPreset_soAStaleIdCannotDisplaceAWorkingDefault', (): void => {
    const presets: LayoutPresets = build();

    presets.setDefault('missing');

    expect(presets.defaultId()).toBe('coding');
    expect(store.values.has('layout.default-preset')).toBe(false);
  });

  it('defaultId_whenTheChosenPresetIsGone_fallsBackToTheFirstPreset', (): void => {
    store.values.set('layout.default-preset', 'deleted-preset');
    const presets: LayoutPresets = build();

    expect(presets.defaultId()).toBe('coding');
  });

  it('saveAs_withMakeDefault_marksTheNewPresetTheDefault', (): void => {
    const presets: LayoutPresets = build();
    presets.register(session);

    presets.saveAs('Agentic Development', true);

    const customId: string = presets.presets().find((preset): boolean => !preset.builtIn)?.id ?? '';
    expect(presets.defaultId()).toBe(customId);
    expect(store.values.get('layout.default-preset')).toBe(customId);
  });

  it('saveAs_withoutMakeDefault_leavesTheDefaultAlone', (): void => {
    const presets: LayoutPresets = build();
    presets.register(session);

    presets.saveAs('Agentic Development');

    expect(presets.defaultId()).toBe('coding');
  });

  it('remove_droppingTheDefault_clearsTheChoiceRatherThanStrandingIt', (): void => {
    const presets: LayoutPresets = build();
    presets.register(session);
    presets.saveAs('Custom', true);
    const customId: string = presets.presets().find((preset): boolean => !preset.builtIn)?.id ?? '';
    expect(presets.defaultId()).toBe(customId);

    presets.remove(customId);

    expect(presets.defaultId()).toBe('coding');
    expect(store.values.get('layout.default-preset')).toBe(null);
  });

  it('saveAs_capturesTheSessionLayout_persists_andBecomesTheRootsActivePick', (): void => {
    const presets: LayoutPresets = build();
    presets.register(session);

    presets.saveAs('Agentic Development');

    const saved: readonly { id: string; name: string }[] = presets
      .presets()
      .filter((preset): boolean => !preset.builtIn);
    expect(saved.length).toBe(1);
    expect(saved[0].name).toBe('Agentic Development');
    expect(presets.activeFor('/repo')).toBe(saved[0].id);
    expect(presets.layoutOf(saved[0].id)).toEqual(captured);
    expect(store.values.has('layout.presets')).toBe(true);
    expect(store.values.has('layout.active-presets')).toBe(true);
  });

  it('select_recordsThePickAndReSeedsTheSession', (): void => {
    const presets: LayoutPresets = build();
    presets.register(session);
    presets.saveAs('Custom');
    const customId: string = presets.presets().find((preset): boolean => !preset.builtIn)?.id ?? '';

    presets.select('coding');
    expect(presets.activeFor('/repo')).toBe('coding');
    expect(applied).toBe(1);

    presets.select(customId);
    expect(presets.activeFor('/repo')).toBe(customId);
    expect(applied).toBe(2);

    presets.select('unknown');
    expect(applied).toBe(2);
  });

  it('updateActive_writesTheCurrentLayoutIntoTheActiveUserPreset_neverIntoBuiltIns', (): void => {
    const presets: LayoutPresets = build();
    presets.register(session);
    presets.saveAs('Custom');
    const customId: string = presets.presets().find((preset): boolean => !preset.builtIn)?.id ?? '';

    captured = mkStack('tool', ['agent']);
    presets.updateActive();
    expect(presets.layoutOf(customId)).toEqual(captured);

    presets.select('coding');
    captured = mkStack('tool', ['search']);
    presets.updateActive();
    expect(presets.layoutOf('coding')).not.toEqual(captured);
  });

  it('renameAndRemove_applyToUserPresetsOnly', (): void => {
    const presets: LayoutPresets = build();
    presets.register(session);
    presets.saveAs('Custom');
    const customId: string = presets.presets().find((preset): boolean => !preset.builtIn)?.id ?? '';

    presets.rename(customId, ' Renamed ');
    expect(presets.presets().find((preset): boolean => preset.id === customId)?.name).toBe(
      'Renamed',
    );

    presets.rename('coding', 'Hacked');
    expect(presets.presets().find((preset): boolean => preset.id === 'coding')?.name).toBe(
      'Coding',
    );

    // Removing the active preset re-seeds the session from the fallback.
    const before: number = applied;
    presets.remove(customId);
    expect(presets.presets().some((preset): boolean => preset.id === customId)).toBe(false);
    expect(applied).toBe(before + 1);

    presets.remove('coding');
    expect(presets.presets().some((preset): boolean => preset.id === 'coding')).toBe(true);
  });

  it('switchTransient_shadowsThePickWithoutPersistingIt_andReturnRestores', (): void => {
    const presets: LayoutPresets = build();
    presets.registerBuiltIn({
      id: 'git',
      name: 'Git',
      createLayout: (): DockNode => mkStack('tool', ['branches']),
    });
    presets.register(session);

    expect(presets.switchTransient('git')).toBe(true);
    expect(presets.activeId()).toBe('git');
    expect(presets.transientActive()).toBe(true);
    // The persisted pick is untouched.
    expect(presets.activeFor('/repo')).toBe('coding');
    expect(applied).toBe(1);

    presets.returnFromTransient();
    expect(presets.activeId()).toBe('coding');
    expect(presets.transientActive()).toBe(false);
    expect(applied).toBe(2);
  });

  it('switchTransient_whenAlreadyShowingOrUnknown_declines', (): void => {
    const presets: LayoutPresets = build();
    presets.register(session);

    expect(presets.switchTransient('coding')).toBe(false);
    expect(presets.switchTransient('missing')).toBe(false);
    expect(applied).toBe(0);
  });

  it('select_whileTransient_takesOverAndDisarmsIt', (): void => {
    const presets: LayoutPresets = build();
    presets.registerBuiltIn({
      id: 'git',
      name: 'Git',
      createLayout: (): DockNode => mkStack('tool', ['branches']),
    });
    presets.register(session);
    presets.switchTransient('git');

    presets.select('git');
    expect(presets.transientActive()).toBe(false);
    expect(presets.activeFor('/repo')).toBe('git');

    presets.returnFromTransient();
    expect(presets.activeId()).toBe('git');
  });

  it('persistedPresets_surviveAServiceRebuild_andMalformedEntriesAreDropped', (): void => {
    const first: LayoutPresets = build();
    first.register(session);
    first.saveAs('Kept');
    const stored: unknown = store.values.get('layout.presets');
    store.values.set('layout.presets', [...(stored as unknown[]), { junk: true }, 42]);

    TestBed.resetTestingModule();
    const second: LayoutPresets = build();

    const user: readonly { name: string }[] = second
      .presets()
      .filter((preset): boolean => !preset.builtIn);
    expect(user.map((preset): string => preset.name)).toEqual(['Kept']);
  });
});
