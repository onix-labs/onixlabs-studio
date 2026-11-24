import { inject, Service } from '@angular/core';
import { DockPanel } from './dock-panel';
import { DockPanelAvailability } from './dock-panel-availability';
import { DockPanelRegistry } from './dock-panel-registry';
import { DockNode, isStackNode, SplitNode } from './dock-node';
import { countStacks } from './dock-tree';

/**
 * A size in pixels a child of a split keeps, and the most it may be dragged to.
 */
export interface DockGroupSize {
  /**
   * Gets the size in pixels.
   */
  readonly size: number;

  /**
   * Gets the greatest size in pixels, infinite when nothing limits it.
   */
  readonly max: number;
}

/**
 * Works out which parts of a dock layout keep a size in pixels rather than taking a share of the room
 * (#1567).
 *
 * A part does when it sits beside the main group — in a split whose other side holds it — and a panel in
 * it prefers a size ({@link DockPanel.defaultSize}). It opens at the largest of its panels' preferences,
 * every panel's and not the active one's, so switching tabs never makes a group jump, and keeps the size
 * a divider was dragged to. The side holding the main group takes the room that is left, so there is
 * always one that does.
 *
 * Everything else takes a share: every part of a layout with no main group, and groups stacked in the same
 * column beside one, which share its height.
 *
 * Scoped per dock, beside the {@link import('./dock-state').DockState} it describes.
 */
@Service()
export class DockGroupSizes {
  /**
   * Holds the panel descriptors, which say what size they prefer.
   */
  private readonly registry: DockPanelRegistry = inject(DockPanelRegistry);

  /**
   * Holds which panels can be shown here: one that cannot asks for no room.
   */
  private readonly availability: DockPanelAvailability = inject(DockPanelAvailability);

  /**
   * Gets the size a child of a split keeps along it. Reads signals, so a computed or a template using it
   * follows every change.
   * @param child The child.
   * @param split The split.
   * @returns Returns the size and its limit, or null when the child takes a share.
   */
  public sizeOf(child: DockNode, split: SplitNode): DockGroupSize | null {
    if (countStacks(split, 'main') === 0 || countStacks(child, 'main') > 0) {
      return null;
    }
    const preferred: DockGroupSize | null = this.preferenceOf(child);
    return preferred === null
      ? null
      : { size: Math.min(child.size ?? preferred.size, preferred.max), max: preferred.max };
  }

  /**
   * Gets the size a node's panels prefer it to be.
   * @param node The node.
   * @returns Returns the largest of its panels' preferences and of their limits, or null when none
   * prefers a size.
   */
  private preferenceOf(node: DockNode): DockGroupSize | null {
    const preferences: readonly DockGroupSize[] = isStackNode(node)
      ? node.panels
          .filter((id: string): boolean => this.availability.isAvailable(id))
          .map((id: string): DockGroupSize | null => preferenceOfPanel(this.registry.get(id)))
          .filter((size: DockGroupSize | null): size is DockGroupSize => size !== null)
      : node.children
          .map((child: DockNode): DockGroupSize | null => this.preferenceOf(child))
          .filter((size: DockGroupSize | null): size is DockGroupSize => size !== null);
    return preferences.length === 0
      ? null
      : {
          size: Math.max(...preferences.map((size: DockGroupSize): number => size.size)),
          max: Math.max(...preferences.map((size: DockGroupSize): number => size.max)),
        };
  }
}

/**
 * Gets the size a panel prefers.
 * @param panel The panel, or undefined when it is not registered.
 * @returns Returns the size and its limit, or null when the panel prefers none.
 */
function preferenceOfPanel(panel: DockPanel | undefined): DockGroupSize | null {
  return panel?.defaultSize === undefined
    ? null
    : { size: panel.defaultSize, max: panel.maxSize ?? Number.POSITIVE_INFINITY };
}
