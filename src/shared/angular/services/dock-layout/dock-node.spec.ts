import {
  isSplitNode,
  isStackNode,
  mkSplit,
  mkStack,
  reserveNodeIds,
  SplitNode,
  StackNode,
} from './dock-node';

describe('dock-node', () => {
  it('mkStack_whenGivenPanels_activatesTheFirstPanel', () => {
    const stack: StackNode = mkStack('document', ['doc1', 'doc2', 'doc3']);

    expect(stack.kind).toBe('stack');
    expect(stack.role).toBe('document');
    expect(stack.panels).toEqual(['doc1', 'doc2', 'doc3']);
    expect(stack.active).toBe('doc1');
  });

  it('mkStack_whenGivenAnActivePanel_putsThatOneInFront', () => {
    // Tab ORDER and which tab is OPEN are separate choices: an authored layout may want the second
    // panel showing without moving it to the first tab.
    const stack: StackNode = mkStack('tool', ['files', 'solution'], false, { active: 'solution' });

    expect(stack.panels).toEqual(['files', 'solution']);
    expect(stack.active).toBe('solution');
  });

  it('mkStack_whenTheActivePanelIsNotHeld_fallsBackToTheFirst', () => {
    const stack: StackNode = mkStack('tool', ['files', 'solution'], false, { active: 'missing' });

    expect(stack.active).toBe('files');
  });

  it('mkStack_whenCollapsed_recordsTheStripAndItsEdge_andNeverForADocumentWell', () => {
    const tool: StackNode = mkStack('tool', ['errors'], false, {
      collapsed: true,
      side: 'bottom',
    });
    expect(tool.collapsed).toBe(true);
    expect(tool.side).toBe('bottom');

    // Document wells are never collapsed, so the flags are dropped rather than honoured.
    const well: StackNode = mkStack('document', ['doc1'], true, {
      collapsed: true,
      side: 'bottom',
    });
    expect(well.collapsed).toBeUndefined();
    expect(well.side).toBeUndefined();
  });

  it('mkStack_whenGivenNoPanels_leavesNoActivePanel', () => {
    const stack: StackNode = mkStack('document', []);

    expect(stack.panels).toEqual([]);
    expect(stack.active).toBeNull();
  });

  it('mkStack_whenGivenPanels_copiesTheArrayDefensively', () => {
    const source: string[] = ['toolbox'];
    const stack: StackNode = mkStack('tool', source);

    source.push('mutated');

    expect(stack.panels).toEqual(['toolbox']);
  });

  it('mkStack_whenCalledRepeatedly_mintsUniqueIds', () => {
    const first: StackNode = mkStack('tool', ['a']);
    const second: StackNode = mkStack('tool', ['b']);

    expect(first.id).not.toBe(second.id);
  });

  it('mkSplit_whenGivenNoSizes_defaultsEveryChildToEqualWeight', () => {
    const split: SplitNode = mkSplit('row', [mkStack('tool', ['a']), mkStack('tool', ['b'])]);

    expect(split.kind).toBe('split');
    expect(split.dir).toBe('row');
    expect(split.children).toHaveLength(2);
    expect(split.sizes).toEqual([1, 1]);
  });

  it('mkSplit_whenGivenSizes_usesTheSuppliedWeights', () => {
    const split: SplitNode = mkSplit(
      'col',
      [mkStack('tool', ['a']), mkStack('tool', ['b'])],
      [4, 1.5],
    );

    expect(split.sizes).toEqual([4, 1.5]);
  });

  it('mkSplit_whenGivenSizes_copiesTheArrayDefensively', () => {
    const sizes: number[] = [1, 2];
    const split: SplitNode = mkSplit(
      'row',
      [mkStack('tool', ['a']), mkStack('tool', ['b'])],
      sizes,
    );

    sizes[0] = 99;

    expect(split.sizes).toEqual([1, 2]);
  });

  it('isSplitNode_whenGivenASplit_returnsTrue', () => {
    expect(isSplitNode(mkSplit('row', [mkStack('tool', ['a'])]))).toBe(true);
    expect(isSplitNode(mkStack('tool', ['a']))).toBe(false);
  });

  it('isStackNode_whenGivenAStack_returnsTrue', () => {
    expect(isStackNode(mkStack('tool', ['a']))).toBe(true);
    expect(isStackNode(mkSplit('row', [mkStack('tool', ['a'])]))).toBe(false);
  });

  it('reserveNodeIds_liftsTheSequencePastARestoredIdentifier', () => {
    const restored: StackNode = {
      kind: 'stack',
      id: 'dock-9000',
      role: 'tool',
      panels: ['a'],
      active: 'a',
    };

    reserveNodeIds(restored);

    expect(mkStack('tool', ['b']).id).toBe('dock-9001');
  });

  it('reserveNodeIds_scansSplitChildrenForTheHighestIdentifier', () => {
    const restored: SplitNode = {
      kind: 'split',
      id: 'dock-9100',
      dir: 'row',
      children: [
        { kind: 'stack', id: 'dock-9105', role: 'tool', panels: ['a'], active: 'a' },
        { kind: 'stack', id: 'dock-9102', role: 'document', panels: [], active: null },
      ],
      sizes: [1, 1],
    };

    reserveNodeIds(restored);

    expect(mkStack('tool', ['x']).id).toBe('dock-9106');
  });
});
