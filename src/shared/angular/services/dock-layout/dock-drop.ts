import { DockTarget } from './dock-legality';
import { DockNode, StackNode, StackRole } from './dock-node';
import {
  dockEdge,
  dockStackEdge,
  findStackOfPanel,
  occupyWell,
  occupyWellWithStack,
  removeFromLayout,
  splitStack,
  splitStackBeside,
  tabInto,
  tabStackInto,
} from './dock-tree';

/**
 * Works out the layout dropping a panel on a target would make, without making it.
 * @param tree The layout.
 * @param panelId The identifier of the panel.
 * @param role The panel's role.
 * @param target The target.
 * @returns Returns the layout, which is the one given when the drop would change nothing.
 */
export function layoutAfterDrop(
  tree: DockNode,
  panelId: string,
  role: StackRole,
  target: DockTarget,
): DockNode {
  const source: StackNode | null = findStackOfPanel(tree, panelId);
  const without: DockNode = removeFromLayout(tree, panelId);
  switch (target.kind) {
    case 'edge':
      return dockEdge(without, panelId, target.side);
    case 'tab':
      return source?.id === target.stackId ? tree : tabInto(without, target.stackId, panelId);
    case 'occupy':
      return occupyWell(without, target.stackId, panelId);
    case 'split':
      return source?.id === target.stackId && source.panels.length <= 1
        ? tree
        : splitStack(without, target.stackId, panelId, target.side, role);
  }
}

/**
 * Works out the layout dropping a whole group on a target would make, without making it.
 * @param tree The layout.
 * @param stackId The identifier of the group.
 * @param target The target.
 * @returns Returns the layout.
 */
export function layoutAfterGroupDrop(
  tree: DockNode,
  stackId: string,
  target: DockTarget,
): DockNode {
  switch (target.kind) {
    case 'edge':
      return dockStackEdge(tree, stackId, target.side);
    case 'tab':
      return tabStackInto(tree, stackId, target.stackId);
    case 'occupy':
      return occupyWellWithStack(tree, stackId, target.stackId);
    case 'split':
      return splitStackBeside(tree, stackId, target.stackId, target.side);
  }
}
