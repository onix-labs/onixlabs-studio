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
  effect,
  ElementRef,
  inject,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import { Settings } from '@shared/angular/services/settings/settings';
import { Tooltip } from './tooltip';

/**
 * How far the bubble stands off the control it names, in CSS pixels. Far enough to read as a separate
 * thing pointing at the control rather than as part of it, and far enough that the bubble's own shadow
 * is not cast onto the control's edge.
 */
const TOOLTIP_GAP: number = 10;

/**
 * Places the bubble centred beneath the control, which is where a tooltip for an icon belongs: the
 * icon is square and unlabelled, so there is no text baseline to align to and no start edge that reads
 * as its beginning. The fallback flips it above for a control near the bottom of the window.
 */
const TOOLTIP_POSITIONS: readonly ConnectedPosition[] = [
  {
    originX: 'center',
    originY: 'bottom',
    overlayX: 'center',
    overlayY: 'top',
    offsetY: TOOLTIP_GAP,
  },
  {
    originX: 'center',
    originY: 'top',
    overlayX: 'center',
    overlayY: 'bottom',
    offsetY: -TOOLTIP_GAP,
  },
];

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
    '(mouseenter)': 'onShow()',
    '(mouseleave)': 'onLeave()',
    '(focus)': 'onShow()',
    '(blur)': 'onLeave()',
    // A control that has been pressed has answered for itself; the bubble would only be in the way of
    // whatever the press opened.
    '(click)': 'onLeave()',
    // Escape is deliberately NOT a host binding here: a document-level Angular listener per trigger
    // instance means every mounted control (hundreds, across ribbons, strips and tables) runs a
    // handler — and schedules change detection — on every Escape pressed anywhere. Only a trigger
    // with an OPEN bubble cares about Escape, so it attaches a native listener while its bubble
    // shows (see onShow) and removes it with the bubble.
  },
})
export class TooltipTrigger {
  /**
   * Gets the name shown in the bubble. An empty value shows nothing.
   */
  public readonly appTooltip: InputSignal<string | undefined> = input<string>();

  /**
   * Gets whether the control is disabled, in which case it is not named.
   *
   * A disabled control cannot be pointed at in the first place — a browser sends it no mouse events —
   * so this is less about suppressing the bubble than about taking one away. A control that disables
   * itself under the pointer (a Stop that finishes running) would otherwise never see the mouse leave
   * it, and would leave its name hanging there over nothing.
   *
   * Stated by the control atoms, which know their own disabled state as a signal. A caller putting the
   * trigger on a plain button can leave it alone: the element's own disabled state is read as well.
   */
  public readonly appTooltipDisabled: InputSignal<boolean> = input<boolean>(false);

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
   * Holds the Escape listener attached to the document while the bubble is open, so pressing Escape
   * dismisses it. Native and bubble-scoped: it exists only while there is a bubble to dismiss.
   */
  private readonly escapeHandler: (event: KeyboardEvent) => void = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      this.onLeave();
    }
  };

  /**
   * Initializes a new instance of the {@link TooltipTrigger} class, tearing down any open bubble with
   * the control. A control can be destroyed while its bubble is open — a toolbar that re-lays out
   * under the pointer, a panel that closes — and the overlay would outlive it.
   */
  public constructor() {
    inject(DestroyRef).onDestroy((): void => this.onLeave());
    // Takes the bubble away from a control that disables itself while wearing it, which no mouseleave
    // is coming to do — the browser stops sending the control mouse events the moment it is disabled.
    effect((): void => {
      if (this.appTooltipDisabled()) {
        this.onLeave();
      }
    });
  }

  /**
   * Gets whether the control the trigger sits on is disabled in the document, for a plain button that
   * states its disabled state as an attribute rather than through {@link appTooltipDisabled}.
   * @returns Returns true when the element is disabled.
   */
  private isElementDisabled(): boolean {
    const element: HTMLElement = this.element.nativeElement;
    return (
      (element as Partial<HTMLButtonElement>).disabled === true ||
      element.getAttribute('aria-disabled') === 'true'
    );
  }

  /**
   * Opens the bubble, on the pointer arriving or on focus reaching the control. Immediately in both
   * cases: the name is what the control was already unable to say for itself, so making the user wait
   * for it is making them wait to find out what they are pointing at.
   */
  protected onShow(): void {
    const text: string = this.appTooltip()?.trim() ?? '';
    if (
      !this.enabled() ||
      this.appTooltipDisabled() ||
      this.isElementDisabled() ||
      text.length === 0 ||
      this.overlayRef !== null
    ) {
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
    this.element.nativeElement.ownerDocument.addEventListener('keydown', this.escapeHandler);
  }

  /**
   * Closes the bubble, and with it the document Escape listener that existed to dismiss it.
   */
  protected onLeave(): void {
    if (this.overlayRef !== null) {
      this.element.nativeElement.ownerDocument.removeEventListener('keydown', this.escapeHandler);
    }
    this.overlayRef?.dispose();
    this.overlayRef = null;
  }
}
