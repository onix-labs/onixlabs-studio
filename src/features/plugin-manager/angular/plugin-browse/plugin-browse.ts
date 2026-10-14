import { computed, inject, Injectable, Signal, signal, WritableSignal } from '@angular/core';
import {
  PLUGIN_SLOT_LABELS,
  type PluginContribution,
  type PluginSummary,
} from '@shared/api/plugin-channels';
import type { TableSort } from '@shared/angular/components/table/table';
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
 * The filters the side panel offers that are not categories: every plugin, those with a version
 * installed, and the rest. A category filter is the category's own name.
 */
export const ALL_PLUGINS: string = '\u0000all';
export const INSTALLED_PLUGINS: string = '\u0000installed';
export const AVAILABLE_PLUGINS: string = '\u0000available';

/**
 * The category every plugin falls under when it contributes nothing recognisable.
 */
const UNCATEGORISED: string = 'Other';

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
  'Version Control': Icon.SOURCE_CONTROL,
  Hosting: Icon.HOSTING,
  'AI Providers': Icon.AGENT,
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
  'Version Control': Icon.WELCOME_SOURCE_CONTROL,
  Hosting: Icon.HOSTING_LIGHT,
  'AI Providers': Icon.AGENT_LIGHT,
};

/**
 * The browsing state of the Plugin Manager (#950) — what is searched for, which filter the side panel
 * has chosen (every plugin, the installed or available ones, or a category), and the column the list
 * is sorted by.
 *
 * ⛔ Held in a service rather than in the view because the view and the status strip both read it.
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
   * Gets the side panel's filter: {@link ALL_PLUGINS}, {@link INSTALLED_PLUGINS},
   * {@link AVAILABLE_PLUGINS}, or a category's name. Every plugin is shown to begin with.
   */
  public readonly filter: WritableSignal<string> = signal<string>(ALL_PLUGINS);

  /**
   * Gets the column the list is sorted by and its direction, or null for the default order, by name.
   */
  public readonly sort: WritableSignal<TableSort | null> = signal<TableSort | null>(null);

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
   * Gets the plugins the filter and search leave, in the chosen order.
   */
  public readonly visible: Signal<readonly PluginSummary[]> = computed(
    (): readonly PluginSummary[] => {
      const text: string = this.query().trim().toLowerCase();
      const filter: string = this.filter();
      const matched: readonly PluginSummary[] = this.all().filter(
        (plugin: PluginSummary): boolean =>
          passesFilter(plugin, filter) && (text.length === 0 || matchesText(plugin, text)),
      );
      return [...matched].sort(comparerFor(this.sort()));
    },
  );

  /**
   * Gets how many plugins have a version installed on this machine.
   */
  public readonly installedCount: Signal<number> = computed(
    (): number => this.all().filter(isInstalled).length,
  );

  /**
   * Gets how many plugins are available to install.
   */
  public readonly notInstalledCount: Signal<number> = computed(
    (): number => this.all().length - this.installedCount(),
  );

  /**
   * Gets whether anything narrows the list: search text, or a filter other than every plugin.
   */
  public readonly narrowed: Signal<boolean> = computed(
    (): boolean => this.query().trim().length > 0 || this.filter() !== ALL_PLUGINS,
  );

  /**
   * Clears the search text.
   */
  public clearQuery(): void {
    this.query.set('');
  }
}

/**
 * Gets whether a plugin is installed on this machine: it says so, or it has an installed version (an
 * update in flight). A sideloaded plugin is installed without a recorded version, so the state decides.
 * @param plugin The plugin.
 * @returns Returns true when it is installed.
 */
export function isInstalled(plugin: PluginSummary): boolean {
  return plugin.state === 'installed' || plugin.installedVersion !== null;
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
        PLUGIN_SLOT_LABELS[contribution.slot] ?? UNCATEGORISED,
    ),
  );
  return names.size === 0 ? [UNCATEGORISED] : [...names];
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
 * Gets whether a plugin passes the side panel's filter.
 * @param plugin The plugin.
 * @param filter The filter: every plugin, installed, available, or a category's name.
 * @returns Returns true when it passes.
 */
function passesFilter(plugin: PluginSummary, filter: string): boolean {
  switch (filter) {
    case ALL_PLUGINS:
      return true;
    case INSTALLED_PLUGINS:
      return isInstalled(plugin);
    case AVAILABLE_PLUGINS:
      return !isInstalled(plugin);
    default:
      return categoriesOf(plugin).includes(filter);
  }
}

/**
 * Builds the comparer for a column sort: by the plugin's name, its first category, or its state
 * (installed first), each falling back to the name; or by name alone when nothing is sorted.
 * @param sort The column sort, or null.
 * @returns Returns the comparer.
 */
function comparerFor(
  sort: TableSort | null,
): (left: PluginSummary, right: PluginSummary) => number {
  const byName: (left: PluginSummary, right: PluginSummary) => number = (
    left: PluginSummary,
    right: PluginSummary,
  ): number => left.name.localeCompare(right.name);
  if (sort === null) {
    return byName;
  }
  const direction: number = sort.direction === 'asc' ? 1 : -1;
  const rank: (plugin: PluginSummary) => number = (plugin: PluginSummary): number =>
    isInstalled(plugin) ? 0 : 1;
  const primary: (left: PluginSummary, right: PluginSummary) => number =
    sort.columnId === 'category'
      ? (left: PluginSummary, right: PluginSummary): number =>
          categoriesOf(left)[0].localeCompare(categoriesOf(right)[0])
      : sort.columnId === 'state'
        ? (left: PluginSummary, right: PluginSummary): number => rank(left) - rank(right)
        : byName;
  return (left: PluginSummary, right: PluginSummary): number =>
    direction * (primary(left, right) || byName(left, right));
}
