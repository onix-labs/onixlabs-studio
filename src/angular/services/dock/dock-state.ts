import { Service, signal, Signal, WritableSignal } from '@angular/core';
import { DockNode, DockSide, mkStack, StackRole } from './dock-node';
import { dockEdge, removeFromLayout, setActive, splitStack, tabInto } from './dock-tree';

/**
 * Holds the dock layout tree and exposes immutable mutations over it. Every mutation replaces the
 * tree signal with a structurally shared copy, so dependent views re-render with stable node ids.
 */
@Service()
export class DockState {
  /**
   * Holds the current layout tree.
   */
  private readonly tree: WritableSignal<DockNode> = signal<DockNode>(this.createDefaultLayout());

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
   * Activates a panel within a stack.
   * @param stackId The identifier of the stack whose active panel changes.
   * @param panelId The identifier of the panel to activate.
   */
  public setActive(stackId: string, panelId: string): void {
    this.tree.set(setActive(this.tree(), stackId, panelId));
  }

  /**
   * Restores the seeded default layout, discarding the current arrangement.
   */
  public reset(): void {
    this.tree.set(this.createDefaultLayout());
  }

  /**
   * Creates the default layout the service starts with and resets to. This is a placeholder empty
   * document well until the seeded VS-like layout (issue #42) replaces it.
   * @returns Returns the default layout tree.
   */
  private createDefaultLayout(): DockNode {
    return mkStack('document', []);
  }
}
