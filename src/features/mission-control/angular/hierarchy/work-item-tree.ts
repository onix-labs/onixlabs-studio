import { ForgeWorkItem } from '@shared/api/forge-types';

/**
 * The levels of the organisation's work-item hierarchy, from the broadest to the narrowest.
 */
export type WorkItemLevel = 'initiative' | 'epic' | 'feature' | 'task';

/**
 * The levels in order, broadest first. A label or issue type naming one of these decides an item's
 * level outright.
 */
export const WORK_ITEM_LEVELS: readonly WorkItemLevel[] = ['initiative', 'epic', 'feature', 'task'];

/**
 * One node of a project's work-item tree.
 */
export interface WorkItemNode {
  /**
   * Gets the work item the node stands for.
   */
  readonly item: ForgeWorkItem;

  /**
   * Gets the item's level.
   */
  readonly level: WorkItemLevel;

  /**
   * Gets the item's open children, in issue-number order — the order an epic's phases are filed in.
   */
  readonly children: readonly WorkItemNode[];

  /**
   * Gets how much of the item is done, from 0 to 1. Derived, never reported: see {@link progressOf}.
   */
  readonly progress: number;
}

/**
 * Resolves an item's level.
 *
 * Its issue type decides when the repository's organisation uses issue types; otherwise a label naming
 * a level does (this repository labels `epic` and `feature`). An item carrying neither is placed by
 * shape: a parent at the top of the tree is an epic, a parent further down a feature, and anything
 * without children a task.
 *
 * @param item The work item.
 * @param depth How far below a root the item sits.
 * @returns Returns the level.
 */
export function levelOf(item: ForgeWorkItem, depth: number): WorkItemLevel {
  const named: readonly string[] = [...(item.type === null ? [] : [item.type]), ...item.labels].map(
    (name: string): string => name.toLowerCase(),
  );
  const level: WorkItemLevel | undefined = WORK_ITEM_LEVELS.find((candidate: WorkItemLevel) =>
    named.includes(candidate),
  );
  if (level !== undefined) {
    return level;
  }
  if (item.children.total === 0) {
    return 'task';
  }
  return depth === 0 ? 'epic' : 'feature';
}

/**
 * Derives how much of an item is done.
 *
 * Only open issues are listed, so an item's closed children are known only as a count — and each of
 * those counts as wholly done. Each open child counts as far as its own progress has got. An open item
 * with no children at all has not been finished, so it is at zero: closing it is what completes it.
 *
 * @param item The work item.
 * @param openChildren The item's open children, already resolved.
 * @returns Returns the progress, from 0 to 1.
 */
export function progressOf(item: ForgeWorkItem, openChildren: readonly WorkItemNode[]): number {
  // The summary counts every child; the listing may hold children the summary has not caught up with
  // yet, so neither is trusted to bound the other.
  const total: number = Math.max(
    item.children.total,
    item.children.completed + openChildren.length,
  );
  if (total === 0) {
    return 0;
  }
  const partial: number = openChildren.reduce(
    (sum: number, child: WorkItemNode): number => sum + child.progress,
    0,
  );
  return Math.min(1, (item.children.completed + partial) / total);
}

/**
 * Builds a project's work-item tree from its flat listing.
 *
 * An item whose parent is not in the listing — a closed parent, or one in another repository — is a
 * root, so nothing open is ever hidden. Roots come most recently updated first, which puts the work in
 * motion at the top; children keep issue-number order. A cycle (which the forge does not allow, but the
 * input is external) cannot loop: an item is placed at most once.
 *
 * @param items The project's open work items.
 * @returns Returns the root nodes.
 */
export function buildWorkItemTree(items: readonly ForgeWorkItem[]): readonly WorkItemNode[] {
  const byNumber: Map<number, ForgeWorkItem> = new Map<number, ForgeWorkItem>(
    items.map((item: ForgeWorkItem): [number, ForgeWorkItem] => [item.number, item]),
  );
  const childrenOf: Map<number, ForgeWorkItem[]> = new Map<number, ForgeWorkItem[]>();
  const roots: ForgeWorkItem[] = [];
  for (const item of byNumber.values()) {
    if (item.parent !== null && item.parent !== item.number && byNumber.has(item.parent)) {
      const siblings: ForgeWorkItem[] = childrenOf.get(item.parent) ?? [];
      siblings.push(item);
      childrenOf.set(item.parent, siblings);
    } else {
      roots.push(item);
    }
  }

  const placed: Set<number> = new Set<number>();
  const build: (item: ForgeWorkItem, depth: number) => WorkItemNode = (
    item: ForgeWorkItem,
    depth: number,
  ): WorkItemNode => {
    placed.add(item.number);
    const children: readonly WorkItemNode[] = (childrenOf.get(item.number) ?? [])
      .filter((child: ForgeWorkItem): boolean => !placed.has(child.number))
      .sort((left: ForgeWorkItem, right: ForgeWorkItem): number => left.number - right.number)
      .map((child: ForgeWorkItem): WorkItemNode => build(child, depth + 1));
    return {
      item,
      level: levelOf(item, depth),
      children,
      progress: progressOf(item, children),
    };
  };

  const byRecency: (left: ForgeWorkItem, right: ForgeWorkItem) => number = (
    left: ForgeWorkItem,
    right: ForgeWorkItem,
  ): number => right.updatedAt.localeCompare(left.updatedAt) || right.number - left.number;
  const tree: WorkItemNode[] = [...roots]
    .sort(byRecency)
    .map((root: ForgeWorkItem): WorkItemNode => build(root, 0));
  // Items caught in a cycle have a parent in the listing, so none of them was a root and nothing
  // reached them. Each cycle surfaces once, from its most recently updated member.
  for (const item of [...byNumber.values()].sort(byRecency)) {
    if (!placed.has(item.number)) {
      tree.push(build(item, 0));
    }
  }
  return tree;
}
