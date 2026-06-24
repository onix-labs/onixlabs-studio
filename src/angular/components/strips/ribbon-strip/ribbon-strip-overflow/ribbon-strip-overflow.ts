import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  HostListener,
  inject,
  signal,
  Signal,
  viewChild,
  WritableSignal,
} from '@angular/core';
import { RibbonAlignment, Settings } from '../../../../services/settings/settings';
import { Icon } from '../../../../icons/icon';
import { AppIcon } from '../../../shared/icon/app-icon';

/**
 * Pixel tolerance applied when comparing the row's content width to its visible width, so sub-pixel
 * rounding does not register as overflow.
 */
const OVERFLOW_TOLERANCE: number = 1;

/**
 * Wraps a ribbon's groups in a width-aware row: groups that do not fit the available width are moved,
 * whole, into a "More" flyout menu rather than clipping off the edge of the strip. The visible row
 * fills the strip and honours the configured ribbon alignment; a trailing trigger button reveals the
 * overflowed groups in a dropdown.
 *
 * Groups are projected through {@link https://angular.dev/guide/components/content-projection content
 * projection} and physically relocated between the row and the flyout as the width changes. Because
 * each per-tab ribbon owns its own instance, the relocated nodes never leave the ribbon's view; they
 * are restored to the row on destroy so Angular's teardown sees them where it created them.
 */
@Component({
  selector: 'app-ribbon-overflow',
  imports: [AppIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ribbon-strip-overflow.html',
  styleUrl: './ribbon-strip-overflow.scss',
})
export class RibbonStripOverflow {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the settings service supplying the ribbon alignment.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds this component's host element, observed for width changes.
   */
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef) as ElementRef<HTMLElement>;

  /**
   * Holds the destroy notifier used to disconnect the resize observer and restore the groups.
   */
  private readonly destroyRef: DestroyRef = inject(DestroyRef);

  /**
   * Holds the visible row the groups are laid out in.
   */
  private readonly row: Signal<ElementRef<HTMLDivElement>> =
    viewChild.required<ElementRef<HTMLDivElement>>('row');

  /**
   * Holds the trigger button that opens the overflow flyout.
   */
  private readonly more: Signal<ElementRef<HTMLButtonElement>> =
    viewChild.required<ElementRef<HTMLButtonElement>>('more');

  /**
   * Holds the flyout the overflowed groups are moved into.
   */
  private readonly flyout: Signal<ElementRef<HTMLDivElement>> =
    viewChild.required<ElementRef<HTMLDivElement>>('flyout');

  /**
   * Holds whether the overflow flyout is open.
   */
  protected readonly flyoutOpen: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the number of groups currently overflowed into the flyout.
   */
  protected readonly overflowCount: WritableSignal<number> = signal<number>(0);

  /**
   * Gets the configured ribbon alignment.
   */
  protected readonly alignment: Signal<RibbonAlignment> = this.settings.ribbonAlignment;

  /**
   * Gets whether any groups are currently overflowed.
   */
  protected readonly hasOverflow: Signal<boolean> = computed((): boolean => this.overflowCount() > 0);

  /**
   * Holds the pending reflow animation-frame handle, or null when none is scheduled.
   */
  private reflowHandle: number | null = null;

  /**
   * Initialises the component, observing the host width and reflowing the groups as it changes.
   */
  public constructor() {
    afterNextRender((): void => {
      const observer: ResizeObserver = new ResizeObserver((): void => this.scheduleReflow());
      observer.observe(this.host.nativeElement);
      this.destroyRef.onDestroy((): void => {
        observer.disconnect();
        if (this.reflowHandle !== null) {
          cancelAnimationFrame(this.reflowHandle);
        }
        this.restoreGroups();
      });
      this.reflow();
    });
  }

  /**
   * Toggles the overflow flyout.
   * @param event The originating click event.
   */
  protected toggle(event: MouseEvent): void {
    event.stopPropagation();
    this.flyoutOpen.update((open: boolean): boolean => !open);
  }

  /**
   * Closes the flyout when a pointer press lands outside this component.
   * @param event The pointer event.
   */
  @HostListener('document:pointerdown', ['$event'])
  protected onDocumentPointerDown(event: Event): void {
    if (this.flyoutOpen() && !this.host.nativeElement.contains(event.target as Node)) {
      this.flyoutOpen.set(false);
    }
  }

  /**
   * Closes the flyout on Escape.
   */
  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.flyoutOpen.set(false);
  }

  /**
   * Schedules a reflow on the next animation frame, coalescing bursts of resize notifications.
   */
  private scheduleReflow(): void {
    if (this.reflowHandle !== null) {
      return;
    }
    this.reflowHandle = requestAnimationFrame((): void => {
      this.reflowHandle = null;
      this.reflow();
    });
  }

  /**
   * Recomputes which groups fit the available width: pulls groups back from the flyout while they fit,
   * then pushes the trailing groups out while the row overflows. The trigger button's width is
   * reserved during measurement so the result is stable.
   */
  private reflow(): void {
    const row: HTMLDivElement = this.row().nativeElement;
    const more: HTMLButtonElement = this.more().nativeElement;
    const flyout: HTMLDivElement = this.flyout().nativeElement;

    // Reserve the trigger's width during measurement (hidden but laid out), so the fit calculation
    // accounts for it whether or not it ends up visible.
    more.style.visibility = 'hidden';
    more.style.display = '';

    // Expansion: bring groups back into the row, in document order, while they still fit.
    while (flyout.firstElementChild !== null) {
      row.appendChild(flyout.firstElementChild);
      if (this.isOverflowing(row)) {
        flyout.insertBefore(row.lastElementChild!, flyout.firstElementChild);
        break;
      }
    }

    // Contraction: move the trailing groups into the flyout while the row overflows, always keeping
    // at least one group visible.
    while (this.isOverflowing(row) && row.children.length > 1) {
      flyout.insertBefore(row.lastElementChild!, flyout.firstElementChild);
    }

    const count: number = flyout.children.length;
    more.style.visibility = '';
    more.style.display = count > 0 ? '' : 'none';
    this.overflowCount.set(count);
    if (count === 0) {
      this.flyoutOpen.set(false);
    }
  }

  /**
   * Determines whether the row's content is wider than its visible area.
   * @param row The row element.
   * @returns Returns true when the row overflows.
   */
  private isOverflowing(row: HTMLDivElement): boolean {
    return row.scrollWidth > row.clientWidth + OVERFLOW_TOLERANCE;
  }

  /**
   * Moves every overflowed group back into the row, restoring the original DOM order so Angular's view
   * teardown removes the projected groups from where it created them.
   */
  private restoreGroups(): void {
    const row: HTMLDivElement = this.row().nativeElement;
    const flyout: HTMLDivElement = this.flyout().nativeElement;
    while (flyout.firstElementChild !== null) {
      row.appendChild(flyout.firstElementChild);
    }
  }
}
