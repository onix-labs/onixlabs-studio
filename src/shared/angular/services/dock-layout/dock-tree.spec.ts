import {
  DockNode,
  isSplitNode,
  isStackNode,
  mkSplit,
  mkStack,
  SplitNode,
  StackNode,
} from './dock-node';
import {
  collectPanelIds,
  countStacks,
  defaultLayout,
  dockEdge,
  dockNodeEdge,
  findNode,
  findPrimaryStack,
  findStackOfPanel,
  firstStackOfRole,
  movePanel,
  occupyWell,
  pruneStack,
  removeFromLayout,
  removeNode,
  reorderTab,
  replaceNode,
  setActive,
  setSizes,
  splitStack,
  splitWellBeside,
  tabInto,
} from './dock-tree';

/**
 * Asserts a node is a stack and narrows it, failing the test otherwise.
 * @param node The node to assert.
 * @returns Returns the node typed as a stack.
 */
function asStack(node: DockNode | null): StackNode {
  expect(node).not.toBeNull();
  expect(node && isStackNode(node)).toBe(true);
  return node as StackNode;
}

describe('dock-tree', () => {
  describe('findNode', () => {
    it('findNode_whenNodeExists_returnsIt', () => {
      const leaf: StackNode = mkStack('tool', ['a']);
      const tree: DockNode = mkSplit('row', [leaf, mkStack('document', ['doc'])]);

      expect(findNode(tree, leaf.id)).toBe(leaf);
    });

    it('findNode_whenNodeMissing_returnsNull', () => {
      const tree: DockNode = mkSplit('row', [mkStack('tool', ['a'])]);

      expect(findNode(tree, 'absent')).toBeNull();
    });
  });

  describe('findStackOfPanel', () => {
    it('findStackOfPanel_whenPanelPresent_returnsItsStack', () => {
      const docs: StackNode = mkStack('document', ['doc1', 'doc2']);
      const tree: DockNode = mkSplit('row', [mkStack('tool', ['tool1']), docs]);

      expect(findStackOfPanel(tree, 'doc2')).toBe(docs);
    });

    it('findStackOfPanel_whenPanelAbsent_returnsNull', () => {
      const tree: DockNode = mkStack('tool', ['a']);

      expect(findStackOfPanel(tree, 'missing')).toBeNull();
    });
  });

  describe('countStacks', () => {
    it('countStacks_whenMixedRoles_countsOnlyTheRequestedRole', () => {
      const tree: DockNode = mkSplit('row', [
        mkStack('tool', ['t1']),
        mkSplit('col', [mkStack('document', ['d1']), mkStack('tool', ['t2'])]),
      ]);

      expect(countStacks(tree, 'tool')).toBe(2);
      expect(countStacks(tree, 'document')).toBe(1);
    });
  });

  describe('firstStackOfRole', () => {
    it('firstStackOfRole_whenRolePresent_returnsTheFirstInDepthFirstOrder', () => {
      const firstTool: StackNode = mkStack('tool', ['t1']);
      const tree: DockNode = mkSplit('row', [firstTool, mkStack('document', ['d1'])]);

      expect(firstStackOfRole(tree, 'tool')).toBe(firstTool);
      expect(firstStackOfRole(tree, 'document')?.panels).toEqual(['d1']);
    });

    it('firstStackOfRole_whenRoleAbsent_returnsNull', () => {
      expect(firstStackOfRole(mkStack('tool', ['a']), 'document')).toBeNull();
    });
  });

  describe('collectPanelIds', () => {
    it('collectPanelIds_whenNested_returnsEveryPanelId', () => {
      const tree: DockNode = mkSplit('row', [
        mkStack('tool', ['a']),
        mkSplit('col', [mkStack('document', ['b', 'c']), mkStack('tool', ['d'])]),
      ]);

      expect(collectPanelIds(tree).sort()).toEqual(['a', 'b', 'c', 'd']);
    });
  });

  describe('replaceNode', () => {
    it('replaceNode_whenIdMatches_substitutesTheNode', () => {
      const target: StackNode = mkStack('tool', ['a']);
      const tree: DockNode = mkSplit('row', [target, mkStack('tool', ['b'])]);
      const replacement: StackNode = mkStack('tool', ['a', 'c']);

      const result: DockNode = replaceNode(tree, target.id, replacement);
      const split: DockNode = result;

      expect(isSplitNode(split) && split.children[0]).toBe(replacement);
    });

    it('replaceNode_whenIdAbsent_returnsTheSameReference', () => {
      const tree: DockNode = mkSplit('row', [mkStack('tool', ['a'])]);

      expect(replaceNode(tree, 'absent', mkStack('tool', ['x']))).toBe(tree);
    });
  });

  describe('removeNode', () => {
    it('removeNode_whenRemovingRoot_returnsNull', () => {
      const tree: DockNode = mkStack('tool', ['a']);

      expect(removeNode(tree, tree.id)).toBeNull();
    });

    it('removeNode_whenSplitLeftWithOneChild_promotesThatChild', () => {
      const survivor: StackNode = mkStack('document', ['doc']);
      const doomed: StackNode = mkStack('tool', ['tool']);
      const tree: DockNode = mkSplit('row', [survivor, doomed]);

      const result: DockNode | null = removeNode(tree, doomed.id);

      expect(result).toBe(survivor);
    });

    it('removeNode_whenNestedSplitEmpties_collapsesRecursivelyTowardsTheRoot', () => {
      const keep: StackNode = mkStack('document', ['doc']);
      const inner: StackNode = mkStack('tool', ['t1']);
      const tree: DockNode = mkSplit('row', [keep, mkSplit('col', [inner])]);

      const result: DockNode | null = removeNode(tree, inner.id);

      // The inner split empties and collapses, leaving the outer split with one child, which is
      // itself promoted, so only the document stack survives.
      expect(result).toBe(keep);
    });

    it('removeNode_whenSplitKeepsTwoChildren_dropsOnlyTheTargetAndItsSize', () => {
      const a: StackNode = mkStack('tool', ['a']);
      const b: StackNode = mkStack('tool', ['b']);
      const c: StackNode = mkStack('tool', ['c']);
      const tree: DockNode = mkSplit('row', [a, b, c], [1, 2, 3]);

      const result: DockNode | null = removeNode(tree, b.id);

      expect(result).not.toBeNull();
      if (result !== null && isSplitNode(result)) {
        expect(result.children).toEqual([a, c]);
        expect(result.sizes).toEqual([1, 3]);
      }
    });

    it('removeNode_whenIdAbsent_returnsTheSameReference', () => {
      const tree: DockNode = mkSplit('row', [mkStack('tool', ['a']), mkStack('tool', ['b'])]);

      expect(removeNode(tree, 'absent')).toBe(tree);
    });
  });

  describe('pruneStack', () => {
    it('pruneStack_whenStackStillHasPanels_leavesItInPlace', () => {
      const stack: StackNode = mkStack('tool', ['a']);
      const tree: DockNode = mkSplit('row', [stack, mkStack('document', ['doc'])]);

      expect(pruneStack(tree, stack)).toBe(tree);
    });

    it('pruneStack_whenEmptyToolStack_removesIt', () => {
      const empty: StackNode = mkStack('tool', []);
      const docs: StackNode = mkStack('document', ['doc']);
      const tree: DockNode = mkSplit('row', [empty, docs]);

      expect(pruneStack(tree, empty)).toBe(docs);
    });

    it('pruneStack_whenLastEmptyDocumentWell_keepsItAsAHomeForDocuments', () => {
      const onlyWell: StackNode = mkStack('document', []);
      const tree: DockNode = mkSplit('row', [mkStack('tool', ['t']), onlyWell]);

      expect(pruneStack(tree, onlyWell)).toBe(tree);
    });

    it('pruneStack_whenNotTheLastDocumentWell_removesTheEmptyWell', () => {
      const emptyWell: StackNode = mkStack('document', []);
      const otherWell: StackNode = mkStack('document', ['doc']);
      const tree: DockNode = mkSplit('row', [emptyWell, otherWell]);

      expect(pruneStack(tree, emptyWell)).toBe(otherWell);
    });

    it('pruneStack_whenPrimaryToolCentreEmpties_revertsItToAnEmptyWell', () => {
      // The centre slot a tool had occupied: closing the last tool must not prune it away — it
      // reverts to an empty document well so the centre keeps a documents-home.
      const centre: StackNode = mkStack('tool', [], true);
      const tree: DockNode = mkSplit('row', [mkStack('tool', ['files']), centre]);

      const reverted: StackNode = asStack(findNode(pruneStack(tree, centre), centre.id));

      expect(reverted.role).toBe('document');
      expect(reverted.panels).toEqual([]);
      expect(reverted.primary).toBe(true);
    });

    it('pruneStack_whenPrimaryDocumentWellEmpties_keepsItUnchanged', () => {
      const centre: StackNode = mkStack('document', [], true);
      const tree: DockNode = mkSplit('row', [mkStack('tool', ['files']), centre]);

      expect(pruneStack(tree, centre)).toBe(tree);
    });

    it('pruneStack_whenPrimaryEmptiesButAnotherWellSurvives_prunesItAndHandsTheAnchorOver', () => {
      // The centre anchor empties while a second document well is open elsewhere: the empty centre
      // prunes (its sibling fills) and the anchor passes to the survivor, so one primary slot remains.
      const centre: StackNode = mkStack('document', [], true);
      const survivor: StackNode = mkStack('document', ['doc']);
      const tree: DockNode = mkSplit('row', [centre, survivor]);

      const result: DockNode = pruneStack(tree, centre);

      expect(findNode(result, centre.id)).toBeNull();
      expect(asStack(findStackOfPanel(result, 'doc')).primary).toBe(true);
    });

    it('pruneStack_whenTheOnlyWellEmptiesButAPrimaryToolHoldsTheCentre_prunesTheWell', () => {
      // A document well split beside a tool-occupied centre: closing its last document leaves an empty
      // well that would once have been kept as "the last well" — but the primary tool is a home, so it
      // prunes and the tool refills the space.
      const agent: StackNode = mkStack('tool', ['agent'], true);
      const well: StackNode = mkStack('document', []);
      const tree: DockNode = mkSplit('row', [well, agent]);

      const result: DockNode = pruneStack(tree, well);

      expect(findStackOfPanel(result, 'agent')).not.toBeNull();
      expect(firstStackOfRole(result, 'document')).toBeNull();
    });
  });

  describe('findPrimaryStack', () => {
    it('findPrimaryStack_whenOneIsFlagged_returnsIt', () => {
      const centre: StackNode = mkStack('document', [], true);
      const tree: DockNode = mkSplit('row', [mkStack('tool', ['files']), centre]);

      expect(findPrimaryStack(tree)).toBe(centre);
    });

    it('findPrimaryStack_whenNoneIsFlagged_returnsNull', () => {
      const tree: DockNode = mkSplit('row', [mkStack('tool', ['files']), mkStack('document', [])]);

      expect(findPrimaryStack(tree)).toBeNull();
    });
  });

  describe('occupyWell', () => {
    it('occupyWell_whenEmptyPrimaryWell_flipsItToAToolStackInPlace', () => {
      const centre: StackNode = mkStack('document', [], true);
      const tree: DockNode = mkSplit('row', [mkStack('tool', ['files']), centre]);

      const occupied: StackNode = asStack(findNode(occupyWell(tree, centre.id, 'agent'), centre.id));

      expect(occupied.id).toBe(centre.id);
      expect(occupied.role).toBe('tool');
      expect(occupied.panels).toEqual(['agent']);
      expect(occupied.active).toBe('agent');
      expect(occupied.primary).toBe(true);
    });

    it('occupyWell_whenWellIsNotEmpty_returnsTheSameReference', () => {
      const centre: StackNode = mkStack('document', ['doc'], true);
      const tree: DockNode = mkSplit('row', [mkStack('tool', ['files']), centre]);

      expect(occupyWell(tree, centre.id, 'agent')).toBe(tree);
    });

    it('occupyWell_whenTargetIsNotADocumentStack_returnsTheSameReference', () => {
      const toolStack: StackNode = mkStack('tool', []);
      const tree: DockNode = mkSplit('row', [toolStack, mkStack('document', [], true)]);

      expect(occupyWell(tree, toolStack.id, 'agent')).toBe(tree);
    });
  });

  describe('splitWellBeside', () => {
    it('splitWellBeside_whenCentreIsToolOccupied_splitsAWellOnTheLeftAtFiftyFifty', () => {
      const centre: StackNode = mkStack('tool', ['agent'], true);
      const tree: SplitNode = mkSplit('row', [mkStack('tool', ['files']), centre]);

      const result: DockNode = splitWellBeside(tree, centre.id, 'doc');

      // The occupied centre is replaced in the outer row by a fresh row split holding [well, tool].
      expect(isSplitNode(result)).toBe(true);
      const inner: DockNode = (result as SplitNode).children[1];
      expect(isSplitNode(inner)).toBe(true);
      expect((inner as SplitNode).dir).toBe('row');
      expect((inner as SplitNode).sizes).toEqual([1, 1]);

      // The new well leads (left) as an ordinary well; the tool keeps its id and the centre anchor,
      // so closing the document later collapses the split back onto the tool.
      const well: StackNode = asStack(findStackOfPanel(result, 'doc'));
      const tool: StackNode = asStack(findStackOfPanel(result, 'agent'));
      expect((inner as SplitNode).children[0]).toBe(well);
      expect((inner as SplitNode).children[1]).toBe(tool);
      expect(well.role).toBe('document');
      expect(well.primary).toBeFalsy();
      expect(tool.id).toBe(centre.id);
      expect(tool.role).toBe('tool');
      expect(tool.primary).toBe(true);
    });

    it('splitWellBeside_thenClosingTheDocument_collapsesBackOntoTheTool', () => {
      // The user's scenario: agent fills the centre, a document splits it 50/50, then the document is
      // closed — the empty well prunes and the agent refills the whole centre.
      const centre: StackNode = mkStack('tool', ['agent'], true);
      const tree: DockNode = mkSplit('row', [mkStack('tool', ['files']), centre]);

      const split: DockNode = splitWellBeside(tree, centre.id, 'doc');
      const refilled: DockNode = removeFromLayout(split, 'doc');

      // The row split is gone: the agent is a lone stack again, still the primary centre, and no
      // document well lingers.
      const agent: StackNode = asStack(findStackOfPanel(refilled, 'agent'));
      expect(agent.id).toBe(centre.id);
      expect(agent.primary).toBe(true);
      expect(findStackOfPanel(refilled, 'doc')).toBeNull();
      expect(firstStackOfRole(refilled, 'document')).toBeNull();
    });
  });

  describe('tabInto', () => {
    it('tabInto_whenStackExists_appendsTheActivePanel', () => {
      const stack: StackNode = mkStack('tool', ['a']);
      const tree: DockNode = mkSplit('row', [stack, mkStack('document', ['doc'])]);

      const result: DockNode = tabInto(tree, stack.id, 'b');
      const updated: StackNode = asStack(findNode(result, stack.id));

      expect(updated.panels).toEqual(['a', 'b']);
      expect(updated.active).toBe('b');
    });

    it('tabInto_whenStackMissing_returnsTheSameReference', () => {
      const tree: DockNode = mkStack('tool', ['a']);

      expect(tabInto(tree, 'absent', 'b')).toBe(tree);
    });
  });

  describe('setActive', () => {
    it('setActive_whenPanelInStack_activatesIt', () => {
      const stack: StackNode = mkStack('tool', ['a', 'b']);
      const tree: DockNode = mkSplit('row', [stack, mkStack('document', ['doc'])]);

      const result: DockNode = setActive(tree, stack.id, 'b');

      expect(asStack(findNode(result, stack.id)).active).toBe('b');
    });

    it('setActive_whenPanelNotInStack_returnsTheSameReference', () => {
      const stack: StackNode = mkStack('tool', ['a']);
      const tree: DockNode = mkSplit('row', [stack, mkStack('document', ['doc'])]);

      expect(setActive(tree, stack.id, 'missing')).toBe(tree);
    });
  });

  describe('splitStack', () => {
    it('splitStack_whenParentRunsAlongTheSameAxis_insertsASibling', () => {
      const left: StackNode = mkStack('tool', ['a']);
      const right: StackNode = mkStack('tool', ['b']);
      const tree: DockNode = mkSplit('row', [left, right], [1, 1]);

      const result: DockNode = splitStack(tree, left.id, 'c', 'right', 'tool');

      expect(isSplitNode(result)).toBe(true);
      if (isSplitNode(result)) {
        expect(result.children).toHaveLength(3);
        expect(asStack(result.children[1]).panels).toEqual(['c']);
      }
    });

    it('splitStack_whenParentRunsAcrossTheAxis_wrapsTheTargetInANewSplit', () => {
      const top: StackNode = mkStack('tool', ['a']);
      const bottom: StackNode = mkStack('tool', ['b']);
      const tree: DockNode = mkSplit('col', [top, bottom]);

      const result: DockNode = splitStack(tree, top.id, 'c', 'right', 'tool');

      expect(isSplitNode(result) && result.dir).toBe('col');
      if (isSplitNode(result)) {
        const wrapped: DockNode = result.children[0];
        expect(isSplitNode(wrapped) && wrapped.dir).toBe('row');
      }
    });

    it('splitStack_whenTargetIsTheRoot_wrapsTheWholeTree', () => {
      const root: StackNode = mkStack('document', ['doc']);

      const result: DockNode = splitStack(root, root.id, 't', 'left', 'tool');

      expect(isSplitNode(result) && result.dir).toBe('row');
      if (isSplitNode(result)) {
        expect(asStack(result.children[0]).panels).toEqual(['t']);
        expect(result.children[1]).toBe(root);
      }
    });

    it('splitStack_whenTargetMissing_returnsTheSameReference', () => {
      const tree: DockNode = mkStack('document', ['doc']);

      expect(splitStack(tree, 'absent', 'x', 'left', 'tool')).toBe(tree);
    });
  });

  describe('dockNodeEdge / dockEdge', () => {
    it('dockNodeEdge_whenRootRunsAlongTheEdgeAxis_joinsAsAnEdgeSibling', () => {
      const tree: DockNode = mkSplit('row', [mkStack('tool', ['a']), mkStack('tool', ['b'])]);

      const result: DockNode = dockNodeEdge(tree, mkStack('tool', ['edge']), 'left');

      expect(isSplitNode(result) && result.children).toHaveLength(3);
      if (isSplitNode(result)) {
        expect(asStack(result.children[0]).panels).toEqual(['edge']);
      }
    });

    it('dockNodeEdge_whenRootRunsAcrossTheEdgeAxis_wrapsTheWholeTree', () => {
      const tree: DockNode = mkStack('document', ['doc']);

      const result: DockNode = dockNodeEdge(tree, mkStack('tool', ['edge']), 'bottom');

      expect(isSplitNode(result) && result.dir).toBe('col');
      if (isSplitNode(result)) {
        expect(result.children[0]).toBe(tree);
        expect(asStack(result.children[1]).panels).toEqual(['edge']);
      }
    });

    it('dockEdge_whenCalled_docksThePanelAsANewToolStack', () => {
      const tree: DockNode = mkStack('document', ['doc']);

      const result: DockNode = dockEdge(tree, 'tool', 'right');

      if (isSplitNode(result)) {
        expect(asStack(result.children[1]).role).toBe('tool');
        expect(asStack(result.children[1]).panels).toEqual(['tool']);
      }
    });
  });

  describe('removeFromLayout', () => {
    it('removeFromLayout_whenPanelSharesAStack_keepsTheStackAndRetargetsActive', () => {
      const stack: StackNode = mkStack('tool', ['a', 'b']);
      const tree: DockNode = mkSplit('row', [stack, mkStack('document', ['doc'])]);

      const result: DockNode = removeFromLayout(tree, 'a');
      const updated: StackNode = asStack(findNode(result, stack.id));

      expect(updated.panels).toEqual(['b']);
      expect(updated.active).toBe('b');
    });

    it('removeFromLayout_whenLastPanelInToolStack_prunesTheStack', () => {
      const tool: StackNode = mkStack('tool', ['only']);
      const docs: StackNode = mkStack('document', ['doc']);
      const tree: DockNode = mkSplit('row', [tool, docs]);

      const result: DockNode = removeFromLayout(tree, 'only');

      expect(result).toBe(docs);
    });

    it('removeFromLayout_whenPanelAbsent_returnsTheSameReference', () => {
      const tree: DockNode = mkStack('tool', ['a']);

      expect(removeFromLayout(tree, 'missing')).toBe(tree);
    });
  });

  describe('reorderTab', () => {
    it('reorderTab_whenIndicesValid_movesThePanel', () => {
      const stack: StackNode = mkStack('tool', ['a', 'b', 'c']);
      const tree: DockNode = mkSplit('row', [stack, mkStack('document', ['doc'])]);

      const result: DockNode = reorderTab(tree, stack.id, 0, 2);

      expect(asStack(findNode(result, stack.id)).panels).toEqual(['b', 'c', 'a']);
    });

    it('reorderTab_whenIndicesOutOfRange_returnsTheSameReference', () => {
      const tree: DockNode = mkStack('tool', ['a', 'b']);

      expect(reorderTab(tree, tree.id, 0, 5)).toBe(tree);
    });
  });

  describe('movePanel', () => {
    it('movePanel_whenMovingBetweenStacks_insertsAtIndexAndPrunesEmptySource', () => {
      const source: StackNode = mkStack('tool', ['only']);
      const target: StackNode = mkStack('tool', ['a', 'b']);
      const tree: DockNode = mkSplit('row', [source, target]);

      const result: DockNode = movePanel(tree, 'only', target.id, 1);

      const moved: StackNode = asStack(findStackOfPanel(result, 'only'));
      expect(moved.id).toBe(target.id);
      expect(moved.panels).toEqual(['a', 'only', 'b']);
      expect(moved.active).toBe('only');
    });

    it('movePanel_whenMovingWithinTheSameStack_reorders', () => {
      const stack: StackNode = mkStack('tool', ['a', 'b', 'c']);
      const tree: DockNode = mkSplit('row', [stack, mkStack('document', ['doc'])]);

      const result: DockNode = movePanel(tree, 'a', stack.id, 2);

      expect(asStack(findNode(result, stack.id)).panels).toEqual(['b', 'c', 'a']);
    });

    it('movePanel_whenMovingFromAMultiPanelStack_keepsTheSource', () => {
      const source: StackNode = mkStack('tool', ['a', 'b']);
      const target: StackNode = mkStack('tool', ['c']);
      const tree: DockNode = mkSplit('row', [source, target]);

      const result: DockNode = movePanel(tree, 'a', target.id, 0);

      expect(asStack(findNode(result, source.id)).panels).toEqual(['b']);
      expect(asStack(findNode(result, target.id)).panels).toEqual(['a', 'c']);
    });

    it('movePanel_whenPanelAbsent_returnsTheSameReference', () => {
      const tree: DockNode = mkStack('tool', ['a']);

      expect(movePanel(tree, 'missing', tree.id, 0)).toBe(tree);
    });
  });

  describe('setSizes', () => {
    it('setSizes_whenWeightsMatchChildCount_replacesThem', () => {
      const tree: DockNode = mkSplit(
        'row',
        [mkStack('tool', ['a']), mkStack('tool', ['b'])],
        [1, 1],
      );

      const result: DockNode = setSizes(tree, tree.id, [3, 1]);

      expect(isSplitNode(result) && result.sizes).toEqual([3, 1]);
    });

    it('setSizes_whenWeightCountMismatches_returnsTheSameReference', () => {
      const tree: DockNode = mkSplit('row', [mkStack('tool', ['a']), mkStack('tool', ['b'])]);

      expect(setSizes(tree, tree.id, [1, 1, 1])).toBe(tree);
    });

    it('setSizes_whenTargetIsAStack_returnsTheSameReference', () => {
      const tree: DockNode = mkStack('tool', ['a']);

      expect(setSizes(tree, tree.id, [1])).toBe(tree);
    });
  });

  describe('defaultLayout', () => {
    it('defaultLayout_whenBuilt_containsAnEmptyDocumentWellAndToolStacks', () => {
      const tree: DockNode = defaultLayout();

      expect(isSplitNode(tree)).toBe(true);
      expect(findStackOfPanel(tree, 'files')).not.toBeNull();
      expect(firstStackOfRole(tree, 'document')?.panels).toEqual([]);
      expect(countStacks(tree, 'document')).toBe(1);
    });

    it('defaultLayout_whenBuiltTwice_mintsFreshNodeIds', () => {
      expect(defaultLayout().id).not.toBe(defaultLayout().id);
    });
  });
});
