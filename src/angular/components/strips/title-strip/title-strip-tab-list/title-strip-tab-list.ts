import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import { Tab } from '../../../../services/tabs/tab';
import { Tabs } from '../../../../services/tabs/tabs';
import { TitleStripTab } from '../title-strip-tab/title-strip-tab';

/**
 * Represents the list of open tabs in the title strip.
 */
@Component({
  selector: 'app-title-strip-tab-list',
  imports: [TitleStripTab],
  templateUrl: './title-strip-tab-list.html',
  styleUrl: './title-strip-tab-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TitleStripTabList {
  /**
   * Holds the tab registry that backs the list.
   */
  private readonly tabsService: Tabs = inject(Tabs);

  /**
   * Gets the ordered list of open tabs.
   */
  protected readonly tabs: Signal<readonly Tab[]> = this.tabsService.tabs;

  /**
   * Gets the identifier of the active tab, or undefined when no tab is open.
   */
  protected readonly activeTabId: Signal<string | undefined> = this.tabsService.activeTabId;

  /**
   * Activates the given tab.
   * @param tab The tab to activate.
   */
  protected onSelect(tab: Tab): void {
    this.tabsService.activate(tab.id);
  }

  /**
   * Closes the given tab.
   * @param tab The tab to close.
   */
  protected onClose(tab: Tab): void {
    this.tabsService.close(tab.id);
  }
}
