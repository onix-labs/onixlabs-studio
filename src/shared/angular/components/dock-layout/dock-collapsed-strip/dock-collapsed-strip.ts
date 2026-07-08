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
import { DockPanelRegistry } from '../../../services/dock-layout/dock-panel-registry';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
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
 * Renders a collapsed tool stack as a thin strip in the slot the stack occupies, listing one tab
 * per panel. Clicking a tab flies the stack out as a peek that opens inward over the layout, where
 * its panels can be activated, closed, or the stack docked (expanded) again. The strip is oriented
 * by the edge of its slot it hugs: left/right slots render a vertical strip, top/bottom a horizontal
 * one, and the peek opens away from that edge.
 */
@Component({
  selector: 'app-dock-collapsed-strip',
  imports: [AppIcon, DockPanelOutlet],
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
  protected readonly collapseIcon: Signal<Icon> = computed(
    (): Icon =>
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
   * Gets the resolved panels held by the stack, in tab order.
   */
  protected readonly panels: Signal<readonly DockPanel[]> = computed((): readonly DockPanel[] =>
    this.stack()
      .panels.map((id: string): DockPanel | undefined => this.registry.get(id))
      .filter((panel: DockPanel | undefined): panel is DockPanel => panel !== undefined),
  );

  /**
   * Gets the active panel id of the stack.
   */
  protected readonly activeId: Signal<string | null> = computed(
    (): string | null => this.stack().active,
  );

  /**
   * Gets the resolved active panel, or undefined when none is.
   */
  protected readonly activePanel: Signal<DockPanel | undefined> = computed(
    (): DockPanel | undefined => {
      const active: string | null = this.stack().active;
      return active !== null ? this.registry.get(active) : undefined;
    },
  );

  /**
   * Gets whether this stack is the one currently flown out as a peek.
   */
  protected readonly isPeeking: Signal<boolean> = computed(
    (): boolean => this.autoHide.flyoutStackId() === this.stack().id,
  );

  /**
   * Gets the flyout's resizable extent in pixels: the live resized value when present, otherwise the
   * captured docked size for the resizable axis, falling back to a default.
   */
  protected readonly flyoutSize: Signal<number> = computed((): number => {
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
   * Flies the stack out (or toggles the peek closed) on the chosen panel.
   * @param panelId The identifier of the panel to peek.
   */
  protected peek(panelId: string): void {
    this.autoHide.showFlyout(this.stack().id, panelId);
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

    const onMove: (move: MouseEvent) => void = (move: MouseEvent): void => {
      const delta: number = (vertical ? move.clientX : move.clientY) - start;
      this.resized.set(Math.max(MINIMUM_FLYOUT_SIZE, startSize + sign * delta));
    };

    const onRelease: () => void = (): void => {
      this.document.removeEventListener('mousemove', onMove);
      this.document.removeEventListener('mouseup', onRelease);
    };

    this.document.addEventListener('mousemove', onMove);
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
