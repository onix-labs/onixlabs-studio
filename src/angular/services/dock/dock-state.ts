import { Service, signal, Signal, WritableSignal } from '@angular/core';
import { DockNode, DockSide, mkStack, StackNode, StackRole } from './dock-node';
import {
  defaultLayout,
  dockEdge,
  dockNodeEdge,
  movePanel,
  removeFromLayout,
  removeNode,
  reorderTab,
  setActive,
  setSizes,
  splitStack,
  tabInto,
} from './dock-tree';

/**
 * Holds the dock layout tree and exposes immutable mutations over it. Every mutation replaces the
 * tree signal with a structurally shared copy, so dependent views re-render with stable node ids.
 */
@Service()
export class DockState {
  /**
   * Holds the current layout tree.
   */
  private readonly tree: WritableSignal<DockNode> = signal<DockNode>(defaultLayout());

  /**
   * Gets the current layout tree.
   */
  public readonly layout: Signal<DockNode> = this.tree.asReadonly();

  /**
   * Adds a panel as a tab in the given stack and makes it active.
   * @param stackId The identifier of the stack to tab into.
   * @param panelId The identifier of the panel to add.
   */
  public tabInto(stackId: string, panelId: string): void {
    this.tree.set(tabInto(this.tree(), stackId, panelId));
  }

  /**
   * Docks a panel beside the given stack as a new stack of the given role.
   * @param stackId The identifier of the stack to dock beside.
   * @param panelId The identifier of the panel to dock.
   * @param side The side of the stack to dock against.
   * @param role The role of the new stack.
   */
  public splitStack(stackId: string, panelId: string, side: DockSide, role: StackRole): void {
    this.tree.set(splitStack(this.tree(), stackId, panelId, side, role));
  }

  /**
   * Docks a panel first-class against an application edge as a new tool stack.
   * @param panelId The identifier of the panel to dock.
   * @param side The edge to dock against.
   */
  public dockEdge(panelId: string, side: DockSide): void {
    this.tree.set(dockEdge(this.tree(), panelId, side));
  }

  /**
   * Removes a panel from the layout, pruning any stack that becomes empty.
   * @param panelId The identifier of the panel to remove.
   */
  public removeFromLayout(panelId: string): void {
    this.tree.set(removeFromLayout(this.tree(), panelId));
  }

  /**
   * Removes a whole stack from the layout, collapsing the tree around it. The call is ignored when
   * removing the stack would empty the entire layout.
   * @param stackId The identifier of the stack to remove.
   */
  public removeStack(stackId: string): void {
    const next: DockNode | null = removeNode(this.tree(), stackId);
    if (next !== null) {
      this.tree.set(next);
    }
  }

  /**
   * Docks a stack of panels first-class against an application edge, used to re-dock an auto-hidden
   * stack.
   * @param panels The identifiers of the panels the stack holds.
   * @param role The role of the stack.
   * @param side The edge to dock against.
   * @param active The identifier of the panel to activate, or null for the first panel.
   */
  public dockStackToEdge(
    panels: readonly string[],
    role: StackRole,
    side: DockSide,
    active: string | null,
  ): void {
    const stack: StackNode = mkStack(role, panels);
    const withActive: StackNode = active !== null ? { ...stack, active } : stack;
    this.tree.set(dockNodeEdge(this.tree(), withActive, side));
  }

  /**
   * Activates a panel within a stack.
   * @param stackId The identifier of the stack whose active panel changes.
   * @param panelId The identifier of the panel to activate.
   */
  public setActive(stackId: string, panelId: string): void {
    this.tree.set(setActive(this.tree(), stackId, panelId));
  }

  /**
   * Reorders a panel within its stack, used to commit a tab drag inside a group.
   * @param stackId The identifier of the stack whose tabs reorder.
   * @param fromIndex The current index of the panel.
   * @param toIndex The index the panel should occupy after the move.
   */
  public reorderTab(stackId: string, fromIndex: number, toIndex: number): void {
    this.tree.set(reorderTab(this.tree(), stackId, fromIndex, toIndex));
  }

  /**
   * Moves a panel into a stack at a given index, used to commit a tab drag between groups.
   * @param panelId The identifier of the panel to move.
   * @param targetStackId The identifier of the stack to move the panel into.
   * @param targetIndex The index the panel should occupy in the target stack.
   */
  public movePanel(panelId: string, targetStackId: string, targetIndex: number): void {
    this.tree.set(movePanel(this.tree(), panelId, targetStackId, targetIndex));
  }

  /**
   * Replaces the flex-grow weights of a split, used to commit a splitter drag.
   * @param splitId The identifier of the split whose weights change.
   * @param sizes The new flex-grow weight of each child.
   */
  public setSizes(splitId: string, sizes: readonly number[]): void {
    this.tree.set(setSizes(this.tree(), splitId, sizes));
  }

  /**
   * Restores the seeded default layout, discarding the current arrangement.
   */
  public reset(): void {
    this.tree.set(defaultLayout());
  }
}
