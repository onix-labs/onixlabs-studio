import { CdkDragDrop, CdkDropList } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, ElementRef, inject, Signal } from '@angular/core';
import { Tab } from '../../../../services/tabs/tab';
import { Tabs } from '../../../../services/tabs/tabs';
import { TitleStripTab } from '../title-strip-tab/title-strip-tab';

/**
 * Represents the list of open tabs in the title strip, supporting drag-to-reorder and roving
 * keyboard navigation.
 */
@Component({
  selector: 'app-title-strip-tab-list',
  imports: [TitleStripTab, CdkDropList],
  templateUrl: './title-strip-tab-list.html',
  styleUrl: './title-strip-tab-list.scss',
  host: {
    '(keydown)': 'onKeydown($event)',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TitleStripTabList {
  /**
   * Holds the tab registry that backs the list.
   */
  private readonly tabsService: Tabs = inject(Tabs);

  /**
   * Holds a reference to the host element, used to move keyboard focus between tabs.
   */
  private readonly hostElement: ElementRef<HTMLElement> = inject(
    ElementRef,
  ) as ElementRef<HTMLElement>;

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

  /**
   * Reorders the tabs after a drag-and-drop gesture.
   * @param event The drag-drop event describing the move.
   */
  protected onDrop(event: CdkDragDrop<readonly Tab[]>): void {
    this.tabsService.reorder(event.previousIndex, event.currentIndex);
  }

  /**
   * Handles roving keyboard navigation across the tablist, where the arrow keys, Home, and End
   * move the active tab and selection follows focus.
   * @param event The keyboard event.
   */
  protected onKeydown(event: KeyboardEvent): void {
    const openTabs: readonly Tab[] = this.tabs();
    if (openTabs.length === 0) {
      return;
    }

    const currentIndex: number = openTabs.findIndex(
      (tab: Tab): boolean => tab.id === this.activeTabId(),
    );
    const lastIndex: number = openTabs.length - 1;
    let nextIndex: number;
    switch (event.key) {
      case 'ArrowRight':
        nextIndex = currentIndex >= lastIndex ? 0 : currentIndex + 1;
        break;
      case 'ArrowLeft':
        nextIndex = currentIndex <= 0 ? lastIndex : currentIndex - 1;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = lastIndex;
        break;
      default:
        return;
    }

    event.preventDefault();
    const nextTab: Tab | undefined = openTabs[nextIndex];
    if (nextTab !== undefined) {
      this.tabsService.activate(nextTab.id);
      this.focusTab(nextIndex);
    }
  }

  /**
   * Moves keyboard focus to the tab at the given index.
   * @param index The index of the tab to focus.
   */
  private focusTab(index: number): void {
    const tabElements: NodeListOf<HTMLElement> =
      this.hostElement.nativeElement.querySelectorAll<HTMLElement>('[role="tab"]');
    tabElements.item(index)?.focus();
  }
}
