import { inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import { DockGeometry } from './dock-geometry';
import { Rect } from './dock-legality';
import { DockNode, DockSide, isStackNode } from './dock-node';
import { DockState } from './dock-state';
import { findNode } from './dock-tree';

/**
 * The pixel size a stack occupied while docked, captured when it collapses so its peek can open at
 * the same size.
 */
export interface PeekSize {
  /**
   * Gets the docked width, in pixels.
   */
  readonly width: number;

  /**
   * Gets the docked height, in pixels.
   */
  readonly height: number;
}

/**
 * Manages auto-hidden (collapsed) tool stacks. Collapsing a tool stack keeps it in the layout tree
 * but shrinks it to a thin strip in its own slot, so it restores to the exact position and size it
 * had. Clicking the strip flies the stack out as a temporary peek over the layout; an explicit dock
 * expands it again. The editor (document) well is never collapsed.
 */
@Service()
export class DockAutoHide {
  /**
   * Holds the layout state collapsing, expanding and activation drive.
   */
  private readonly dockState: DockState = inject(DockState);

  /**
   * Holds the geometry registry the docked size is measured from at collapse time.
   */
  private readonly geometry: DockGeometry = inject(DockGeometry);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the docked size of each collapsed stack, keyed by stack id, so its peek opens at the size
   * it had while docked.
   */
  private readonly sizes: Map<string, PeekSize> = new Map<string, PeekSize>();

  /**
   * Holds the identifier of the stack currently flown out as a peek, or null when none is.
   */
  private readonly flyout: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Gets the identifier of the stack currently flown out as a peek.
   */
  public readonly flyoutStackId: Signal<string | null> = this.flyout.asReadonly();

  /**
   * Collapses a tool stack to a strip in its slot, remembering the edge it was hugging so the strip
   * keeps that edge as the tree is rearranged around it. The call is ignored for document wells and
   * unknown stacks.
   * @param stackId The identifier of the stack to collapse.
   * @param side The edge the stack is hugging, or undefined when the caller cannot say.
   */
  public pin(stackId: string, side?: DockSide): void {
    const node: DockNode | null = findNode(this.dockState.layout(), stackId);
    if (node === null || !isStackNode(node) || node.role === 'document') {
      return;
    }
    this.log.info(
      'DockAutoHide',
      `Auto-hid stack '${stackId}' against the ${side ?? 'unknown'} edge`,
    );
    const rect: Rect | null = this.geometry.rectOf(stackId);
    if (rect !== null) {
      this.sizes.set(stackId, { width: rect.width, height: rect.height });
    }
    this.flyout.set(null);
    this.dockState.setCollapsed(stackId, true, side);
  }

  /**
   * Expands a collapsed stack back to its slot, ending any peek and forgetting its captured size.
   * @param stackId The identifier of the stack to expand.
   */
  public unpin(stackId: string): void {
    this.log.info('DockAutoHide', `Expanded auto-hidden stack '${stackId}'`);
    this.sizes.delete(stackId);
    this.flyout.set(null);
    this.dockState.setCollapsed(stackId, false);
  }

  /**
   * Gets the docked size captured for a collapsed stack, or null when none was measured.
   * @param stackId The identifier of the collapsed stack.
   * @returns Returns the docked size, or null.
   */
  public peekSize(stackId: string): PeekSize | null {
    return this.sizes.get(stackId) ?? null;
  }

  /**
   * Flies a collapsed stack out as a peek, optionally activating one of its panels. Clicking the
   * already-peeking active panel toggles the peek closed.
   * @param stackId The identifier of the stack to peek.
   * @param panelId The identifier of the panel to activate, or undefined to keep the current one.
   */
  public showFlyout(stackId: string, panelId?: string): void {
    if (panelId !== undefined) {
      if (this.flyout() === stackId && this.activeOf(stackId) === panelId) {
        this.flyout.set(null);
        return;
      }
      this.dockState.setActive(stackId, panelId);
    }
    this.flyout.set(stackId);
  }

  /**
   * Hides the current peek.
   */
  public hideFlyout(): void {
    this.flyout.set(null);
  }

  /**
   * Closes a panel within a collapsed stack, ending the peek when the stack empties away.
   * @param stackId The identifier of the collapsed stack.
   * @param panelId The identifier of the panel to close.
   */
  public closePanel(stackId: string, panelId: string): void {
    this.log.debug('DockAutoHide', `Closing panel '${panelId}' in collapsed stack '${stackId}'`);
    this.dockState.removeFromLayout(panelId);
    if (findNode(this.dockState.layout(), stackId) === null) {
      this.flyout.set(null);
    }
  }

  /**
   * Resolves the active panel of a stack in the current layout.
   * @param stackId The identifier of the stack.
   * @returns Returns the active panel identifier, or null when unknown or empty.
   */
  private activeOf(stackId: string): string | null {
    const node: DockNode | null = findNode(this.dockState.layout(), stackId);
    return node !== null && isStackNode(node) ? node.active : null;
  }
}
