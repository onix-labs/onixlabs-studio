import { computed, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { DockGeometry } from './dock-geometry';
import { nearestEdge, Rect } from './dock-legality';
import { DockNode, DockSide, isStackNode, StackRole } from './dock-node';
import { DockState } from './dock-state';
import { findNode } from './dock-tree';

/**
 * An auto-hidden (shelved) tool stack, pinned to an edge as a button strip.
 */
export interface ShelvedStack {
  /**
   * Gets the stable key identifying the shelved stack.
   */
  readonly key: string;

  /**
   * Gets the edge the stack is shelved against.
   */
  readonly edge: DockSide;

  /**
   * Gets the role of the shelved stack.
   */
  readonly role: StackRole;

  /**
   * Gets the panels the shelved stack holds.
   */
  readonly panels: readonly string[];

  /**
   * Gets the active panel of the shelved stack, or null when empty.
   */
  readonly active: string | null;
}

/**
 * Manages auto-hidden tool stacks: pinning a tool stack shelves it to its nearest edge as a button
 * strip; hovering a button flies the stack out; unpinning re-docks it. The editor (document) well
 * is never auto-hidden.
 */
@Service()
export class DockAutoHide {
  /**
   * Holds the layout state pinning and unpinning drive.
   */
  private readonly dockState: DockState = inject(DockState);

  /**
   * Holds the geometry registry the nearest edge is measured against.
   */
  private readonly geometry: DockGeometry = inject(DockGeometry);

  /**
   * Holds the shelved stacks.
   */
  private readonly shelf: WritableSignal<readonly ShelvedStack[]> = signal<readonly ShelvedStack[]>(
    [],
  );

  /**
   * Holds the key of the shelved stack currently flown out, or null when none is.
   */
  private readonly flyout: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds the running counter that assigns shelf keys.
   */
  private keyCounter: number = 0;

  /**
   * Gets the shelved stacks.
   */
  public readonly shelved: Signal<readonly ShelvedStack[]> = this.shelf.asReadonly();

  /**
   * Gets the key of the shelved stack currently flown out.
   */
  public readonly flyoutKey: Signal<string | null> = this.flyout.asReadonly();

  /**
   * Gets which edges have at least one shelved stack, so the dock area can inset away from them.
   */
  public readonly occupiedEdges: Signal<Record<DockSide, boolean>> = computed(
    (): Record<DockSide, boolean> => {
      const edges: Record<DockSide, boolean> = {
        left: false,
        right: false,
        top: false,
        bottom: false,
      };
      for (const stack of this.shelf()) {
        edges[stack.edge] = true;
      }
      return edges;
    },
  );

  /**
   * Auto-hides a tool stack, shelving it to its nearest edge and removing it from the layout. The
   * call is ignored for document wells and unknown stacks.
   * @param stackId The identifier of the stack to pin.
   */
  public pin(stackId: string): void {
    const node: DockNode | null = findNode(this.dockState.layout(), stackId);
    if (node === null || !isStackNode(node) || node.role === 'document') {
      return;
    }
    const rect: Rect | null = this.geometry.rectOf(stackId);
    const workspace: Rect | null = this.geometry.workspaceRect();
    const edge: DockSide =
      rect !== null && workspace !== null ? nearestEdge(rect, workspace) : 'left';
    this.keyCounter += 1;
    this.shelf.set([
      ...this.shelf(),
      {
        key: `shelf-${this.keyCounter}`,
        edge,
        role: node.role,
        panels: [...node.panels],
        active: node.active,
      },
    ]);
    this.dockState.removeStack(stackId);
  }

  /**
   * Re-docks a shelved stack to its edge, removing it from the shelf.
   * @param key The key of the shelved stack to unpin.
   */
  public unpin(key: string): void {
    const entry: ShelvedStack | undefined = this.find(key);
    if (entry === undefined) {
      return;
    }
    this.remove(key);
    this.flyout.set(null);
    this.dockState.dockStackToEdge(entry.panels, entry.role, entry.edge, entry.active);
  }

  /**
   * Flies a shelved stack out, optionally activating one of its panels.
   * @param key The key of the shelved stack to fly out.
   * @param panelId The identifier of the panel to activate, or undefined to keep the current one.
   */
  public showFlyout(key: string, panelId?: string): void {
    if (panelId !== undefined) {
      this.setActive(key, panelId);
    }
    this.flyout.set(key);
  }

  /**
   * Hides the current flyout.
   */
  public hideFlyout(): void {
    this.flyout.set(null);
  }

  /**
   * Activates a panel within a shelved stack.
   * @param key The key of the shelved stack.
   * @param panelId The identifier of the panel to activate.
   */
  public setActive(key: string, panelId: string): void {
    this.shelf.set(
      this.shelf().map(
        (stack: ShelvedStack): ShelvedStack =>
          stack.key === key && stack.panels.includes(panelId)
            ? { ...stack, active: panelId }
            : stack,
      ),
    );
  }

  /**
   * Closes a panel within a shelved stack, removing the whole shelf entry when it empties.
   * @param key The key of the shelved stack.
   * @param panelId The identifier of the panel to close.
   */
  public closePanel(key: string, panelId: string): void {
    const entry: ShelvedStack | undefined = this.find(key);
    if (entry === undefined) {
      return;
    }
    const panels: readonly string[] = entry.panels.filter((id: string): boolean => id !== panelId);
    if (panels.length === 0) {
      this.remove(key);
      this.flyout.set(null);
      return;
    }
    const active: string | null = entry.active === panelId ? panels[0] : entry.active;
    this.shelf.set(
      this.shelf().map(
        (stack: ShelvedStack): ShelvedStack =>
          stack.key === key ? { ...stack, panels, active } : stack,
      ),
    );
  }

  /**
   * Finds a shelved stack by key.
   * @param key The key to find.
   * @returns Returns the shelved stack, or undefined when none matches.
   */
  private find(key: string): ShelvedStack | undefined {
    return this.shelf().find((stack: ShelvedStack): boolean => stack.key === key);
  }

  /**
   * Removes a shelved stack by key.
   * @param key The key to remove.
   */
  private remove(key: string): void {
    this.shelf.set(this.shelf().filter((stack: ShelvedStack): boolean => stack.key !== key));
  }
}
