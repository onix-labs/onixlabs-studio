import { TestBed } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
import type { PluginSummary } from '@shared/api/plugin-channels';
import { Icon } from '@shared/angular/icons/icon';
import { Plugins } from '@shared/angular/services/plugins/plugins';
import {
  ALL_PLUGINS,
  AVAILABLE_PLUGINS,
  categoriesOf,
  INSTALLED_PLUGINS,
  PluginBrowse,
} from './plugin-browse';

/**
 * Builds a plugin summary with the fields these tests narrow on.
 * @param overrides The fields to set.
 * @returns Returns the summary.
 */
function plugin(overrides: Partial<PluginSummary> & { id: string; name: string }): PluginSummary {
  return {
    description: '',
    state: 'available',
    version: '1.0.0',
    installedVersion: null,
    installedPath: null,
    detail: null,
    origin: null,
    contributions: [],
    ...overrides,
  } as unknown as PluginSummary;
}

describe('PluginBrowse', () => {
  let browse: PluginBrowse;
  let catalogue: WritableSignal<readonly PluginSummary[]>;

  beforeEach(() => {
    catalogue = signal<readonly PluginSummary[]>([
      plugin({
        id: 'ts',
        name: 'TypeScript Language Server',
        description: 'Serves TypeScript and JavaScript.',
        state: 'installed',
        contributions: [
          {
            slot: 'language-server',
            id: 'ts',
            displayName: 'TypeScript',
            languages: ['typescript'],
            priority: 100,
          },
        ] as unknown as PluginSummary['contributions'],
      }),
      plugin({
        id: 'claude',
        name: 'Claude',
        description: 'The full Claude agent.',
        contributions: [
          { slot: 'agent-harness', id: 'claude', displayName: 'Claude', priority: 100 },
        ] as unknown as PluginSummary['contributions'],
      }),
      plugin({ id: 'mystery', name: 'Mystery', description: 'Contributes nothing legible.' }),
    ]);
    TestBed.configureTestingModule({
      providers: [{ provide: Plugins, useValue: { plugins: catalogue } }],
    });
    browse = TestBed.inject(PluginBrowse);
  });

  it('visible_whenNothingIsNarrowed_isEverythingByName', () => {
    expect(browse.visible().map((p: PluginSummary): string => p.name)).toEqual([
      'Claude',
      'Mystery',
      'TypeScript Language Server',
    ]);
  });

  it('query_matchesNameDescriptionIdAndCategory', () => {
    browse.query.set('javascript');
    expect(browse.visible().map((p: PluginSummary): string => p.id)).toEqual(['ts']);

    browse.query.set('ai providers');
    expect(browse.visible().map((p: PluginSummary): string => p.id)).toEqual(['claude']);
  });

  it('filter_startsOnEveryPlugin_andNarrowsToInstalledAvailableOrACategory', () => {
    // #950. One flat list of filters in the side panel: every plugin, by install state, or a category.
    expect(browse.filter()).toBe(ALL_PLUGINS);
    expect(browse.visible()).toHaveLength(3);
    expect(browse.narrowed()).toBe(false);

    browse.filter.set(INSTALLED_PLUGINS);
    expect(browse.visible().map((p: PluginSummary): string => p.id)).toEqual(['ts']);
    expect(browse.narrowed()).toBe(true);

    browse.filter.set(AVAILABLE_PLUGINS);
    expect(browse.visible().map((p: PluginSummary): string => p.id)).toEqual(['claude', 'mystery']);

    browse.filter.set('AI Providers');
    expect(browse.visible().map((p: PluginSummary): string => p.id)).toEqual(['claude']);
  });

  it('installed_countsASideloadedPlugin_thoughItRecordsNoVersion', () => {
    catalogue.set([
      plugin({ id: 'sideloaded', name: 'Zig', state: 'installed', installedVersion: null }),
      plugin({ id: 'updating', name: 'Busy', state: 'busy', installedVersion: '1.0.0' }),
      plugin({ id: 'new', name: 'New', state: 'available', installedVersion: null }),
    ]);

    browse.filter.set(INSTALLED_PLUGINS);
    expect(browse.visible().map((p: PluginSummary): string => p.id)).toEqual([
      'updating',
      'sideloaded',
    ]);
    expect(browse.installedCount()).toBe(2);
    browse.filter.set(AVAILABLE_PLUGINS);
    expect(browse.visible().map((p: PluginSummary): string => p.id)).toEqual(['new']);
  });

  it('categories_areBuiltFromWhatIsContributed_withCountsAndIcons', () => {
    expect(browse.categories()).toEqual([
      { name: 'AI Providers', count: 1, icon: Icon.AGENT },
      { name: 'Language Servers', count: 1, icon: Icon.LANGUAGE_SERVERS },
      // A plugin contributing nothing recognisable still has to appear somewhere, and still needs a
      // glyph — the puzzle piece, which is what the catalogue as a whole is drawn with.
      { name: 'Other', count: 1, icon: Icon.PLUGINS },
    ]);
  });

  it('sort_followsTheColumnHeader_andItsDirection', () => {
    browse.sort.set({ columnId: 'state', direction: 'asc' });
    expect(browse.visible()[0].id).toBe('ts');

    browse.sort.set({ columnId: 'plugin', direction: 'desc' });
    expect(browse.visible().map((p: PluginSummary): string => p.name)).toEqual([
      'TypeScript Language Server',
      'Mystery',
      'Claude',
    ]);
  });

  it('visible_pinsPluginsWithAnUpdateToTheTop_underEveryFilterAndSort', () => {
    catalogue.set([
      plugin({ id: 'alpha', name: 'Alpha', state: 'installed', installedVersion: '1.0.0' }),
      plugin({ id: 'beta', name: 'Beta', state: 'available' }),
      plugin({
        id: 'yak',
        name: 'Yak',
        state: 'installed',
        version: '2.0.0',
        installedVersion: '1.0.0',
      }),
      plugin({
        id: 'zed',
        name: 'Zed',
        state: 'installed',
        version: '2.0.0',
        installedVersion: '1.0.0',
      }),
    ]);
    const ids: () => readonly string[] = (): readonly string[] =>
      browse.visible().map((p: PluginSummary): string => p.id);

    expect(ids()).toEqual(['yak', 'zed', 'alpha', 'beta']);

    browse.filter.set(INSTALLED_PLUGINS);
    expect(ids()).toEqual(['yak', 'zed', 'alpha']);

    browse.filter.set('Other');
    expect(ids()).toEqual(['yak', 'zed', 'alpha', 'beta']);

    // The column sort still orders the updates among themselves, and everything beneath them.
    browse.filter.set(ALL_PLUGINS);
    browse.sort.set({ columnId: 'plugin', direction: 'desc' });
    expect(ids()).toEqual(['zed', 'yak', 'beta', 'alpha']);
  });

  it('counts_areOfTheCatalogueRatherThanTheFilteredList', () => {
    browse.query.set('claude');

    expect(browse.visible()).toHaveLength(1);
    expect(browse.installedCount()).toBe(1);
    expect(browse.notInstalledCount()).toBe(2);
  });

  it('narrowed_reportsWhetherAnyFilterIsApplied', () => {
    expect(browse.narrowed()).toBe(false);
    browse.query.set('x');
    expect(browse.narrowed()).toBe(true);
    browse.clearQuery();
    expect(browse.narrowed()).toBe(false);
  });

  it('categoriesOf_namesEverySlotAPluginFills', () => {
    expect(categoriesOf(catalogue()[0])).toEqual(['Language Servers']);
    expect(categoriesOf(catalogue()[2])).toEqual(['Other']);
  });
});
