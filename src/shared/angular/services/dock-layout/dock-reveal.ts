import { inject, Service } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import { DockAutoHide } from './dock-auto-hide';
import { DockFloating, FloatWindow } from './dock-floating';
import { DockFocus } from './dock-focus';
import { DockNode, StackNode } from './dock-node';
import { DockPanelAvailability } from './dock-panel-availability';
import { DockRoom } from './dock-room';
import { DockState } from './dock-state';
import { findStackOfPanel } from './dock-tree';
import { PopoutPanels } from './popout-panels';

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
   * Holds which groups are collapsed, by the user or for want of room.
   */
  private readonly room: DockRoom = inject(DockRoom);

  /**
   * Holds which panels can be shown, which decides the one a group shows.
   */
  private readonly availability: DockPanelAvailability = inject(DockPanelAvailability);

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
   * Holds the popped-panels registry, so revealing a panel that lives in its own OS window focuses
   * that window instead of touching the dock.
   */
  private readonly popouts: PopoutPanels = inject(PopoutPanels);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Opens a panel and reveals it: where it lives already, when that is a floating or pop-out window, or
   * else in the layout (see {@link DockState.open}).
   * @param panelId The identifier of the panel to open.
   */
  public open(panelId: string): void {
    if (!this.isElsewhere(panelId)) {
      this.dockState.open(panelId);
    }
    this.reveal(panelId);
  }

  /**
   * Opens and reveals a panel so that it doesn't cover another: sharing a group with it, it moves to one of
   * its own beneath. For a panel that acts on what the other shows, as Find does.
   * @param panelId The identifier of the panel to open.
   * @param otherId The identifier of the panel to keep in sight.
   */
  public openClearOf(panelId: string, otherId: string): void {
    this.open(panelId);
    const layout: DockNode = this.dockState.layout();
    const stack: StackNode | null = findStackOfPanel(layout, panelId);
    if (
      stack !== null &&
      stack === findStackOfPanel(layout, otherId) &&
      this.dockState.isOpen(otherId)
    ) {
      this.dockState.splitPanelOut(panelId, 'bottom');
      this.reveal(otherId);
      this.reveal(panelId);
    }
  }

  /**
   * Determines whether a panel is open anywhere: in the layout, or in a floating or pop-out window.
   * @param panelId The identifier of the panel.
   * @returns Returns true when it is.
   */
  public isOpen(panelId: string): boolean {
    return this.isElsewhere(panelId) || this.dockState.isOpen(panelId);
  }

  /**
   * Closes a panel: in its floating window, when it lives in one, or else in the layout. One in a pop-out
   * window is closed there.
   * @param panelId The identifier of the panel to close.
   */
  public close(panelId: string): void {
    if (this.floating.floats().some((float: FloatWindow): boolean => float.panelId === panelId)) {
      void this.floating.requestClose(panelId);
    } else if (this.dockState.isOpen(panelId)) {
      void this.dockState.requestClose(panelId);
    }
  }

  /**
   * Closes a panel its group is showing, and otherwise opens and reveals it, so a panel that is open
   * behind another tab is brought to the front rather than closed.
   * @param panelId The identifier of the panel to toggle.
   */
  public toggle(panelId: string): void {
    if (this.isShowing(panelId)) {
      void this.dockState.requestClose(panelId);
    } else {
      this.open(panelId);
    }
  }

  /**
   * Determines whether the user is at a panel: its group is the one last used, or it is in a window of its
   * own. A panel drawn afresh takes the keyboard only then, rather than whenever its group comes back of
   * itself. Reads signals.
   * @param panelId The identifier of the panel.
   * @returns Returns true when they are.
   */
  public isInUse(panelId: string): boolean {
    return (
      this.isElsewhere(panelId) ||
      findStackOfPanel(this.dockState.layout(), panelId)?.id === this.dockFocus.focusedStackId()
    );
  }

  /**
   * Determines whether a panel lives in a floating or pop-out window.
   * @param panelId The identifier of the panel.
   * @returns Returns true when it does.
   */
  private isElsewhere(panelId: string): boolean {
    return (
      this.popouts.isPopped(panelId) ||
      this.floating.floats().some((float: FloatWindow): boolean => float.panelId === panelId)
    );
  }

  /**
   * Determines whether a panel is the one its group in the layout is showing.
   * @param panelId The identifier of the panel.
   * @returns Returns true when it is.
   */
  private isShowing(panelId: string): boolean {
    const stack: StackNode | null = findStackOfPanel(this.dockState.layout(), panelId);
    if (
      stack === null ||
      (this.room.isCollapsed(stack) && this.autoHide.flyoutStackId() !== stack.id)
    ) {
      return false;
    }
    const available: readonly string[] = stack.panels.filter((id: string): boolean =>
      this.availability.isAvailable(id),
    );
    const active: string | undefined = available.find((id: string): boolean => id === stack.active);
    return (active ?? available[0]) === panelId;
  }

  /**
   * Reveals a panel: focuses its pop-out window when it lives in one; otherwise activates it in its
   * stack (focusing the stack), peeks its collapsed stack, or brings its floating window to the
   * front. A panel absent from the dock is ignored.
   * @param panelId The identifier of the panel to reveal.
   */
  public reveal(panelId: string): void {
    this.log.info('DockReveal', `Revealing panel '${panelId}'`);
    if (this.popouts.isPopped(panelId)) {
      this.log.debug('DockReveal', `Panel '${panelId}' is popped out; focusing its window`);
      this.popouts.focusPopped(panelId);
      return;
    }

    if (this.isElsewhere(panelId)) {
      this.log.debug('DockReveal', `Panel '${panelId}' is floating; bringing to front`);
      this.floating.bringToFront(panelId);
      return;
    }

    const layout: DockNode = this.dockState.layout();
    const stack: StackNode | null = findStackOfPanel(layout, panelId);
    if (stack === null) {
      this.log.debug('DockReveal', `Panel '${panelId}' is not in the dock; nothing to reveal`);
      return;
    }

    if (this.room.isCollapsed(stack)) {
      if (this.autoHide.flyoutStackId() === stack.id) {
        // The stack is already peeking: just switch its active panel. Going through showFlyout here
        // would toggle the peek closed when the panel is already the active one.
        this.dockState.setActive(stack.id, panelId);
      } else {
        this.autoHide.showFlyout(stack.id, panelId);
      }
      if (this.room.enabled) {
        this.dockFocus.focus(stack.id);
      }
      return;
    }

    this.dockState.setActive(stack.id, panelId);
    this.dockFocus.focus(stack.id);
  }
}
