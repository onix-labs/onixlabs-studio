import { ForgeWorkItem } from '@shared/api/forge-types';
import { buildWorkItemTree, levelOf, progressOf, WorkItemNode } from './work-item-tree';

/**
 * Builds a work item, open and childless unless told otherwise.
 * @param number The issue number.
 * @param overrides The fields to set.
 * @returns Returns the work item.
 */
function item(number: number, overrides: Partial<ForgeWorkItem> = {}): ForgeWorkItem {
  return {
    number,
    title: `Issue ${number}`,
    url: `https://github.com/o/r/issues/${number}`,
    labels: [],
    type: null,
    assignees: [],
    parent: null,
    children: { total: 0, completed: 0 },
    blockedBy: 0,
    authorTrusted: true,
    updatedAt: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

/**
 * Reads a tree's shape as nested issue numbers, which is what most tests assert.
 * @param nodes The nodes.
 * @returns Returns the shape.
 */
function shape(nodes: readonly WorkItemNode[]): unknown[] {
  return nodes.map((node: WorkItemNode): unknown =>
    node.children.length === 0 ? node.item.number : [node.item.number, shape(node.children)],
  );
}

describe('levelOf', () => {
  it('takesTheIssueTypeFirst', () => {
    expect(levelOf(item(1, { type: 'Epic', labels: ['feature'] }), 3)).toBe('epic');
  });

  it('takesALabelNamingALevel', () => {
    expect(levelOf(item(1, { labels: ['area:agent', 'Feature'] }), 0)).toBe('feature');
    expect(levelOf(item(1, { labels: ['initiative'] }), 2)).toBe('initiative');
  });

  it('ignoresATypeThatNamesNoLevel', () => {
    // A `Bug` type says nothing about where it sits in the hierarchy.
    expect(levelOf(item(1, { type: 'Bug', labels: ['epic'] }), 0)).toBe('epic');
  });

  it('placesAnUnlabelledItemByShape', () => {
    const parent: ForgeWorkItem = item(1, { children: { total: 2, completed: 0 } });

    expect(levelOf(parent, 0)).toBe('epic');
    expect(levelOf(parent, 1)).toBe('feature');
    expect(levelOf(item(2), 0)).toBe('task');
  });
});

describe('progressOf', () => {
  it('isZero_forAnOpenItemWithNoChildren', () => {
    // Closing it is what completes it.
    expect(progressOf(item(1), [])).toBe(0);
  });

  it('countsClosedChildrenAsDone', () => {
    expect(progressOf(item(1, { children: { total: 4, completed: 1 } }), [])).toBe(0.25);
  });

  it('countsOpenChildrenAsFarAsTheyHaveGot', () => {
    const child: WorkItemNode = { item: item(2), level: 'task', children: [], progress: 0.5 };

    // One closed (1) plus one half-done open child (0.5), out of two.
    expect(progressOf(item(1, { children: { total: 2, completed: 1 } }), [child])).toBe(0.75);
  });

  it('neverDividesByASummaryThatHasNotCaughtUp', () => {
    // The listing holds two open children while the summary still says one child in all.
    const child: WorkItemNode = { item: item(2), level: 'task', children: [], progress: 0 };

    expect(progressOf(item(1, { children: { total: 1, completed: 1 } }), [child, child])).toBe(
      1 / 3,
    );
  });
});

describe('buildWorkItemTree', () => {
  it('nestsChildrenUnderTheirParents_recursively', () => {
    const tree: readonly WorkItemNode[] = buildWorkItemTree([
      item(10, { children: { total: 2, completed: 0 } }),
      item(12, { parent: 10, children: { total: 1, completed: 0 } }),
      item(11, { parent: 10 }),
      item(13, { parent: 12 }),
    ]);

    expect(shape(tree)).toEqual([[10, [11, [12, [13]]]]]);
  });

  it('makesAnItemARoot_whenItsParentIsNotListed', () => {
    // A closed parent, or one in another repository: the child stays visible as a root.
    expect(shape(buildWorkItemTree([item(5, { parent: 4 })]))).toEqual([5]);
  });

  it('putsTheMostRecentlyUpdatedRootFirst', () => {
    const tree: readonly WorkItemNode[] = buildWorkItemTree([
      item(1, { updatedAt: '2026-09-01T00:00:00Z' }),
      item(2, { updatedAt: '2026-10-02T00:00:00Z' }),
      item(3, { updatedAt: '2026-09-15T00:00:00Z' }),
    ]);

    expect(shape(tree)).toEqual([2, 3, 1]);
  });

  it('derivesEachLevelAndRollsProgressUp', () => {
    const tree: readonly WorkItemNode[] = buildWorkItemTree([
      item(1, { labels: ['epic'], children: { total: 2, completed: 1 } }),
      item(2, { labels: ['feature'], parent: 1, children: { total: 2, completed: 1 } }),
    ]);

    expect(tree[0].level).toBe('epic');
    expect(tree[0].children[0].level).toBe('feature');
    expect(tree[0].children[0].progress).toBe(0.5);
    // One closed child (1) plus the feature at a half (0.5), out of two.
    expect(tree[0].progress).toBe(0.75);
  });

  it('survivesACycle_placingEveryItemOnce', () => {
    const tree: readonly WorkItemNode[] = buildWorkItemTree([
      item(1, { parent: 2, updatedAt: '2026-10-02T00:00:00Z' }),
      item(2, { parent: 1 }),
      item(3, { parent: 3 }),
    ]);

    expect(shape(tree)).toEqual([3, [1, [2]]]);
  });
});
