import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import { ConnectedPosition } from '@angular/cdk/overlay';
import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { Tab, TabType } from '@shared/angular/services/tabs/tab';
import { TabCloser } from '@shared/angular/services/tab-closer/tab-closer';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { MENU_POSITIONS } from '@shared/angular/components/menu/menu-position';
import { TooltipTrigger } from '@shared/angular/components/tooltip/tooltip-trigger';

/**
 * Pairs a category heading with the open tabs that fall under it, for the grouped tab menu.
 */
interface TabGroup {
  /**
   * Gets the category heading shown above the group.
   */
  readonly label: string;

  /**
   * Gets the open tabs belonging to the category, in their tab-strip order.
   */
  readonly tabs: readonly Tab[];
}

/**
 * Specifies the heading every {@link TabType} is grouped under in the menu, in display order —
 * documents first, then the surfaces a user opens many of, and the singleton tool views last.
 *
 * It is a total map of the tab types on purpose. The menu is how a tab is reached once the strip
 * overflows and starts to scroll, so a type missing from here is a tab the user cannot get back to;
 * a hand-picked subset silently swallowed every tab type added after it was written. Declaring it as
 * a `Record` makes adding a `TabType` without a heading a compile error.
 *
 * Headings may repeat, and one does: the singleton tool views share **Tools**, matching how the
 * welcome screen offers them. A heading per singleton is a heading over a single row, which is how
 * this menu ended up with more headings than tabs.
 */
const TAB_CATEGORY_LABELS: Readonly<Record<TabType, string>> = {
  directory: 'Workspaces',
  code: 'Code Files',
  markdown: 'Markdown Files',
  binary: 'Binary Files',
  'api-explorer': 'API Explorers',
  terminal: 'Terminals',
  agent: 'Agents',
  containers: 'Tools',
  'model-manager': 'Tools',
  'plugin-manager': 'Tools',
  'system-monitor': 'Tools',
  'mission-control': 'Tools',
  settings: 'Tools',
};

/**
 * Lists the headings in display order, without repeats — the order the groups are built in.
 */
const TAB_CATEGORY_ORDER: readonly string[] = [
  ...new Set<string>(Object.values(TAB_CATEGORY_LABELS)),
];

/**
 * The title strip's tab menu: a trigger in the title-strip button group that opens a drop-down
 * listing every open tab, grouped by category (workspaces, repositories, code files, and so on).
 * Selecting an entry activates that tab, which makes tabs reachable even once the strip overflows and
 * begins to scroll. The menu's left edge is aligned with the trigger's left edge.
 *
 * It is a tab list and nothing else. It once doubled as the agent-requests inbox (#253) — a bell
 * trigger, per-tab markers, and inline answer buttons nested under each tab — which crowded the list
 * and buried the tabs it exists to surface. Pending requests are answered in the conversation, and
 * are raised as toasts when that setting is on.
 */
@Component({
  selector: 'app-title-strip-tab-menu',
  imports: [AppIcon, CdkMenuTrigger, CdkMenu, CdkMenuItem, TooltipTrigger],
  templateUrl: './title-strip-tab-menu.html',
  styleUrl: './title-strip-tab-menu.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TitleStripTabMenu {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the tab registry that backs the menu.
   */
  private readonly tabsService: Tabs = inject(Tabs);

  /**
   * Holds the tab closer that resolves unsaved changes before removing a tab.
   */
  private readonly tabCloser: TabCloser = inject(TabCloser);

  /**
   * Gets the identifier of the active tab, or undefined when no tab is open.
   */
  protected readonly activeTabId: Signal<string | undefined> = this.tabsService.activeTabId;

  /**
   * Gets the open tabs grouped by category, omitting categories with no open tabs, so the menu lists
   * only the categories that are actually present.
   */
  protected readonly groups: Signal<readonly TabGroup[]> = computed((): readonly TabGroup[] => {
    const open: readonly Tab[] = this.tabsService.tabs();
    return TAB_CATEGORY_ORDER.map((label: string): TabGroup => ({
      label,
      // Filtered from the open tabs rather than gathered per type, so tabs sharing a heading keep
      // the order they have in the strip.
      tabs: open.filter((tab: Tab): boolean => TAB_CATEGORY_LABELS[tab.type] === label),
    })).filter((group: TabGroup): boolean => group.tabs.length > 0);
  });

  /**
   * Gets the position that opens the menu below the trigger with their left edges aligned.
   */
  protected readonly menuPosition: readonly ConnectedPosition[] = MENU_POSITIONS['down-start'];

  /**
   * Activates the given tab, bringing it into view in the tab strip.
   * @param tab The tab to activate.
   */
  protected onSelect(tab: Tab): void {
    this.tabsService.activate(tab.id);
  }

  /**
   * Closes the given tab. The menu stays open so several tabs can be closed in succession; its
   * grouped list updates as tabs (and emptied categories) fall away.
   * @param tab The tab to close.
   */
  protected onClose(tab: Tab): void {
    void this.tabCloser.close(tab.id);
  }
}
