import {
  DockNode,
  DockSide,
  isSplitNode,
  isStackNode,
  mkSplit,
  mkStack,
  SplitDirection,
  StackNode,
  StackRole,
} from './dock-node';

/**
 * Computes the arithmetic mean of a list of weights, used when sizing a newly inserted child so it
 * claims an average share of its split.
 * @param values The weights to average.
 * @returns Returns the mean of the values, or one when the list is empty.
 */
function average(values: readonly number[]): number {
  if (values.length === 0) {
    return 1;
  }
  return values.reduce((total: number, value: number): number => total + value, 0) / values.length;
}

/**
 * Resolves the split orientation a dock side implies.
 * @param side The side a panel is docking against.
 * @returns Returns `row` for the horizontal sides and `col` for the vertical sides.
 */
function directionOf(side: DockSide): SplitDirection {
  return side === 'left' || side === 'right' ? 'row' : 'col';
}

/**
 * Determines whether a dock side places the new node before the existing node in document order.
 * @param side The side a panel is docking against.
 * @returns Returns `true` for the `left` and `top` sides; otherwise, `false`.
 */
function isBefore(side: DockSide): boolean {
  return side === 'left' || side === 'top';
}

/**
 * Finds the node with the given identifier anywhere in the tree.
 * @param tree The root of the tree to search.
 * @param id The identifier of the node to find.
 * @returns Returns the matching node, or `null` when no node has the identifier.
 */
export function findNode(tree: DockNode, id: string): DockNode | null {
  if (tree.id === id) {
    return tree;
  }
  if (isStackNode(tree)) {
    return null;
  }
  for (const child of tree.children) {
    const found: DockNode | null = findNode(child, id);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

/**
 * Finds the stack that currently holds the given panel.
 * @param tree The root of the tree to search.
 * @param panelId The identifier of the panel to locate.
 * @returns Returns the stack holding the panel, or `null` when the panel is not in the tree.
 */
export function findStackOfPanel(tree: DockNode, panelId: string): StackNode | null {
  if (isStackNode(tree)) {
    return tree.panels.includes(panelId) ? tree : null;
  }
  for (const child of tree.children) {
    const found: StackNode | null = findStackOfPanel(child, panelId);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

/**
 * Finds the first stack of the given role in depth-first order.
 * @param tree The root of the tree to search.
 * @param role The role to find.
 * @returns Returns the first matching stack, or null when none exists.
 */
export function firstStackOfRole(tree: DockNode, role: StackRole): StackNode | null {
  if (isStackNode(tree)) {
    return tree.role === role ? tree : null;
  }
  for (const child of tree.children) {
    const found: StackNode | null = firstStackOfRole(child, role);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

/**
 * Counts the stacks of the given role in the tree.
 * @param tree The root of the tree to search.
 * @param role The role to count.
 * @returns Returns the number of stacks with the role.
 */
export function countStacks(tree: DockNode, role: StackRole): number {
  if (isStackNode(tree)) {
    return tree.role === role ? 1 : 0;
  }
  return tree.children.reduce(
    (total: number, child: DockNode): number => total + countStacks(child, role),
    0,
  );
}

/**
 * Replaces the node with the given identifier, returning a new tree that shares every untouched
 * subtree with the original. The tree is returned unchanged when the identifier is not found.
 * @param tree The root of the tree to transform.
 * @param id The identifier of the node to replace.
 * @param replacement The node to substitute in its place.
 * @returns Returns the transformed tree.
 */
export function replaceNode(tree: DockNode, id: string, replacement: DockNode): DockNode {
  if (tree.id === id) {
    return replacement;
  }
  if (isStackNode(tree)) {
    return tree;
  }
  let changed: boolean = false;
  const children: DockNode[] = tree.children.map((child: DockNode): DockNode => {
    const next: DockNode = replaceNode(child, id, replacement);
    if (next !== child) {
      changed = true;
    }
    return next;
  });
  return changed ? { ...tree, children } : tree;
}

/**
 * Removes the node with the given identifier and collapses the layout around the hole: an empty
 * split is removed (recursing into its parent) and a split left with a single child is replaced by
 * that child (single-child promotion). Untouched subtrees are shared with the original tree.
 * @param tree The root of the tree to transform.
 * @param id The identifier of the node to remove.
 * @returns Returns the transformed tree, or `null` when removing the node empties the whole tree.
 */
export function removeNode(tree: DockNode, id: string): DockNode | null {
  if (tree.id === id) {
    return null;
  }
  if (isStackNode(tree)) {
    return tree;
  }
  let changed: boolean = false;
  const children: DockNode[] = [];
  const sizes: number[] = [];
  tree.children.forEach((child: DockNode, index: number): void => {
    const next: DockNode | null = removeNode(child, id);
    if (next === null) {
      changed = true;
      return;
    }
    if (next !== child) {
      changed = true;
    }
    children.push(next);
    sizes.push(tree.sizes[index]);
  });
  if (!changed) {
    return tree;
  }
  if (children.length === 0) {
    return null;
  }
  if (children.length === 1) {
    return children[0];
  }
  return { ...tree, children, sizes };
}

/**
 * Removes a stack from the tree once it is empty, except the last remaining document well, which is
 * kept so documents always have a home. A non-empty stack is left untouched.
 * @param tree The root of the tree to transform.
 * @param stack The stack to consider pruning.
 * @returns Returns the transformed tree.
 */
export function pruneStack(tree: DockNode, stack: StackNode): DockNode {
  if (stack.panels.length > 0) {
    return tree;
  }
  if (stack.role === 'document' && countStacks(tree, 'document') <= 1) {
    return tree;
  }
  return removeNode(tree, stack.id) ?? tree;
}

/**
 * Adds a panel as a tab in the given stack and makes it active.
 * @param tree The root of the tree to transform.
 * @param stackId The identifier of the stack to tab into.
 * @param panelId The identifier of the panel to add.
 * @returns Returns the transformed tree, or the original tree when the stack does not exist.
 */
export function tabInto(tree: DockNode, stackId: string, panelId: string): DockNode {
  const target: DockNode | null = findNode(tree, stackId);
  if (target === null || !isStackNode(target)) {
    return tree;
  }
  const updated: StackNode = { ...target, panels: [...target.panels, panelId], active: panelId };
  return replaceNode(tree, stackId, updated);
}

/**
 * Activates a panel within a stack. The call is ignored when the stack or panel does not exist.
 * @param tree The root of the tree to transform.
 * @param stackId The identifier of the stack whose active panel changes.
 * @param panelId The identifier of the panel to activate.
 * @returns Returns the transformed tree.
 */
export function setActive(tree: DockNode, stackId: string, panelId: string): DockNode {
  const target: DockNode | null = findNode(tree, stackId);
  if (target === null || !isStackNode(target) || !target.panels.includes(panelId)) {
    return tree;
  }
  return replaceNode(tree, stackId, { ...target, active: panelId });
}

/**
 * Wraps a node in a new split so that a new sibling docks beside it along the given axis.
 * @param target The existing node to dock beside.
 * @param sibling The new node to place alongside it.
 * @param dir The orientation of the wrapping split.
 * @param before Whether the sibling precedes the target in document order.
 * @returns Returns the new split node.
 */
function wrap(target: DockNode, sibling: DockNode, dir: SplitDirection, before: boolean): DockNode {
  return mkSplit(dir, before ? [sibling, target] : [target, sibling], [1, 1]);
}

/**
 * Inserts a new stack beside the target stack. When the target's parent already runs along the
 * required axis the new stack is inserted as a sibling; otherwise the target is wrapped in a new
 * split. When the target is the tree root, the whole tree is wrapped.
 * @param tree The root of the tree to transform.
 * @param stackId The identifier of the stack to dock beside.
 * @param panelId The identifier of the panel to place in the new stack.
 * @param side The side of the target the new stack docks against.
 * @param role The role of the new stack.
 * @returns Returns the transformed tree, or the original tree when the target does not exist.
 */
export function splitStack(
  tree: DockNode,
  stackId: string,
  panelId: string,
  side: DockSide,
  role: StackRole,
): DockNode {
  if (findNode(tree, stackId) === null) {
    return tree;
  }
  const dir: SplitDirection = directionOf(side);
  const before: boolean = isBefore(side);
  const sibling: StackNode = mkStack(role, [panelId]);

  if (tree.id === stackId) {
    return wrap(tree, sibling, dir, before);
  }
  return insertBeside(tree, stackId, sibling, dir, before);
}

/**
 * Recursively rebuilds the tree to place a sibling beside the target node, choosing between an
 * in-place sibling insert and a wrapping split based on the parent split's orientation.
 * @param node The current subtree root.
 * @param targetId The identifier of the node to dock beside.
 * @param sibling The new node to insert.
 * @param dir The orientation the sibling requires.
 * @param before Whether the sibling precedes the target in document order.
 * @returns Returns the transformed subtree.
 */
function insertBeside(
  node: DockNode,
  targetId: string,
  sibling: DockNode,
  dir: SplitDirection,
  before: boolean,
): DockNode {
  if (isStackNode(node)) {
    return node;
  }
  const index: number = node.children.findIndex(
    (child: DockNode): boolean => child.id === targetId,
  );
  if (index >= 0) {
    if (node.dir === dir) {
      const at: number = before ? index : index + 1;
      const children: DockNode[] = [...node.children];
      const sizes: number[] = [...node.sizes];
      children.splice(at, 0, sibling);
      sizes.splice(at, 0, average(node.sizes));
      return { ...node, children, sizes };
    }
    const children: DockNode[] = [...node.children];
    children[index] = wrap(node.children[index], sibling, dir, before);
    return { ...node, children };
  }
  let changed: boolean = false;
  const children: DockNode[] = node.children.map((child: DockNode): DockNode => {
    const next: DockNode = insertBeside(child, targetId, sibling, dir, before);
    if (next !== child) {
      changed = true;
    }
    return next;
  });
  return changed ? { ...node, children } : node;
}

/**
 * Docks a node first-class against an application edge: a full-length slab spanning the edge. When
 * the tree root already runs along the required axis the node joins it as an edge sibling;
 * otherwise the whole tree is wrapped so the new slab spans the full edge.
 * @param tree The root of the tree to transform.
 * @param node The node to dock against the edge.
 * @param side The edge to dock against.
 * @returns Returns the transformed tree.
 */
export function dockNodeEdge(tree: DockNode, node: DockNode, side: DockSide): DockNode {
  const dir: SplitDirection = directionOf(side);
  const before: boolean = isBefore(side);
  if (isSplitNode(tree) && tree.dir === dir) {
    const slab: number = average(tree.sizes);
    const children: DockNode[] = before ? [node, ...tree.children] : [...tree.children, node];
    const sizes: number[] = before ? [slab, ...tree.sizes] : [...tree.sizes, slab];
    return { ...tree, children, sizes };
  }
  return mkSplit(dir, before ? [node, tree] : [tree, node], before ? [1.3, 4] : [4, 1.3]);
}

/**
 * Docks a panel first-class against an application edge as a new tool stack.
 * @param tree The root of the tree to transform.
 * @param panelId The identifier of the panel to dock.
 * @param side The edge to dock against.
 * @returns Returns the transformed tree.
 */
export function dockEdge(tree: DockNode, panelId: string, side: DockSide): DockNode {
  return dockNodeEdge(tree, mkStack('tool', [panelId]), side);
}

/**
 * Removes a panel from the layout, updating its stack's active panel and pruning the stack when it
 * becomes empty.
 * @param tree The root of the tree to transform.
 * @param panelId The identifier of the panel to remove.
 * @returns Returns the transformed tree.
 */
export function removeFromLayout(tree: DockNode, panelId: string): DockNode {
  const stack: StackNode | null = findStackOfPanel(tree, panelId);
  if (stack === null) {
    return tree;
  }
  const panels: readonly string[] = stack.panels.filter((id: string): boolean => id !== panelId);
  const active: string | null = stack.active === panelId ? (panels[0] ?? null) : stack.active;
  const updated: StackNode = { ...stack, panels, active };
  return pruneStack(replaceNode(tree, stack.id, updated), updated);
}

/**
 * Reorders a panel within its stack. Out-of-range or no-op indices are ignored.
 * @param tree The root of the tree to transform.
 * @param stackId The identifier of the stack whose tabs reorder.
 * @param fromIndex The current index of the panel to move.
 * @param toIndex The index the panel should occupy after the move.
 * @returns Returns the transformed tree.
 */
export function reorderTab(
  tree: DockNode,
  stackId: string,
  fromIndex: number,
  toIndex: number,
): DockNode {
  const target: DockNode | null = findNode(tree, stackId);
  if (target === null || !isStackNode(target)) {
    return tree;
  }
  const lastIndex: number = target.panels.length - 1;
  const outOfRange: boolean =
    fromIndex < 0 || fromIndex > lastIndex || toIndex < 0 || toIndex > lastIndex;
  if (outOfRange || fromIndex === toIndex) {
    return tree;
  }
  const panels: string[] = [...target.panels];
  const [moved] = panels.splice(fromIndex, 1);
  panels.splice(toIndex, 0, moved);
  return replaceNode(tree, stackId, { ...target, panels });
}

/**
 * Moves a panel into a stack at a given index, removing it from its current stack and pruning that
 * stack when it empties. Moving within the same stack reorders it. The call is ignored when the
 * panel or target stack does not exist.
 * @param tree The root of the tree to transform.
 * @param panelId The identifier of the panel to move.
 * @param targetStackId The identifier of the stack to move the panel into.
 * @param targetIndex The index the panel should occupy in the target stack.
 * @returns Returns the transformed tree.
 */
export function movePanel(
  tree: DockNode,
  panelId: string,
  targetStackId: string,
  targetIndex: number,
): DockNode {
  const source: StackNode | null = findStackOfPanel(tree, panelId);
  const target: DockNode | null = findNode(tree, targetStackId);
  if (source === null || target === null || !isStackNode(target)) {
    return tree;
  }
  if (source.id === targetStackId) {
    return reorderTab(tree, targetStackId, source.panels.indexOf(panelId), targetIndex);
  }

  const targetPanels: string[] = [...target.panels];
  const index: number = Math.max(0, Math.min(targetIndex, targetPanels.length));
  targetPanels.splice(index, 0, panelId);
  const withTarget: DockNode = replaceNode(tree, targetStackId, {
    ...target,
    panels: targetPanels,
    active: panelId,
  });

  const remaining: readonly string[] = source.panels.filter(
    (id: string): boolean => id !== panelId,
  );
  const active: string | null = source.active === panelId ? (remaining[0] ?? null) : source.active;
  const updatedSource: StackNode = { ...source, panels: remaining, active };
  return pruneStack(replaceNode(withTarget, source.id, updatedSource), updatedSource);
}

/**
 * Replaces the flex-grow weights of a split. The call is ignored when the node does not exist, is
 * not a split, or the new weights do not match the child count.
 * @param tree The root of the tree to transform.
 * @param splitId The identifier of the split whose weights change.
 * @param sizes The new flex-grow weight of each child.
 * @returns Returns the transformed tree.
 */
export function setSizes(tree: DockNode, splitId: string, sizes: readonly number[]): DockNode {
  const target: DockNode | null = findNode(tree, splitId);
  if (target === null || !isSplitNode(target) || target.sizes.length !== sizes.length) {
    return tree;
  }
  return replaceNode(tree, splitId, { ...target, sizes: [...sizes] });
}

/**
 * Builds the seeded default layout: the classic VS arrangement — a toolbox on the left, the
 * document well in the centre, the solution explorer over the agent panel on the right, and the
 * output and error list along the bottom. This is the layout {@link DockState} starts with and
 * resets to.
 * @returns Returns a fresh default layout tree.
 */
export function defaultLayout(): DockNode {
  return mkSplit(
    'col',
    [
      mkSplit(
        'row',
        [
          mkStack('tool', ['toolbox']),
          mkStack('document', ['doc1', 'doc2', 'doc3']),
          mkSplit('col', [mkStack('tool', ['solution']), mkStack('tool', ['agent'])], [1, 1]),
        ],
        [1.1, 4, 1.6],
      ),
      mkStack('tool', ['output', 'errors']),
    ],
    [4, 1.5],
  );
}
