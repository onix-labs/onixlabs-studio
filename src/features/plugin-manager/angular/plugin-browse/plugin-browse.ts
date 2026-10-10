import { computed, inject, Injectable, Signal, signal, WritableSignal } from '@angular/core';
import {
  PLUGIN_SLOT_LABELS,
  type PluginContribution,
  type PluginSummary,
} from '@shared/api/plugin-channels';
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
 * The groups the list is split into: plugins with a version installed, and the rest.
 */
export type PluginGroupId = 'installed' | 'available';

/**
 * How the list is ordered.
 */
export type PluginSort = 'name' | 'category' | 'state';

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
   * Gets the group that is open, or null when the user has closed it. Only one is open at a time, and
   * Installed is open to begin with.
   */
  public readonly openGroup: WritableSignal<PluginGroupId | null> = signal<PluginGroupId | null>(
    'installed',
  );

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
      const category: string | null = this.category();
      const matched: readonly PluginSummary[] = this.all().filter(
        (plugin: PluginSummary): boolean =>
          (category === null || categoriesOf(plugin).includes(category)) &&
          (text.length === 0 || matchesText(plugin, text)),
      );
      return [...matched].sort(comparerFor(this.sort()));
    },
  );

  /**
   * Gets the listed plugins that are installed: present on this machine, a sideloaded one included, or
   * mid-update (still installed while the work runs).
   */
  public readonly installedVisible: Signal<readonly PluginSummary[]> = computed(
    (): readonly PluginSummary[] => this.visible().filter(isInstalled),
  );

  /**
   * Gets the listed plugins that are not installed.
   */
  public readonly availableVisible: Signal<readonly PluginSummary[]> = computed(
    (): readonly PluginSummary[] =>
      this.visible().filter((plugin: PluginSummary): boolean => !isInstalled(plugin)),
  );

  /**
   * Gets the group that is actually open: the chosen one, unless it has nothing to show and the other
   * does, in which case the other opens in its place rather than leaving every box shut. Null when the
   * user has closed it. The ribbon and the list both read this, so they never disagree.
   */
  public readonly shownGroup: Signal<PluginGroupId | null> = computed((): PluginGroupId | null => {
    const chosen: PluginGroupId | null = this.openGroup();
    if (chosen === null || this.groupHasRows(chosen)) {
      return chosen;
    }
    const other: PluginGroupId = chosen === 'installed' ? 'available' : 'installed';
    return this.groupHasRows(other) ? other : chosen;
  });

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
    (): boolean => this.query().trim().length > 0 || this.category() !== null,
  );

  /**
   * Clears the search text.
   */
  public clearQuery(): void {
    this.query.set('');
  }

  /**
   * Gets whether a group has any plugins to list.
   * @param group The group.
   * @returns Returns true when it has.
   */
  private groupHasRows(group: PluginGroupId): boolean {
    return (group === 'installed' ? this.installedVisible() : this.availableVisible()).length > 0;
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
