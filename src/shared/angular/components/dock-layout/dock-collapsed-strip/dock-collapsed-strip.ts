import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  InputSignal,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { DockAutoHide, PeekSize } from '../../../services/dock-layout/dock-auto-hide';
import { DockFloating } from '../../../services/dock-layout/dock-floating';
import { Rect } from '../../../services/dock-layout/dock-legality';
import { DockSide, StackNode } from '../../../services/dock-layout/dock-node';
import { DockPanel } from '../../../services/dock-layout/dock-panel';
import { DockPanelAvailability } from '../../../services/dock-layout/dock-panel-availability';
import {
  CoalescedPointerMoves,
  coalescePointerMoves,
} from '../../../services/dock-layout/pointer-coalesce';
import { DockPanelRegistry } from '../../../services/dock-layout/dock-panel-registry';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Button } from '@shared/angular/components/forms/button/button';
import { DockPanelOutlet } from '../dock-panel-outlet/dock-panel-outlet';

/**
 * The rectangle a peeked panel floats into, since a collapsed strip has no docked rectangle to
 * inherit.
 */
const FALLBACK_FLOAT_RECT: Rect = { left: 120, top: 120, width: 360, height: 240 };

/**
 * The flyout's resizable extent, in pixels, when no docked size was captured: a width for vertical
 * strips, a height for horizontal ones.
 */
const DEFAULT_FLYOUT_WIDTH: number = 300;
const DEFAULT_FLYOUT_HEIGHT: number = 230;

/**
 * The smallest extent, in pixels, the flyout may be resized to along its resizable axis.
 */
const MINIMUM_FLYOUT_SIZE: number = 180;

/**
 * The gap, in pixels, kept between the flyout and the far edge of the surface that clips it, matching
 * the gap the stylesheet leaves between the flyout and its strip.
 */
const FLYOUT_EDGE_GAP: number = 6;

/**
 * Renders a collapsed tool stack as a thin strip in the slot the stack occupies, listing one tab
 * per panel. Clicking a tab flies the stack out as a peek that opens inward over the layout, where
 * its panels can be activated, closed, or the stack docked (expanded) again. The strip is oriented
 * by the edge of its slot it hugs: left/right slots render a vertical strip, top/bottom a horizontal
 * one, and the peek opens away from that edge.
 */
@Component({
  selector: 'app-dock-collapsed-strip',
  imports: [AppIcon, DockPanelOutlet, Button],
  templateUrl: './dock-collapsed-strip.html',
  styleUrl: './dock-collapsed-strip.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.dock-collapsed-strip--left]': "side() === 'left'",
    '[class.dock-collapsed-strip--right]': "side() === 'right'",
    '[class.dock-collapsed-strip--top]': "side() === 'top'",
    '[class.dock-collapsed-strip--bottom]': "side() === 'bottom'",
    '[class.dock-collapsed-strip--vertical]': 'isVertical()',
    '[class.dock-collapsed-strip--horizontal]': '!isVertical()',
    '[class.dock-collapsed-strip--peeking]': 'isPeeking()',
    '(document:mousedown)': 'onDocumentMouseDown($event)',
  },
})
export class DockCollapsedStrip {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the registry panel ids are resolved through.
   */
  private readonly registry: DockPanelRegistry = inject(DockPanelRegistry);

  /**
   * Holds the availability of the panels this view can show, so the strip lists only the panels whose
   * backing is there.
   */
  private readonly availability: DockPanelAvailability = inject(DockPanelAvailability);

  /**
   * Holds the auto-hide store driving the peek.
   */
  private readonly autoHide: DockAutoHide = inject(DockAutoHide);

  /**
   * Holds the floating layer the float button detaches the active panel into.
   */
  private readonly floating: DockFloating = inject(DockFloating);

  /**
   * Holds the document the resize drag is tracked on beyond the handle's bounds.
   */
  private readonly document: Document = inject(DOCUMENT);

  /**
   * Holds this strip's element, used to dismiss the peek on a press outside it.
   */
  private readonly hostElement: ElementRef<HTMLElement> = inject(
    ElementRef,
  ) as ElementRef<HTMLElement>;

  /**
   * Holds the user-resized flyout extent in pixels, or null to use the captured docked size.
   */
  private readonly resized: WritableSignal<number | null> = signal<number | null>(null);

  /**
   * Holds the room the flyout has to open into, in pixels along its resizable axis, measured when the
   * peek opens; null when it could not be measured (no layout, as under a bare unit test).
   */
  private readonly room: WritableSignal<number | null> = signal<number | null>(null);

  /**
   * Gets the collapsed stack this strip renders.
   */
  public readonly stack: InputSignal<StackNode> = input.required<StackNode>();

  /**
   * Gets the edge of its slot the strip hugs, which sets its orientation and peek direction.
   */
  public readonly side: InputSignal<DockSide> = input.required<DockSide>();

  /**
   * Gets whether the strip is vertical (a left- or right-hugging slot).
   */
  protected readonly isVertical: Signal<boolean> = computed(
    (): boolean => this.side() === 'left' || this.side() === 'right',
  );

  /**
   * Gets the dock (re-dock) button's icon, matching the docked panel's collapse button for its edge.
   */
  protected readonly collapseIcon: Signal<Icon> = computed((): Icon =>
    this.side() === 'top' || this.side() === 'bottom'
      ? Icon.COLLAPSE_VERTICAL
      : Icon.COLLAPSE_HORIZONTAL,
  );

  /**
   * Gets the dock button's rotation in degrees: the left and top edges flip the icon 180°.
   */
  protected readonly collapseRotation: Signal<number> = computed((): number =>
    this.side() === 'left' || this.side() === 'top' ? 180 : 0,
  );

  /**
   * Gets the resolved panels held by the stack, in tab order, passing over the ones whose backing is
   * not there — a collapsed strip lists what the stack can show, exactly as its docked form does.
   */
  protected readonly panels: Signal<readonly DockPanel[]> = computed((): readonly DockPanel[] =>
    this.stack()
      .panels.filter((id: string): boolean => this.availability.isAvailable(id))
      .map((id: string): DockPanel | undefined => this.registry.get(id))
      .filter((panel: DockPanel | undefined): panel is DockPanel => panel !== undefined),
  );

  /**
   * Gets the active panel id of the stack, as the strip shows it: the stack's own while it names a
   * panel the strip lists, else the first it does.
   */
  protected readonly activeId: Signal<string | null> = computed(
    (): string | null => this.activePanel()?.id ?? null,
  );

  /**
   * Gets the resolved active panel, or undefined when the strip lists none. As in a docked stack, an
   * active id naming an unregistered or unavailable panel falls to the first listed one.
   */
  protected readonly activePanel: Signal<DockPanel | undefined> = computed(
    (): DockPanel | undefined => {
      const active: string | null = this.stack().active;
      const showing: readonly DockPanel[] = this.panels();
      const chosen: DockPanel | undefined =
        active === null
          ? undefined
          : showing.find((panel: DockPanel): boolean => panel.id === active);
      return chosen ?? showing[0];
    },
  );

  /**
   * Gets whether this stack is the one currently flown out as a peek.
   */
  protected readonly isPeeking: Signal<boolean> = computed(
    (): boolean => this.autoHide.flyoutStackId() === this.stack().id,
  );

  /**
   * Gets the flyout's preferred resizable extent in pixels: the live resized value when present,
   * otherwise the captured docked size for the resizable axis, falling back to a default.
   */
  private readonly preferredSize: Signal<number> = computed((): number => {
    const resized: number | null = this.resized();
    if (resized !== null) {
      return resized;
    }
    const docked: PeekSize | null = this.autoHide.peekSize(this.stack().id);
    if (docked !== null) {
      return this.isVertical() ? docked.width : docked.height;
    }
    return this.isVertical() ? DEFAULT_FLYOUT_WIDTH : DEFAULT_FLYOUT_HEIGHT;
  });

  /**
   * Gets the flyout's resizable extent in pixels, capped at the room it actually has to open into.
   * A strip restored at its docked size can easily be wider or taller than the space left beside it
   * — and since the flyout is clipped by the surface it opens over, an uncapped one is not merely
   * cramped but invisible. A shrunken panel the user can read beats a hidden one.
   */
  protected readonly flyoutSize: Signal<number> = computed((): number => {
    const room: number | null = this.room();
    return room === null ? this.preferredSize() : Math.min(this.preferredSize(), room);
  });

  /**
   * Flies the stack out (or toggles the peek closed) on the chosen panel, measuring the room it has
   * first so it opens no larger than the space it can be seen in.
   * @param panelId The identifier of the panel to peek.
   */
  protected peek(panelId: string): void {
    this.room.set(this.measureRoom());
    this.autoHide.showFlyout(this.stack().id, panelId);
  }

  /**
   * Measures how far the flyout may extend from the strip before it runs into the edge of the surface
   * that clips it — the nearest scroll-or-clip ancestor, which is the dock pane the peek overlays.
   * @returns Returns the available extent in pixels, or null when there is nothing to measure.
   */
  private measureRoom(): number | null {
    const host: HTMLElement = this.hostElement.nativeElement;
    const clip: HTMLElement | null = this.clippingAncestor(host);
    if (clip === null || typeof host.getBoundingClientRect !== 'function') {
      return null;
    }
    const strip: DOMRect = host.getBoundingClientRect();
    const bounds: DOMRect = clip.getBoundingClientRect();
    // The flyout opens away from the edge the strip hugs, so the room is whatever lies on the other
    // side of the strip, less the gap the stylesheet leaves at each end.
    const room: number =
      this.side() === 'left'
        ? bounds.right - strip.right
        : this.side() === 'right'
          ? strip.left - bounds.left
          : this.side() === 'top'
            ? bounds.bottom - strip.bottom
            : strip.top - bounds.top;
    return Math.max(0, room - FLYOUT_EDGE_GAP * 2);
  }

  /**
   * Walks up from the strip to the nearest ancestor that clips its overflow, which is the surface the
   * peek is confined to.
   * @param from The element to walk up from.
   * @returns Returns the clipping ancestor, or null when none clips (or styles cannot be read).
   */
  private clippingAncestor(from: HTMLElement): HTMLElement | null {
    const view: Window | null = this.document.defaultView;
    if (view === null || typeof view.getComputedStyle !== 'function') {
      return null;
    }
    for (
      let element: HTMLElement | null = from.parentElement;
      element !== null;
      element = element.parentElement
    ) {
      const style: CSSStyleDeclaration = view.getComputedStyle(element);
      if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
        return element;
      }
    }
    return null;
  }

  /**
   * Docks (expands) the stack back into its slot.
   */
  protected dock(): void {
    this.autoHide.unpin(this.stack().id);
  }

  /**
   * Floats the active panel out of the collapsed stack into a window.
   * @param panelId The identifier of the panel to float.
   */
  protected float(panelId: string): void {
    this.autoHide.hideFlyout();
    this.floating.float(panelId, FALLBACK_FLOAT_RECT);
  }

  /**
   * Closes a panel within the stack.
   * @param panelId The identifier of the panel to close.
   */
  protected close(panelId: string): void {
    this.autoHide.closePanel(this.stack().id, panelId);
  }

  /**
   * Begins a flyout resize along its pinned axis, growing it away from the strip until release.
   * @param event The originating mouse event.
   */
  protected startResize(event: MouseEvent): void {
    event.preventDefault();
    const vertical: boolean = this.isVertical();
    // The handle sits on the flyout's inner edge; for right/bottom strips the flyout grows as the
    // pointer moves toward the strip (a negative delta), so those axes invert the sign.
    const sign: number = this.side() === 'right' || this.side() === 'bottom' ? -1 : 1;
    const start: number = vertical ? event.clientX : event.clientY;
    const startSize: number = this.flyoutSize();

    // Coalesced to the frame rate: each processed move writes the resized signal (a change-detection
    // pass), and only the frame's last position can ever be seen (see coalescePointerMoves).
    const coalesced: CoalescedPointerMoves = coalescePointerMoves((move: MouseEvent): void => {
      const delta: number = (vertical ? move.clientX : move.clientY) - start;
      this.resized.set(Math.max(MINIMUM_FLYOUT_SIZE, startSize + sign * delta));
    });

    const onRelease: () => void = (): void => {
      this.document.removeEventListener('mousemove', coalesced.move);
      this.document.removeEventListener('mouseup', onRelease);
      coalesced.flush();
    };

    this.document.addEventListener('mousemove', coalesced.move);
    this.document.addEventListener('mouseup', onRelease);
  }

  /**
   * Dismisses the peek when a press lands outside this strip and its flyout.
   * @param event The originating mouse event.
   */
  protected onDocumentMouseDown(event: MouseEvent): void {
    if (this.isPeeking() && !this.hostElement.nativeElement.contains(event.target as Node)) {
      this.autoHide.hideFlyout();
    }
  }
}
