import { computed, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { Settings } from '@shared/angular/services/settings/settings';
import { DOCK_BLUEPRINT, DockBlueprint } from './dock-blueprint';
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
  setCollapsed,
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
   * Holds the host-supplied blueprint specialising this dock, or null when none was provided (the
   * workspace default).
   */
  private readonly blueprint: DockBlueprint | null = inject(DOCK_BLUEPRINT, { optional: true });

  /**
   * Holds the settings the history caretaker reads the bounded undo depth from.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the current layout tree, seeded from the blueprint's layout (or the workspace default).
   */
  private readonly tree: WritableSignal<DockNode> = signal<DockNode>(this.createLayout());

  /**
   * Gets the current layout tree.
   */
  public readonly layout: Signal<DockNode> = this.tree.asReadonly();

  /**
   * Holds the past layout snapshots (the caretaker's undo stack), oldest first, most recent last.
   * Each entry is a whole immutable tree captured before a structural mutation — a memento, cheap to
   * hold because the trees are structurally shared.
   */
  private readonly past: WritableSignal<readonly DockNode[]> = signal<readonly DockNode[]>([]);

  /**
   * Holds the undone layout snapshots available to redo, most recently undone first.
   */
  private readonly future: WritableSignal<readonly DockNode[]> = signal<readonly DockNode[]>([]);

  /**
   * Gets a value indicating whether an earlier layout can be restored.
   */
  public readonly canUndo: Signal<boolean> = computed((): boolean => this.past().length > 0);

  /**
   * Gets a value indicating whether an undone layout can be reapplied.
   */
  public readonly canRedo: Signal<boolean> = computed((): boolean => this.future().length > 0);

  /**
   * Adds a panel as a tab in the given stack and makes it active.
   * @param stackId The identifier of the stack to tab into.
   * @param panelId The identifier of the panel to add.
   */
  public tabInto(stackId: string, panelId: string): void {
    this.commit(tabInto(this.tree(), stackId, panelId));
  }

  /**
   * Docks a panel beside the given stack as a new stack of the given role.
   * @param stackId The identifier of the stack to dock beside.
   * @param panelId The identifier of the panel to dock.
   * @param side The side of the stack to dock against.
   * @param role The role of the new stack.
   */
  public splitStack(stackId: string, panelId: string, side: DockSide, role: StackRole): void {
    this.commit(splitStack(this.tree(), stackId, panelId, side, role));
  }

  /**
   * Docks a panel first-class against an application edge as a new tool stack.
   * @param panelId The identifier of the panel to dock.
   * @param side The edge to dock against.
   */
  public dockEdge(panelId: string, side: DockSide): void {
    this.commit(dockEdge(this.tree(), panelId, side));
  }

  /**
   * Removes a panel from the layout, pruning any stack that becomes empty.
   * @param panelId The identifier of the panel to remove.
   */
  public removeFromLayout(panelId: string): void {
    this.commit(removeFromLayout(this.tree(), panelId));
  }

  /**
   * Removes a whole stack from the layout, collapsing the tree around it. The call is ignored when
   * removing the stack would empty the entire layout.
   * @param stackId The identifier of the stack to remove.
   */
  public removeStack(stackId: string): void {
    const next: DockNode | null = removeNode(this.tree(), stackId);
    if (next !== null) {
      this.commit(next);
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
    this.commit(dockNodeEdge(this.tree(), withActive, side));
  }

  /**
   * Activates a panel within a stack.
   * @param stackId The identifier of the stack whose active panel changes.
   * @param panelId The identifier of the panel to activate.
   */
  public setActive(stackId: string, panelId: string): void {
    // Activating a tab is a focus change, not a layout mutation, so it bypasses the undo history:
    // undo/redo restore whole arrangements, not which tab was last looked at.
    this.tree.set(setActive(this.tree(), stackId, panelId));
  }

  /**
   * Collapses or expands a tool stack in place, keeping its slot and weight so it restores exactly.
   * @param stackId The identifier of the stack to collapse or expand.
   * @param collapsed Whether the stack should be collapsed.
   */
  public setCollapsed(stackId: string, collapsed: boolean): void {
    this.commit(setCollapsed(this.tree(), stackId, collapsed));
  }

  /**
   * Reorders a panel within its stack, used to commit a tab drag inside a group.
   * @param stackId The identifier of the stack whose tabs reorder.
   * @param fromIndex The current index of the panel.
   * @param toIndex The index the panel should occupy after the move.
   */
  public reorderTab(stackId: string, fromIndex: number, toIndex: number): void {
    this.commit(reorderTab(this.tree(), stackId, fromIndex, toIndex));
  }

  /**
   * Moves a panel into a stack at a given index, used to commit a tab drag between groups.
   * @param panelId The identifier of the panel to move.
   * @param targetStackId The identifier of the stack to move the panel into.
   * @param targetIndex The index the panel should occupy in the target stack.
   */
  public movePanel(panelId: string, targetStackId: string, targetIndex: number): void {
    this.commit(movePanel(this.tree(), panelId, targetStackId, targetIndex));
  }

  /**
   * Replaces the flex-grow weights of a split, used to commit a splitter drag.
   * @param splitId The identifier of the split whose weights change.
   * @param sizes The new flex-grow weight of each child.
   */
  public setSizes(splitId: string, sizes: readonly number[]): void {
    this.commit(setSizes(this.tree(), splitId, sizes));
  }

  /**
   * Restores the seeded default layout, discarding the current arrangement.
   */
  public reset(): void {
    this.commit(this.createLayout());
  }

  /**
   * Restores the most recent layout from before the last structural mutation. Does nothing when
   * there is no history to undo.
   */
  public undo(): void {
    const past: readonly DockNode[] = this.past();
    if (past.length === 0) {
      return;
    }
    const previous: DockNode = past[past.length - 1];
    this.past.set(past.slice(0, -1));
    this.future.set([this.tree(), ...this.future()]);
    this.tree.set(previous);
  }

  /**
   * Reapplies the most recently undone layout. Does nothing when there is nothing to redo.
   */
  public redo(): void {
    const future: readonly DockNode[] = this.future();
    if (future.length === 0) {
      return;
    }
    const next: DockNode = future[0];
    this.future.set(future.slice(1));
    this.past.set([...this.past(), this.tree()]);
    this.tree.set(next);
  }

  /**
   * Captures the current layout as a memento, then applies the next one. The undo stack is bounded to
   * the configured undo depth (oldest snapshots dropped), and any redo history is discarded because a
   * fresh mutation forks a new future.
   * @param next The layout tree to apply.
   */
  private commit(next: DockNode): void {
    const limit: number = Math.max(0, Math.trunc(this.settings.undoStackSize()));
    const history: readonly DockNode[] = [...this.past(), this.tree()];
    this.past.set(limit === 0 ? [] : history.slice(-limit));
    this.future.set([]);
    this.tree.set(next);
  }

  /**
   * Builds a fresh layout tree from the blueprint, or the built-in workspace default when no
   * blueprint was provided.
   * @returns Returns a fresh layout tree.
   */
  private createLayout(): DockNode {
    return this.blueprint !== null ? this.blueprint.createLayout() : defaultLayout();
  }
}
