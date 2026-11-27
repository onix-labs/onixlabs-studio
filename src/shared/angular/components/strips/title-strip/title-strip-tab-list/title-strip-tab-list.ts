import { CdkDragDrop, CdkDropList } from '@angular/cdk/drag-drop';
import { CdkContextMenuTrigger } from '@angular/cdk/menu';
import {
  afterNextRender,
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  signal,
  Signal,
  viewChild,
  WritableSignal,
} from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { Menu, MenuChoice, MenuItem } from '@shared/angular/components/menu/menu';
import { MenuSubject } from '@shared/angular/components/menu/menu-subject';
import { Keybindings } from '@shared/angular/services/keybindings/keybindings';
import { Tab } from '@shared/angular/services/tabs/tab';
import { TabWindows } from '@shared/angular/services/tab-windows/tab-windows';
import { TabCloser } from '@shared/angular/services/tab-closer/tab-closer';
import { isPinnedTabType, Tabs } from '@shared/angular/services/tabs/tabs';
import { TitleStripTab } from '../title-strip-tab/title-strip-tab';

/**
 * Identifies the commands of a tab's context menu.
 */
const MOVE_TO_START: string = 'tab.move-to-start';
const MOVE_TO_END: string = 'tab.move-to-end';
const CLOSE: string = 'tab.close';

/**
 * TRIAL (#1593): moves the tab into a window of its own.
 */
const NEW_WINDOW: string = 'tab.new-window';

/**
 * Represents the list of open tabs in the title strip, supporting drag-to-reorder and roving
 * keyboard navigation.
 */
@Component({
  selector: 'app-title-strip-tab-list',
  imports: [TitleStripTab, CdkDropList, CdkContextMenuTrigger, Menu, MenuSubject],
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
   * Holds the tab closer that resolves unsaved changes before removing a tab.
   */
  private readonly tabCloser: TabCloser = inject(TabCloser);

  /**
   * TRIAL (#1593): holds the tab windows.
   */
  private readonly tabWindows: TabWindows = inject(TabWindows);

  /**
   * Holds a reference to the host element, used to move keyboard focus between tabs.
   */
  private readonly hostElement: ElementRef<HTMLElement> = inject(
    ElementRef,
  ) as ElementRef<HTMLElement>;

  /**
   * Holds the keybindings, which say what chord closes the active tab.
   */
  private readonly keybindings: Keybindings = inject(Keybindings);

  /**
   * Holds the lifecycle scope used to tear the resize observer down.
   */
  private readonly destroyRef: DestroyRef = inject(DestroyRef);

  /**
   * Holds the scrolling tab-list element, measured to detect horizontal overflow.
   */
  private readonly tabListElement: Signal<ElementRef<HTMLElement>> =
    viewChild.required<ElementRef<HTMLElement>>('tabList');

  /**
   * Gets whether the tab list overflows its width and is therefore scrolling. It drives the
   * drag-region opt-out: an overflowing strip is no-drag across its whole surface so the wheel
   * scrolls it from anywhere, whereas a strip with room to spare stays draggable in its empty space so
   * the window can still be moved by it (the tabs themselves remain individually no-drag either way).
   */
  protected readonly overflowing: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets the ordered list of open tabs.
   */
  protected readonly tabs: Signal<readonly Tab[]> = this.tabsService.tabs;

  /**
   * Gets the identifier of the active tab, or undefined when no tab is open.
   */
  protected readonly activeTabId: Signal<string | undefined> = this.tabsService.activeTabId;

  /**
   * Wires up overflow measurement: after every render that changes the open tabs (which can change
   * the content width), and whenever the strip itself is resized.
   */
  public constructor() {
    afterRenderEffect((): void => {
      this.tabs();
      this.measureOverflow();
    });
    afterNextRender((): void => {
      const element: HTMLElement = this.tabListElement().nativeElement;
      if (typeof ResizeObserver === 'undefined') {
        return;
      }
      const observer: ResizeObserver = new ResizeObserver((): void => this.measureOverflow());
      observer.observe(element);
      this.destroyRef.onDestroy((): void => observer.disconnect());
    });
  }

  /**
   * Recomputes whether the tab list overflows its visible width. A one-pixel tolerance absorbs
   * sub-pixel rounding so a strip that exactly fits is not treated as overflowing.
   */
  private measureOverflow(): void {
    const element: HTMLElement = this.tabListElement().nativeElement;
    this.overflowing.set(element.scrollWidth > element.clientWidth + 1);
  }

  /**
   * Activates the given tab.
   * @param tab The tab to activate.
   */
  protected onSelect(tab: Tab): void {
    this.tabsService.activate(tab.id);
  }

  /**
   * Closes the given tab, prompting to save when it has unsaved changes.
   * @param tab The tab to close.
   */
  protected onClose(tab: Tab): void {
    void this.tabCloser.close(tab.id);
  }

  /**
   * Builds a tab's context menu: move it to either end of the strip, or close it (#1592). A fixed
   * tab (Settings, Mission Control) holds its place, so it offers Close alone; a move that would
   * change nothing is shown but disabled. Bound as a value, because the menu calls it as its item
   * factory with the tab's id.
   */
  protected readonly tabItemsFor: (data: unknown) => readonly MenuItem[] = (
    data: unknown,
  ): readonly MenuItem[] => {
    const tabs: readonly Tab[] = this.tabs();
    const index: number = tabs.findIndex((tab: Tab): boolean => tab.id === data);
    if (index < 0) {
      return [];
    }
    // The chord closes the active tab, so it is named only on the menu of the tab it would close.
    const closeChord: string | null =
      tabs[index].id === this.activeTabId() ? this.keybindings.chordFor('app.closeTab') : null;
    const close: MenuItem = {
      id: CLOSE,
      label: 'Close Tab',
      icon: Icon.CLOSE,
      ...(closeChord === null || closeChord === '' ? {} : { chord: closeChord }),
    };
    this.menuTabId = tabs[index].id;
    if (isPinnedTabType(tabs[index].type)) {
      return [close];
    }
    const firstMovable: number = tabs.findIndex((tab: Tab): boolean => !isPinnedTabType(tab.type));
    return [
      { id: NEW_WINDOW, label: 'Open Tab in New Window (trial)', icon: Icon.CODE },
      { id: 'tab.sep-window', label: '', separator: true },
      {
        id: MOVE_TO_START,
        label: 'Move Tab to Beginning',
        icon: Icon.MOVE_TO_START,
        disabled: index === firstMovable,
      },
      {
        id: MOVE_TO_END,
        label: 'Move Tab to End',
        icon: Icon.MOVE_TO_END,
        disabled: index === tabs.length - 1,
      },
      { id: 'tab.sep-close', label: '', separator: true },
      close,
    ];
  };

  /**
   * Holds the id of the tab whose menu was last opened, so the keyboard can return to it.
   */
  private menuTabId: string | null = null;

  /**
   * Returns the keyboard to the tab whose menu just closed: the menu is opened on the tab's host,
   * which cannot take focus, so nothing else would, and it would fall to the page.
   */
  protected onTabMenuClosed(): void {
    const id: string | null = this.menuTabId;
    this.menuTabId = null;
    const index: number = this.tabs().findIndex((tab: Tab): boolean => tab.id === id);
    if (index < 0) {
      return;
    }
    const tabElements: NodeListOf<HTMLElement> =
      this.hostElement.nativeElement.querySelectorAll<HTMLElement>(
        'app-title-strip-tab > [role="tab"]',
      );
    tabElements.item(index)?.focus();
  }

  /**
   * Runs a command chosen from a tab's context menu.
   * @param choice The chosen command, with the id of the tab it was opened on.
   */
  protected onTabMenu(choice: MenuChoice): void {
    const tabs: readonly Tab[] = this.tabs();
    const index: number = tabs.findIndex((tab: Tab): boolean => tab.id === choice.data);
    if (index < 0) {
      return;
    }
    switch (choice.id) {
      case MOVE_TO_START:
        // Clamped past the fixed tabs, which keep the front of the strip.
        this.tabsService.reorder(index, 0);
        return;
      case MOVE_TO_END:
        this.tabsService.reorder(index, tabs.length - 1);
        return;
      case CLOSE:
        this.onClose(tabs[index]);
        return;
      case NEW_WINDOW:
        this.tabWindows.openInNewWindow(tabs[index].id);
        return;
      default:
        return;
    }
  }

  /**
   * Reorders the tabs after a drag-and-drop gesture.
   * @param event The drag-drop event describing the move.
   */
  protected onDrop(event: CdkDragDrop<readonly Tab[]>): void {
    this.tabsService.reorder(event.previousIndex, event.currentIndex);
  }

  /**
   * Scrolls the overflowing tab strip horizontally in response to the wheel. The strip hides its
   * scrollbar, so a plain mouse wheel (which reports vertical delta) would otherwise leave the
   * off-screen tabs unreachable; the larger of the two axes is mapped onto the horizontal scroll
   * position, leaving a trackpad's native horizontal scroll working as before. It is a no-op when the
   * strip is not overflowing, so vertical wheel events pass through unhindered.
   * @param event The wheel event.
   */
  protected onWheel(event: WheelEvent): void {
    const strip: HTMLElement = event.currentTarget as HTMLElement;
    if (strip.scrollWidth <= strip.clientWidth) {
      return;
    }
    const delta: number =
      Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    if (delta === 0) {
      return;
    }
    strip.scrollLeft += delta;
    event.preventDefault();
  }

  /**
   * Determines whether a dragged tab may settle at the given index, keeping the pinned front prefix
   * (Settings, then Mission Control) immovable by forbidding any other tab from displacing a pinned
   * slot during a drag. The prefix is however many pinned tabs currently lead the strip, so an
   * ordinary tab can never be dropped ahead of one.
   * @param index The candidate index the dragged tab would occupy.
   * @returns Returns true when the index may receive the tab; otherwise, false.
   */
  protected readonly sortPredicate: (index: number) => boolean = (index: number): boolean =>
    index >= this.pinnedPrefixCount();

  /**
   * Counts the pinned tabs that currently lead the strip, forming the immovable front prefix.
   * @returns Returns the number of leading pinned tabs.
   */
  private pinnedPrefixCount(): number {
    const openTabs: readonly Tab[] = this.tabs();
    let count: number = 0;
    while (count < openTabs.length && isPinnedTabType(openTabs[count].type)) {
      count++;
    }
    return count;
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
