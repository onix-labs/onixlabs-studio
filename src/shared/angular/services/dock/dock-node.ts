/**
 * Specifies the orientation in which a {@link SplitNode} lays out its children: `row` places them
 * side by side along the horizontal axis, `col` stacks them along the vertical axis.
 */
export type SplitDirection = 'row' | 'col';

/**
 * Specifies the role a {@link StackNode} plays, which governs docking legality. Tool stacks may
 * dock to edges and beside or into any stack; document stacks form the editor wells and only ever
 * hold documents.
 */
export type StackRole = 'tool' | 'document';

/**
 * Specifies the side of a stack or the application edge a panel can dock against. `left` and
 * `right` produce a horizontal (`row`) split; `top` and `bottom` produce a vertical (`col`) split.
 */
export type DockSide = 'left' | 'right' | 'top' | 'bottom';

/**
 * Defines a split node: a row or column of child nodes separated by splitters. Splits are the
 * branches of the layout tree and never hold panels directly.
 */
export interface SplitNode {
  /**
   * Gets the discriminant identifying this node as a split.
   */
  readonly kind: 'split';

  /**
   * Gets the unique, stable identifier of the node, used as the `track` key when rendering.
   */
  readonly id: string;

  /**
   * Gets the orientation in which the children are laid out.
   */
  readonly dir: SplitDirection;

  /**
   * Gets the ordered child nodes of the split.
   */
  readonly children: readonly DockNode[];

  /**
   * Gets the flex-grow weight of each child, positionally aligned with {@link children}. A child's
   * share of the split is its weight divided by the sum of all weights.
   */
  readonly sizes: readonly number[];
}

/**
 * Defines a stack node: a tabbed group of panels. Stacks are the leaves of the layout tree and are
 * the only nodes that hold panels.
 */
export interface StackNode {
  /**
   * Gets the discriminant identifying this node as a stack.
   */
  readonly kind: 'stack';

  /**
   * Gets the unique, stable identifier of the node, used as the `track` key when rendering.
   */
  readonly id: string;

  /**
   * Gets the role of the stack, which governs which panels may dock into it.
   */
  readonly role: StackRole;

  /**
   * Gets the ordered identifiers of the panels held by the stack.
   */
  readonly panels: readonly string[];

  /**
   * Gets the identifier of the active (visible) panel, or `null` when the stack is empty.
   */
  readonly active: string | null;

  /**
   * Gets whether the stack is collapsed to a thin strip in its slot. A collapsed tool stack keeps
   * its place and weight in the tree (so it restores exactly), rendering only its tabs until it is
   * expanded again. Document wells are never collapsed.
   */
  readonly collapsed?: boolean;
}

/**
 * Defines a node in the dock layout tree: either a {@link SplitNode} branch or a {@link StackNode}
 * leaf.
 */
export type DockNode = SplitNode | StackNode;

/**
 * Holds the running counter used to mint unique node identifiers.
 */
let sequence: number = 0;

/**
 * Mints the next unique, stable node identifier.
 * @returns Returns a node identifier of the form `dock-{n}`, unique within the running process.
 */
function nextNodeId(): string {
  sequence += 1;
  return `dock-${sequence}`;
}

/**
 * Creates a stack node with a fresh identifier, activating its first panel.
 * @param role The role of the stack, which governs docking legality.
 * @param panels The ordered identifiers of the panels the stack should hold.
 * @returns Returns a new {@link StackNode} whose active panel is the first supplied panel, or
 * `null` when no panels are supplied.
 */
export function mkStack(role: StackRole, panels: readonly string[]): StackNode {
  return { kind: 'stack', id: nextNodeId(), role, panels: [...panels], active: panels[0] ?? null };
}

/**
 * Creates a split node with a fresh identifier.
 * @param dir The orientation in which to lay out the children.
 * @param children The ordered child nodes of the split.
 * @param sizes The flex-grow weight of each child; when omitted every child is given an equal
 * weight of one.
 * @returns Returns a new {@link SplitNode}.
 */
export function mkSplit(
  dir: SplitDirection,
  children: readonly DockNode[],
  sizes?: readonly number[],
): SplitNode {
  return {
    kind: 'split',
    id: nextNodeId(),
    dir,
    children: [...children],
    sizes: sizes !== undefined ? [...sizes] : children.map((): number => 1),
  };
}

/**
 * Determines whether the given node is a {@link SplitNode}.
 * @param node The node to test.
 * @returns Returns `true` when the node is a split; otherwise, `false`.
 */
export function isSplitNode(node: DockNode): node is SplitNode {
  return node.kind === 'split';
}

/**
 * Determines whether the given node is a {@link StackNode}.
 * @param node The node to test.
 * @returns Returns `true` when the node is a stack; otherwise, `false`.
 */
export function isStackNode(node: DockNode): node is StackNode {
  return node.kind === 'stack';
}
