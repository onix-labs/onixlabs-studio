import { ComponentPortal } from '@angular/cdk/portal';
import {
  ConnectedPosition,
  Overlay,
  OverlayPositionBuilder,
  OverlayRef,
  ScrollStrategyOptions,
} from '@angular/cdk/overlay';
import {
  ComponentRef,
  DestroyRef,
  Directive,
  ElementRef,
  inject,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import { Settings } from '@shared/angular/services/settings/settings';
import { Tooltip } from './tooltip';

/**
 * Places the bubble centred beneath the control, which is where a tooltip for an icon belongs: the
 * icon is square and unlabelled, so there is no text baseline to align to and no start edge that reads
 * as its beginning. The fallback flips it above for a control near the bottom of the window.
 */
const TOOLTIP_POSITIONS: readonly ConnectedPosition[] = [
  { originX: 'center', originY: 'bottom', overlayX: 'center', overlayY: 'top', offsetY: 6 },
  { originX: 'center', originY: 'top', overlayX: 'center', overlayY: 'bottom', offsetY: -6 },
];

/**
 * How long a pointer must rest on a control before its name appears, in milliseconds. Long enough that
 * sweeping the pointer across a strip of icons does not trail bubbles behind it; short enough that
 * pausing on one is answered rather than waited on.
 */
const HOVER_DELAY: number = 400;

/**
 * Shows a control's name in a bubble beneath it, on hover or keyboard focus.
 *
 * Applied by the control atoms to their own element rather than by callers, so that a control which
 * shows only an icon is named wherever it appears, without every call site having to remember. The
 * atoms decide when a control counts as icon-only; this decides how the name is drawn.
 *
 * Nothing is shown when the user has turned tooltips off, and nothing is shown for a control with no
 * name to give — the bubble states the control's accessible name, so a control that has none has
 * nothing to say here either.
 *
 * Keyboard focus opens it too. That is the point of it being an accessibility setting: a control
 * reached by Tab is named the same as one reached by pointer.
 */
@Directive({
  selector: '[appTooltip]',
  host: {
    '(mouseenter)': 'onEnter()',
    '(mouseleave)': 'onLeave()',
    '(focus)': 'onShow()',
    '(blur)': 'onLeave()',
    // A control that has been pressed has answered for itself; the bubble would only be in the way of
    // whatever the press opened.
    '(click)': 'onLeave()',
    '(document:keydown.escape)': 'onLeave()',
  },
})
export class TooltipTrigger {
  /**
   * Gets the name shown in the bubble. An empty value shows nothing.
   */
  public readonly appTooltip: InputSignal<string | undefined> = input<string>();

  /**
   * Holds the element the bubble is placed against.
   */
  private readonly element: ElementRef<HTMLElement> = inject<ElementRef<HTMLElement>>(ElementRef);

  /**
   * Holds the overlay service the bubble is presented through. An overlay rather than an absolutely
   * positioned child, because the controls that need this sit inside ribbons, strips and docked panels
   * that clip their overflow — a bubble drawn in the flow would be cut off by its own toolbar.
   */
  private readonly overlay: Overlay = inject(Overlay);

  /**
   * Holds the overlay position builder.
   */
  private readonly positions: OverlayPositionBuilder = inject(OverlayPositionBuilder);

  /**
   * Holds the overlay scroll strategies.
   */
  private readonly scrollStrategies: ScrollStrategyOptions = inject(ScrollStrategyOptions);

  /**
   * Gets whether the user wants icon-only controls named.
   */
  private readonly enabled: Signal<boolean> = inject(Settings).value('accessibility.showTooltips');

  /**
   * Holds the open bubble's overlay, or null when none is showing.
   */
  private overlayRef: OverlayRef | null = null;

  /**
   * Holds the pending hover timer, or null when no open is pending.
   */
  private timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Initializes a new instance of the {@link TooltipTrigger} class, tearing down any open bubble with
   * the control. A control can be destroyed while its bubble is open — a toolbar that re-lays out
   * under the pointer, a panel that closes — and the overlay would outlive it.
   */
  public constructor() {
    inject(DestroyRef).onDestroy((): void => this.onLeave());
  }

  /**
   * Opens the bubble after the hover delay.
   */
  protected onEnter(): void {
    this.cancel();
    this.timer = setTimeout((): void => this.onShow(), HOVER_DELAY);
  }

  /**
   * Opens the bubble now, for focus, which has already waited by the act of arriving.
   */
  protected onShow(): void {
    this.cancel();
    const text: string = this.appTooltip()?.trim() ?? '';
    if (!this.enabled() || text.length === 0 || this.overlayRef !== null) {
      return;
    }
    this.overlayRef = this.overlay.create({
      positionStrategy: this.positions
        .flexibleConnectedTo(this.element)
        .withPositions([...TOOLTIP_POSITIONS])
        .withPush(true),
      // The bubble is an annotation on a control, not a surface of its own: if the thing it names
      // scrolls away, the annotation goes with it rather than hanging in space.
      scrollStrategy: this.scrollStrategies.close(),
      disposeOnNavigation: true,
      panelClass: 'tooltip-overlay',
    });
    const bubble: ComponentRef<Tooltip> = this.overlayRef.attach(new ComponentPortal(Tooltip));
    bubble.setInput('text', text);
  }

  /**
   * Closes the bubble and drops any pending open.
   */
  protected onLeave(): void {
    this.cancel();
    this.overlayRef?.dispose();
    this.overlayRef = null;
  }

  /**
   * Drops a pending open without touching an bubble already showing.
   */
  private cancel(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
