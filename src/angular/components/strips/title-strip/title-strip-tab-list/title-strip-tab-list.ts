import { CdkDragDrop, CdkDropList } from '@angular/cdk/drag-drop';
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
import { Documents } from '../../../../services/documents/documents';
import { Tab } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
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
   * Holds the documents registry, used to prompt for unsaved changes when closing a tab.
   */
  private readonly documents: Documents = inject(Documents);

  /**
   * Holds a reference to the host element, used to move keyboard focus between tabs.
   */
  private readonly hostElement: ElementRef<HTMLElement> = inject(
    ElementRef,
  ) as ElementRef<HTMLElement>;

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
    void this.documents.closeTab(tab.id);
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
   * Determines whether a dragged tab may settle at the given index, keeping the pinned settings
   * tab at the front by forbidding any other tab from displacing index 0 during a drag.
   * @param index The candidate index the dragged tab would occupy.
   * @returns Returns true when the index may receive the tab; otherwise, false.
   */
  protected readonly sortPredicate: (index: number) => boolean = (index: number): boolean =>
    index > 0 || this.tabs()[0]?.type !== 'settings';

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
