import { TestBed } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
import type { PluginSummary } from '@shared/api/plugin-channels';
import { Plugins } from '@shared/angular/services/plugins/plugins';
import { categoriesOf, PluginBrowse } from './plugin-browse';

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

    browse.query.set('ai agents');
    expect(browse.visible().map((p: PluginSummary): string => p.id)).toEqual(['claude']);
  });

  it('stateFilter_narrowsToInstalledOrNotInstalled', () => {
    browse.stateFilter.set('installed');
    expect(browse.visible().map((p: PluginSummary): string => p.id)).toEqual(['ts']);

    browse.stateFilter.set('not-installed');
    expect(browse.visible().map((p: PluginSummary): string => p.id)).toEqual(['claude', 'mystery']);
  });

  it('aBusyPluginShowsUnderBothStates_soARowNeverVanishesUnderTheButtonJustPressed', () => {
    catalogue.set([plugin({ id: 'busy', name: 'Busy', state: 'busy' })]);

    browse.stateFilter.set('installed');
    expect(browse.visible()).toHaveLength(1);
    browse.stateFilter.set('not-installed');
    expect(browse.visible()).toHaveLength(1);
  });

  it('category_narrowsToThatCategoryOnly', () => {
    browse.category.set('AI Agents');
    expect(browse.visible().map((p: PluginSummary): string => p.id)).toEqual(['claude']);
  });

  it('categories_areBuiltFromWhatIsContributed_withCounts', () => {
    expect(browse.categories()).toEqual([
      { name: 'AI Agents', count: 1 },
      { name: 'Language Servers', count: 1 },
      // A plugin contributing nothing recognisable still has to appear somewhere.
      { name: 'Other', count: 1 },
    ]);
  });

  it('sort_byStatePutsInstalledFirst', () => {
    browse.sort.set('state');
    expect(browse.visible()[0].id).toBe('ts');
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
