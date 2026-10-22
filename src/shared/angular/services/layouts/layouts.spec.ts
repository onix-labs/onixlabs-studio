import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { mkStack } from '@shared/angular/services/dock-layout/dock-node';
import { DockNode } from '@shared/angular/services/dock-layout/dock-node';
import { SettingsStore } from '@shared/angular/services/settings-store/settings-store';
import { LayoutInfo, Layouts, LayoutSession } from './layouts';

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

describe('Layouts', () => {
  let store: FakeStore;
  let root: WritableSignal<string | null>;
  let applied: number;
  let captured: DockNode;
  let session: LayoutSession;

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
   * Builds the service against the current fake-store contents, registering two templates.
   * @param seed Whether to run the first-run seed, as the workspace view does.
   * @returns Returns the service under test.
   */
  function build(seed: boolean = true): Layouts {
    // Reset first, so a spec can rebuild the service over the same store and prove that what
    // survives a restart is only what was persisted.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: SettingsStore, useValue: store }],
    });
    const layouts: Layouts = TestBed.inject(Layouts);
    layouts.registerTemplate({
      id: 'default',
      name: 'Default',
      createLayout: (): DockNode => mkStack('tool', ['files']),
    });
    layouts.registerTemplate({
      id: 'source-control',
      name: 'Version Control',
      createLayout: (): DockNode => mkStack('tool', ['branches']),
    });
    if (seed) {
      layouts.seedFromTemplates();
    }
    return layouts;
  }

  /**
   * Resolves a layout by name.
   * @param layouts The service under test.
   * @param name The layout name.
   * @returns Returns the layout's identifier, or the empty string when absent.
   */
  function idOf(layouts: Layouts, name: string): string {
    return layouts.layouts().find((layout: LayoutInfo): boolean => layout.name === name)?.id ?? '';
  }

  it('templates_areRegisteredIdempotently_andAreNotLayouts', (): void => {
    const layouts: Layouts = build(false);
    layouts.registerTemplate({
      id: 'default',
      name: 'Duplicate',
      createLayout: (): DockNode => mkStack('tool', []),
    });

    expect(layouts.templates()).toEqual([
      { id: 'default', name: 'Default' },
      { id: 'source-control', name: 'Version Control' },
    ]);
    expect(layouts.layouts()).toEqual([]);
  });

  it('seedFromTemplates_onAFirstRun_makesOneLayoutPerTemplate', (): void => {
    const layouts: Layouts = build();

    expect(layouts.layouts().map((layout: LayoutInfo): string => layout.name)).toEqual([
      'Default',
      'Version Control',
    ]);
    // The seeded layouts are the user's own, so they persist like any other.
    expect(Array.isArray(store.values.get('layout.presets'))).toBe(true);
  });

  it('seedFromTemplates_whenLayoutsWereEverWritten_doesNothing', (): void => {
    // A user who deleted every layout has said something; growing them back would overrule them.
    store.values.set('layout.presets', []);
    const layouts: Layouts = build();

    expect(layouts.layouts()).toEqual([]);
    expect(layouts.defaultId()).toBeNull();
  });

  it('layoutForRoot_withNoLayouts_fallsBackToTheFirstTemplate', (): void => {
    store.values.set('layout.presets', []);
    const layouts: Layouts = build();

    // Node ids are minted per call, so the tree is compared by what it holds rather than by identity.
    expect(layouts.layoutForRoot('/repo')).toMatchObject({ kind: 'stack', panels: ['files'] });
  });

  it('createFromTemplate_addsALayoutNamedUniquely_withoutApplyingIt', (): void => {
    const layouts: Layouts = build();
    layouts.register(session);
    applied = 0;

    layouts.createFromTemplate('default');
    layouts.createFromTemplate('default');

    expect(layouts.layouts().map((layout: LayoutInfo): string => layout.name)).toEqual([
      'Default',
      'Version Control',
      'Default 2',
      'Default 3',
    ]);
    // Layouts are made in the manager and chosen from the ribbon; adding one applies nothing.
    expect(applied).toBe(0);
  });

  it('createFromTemplate_afterTheFirstWasRenamed_takesTheNameBack', (): void => {
    const layouts: Layouts = build();
    layouts.rename(idOf(layouts, 'Default'), 'General Engineering');

    layouts.createFromTemplate('default');

    expect(layouts.layouts().map((layout: LayoutInfo): string => layout.name)).toEqual([
      'General Engineering',
      'Version Control',
      'Default',
    ]);
  });

  it('createFromTemplate_withAnUnknownTemplate_isIgnored', (): void => {
    const layouts: Layouts = build();

    expect(layouts.createFromTemplate('missing')).toBeNull();
    expect(layouts.layouts().length).toBe(2);
  });

  it('saveAs_withAFreeName_addsALayout_andMakesItTheRootsPick', (): void => {
    const layouts: Layouts = build();
    layouts.register(session);

    const id: string | null = layouts.saveAs('Mine');

    expect(id).not.toBeNull();
    expect(layouts.layouts().length).toBe(3);
    expect(layouts.activeFor('/repo')).toBe(id);
  });

  it('saveAs_overAnExistingName_replacesInPlace_keepingItsIdentityAndItsRole', (): void => {
    const layouts: Layouts = build();
    layouts.register(session);
    const id: string = idOf(layouts, 'Default');
    layouts.setDefault(id);

    // Saving over a name is how a layout is UPDATED — there is no separate Save. Replacing by
    // delete-and-recreate would orphan the default marker and every root that picked it.
    layouts.saveAs('default');

    expect(layouts.layouts().length).toBe(2);
    expect(idOf(layouts, 'default')).toBe(id);
    expect(layouts.defaultId()).toBe(id);
    expect(layouts.layoutOf(id)).toEqual(captured);
  });

  it('saveAs_withoutASessionOrWithABlankName_savesNothing', (): void => {
    const layouts: Layouts = build();

    expect(layouts.saveAs('Nowhere')).toBeNull();

    layouts.register(session);
    expect(layouts.saveAs('   ')).toBeNull();
    expect(layouts.layouts().length).toBe(2);
  });

  it('layoutNamed_matchesCaseInsensitively_andCanDisregardOneLayout', (): void => {
    const layouts: Layouts = build();
    const id: string = idOf(layouts, 'Default');

    expect(layouts.layoutNamed('  DEFAULT ')?.id).toBe(id);
    expect(layouts.layoutNamed('Default', id)).toBeNull();
    expect(layouts.layoutNamed('Nothing')).toBeNull();
  });

  it('rename_refusesAnEmptyName_anUnknownLayout_andOneAnotherLayoutHolds', (): void => {
    const layouts: Layouts = build();
    const id: string = idOf(layouts, 'Default');

    expect(layouts.rename(id, '  ')).toBe(false);
    expect(layouts.rename('missing', 'Fine')).toBe(false);
    // Swallowing another layout's name would leave two the user cannot tell apart.
    expect(layouts.rename(id, 'version control')).toBe(false);
    expect(layouts.rename(id, 'Mine')).toBe(true);
    expect(layouts.layouts()[0]?.name).toBe('Mine');
  });

  it('remove_dropsTheDefaultChoice_andReSeedsWhenItWasShowing', async (): Promise<void> => {
    const layouts: Layouts = build();
    layouts.register(session);
    const id: string = idOf(layouts, 'Default');
    layouts.setDefault(id);
    applied = 0;

    await layouts.remove(id);

    expect(layouts.layouts().length).toBe(1);
    expect(store.values.get('layout.default-preset')).toBeNull();
    expect(layouts.defaultId()).toBe(idOf(layouts, 'Version Control'));
    expect(applied).toBe(1);
  });

  it('activeFor_prefersThePersistedPick_andFallsBackToTheDefault', (): void => {
    const layouts: Layouts = build();
    const fallback: string = idOf(layouts, 'Default');
    store.values.set('layout.active-presets', { '/repo': 'missing' });

    // A pick naming a layout that no longer exists is not honoured — the default answers instead.
    expect(layouts.activeFor('/repo')).toBe(fallback);
    expect(layouts.activeFor(null)).toBe(fallback);
  });

  it('select_ignoresATemplateId_sinceATemplateIsNotALayout', async (): Promise<void> => {
    const layouts: Layouts = build();
    layouts.register(session);
    applied = 0;

    await layouts.select('default');

    expect(applied).toBe(0);
  });

  it('switchTransient_shadowsThePickWithoutPersistingIt_andReturnRestores', async (): Promise<void> => {
    const layouts: Layouts = build();
    layouts.register(session);
    const chosen: string = idOf(layouts, 'Version Control');

    expect(await layouts.switchTransient(chosen)).toBe(true);
    expect(layouts.activeId()).toBe(chosen);
    expect(layouts.transientActive()).toBe(true);
    // The persisted pick is untouched.
    expect(layouts.activeFor('/repo')).toBe(idOf(layouts, 'Default'));
    expect(applied).toBe(1);

    await layouts.returnFromTransient();
    expect(layouts.activeId()).toBe(idOf(layouts, 'Default'));
    expect(layouts.transientActive()).toBe(false);
    expect(applied).toBe(2);
  });

  it('switchTransientForTemplate_prefersTheUsersOwnLayoutForIt', async (): Promise<void> => {
    const layouts: Layouts = build();
    layouts.register(session);
    const own: string = idOf(layouts, 'Version Control');
    // The link is the template it came from, so renaming does not break it.
    layouts.rename(own, 'Committing');

    expect(await layouts.switchTransientForTemplate('source-control')).toBe(true);
    expect(layouts.activeId()).toBe(own);
    expect(layouts.activeName()).toBe('Committing');
  });

  it('switchTransientForTemplate_withNoLayoutOfTheirOwn_stagesTheTemplate', async (): Promise<void> => {
    const layouts: Layouts = build();
    layouts.register(session);
    await layouts.remove(idOf(layouts, 'Version Control'));

    expect(await layouts.switchTransientForTemplate('source-control')).toBe(true);
    expect(layouts.activeId()).toBe('source-control');
    expect(layouts.activeName()).toBe('Version Control');
  });

  it('switchTransient_whenAlreadyShowingOrUnknown_declines', async (): Promise<void> => {
    const layouts: Layouts = build();
    layouts.register(session);

    expect(await layouts.switchTransient(idOf(layouts, 'Default'))).toBe(false);
    expect(await layouts.switchTransient('missing')).toBe(false);
    expect(applied).toBe(0);
  });

  it('select_whileTransient_takesOverAndDisarmsIt', async (): Promise<void> => {
    const layouts: Layouts = build();
    layouts.register(session);
    const chosen: string = idOf(layouts, 'Version Control');
    await layouts.switchTransient(chosen);

    await layouts.select(chosen);

    expect(layouts.transientActive()).toBe(false);
    expect(layouts.activeFor('/repo')).toBe(chosen);

    await layouts.returnFromTransient();
    expect(layouts.activeId()).toBe(chosen);
  });

  it('select_whenTheSessionDeclines_keepsThePickAndTheDock', async (): Promise<void> => {
    const layouts: Layouts = build();
    const offered: (DockNode | null)[] = [];
    layouts.register({
      ...session,
      confirmApply: (next: DockNode | null): Promise<boolean> => {
        offered.push(next);
        return Promise.resolve(false);
      },
    });
    const before: string | null = layouts.activeId();

    await layouts.select(idOf(layouts, 'Version Control'));

    // The session was shown the incoming tree, and declining it changed nothing.
    expect(offered).toHaveLength(1);
    expect(offered[0]).toMatchObject({ kind: 'stack', panels: ['branches'] });
    expect(layouts.activeId()).toBe(before);
    expect(applied).toBe(0);
  });

  it('switchesAndResets_whenTheSessionDeclines_doNothing', async (): Promise<void> => {
    const layouts: Layouts = build();
    layouts.register({ ...session, confirmApply: (): Promise<boolean> => Promise.resolve(false) });

    expect(await layouts.switchTransient(idOf(layouts, 'Version Control'))).toBe(false);
    await layouts.reset();

    expect(layouts.transientActive()).toBe(false);
    expect(applied).toBe(0);
  });

  it('switches_whenTheSessionAgrees_apply', async (): Promise<void> => {
    const layouts: Layouts = build();
    layouts.register({ ...session, confirmApply: (): Promise<boolean> => Promise.resolve(true) });

    await layouts.select(idOf(layouts, 'Version Control'));
    await layouts.reset();

    expect(applied).toBe(2);
  });

  it('activeName_withoutASession_isNull_andFallsBackToTheTemplateWithNoLayouts', (): void => {
    store.values.set('layout.presets', []);
    const layouts: Layouts = build();

    expect(layouts.activeName()).toBeNull();

    layouts.register(session);
    expect(layouts.activeName()).toBe('Default');
  });

  it('persistedLayouts_surviveAServiceRebuild_andMalformedEntriesAreDropped', (): void => {
    const first: Layouts = build();
    first.register(session);
    first.saveAs('Kept');
    const stored: unknown = store.values.get('layout.presets');
    store.values.set('layout.presets', [...(stored as unknown[]), { id: 'broken' }, 7, null]);

    const second: Layouts = build();

    expect(second.layouts().map((layout: LayoutInfo): string => layout.name)).toEqual([
      'Default',
      'Version Control',
      'Kept',
    ]);
  });

  it('aSavedLayoutStillNamedForARenamedTemplate_takesItsNewName', (): void => {
    // #941: "Source Control" became "Version Control". A copy seeded before then still carries the old
    // name, and is brought into line; one the user renamed keeps their name.
    store.values.set('layout.presets', [
      { id: 'a', name: 'Source Control', templateId: 'source-control', layout: {} },
      { id: 'b', name: 'My review layout', templateId: 'source-control', layout: {} },
      { id: 'c', name: 'Source Control', layout: {} },
    ]);

    const layouts: Layouts = build();

    expect(layouts.layouts().map((layout: LayoutInfo): string => layout.name)).toEqual([
      'Version Control',
      'My review layout',
      'Source Control',
    ]);
  });

  it('pick_withoutARoot_isSessionOnly_andIsNotPersisted', (): void => {
    const layouts: Layouts = build();
    root.set(null);
    layouts.register(session);

    layouts.saveAs('Rootless');

    expect(store.values.has('layout.active-presets')).toBe(false);
  });
});
