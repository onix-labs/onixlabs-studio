import { inject, Service } from '@angular/core';
import { DockAutoHide } from './dock-auto-hide';
import { DockFloating, FloatWindow } from './dock-floating';
import { DockFocus } from './dock-focus';
import { DockNode, StackNode } from './dock-node';
import { DockState } from './dock-state';
import { findStackOfPanel } from './dock-tree';

/**
 * Reveals a panel in its dock wherever it currently lives, so programmatic flows (a run activating a
 * terminal, a build starting) can surface a panel without knowing its state: a panel in an expanded
 * stack is activated and its stack focused; a panel in a collapsed stack is flown out as a peek (or
 * just activated, when its stack is already peeking, so revealing never toggles the peek closed); a
 * floating panel is brought to the front. A panel in no dock at all is left alone — callers that
 * need to (re)add a panel to the layout do so before revealing.
 *
 * Provided per view alongside the rest of the dock services, so it drives the revealing view's own
 * dock rather than another tab's.
 */
@Service()
export class DockReveal {
  /**
   * Holds the layout state activation is driven through.
   */
  private readonly dockState: DockState = inject(DockState);

  /**
   * Holds the auto-hide manager used to peek collapsed stacks.
   */
  private readonly autoHide: DockAutoHide = inject(DockAutoHide);

  /**
   * Holds the floating layer, so a floated panel is revealed by bringing its window forward.
   */
  private readonly floating: DockFloating = inject(DockFloating);

  /**
   * Holds the focus tracker used to accent the revealed stack.
   */
  private readonly dockFocus: DockFocus = inject(DockFocus);

  /**
   * Reveals a panel: activates it in its stack (focusing the stack), peeks its collapsed stack, or
   * brings its floating window to the front. A panel absent from the dock is ignored.
   * @param panelId The identifier of the panel to reveal.
   */
  public reveal(panelId: string): void {
    const floated: boolean = this.floating
      .floats()
      .some((float: FloatWindow): boolean => float.panelId === panelId);
    if (floated) {
      this.floating.bringToFront(panelId);
      return;
    }

    const layout: DockNode = this.dockState.layout();
    const stack: StackNode | null = findStackOfPanel(layout, panelId);
    if (stack === null) {
      return;
    }

    if (stack.collapsed === true) {
      if (this.autoHide.flyoutStackId() === stack.id) {
        // The stack is already peeking: just switch its active panel. Going through showFlyout here
        // would toggle the peek closed when the panel is already the active one.
        this.dockState.setActive(stack.id, panelId);
      } else {
        this.autoHide.showFlyout(stack.id, panelId);
      }
      return;
    }

    this.dockState.setActive(stack.id, panelId);
    this.dockFocus.focus(stack.id);
  }
}
