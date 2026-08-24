import {
  CdkDrag,
  CdkDragPreview,
  CdkDragStart,
  DragConstrainPosition,
} from '@angular/cdk/drag-drop';
import {
  AfterRenderRef,
  afterRenderEffect,
  ApplicationRef,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  Signal,
} from '@angular/core';
import { Tab } from '@shared/angular/services/tabs/tab';
import { isPinnedTabType } from '@shared/angular/services/tabs/tabs';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { TooltipTrigger } from '@shared/angular/components/tooltip/tooltip-trigger';

/**
 * Represents a single tab in the title strip.
 */
@Component({
  selector: 'app-title-strip-tab',
  imports: [CdkDrag, CdkDragPreview, AppIcon, TooltipTrigger],
  templateUrl: './title-strip-tab.html',
  styleUrl: './title-strip-tab.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TitleStripTab {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the application reference, used to flush change detection synchronously on activation.
   */
  private readonly applicationRef: ApplicationRef = inject(ApplicationRef);

  /**
   * Holds a reference to the host element, used to measure the tab list while dragging.
   */
  private readonly hostElement: ElementRef<HTMLElement> = inject(
    ElementRef,
  ) as ElementRef<HTMLElement>;

  /**
   * Holds the left edge of the tab list in page coordinates, captured at drag start, beyond which
   * the drag preview may not slide.
   */
  private tabListLeft: number = Number.NEGATIVE_INFINITY;

  /**
   * Holds the right edge of the tab list in page coordinates, captured at drag start, beyond which
   * the drag preview may not slide.
   */
  private tabListRight: number = Number.POSITIVE_INFINITY;

  /**
   * Holds the top edge, in page coordinates, that the drag preview is pinned to while dragging. It
   * is taken from the placeholder so it reflects the settled active-tab position on the rail, rather
   * than the drag's captured geometry which can predate the tab becoming active.
   */
  private dragTop: number | undefined = undefined;

  /**
   * Gets the tab to render.
   */
  public readonly tab: InputSignal<Tab> = input.required<Tab>();

  /**
   * Gets a value indicating whether the tab is the active tab.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Gets a value indicating whether the tab is pinned, and therefore cannot be dragged. The Settings
   * and Mission Control tabs are pinned to the front of the strip.
   */
  protected readonly isPinned: Signal<boolean> = computed((): boolean =>
    isPinnedTabType(this.tab().type),
  );

  /**
   * Keeps the active tab within the scrolled tab strip's viewport: whenever this tab becomes active
   * — whether by a click, the keyboard, or a pick from the overflow menu — it is scrolled into view,
   * so a tab selected while off-screen is brought back into sight. `block: 'nearest'` leaves the
   * vertical position untouched, scrolling only along the strip.
   */
  private readonly scrollActiveIntoView: AfterRenderRef = afterRenderEffect((): void => {
    if (this.isActive()) {
      this.hostElement.nativeElement
        .querySelector<HTMLElement>('[role="tab"]')
        ?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    }
  });

  /**
   * Emits when the user selects the tab.
   */
  public readonly selectTab: OutputEmitterRef<void> = output<void>();

  /**
   * Emits when the user requests to close the tab.
   */
  public readonly closeTab: OutputEmitterRef<void> = output<void>();

  /**
   * Pins the drag preview to the tab rail so it slides horizontally without translating vertically.
   *
   * A custom `cdkDragPreview` makes the CDK anchor the preview's top-left to the cursor, which would
   * otherwise leave the chip floating over the rail by however far down the tab was grabbed. The
   * horizontal position tracks the pointer but is clamped to the tab list so the chip cannot be
   * dragged past either end, while the vertical position is locked to the tab's original top edge so
   * its bottom keeps meeting the rail.
   * @param point The current pointer position.
   * @param _dragRef The drag reference (unused).
   * @param dimensions The originating tab's bounding rectangle, captured at drag start.
   * @returns The constrained top-left position for the drag preview.
   */
  protected readonly anchorDragToRail: DragConstrainPosition = (point, _dragRef, dimensions) => {
    const maxLeft: number = this.tabListRight - dimensions.width;
    const x: number = Math.min(Math.max(point.x, this.tabListLeft), maxLeft);
    return { x, y: this.dragTop ?? dimensions.top };
  };

  /**
   * Activates the tab on pointer press, then flushes change detection so the now-active tab's layout
   * (which nudges it onto the rail) is applied before the CDK captures the drag's starting geometry.
   * Without the synchronous flush, dragging straight from the press would pin the chip a pixel high
   * and leave the rail showing beneath it.
   */
  protected onPress(): void {
    this.selectTab.emit();
    this.applicationRef.tick();
  }

  /**
   * Captures the geometry the preview needs when a drag begins: the tab list's horizontal bounds, so
   * the preview can be clamped to them, and the placeholder's top, so the preview can be pinned to
   * the settled active-tab position on the rail. The host element is rendered with `display:
   * contents`, so its parent is the tab list.
   * @param event The drag-start event, whose source exposes the placeholder.
   */
  protected onDragStarted(event: CdkDragStart): void {
    const tabList: HTMLElement | null = this.hostElement.nativeElement.parentElement;
    if (tabList !== null) {
      const bounds: DOMRect = tabList.getBoundingClientRect();
      this.tabListLeft = bounds.left;
      this.tabListRight = bounds.right;
    }
    this.dragTop = event.source.getPlaceholderElement().getBoundingClientRect().top;
  }

  /**
   * Handles a click on the close button, suppressing the tab-selection click.
   * @param event The originating pointer event.
   */
  protected onCloseClick(event: MouseEvent): void {
    event.stopPropagation();
    this.closeTab.emit();
  }
}
