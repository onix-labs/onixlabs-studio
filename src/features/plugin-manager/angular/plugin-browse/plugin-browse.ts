import { computed, inject, Injectable, Signal, signal, WritableSignal } from '@angular/core';
import { type PluginContribution, type PluginSummary } from '@shared/api/plugin-channels';
import { Icon } from '@shared/angular/icons/icon';
import { Plugins } from '@shared/angular/services/plugins/plugins';

/**
 * One row of the categories panel: what it is called, how many plugins it holds, and the glyph that
 * stands for it.
 */
export interface PluginCategory {
  /**
   * Gets the category name, which is also how a plugin is matched to it.
   */
  readonly name: string;

  /**
   * Gets how many plugins fall under it.
   */
  readonly count: number;

  /**
   * Gets the icon shown beside it.
   */
  readonly icon: Icon;
}

/**
 * Which install states the list is narrowed to.
 */
export type PluginStateFilter = 'all' | 'installed' | 'not-installed';

/**
 * How the list is ordered.
 */
export type PluginSort = 'name' | 'category' | 'state';

/**
 * The category every plugin falls under when it contributes nothing recognisable.
 */
const UNCATEGORISED: string = 'Other';

/**
 * The display name of each contribution slot, which is what the categories panel lists.
 *
 * Keyed by the slot rather than derived from it so the wording is a decision made here rather than a
 * mechanical de-kebabing — "Language Servers" reads better than "Language Server" as a category, and
 * "AI Agents" is what a user calls an agent harness.
 */
const SLOT_CATEGORIES: Readonly<Record<string, string>> = {
  'language-server': 'Language Servers',
  'debug-adapter': 'Debug Adapters',
  decoder: 'Decoders',
  'container-engine': 'Container Engines',
  'agent-harness': 'AI Agents',
};

/**
 * The glyph shown beside each category, all duotone so the panel reads as one set.
 *
 * Keyed by the category name rather than by the slot, so the panel and this table cannot drift: a
 * category that appears because a plugin contributed it is looked up by the same string the panel
 * shows. A name with no entry falls back to the puzzle piece rather than rendering nothing.
 */
const CATEGORY_ICONS: Readonly<Record<string, Icon>> = {
  'Language Servers': Icon.LANGUAGE_SERVERS,
  'Debug Adapters': Icon.DEBUG,
  Decoders: Icon.DECODERS,
  'Container Engines': Icon.CONTAINERS,
  'AI Agents': Icon.AGENT,
};

/**
 * The same glyphs at the light weight, for a plugin row.
 *
 * ⚠️ The panel and a row deliberately differ in weight rather than in glyph: duotone reads as a set of
 * destinations, where a list of duotone icons at row size turns into a wall of colour. Keeping the
 * glyph means a plugin still looks like the category that filters to it.
 */
const ROW_ICONS: Readonly<Record<string, Icon>> = {
  'Language Servers': Icon.LANGUAGE_SERVERS_LIGHT,
  'Debug Adapters': Icon.DEBUG_LIGHT,
  Decoders: Icon.DECODERS_LIGHT,
  'Container Engines': Icon.CONTAINERS_LIGHT,
  'AI Agents': Icon.AGENT_LIGHT,
};

/**
 * The browsing state of the Plugin Manager — what is searched for, which install states are shown,
 * which category is selected, and how the list is ordered.
 *
 * ⛔ Held in a service rather than in the view because three surfaces read it: the contextual ribbon
 * owns the controls, the view renders the result, and the status strip counts it. A view-local signal
 * would leave the ribbon unable to reach the thing its own buttons change.
 *
 * Root-provided, because the Plugin Manager is a singleton tool view — there is only ever one of it, so
 * there is no per-tab state to keep apart.
 */
@Injectable({ providedIn: 'root' })
export class PluginBrowse {
  /**
   * Holds the plugin catalogue.
   */
  private readonly plugins: Plugins = inject(Plugins);

  /**
   * Gets the search text, empty when nothing is being searched for.
   */
  public readonly query: WritableSignal<string> = signal<string>('');

  /**
   * Gets which install states are shown.
   */
  public readonly stateFilter: WritableSignal<PluginStateFilter> = signal<PluginStateFilter>('all');

  /**
   * Gets the selected category, or null for every category.
   */
  public readonly category: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Gets the ordering.
   */
  public readonly sort: WritableSignal<PluginSort> = signal<PluginSort>('name');

  /**
   * Gets every known plugin.
   */
  public readonly all: Signal<readonly PluginSummary[]> = this.plugins.plugins;

  /**
   * Gets the categories present in the catalogue, in display order, each with how many plugins it holds.
   *
   * Built from what is actually contributed rather than from the full slot list: a category with
   * nothing in it is a row that can only disappoint, and the set grows on its own as plugins arrive.
   */
  public readonly categories: Signal<readonly PluginCategory[]> = computed(
    (): readonly PluginCategory[] => {
      const counts: Map<string, number> = new Map<string, number>();
      for (const plugin of this.all()) {
        for (const name of categoriesOf(plugin)) {
          counts.set(name, (counts.get(name) ?? 0) + 1);
        }
      }
      return [...counts.entries()]
        .map(([name, count]: [string, number]): PluginCategory => ({
          name,
          count,
          icon: iconForCategory(name),
        }))
        .sort((left, right): number => left.name.localeCompare(right.name));
    },
  );

  /**
   * Gets the plugins the list should show, narrowed by every filter and then ordered.
   */
  public readonly visible: Signal<readonly PluginSummary[]> = computed(
    (): readonly PluginSummary[] => {
      const text: string = this.query().trim().toLowerCase();
      const state: PluginStateFilter = this.stateFilter();
      const category: string | null = this.category();
      const matched: readonly PluginSummary[] = this.all().filter(
        (plugin: PluginSummary): boolean =>
          matchesState(plugin, state) &&
          (category === null || categoriesOf(plugin).includes(category)) &&
          (text.length === 0 || matchesText(plugin, text)),
      );
      return [...matched].sort(comparerFor(this.sort()));
    },
  );

  /**
   * Gets how many plugins are installed.
   */
  public readonly installedCount: Signal<number> = computed(
    (): number =>
      this.all().filter((plugin: PluginSummary): boolean => plugin.state === 'installed').length,
  );

  /**
   * Gets how many plugins are available but not installed.
   */
  public readonly notInstalledCount: Signal<number> = computed(
    (): number => this.all().length - this.installedCount(),
  );

  /**
   * Gets whether any filter is narrowing the list, which decides how an empty list is explained.
   */
  public readonly narrowed: Signal<boolean> = computed(
    (): boolean =>
      this.query().trim().length > 0 || this.stateFilter() !== 'all' || this.category() !== null,
  );

  /**
   * Clears the search text.
   */
  public clearQuery(): void {
    this.query.set('');
  }
}

/**
 * Gets the glyph that stands for a category.
 *
 * Exported because the list rows use it too: a plugin is drawn with the icon of the category it falls
 * under, so the panel and the row it filters to cannot show different pictures of the same thing.
 * @param name The category name.
 * @returns Returns the icon, falling back to the puzzle piece for a category with no entry.
 */
export function iconForCategory(name: string): Icon {
  return CATEGORY_ICONS[name] ?? Icon.PLUGINS;
}

/**
 * Gets the glyph a plugin row is drawn with: the category's, at the light weight.
 * @param name The category name.
 * @returns Returns the icon, falling back to the puzzle piece for a category with no entry.
 */
export function rowIconForCategory(name: string): Icon {
  return ROW_ICONS[name] ?? Icon.PLUGINS_LIGHT;
}

/**
 * Gets the categories a plugin belongs to, which is one per kind of thing it contributes.
 * @param plugin The plugin.
 * @returns Returns the category names, never empty.
 */
export function categoriesOf(plugin: PluginSummary): readonly string[] {
  const names: Set<string> = new Set<string>(
    plugin.contributions.map(
      (contribution: PluginContribution): string =>
        SLOT_CATEGORIES[contribution.slot] ?? UNCATEGORISED,
    ),
  );
  return names.size === 0 ? [UNCATEGORISED] : [...names];
}

/**
 * Gets whether a plugin passes the install-state filter.
 * @param plugin The plugin.
 * @param filter The filter.
 * @returns Returns true when it passes.
 */
function matchesState(plugin: PluginSummary, filter: PluginStateFilter): boolean {
  if (filter === 'all') {
    return true;
  }
  // ⚠️ `busy` counts as installed while an install is in flight and as not-installed while a removal
  // is: either would make a row vanish from under the button the user just pressed. It shows in both.
  if (plugin.state === 'busy') {
    return true;
  }
  return filter === 'installed' ? plugin.state === 'installed' : plugin.state !== 'installed';
}

/**
 * Gets whether a plugin matches search text, across everything a user would reasonably type.
 * @param plugin The plugin.
 * @param text The lower-cased search text.
 * @returns Returns true when it matches.
 */
function matchesText(plugin: PluginSummary, text: string): boolean {
  return (
    plugin.name.toLowerCase().includes(text) ||
    plugin.description.toLowerCase().includes(text) ||
    plugin.id.toLowerCase().includes(text) ||
    categoriesOf(plugin).some((name: string): boolean => name.toLowerCase().includes(text))
  );
}

/**
 * Builds the comparer for an ordering. Every ordering falls back to the name, so the list is stable
 * rather than arbitrary within a group.
 * @param sort The ordering.
 * @returns Returns the comparer.
 */
function comparerFor(sort: PluginSort): (left: PluginSummary, right: PluginSummary) => number {
  const byName: (left: PluginSummary, right: PluginSummary) => number = (
    left: PluginSummary,
    right: PluginSummary,
  ): number => left.name.localeCompare(right.name);
  if (sort === 'category') {
    return (left: PluginSummary, right: PluginSummary): number =>
      categoriesOf(left)[0].localeCompare(categoriesOf(right)[0]) || byName(left, right);
  }
  if (sort === 'state') {
    // Installed first: what you already have is what you are most likely looking for.
    const rank: (plugin: PluginSummary) => number = (plugin: PluginSummary): number =>
      plugin.state === 'installed' ? 0 : 1;
    return (left: PluginSummary, right: PluginSummary): number =>
      rank(left) - rank(right) || byName(left, right);
  }
  return byName;
}
