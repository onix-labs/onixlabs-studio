import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import { ConnectedPosition } from '@angular/cdk/overlay';
import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { Tab, TabType } from '@shared/angular/services/tabs/tab';
import { TabCloser } from '@shared/angular/services/tab-closer/tab-closer';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { MENU_POSITIONS } from '@shared/angular/components/menu/menu-position';

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
 * Specifies the categories the open tabs are grouped under in the menu, in display order. Each entry
 * pairs a {@link TabType} with the plural heading shown above its tabs; categories with no open tabs
 * are omitted from the menu.
 */
const TAB_CATEGORIES: readonly { readonly type: TabType; readonly label: string }[] = [
  { type: 'directory', label: 'Workspaces' },
  { type: 'source-control', label: 'Repositories' },
  { type: 'code', label: 'Code Files' },
  { type: 'markdown', label: 'Markdown Files' },
  { type: 'terminal', label: 'Terminals' },
  { type: 'agent', label: 'Agents' },
  { type: 'settings', label: 'Settings' },
];

/**
 * The title strip's tab menu: a trigger button at the end of the tab strip that opens a drop-down
 * listing every open tab, grouped by category (workspaces, repositories, code files, and so on).
 * Selecting an entry activates that tab, which makes tabs reachable even once the strip overflows and
 * begins to scroll. The menu's right edge is aligned with the trigger's right edge.
 */
@Component({
  selector: 'app-title-strip-tab-menu',
  imports: [AppIcon, CdkMenuTrigger, CdkMenu, CdkMenuItem],
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
    return TAB_CATEGORIES.map(
      (category: { readonly type: TabType; readonly label: string }): TabGroup => ({
        label: category.label,
        tabs: open.filter((tab: Tab): boolean => tab.type === category.type),
      }),
    ).filter((group: TabGroup): boolean => group.tabs.length > 0);
  });

  /**
   * Gets the position that opens the menu below the trigger with their right edges aligned.
   */
  protected readonly menuPosition: readonly ConnectedPosition[] = MENU_POSITIONS['down-end'];

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
