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
  carryIntoWell,
  collectPanelIds,
  countStacks,
  defaultLayout,
  dockEdge,
  dockNodeEdge,
  dockStackEdge,
  findDocumentWell,
  findNode,
  findPrimaryStack,
  findStackOfPanel,
  firstStackOfRole,
  movePanel,
  occupyWell,
  occupyWellWithStack,
  pruneStack,
  removeFromLayout,
  removeNode,
  reorderTab,
  replaceNode,
  rightHandToolStack,
  seatDocuments,
  setActive,
  setCollapsed,
  setSizes,
  splitStack,
  splitStackBeside,
  splitWellBeside,
  tabInto,
  tabStackInto,
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

  describe('rightHandToolStack', () => {
    it('isTheToolStackThatIsTheRootRowsLastColumn', () => {
      // The Default and Version Control layouts' shape: the Agent alone down the right.
      const agent: StackNode = mkStack('tool', ['agent']);
      const tree: DockNode = mkSplit('row', [
        mkStack('tool', ['files']),
        mkSplit('col', [mkStack('document', [], true), mkStack('tool', ['errors'])]),
        agent,
      ]);

      expect(rightHandToolStack(tree)).toBe(agent);
    });

    it('isTheAgent_whenABottomStripRunsUnderBothTheWellAndIt', () => {
      // Matthew's layout: the Error List and References beneath the well AND the Agent, so the root
      // row's last column is a split. The Agent is still the right-hand group, and Find & Replace
      // joins it rather than docking a new group on the right edge.
      const agent: StackNode = mkStack('tool', ['agent']);
      const tree: DockNode = mkSplit('row', [
        mkStack('tool', ['files']),
        mkSplit('col', [
          mkSplit('row', [mkStack('document', [], true), agent]),
          mkStack('tool', ['errors', 'references']),
        ]),
      ]);

      expect(rightHandToolStack(tree)).toBe(agent);
    });

    it('isNull_whenTheRightMostColumnHoldsOnlyAWellAndAFullWidthStrip', () => {
      // A strip running the whole width under the well is not a right-hand group.
      const tree: DockNode = mkSplit('row', [
        mkStack('tool', ['files']),
        mkSplit('col', [mkStack('document', [], true), mkStack('tool', ['errors'])]),
      ]);

      expect(rightHandToolStack(tree)).toBeNull();
    });

    it('isNull_whenTheLastColumnIsASplit', () => {
      // The Agentic Engineering layout's shape: the Agent in the centre over a bottom strip.
      const tree: DockNode = mkSplit('row', [
        mkStack('tool', ['files']),
        mkSplit('col', [mkStack('tool', ['agent'], true), mkStack('tool', ['errors'])]),
      ]);

      expect(rightHandToolStack(tree)).toBeNull();
    });

    it('isNull_whenTheLastColumnIsADocumentWellOrTheRootIsNotARow', () => {
      expect(
        rightHandToolStack(
          mkSplit('row', [mkStack('tool', ['files']), mkStack('document', [], true)]),
        ),
      ).toBeNull();
      expect(
        rightHandToolStack(mkSplit('col', [mkStack('tool', ['a']), mkStack('tool', ['b'])])),
      ).toBeNull();
      expect(rightHandToolStack(mkStack('tool', ['a']))).toBeNull();
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

    it('pruneStack_whenTheOnlyWellEmptiesButThePrimaryToolIsCollapsed_keepsTheWell', () => {
      // Same shape as above, except the agent has been auto-hidden to a gutter. A strip cannot fill
      // the space the well would give up, so pruning here would leave the centre holding nothing but
      // two thin strips — the well is kept instead, and the gutter stays put beside it.
      const agent: StackNode = { ...mkStack('tool', ['agent'], true), collapsed: true };
      const well: StackNode = mkStack('document', []);
      const tree: DockNode = mkSplit('row', [well, agent]);

      expect(pruneStack(tree, well)).toBe(tree);
    });

    it('pruneStack_whenACollapsedPrimaryHoldsTheCentreButAnotherWellIsOpen_stillPrunes', () => {
      // The collapsed primary is discounted only as a last resort home; a real well elsewhere is
      // still a home, so the empty well prunes as it always did.
      const agent: StackNode = { ...mkStack('tool', ['agent'], true), collapsed: true };
      const empty: StackNode = mkStack('document', []);
      const open: StackNode = mkStack('document', ['doc']);
      const tree: DockNode = mkSplit('row', [empty, open, agent]);

      const result: DockNode = pruneStack(tree, empty);

      expect(findNode(result, empty.id)).toBeNull();
      expect(findStackOfPanel(result, 'doc')).not.toBeNull();
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

      const occupied: StackNode = asStack(
        findNode(occupyWell(tree, centre.id, 'agent'), centre.id),
      );

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

    it('splitWellBeside_whenTheToolIsCollapsedFirst_keepsTheWellAndTheGuttersEdge', () => {
      // The reported bug, end to end: the agent fills the centre, a document splits it 50/50, the
      // agent is auto-hidden to the right-hand gutter, then the document is closed. The well used to
      // prune, promoting the gutter into the column below and flipping it to a strip along the top.
      // Now the empty well stays, the split survives, and the gutter keeps its remembered edge.
      const centre: StackNode = mkStack('tool', ['agent'], true);
      const tree: DockNode = mkSplit('row', [mkStack('tool', ['files']), centre]);

      const split: DockNode = splitWellBeside(tree, centre.id, 'doc');
      const hidden: DockNode = setCollapsed(split, centre.id, true, 'right');
      const closed: DockNode = removeFromLayout(hidden, 'doc');

      const agent: StackNode = asStack(findStackOfPanel(closed, 'agent'));
      const well: StackNode = asStack(firstStackOfRole(closed, 'document'));
      expect(agent.collapsed).toBe(true);
      expect(agent.side).toBe('right');
      expect(well.panels).toEqual([]);
      // The well and the gutter are still siblings in the same row, so the centre keeps its space.
      const inner: DockNode = (closed as SplitNode).children[1];
      expect(isSplitNode(inner)).toBe(true);
      expect((inner as SplitNode).dir).toBe('row');
      expect((inner as SplitNode).children.map((child: DockNode): string => child.id)).toEqual([
        well.id,
        agent.id,
      ]);
    });

    it('splitWellBeside_vertically_putsTheWellAboveTheTool', () => {
      const centre: StackNode = mkStack('tool', ['agent'], true);
      const tree: DockNode = mkSplit('row', [mkStack('tool', ['files']), centre]);

      const result: DockNode = splitWellBeside(tree, centre.id, 'doc', 'col');

      const inner: SplitNode = (result as SplitNode).children[1] as SplitNode;
      expect(inner.dir).toBe('col');
      expect(inner.sizes).toEqual([1, 1]);
      expect(inner.children[0]).toBe(asStack(findStackOfPanel(result, 'doc')));
      expect(inner.children[1].id).toBe(centre.id);
      // Closing the document lets the tool refill the centre, as beside does.
      const refilled: DockNode = removeFromLayout(result, 'doc');
      expect(firstStackOfRole(refilled, 'document')).toBeNull();
      expect(asStack(findStackOfPanel(refilled, 'agent')).collapsed).toBeFalsy();
    });

    it('splitWellBeside_collapsing_givesTheWellTheSpace_andTheToolItBackWhenTheLastDocumentCloses', () => {
      const centre: StackNode = mkStack('tool', ['agent'], true);
      const tree: DockNode = mkSplit('row', [mkStack('tool', ['files']), centre]);

      const result: DockNode = splitWellBeside(tree, centre.id, 'doc', 'collapse');

      // The tool collapses to a strip on the right of the well, remembering it made way for it.
      const agent: StackNode = asStack(findStackOfPanel(result, 'agent'));
      expect(agent).toMatchObject({ collapsed: true, side: 'right', yielded: true, primary: true });
      const inner: SplitNode = (result as SplitNode).children[1] as SplitNode;
      expect(inner.dir).toBe('row');
      expect(inner.children.map((child: DockNode): string => child.id)).toEqual([
        asStack(findStackOfPanel(result, 'doc')).id,
        centre.id,
      ]);

      // A second document joins the well; closing only one keeps the tool collapsed.
      const two: DockNode = tabInto(result, asStack(findStackOfPanel(result, 'doc')).id, 'doc2');
      expect(asStack(findStackOfPanel(removeFromLayout(two, 'doc'), 'agent')).collapsed).toBe(true);

      // The last document closing expands the tool back into the whole centre.
      const refilled: DockNode = removeFromLayout(removeFromLayout(two, 'doc'), 'doc2');
      const back: StackNode = asStack(findStackOfPanel(refilled, 'agent'));
      expect(back.collapsed).toBe(false);
      expect(back.side).toBeUndefined();
      expect(back.yielded).toBeUndefined();
      expect(firstStackOfRole(refilled, 'document')).toBeNull();
    });

    it('splitWellBeside_collapsing_thenExpandingByHand_forgetsItMadeWay', () => {
      const centre: StackNode = mkStack('tool', ['agent'], true);
      const tree: DockNode = mkSplit('row', [mkStack('tool', ['files']), centre]);

      const split: DockNode = splitWellBeside(tree, centre.id, 'doc', 'collapse');
      const shown: DockNode = setCollapsed(split, centre.id, false);

      expect(asStack(findStackOfPanel(shown, 'agent')).yielded).toBeUndefined();
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

  describe('setCollapsed', () => {
    it('setCollapsed_whenCollapsingAgainstAnEdge_remembersIt', () => {
      const stack: StackNode = mkStack('tool', ['agent']);
      const tree: DockNode = mkSplit('row', [mkStack('document', ['doc']), stack]);

      const collapsed: StackNode = asStack(
        findNode(setCollapsed(tree, stack.id, true, 'right'), stack.id),
      );

      expect(collapsed.collapsed).toBe(true);
      expect(collapsed.side).toBe('right');
    });

    it('setCollapsed_whenCollapsingWithNoEdgeGiven_recordsNone', () => {
      const stack: StackNode = mkStack('tool', ['agent']);
      const tree: DockNode = mkSplit('row', [mkStack('document', ['doc']), stack]);

      const collapsed: StackNode = asStack(findNode(setCollapsed(tree, stack.id, true), stack.id));

      expect(collapsed.collapsed).toBe(true);
      expect(collapsed.side).toBeUndefined();
    });

    it('setCollapsed_whenExpanding_forgetsTheRememberedEdge', () => {
      const stack: StackNode = mkStack('tool', ['agent']);
      const tree: DockNode = mkSplit('row', [mkStack('document', ['doc']), stack]);
      const hidden: DockNode = setCollapsed(tree, stack.id, true, 'right');

      const expanded: StackNode = asStack(
        findNode(setCollapsed(hidden, stack.id, false), stack.id),
      );

      expect(expanded.collapsed).toBe(false);
      expect(expanded.side).toBeUndefined();
    });

    it('setCollapsed_whenDocumentWell_isIgnored', () => {
      const well: StackNode = mkStack('document', ['doc']);
      const tree: DockNode = mkSplit('row', [mkStack('tool', ['t']), well]);

      expect(setCollapsed(tree, well.id, true, 'left')).toBe(tree);
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

  describe('tabStackInto', () => {
    it('tabStackInto_whenGroupMoves_appendsEveryTabAndPrunesTheSource', () => {
      const source: StackNode = mkStack('tool', ['a', 'b']);
      const target: StackNode = mkStack('tool', ['c']);
      const tree: DockNode = mkSplit('row', [source, target, mkStack('document', ['doc'])]);

      const result: DockNode = tabStackInto(tree, source.id, target.id);

      expect(findNode(result, source.id)).toBeNull();
      expect(asStack(findNode(result, target.id)).panels).toEqual(['c', 'a', 'b']);
    });

    it('tabStackInto_whenGroupMoves_keepsTheMovedGroupsActivePanelActive', () => {
      const source: StackNode = { ...mkStack('tool', ['a', 'b']), active: 'b' };
      const target: StackNode = mkStack('tool', ['c']);
      const tree: DockNode = mkSplit('row', [source, target, mkStack('document', ['doc'])]);

      const result: DockNode = tabStackInto(tree, source.id, target.id);

      expect(asStack(findNode(result, target.id)).active).toBe('b');
    });

    it('tabStackInto_whenSourceHeldTheCentreAnchor_handsItToASurvivingWell', () => {
      const source: StackNode = mkStack('document', ['doc1'], true);
      const target: StackNode = mkStack('document', ['doc2']);
      const tree: DockNode = mkSplit('row', [source, target]);

      const result: DockNode = tabStackInto(tree, source.id, target.id);

      expect(findPrimaryStack(result)?.id).toBe(target.id);
      expect(asStack(result).panels).toEqual(['doc2', 'doc1']);
    });

    it('tabStackInto_whenTargetIsTheSourceOrMissing_returnsTheSameReference', () => {
      const source: StackNode = mkStack('tool', ['a']);
      const tree: DockNode = mkSplit('row', [source, mkStack('document', ['doc'])]);

      expect(tabStackInto(tree, source.id, source.id)).toBe(tree);
      expect(tabStackInto(tree, source.id, 'absent')).toBe(tree);
      expect(tabStackInto(tree, 'absent', source.id)).toBe(tree);
    });

    it('tabStackInto_whenSourceIsEmpty_returnsTheSameReference', () => {
      const source: StackNode = mkStack('document', []);
      const target: StackNode = mkStack('document', ['doc']);
      const tree: DockNode = mkSplit('row', [source, target]);

      expect(tabStackInto(tree, source.id, target.id)).toBe(tree);
    });
  });

  describe('occupyWellWithStack', () => {
    it('occupyWellWithStack_whenToolGroupTakesTheEmptyCentre_seatsEveryTabInIt', () => {
      const tools: StackNode = { ...mkStack('tool', ['a', 'b']), active: 'b' };
      const well: StackNode = mkStack('document', [], true);
      const tree: DockNode = mkSplit('row', [tools, well]);

      const result: DockNode = occupyWellWithStack(tree, tools.id, well.id);
      const occupied: StackNode = asStack(findNode(result, well.id));

      expect(occupied.role).toBe('tool');
      expect(occupied.panels).toEqual(['a', 'b']);
      expect(occupied.active).toBe('b');
      expect(occupied.primary).toBe(true);
      expect(findNode(result, tools.id)).toBeNull();
    });

    it('occupyWellWithStack_whenTargetHoldsDocuments_returnsTheSameReference', () => {
      const tools: StackNode = mkStack('tool', ['a']);
      const well: StackNode = mkStack('document', ['doc'], true);
      const tree: DockNode = mkSplit('row', [tools, well]);

      expect(occupyWellWithStack(tree, tools.id, well.id)).toBe(tree);
    });

    it('occupyWellWithStack_whenSourceIsADocumentWell_returnsTheSameReference', () => {
      const docs: StackNode = mkStack('document', ['doc']);
      const well: StackNode = mkStack('document', [], true);
      const tree: DockNode = mkSplit('row', [docs, well]);

      expect(occupyWellWithStack(tree, docs.id, well.id)).toBe(tree);
    });
  });

  describe('splitStackBeside', () => {
    it('splitStackBeside_whenGroupDocksBesideAnother_movesEveryTabAsOneStack', () => {
      const source: StackNode = { ...mkStack('tool', ['a', 'b']), active: 'b' };
      const target: StackNode = mkStack('document', ['doc']);
      const tree: DockNode = mkSplit('row', [source, target]);

      const result: DockNode = splitStackBeside(tree, source.id, target.id, 'bottom');

      expect(isSplitNode(result) && result.dir).toBe('col');
      if (isSplitNode(result)) {
        expect(result.children[0]).toBe(target);
        const moved: StackNode = asStack(result.children[1]);
        expect(moved.panels).toEqual(['a', 'b']);
        expect(moved.active).toBe('b');
      }
    });

    it('splitStackBeside_whenADocumentWellDocksBesideATool_movesTheWellWhole', () => {
      const agent: StackNode = mkStack('tool', ['agent'], true);
      const well: StackNode = { ...mkStack('document', ['a.ts', 'b.ts']), active: 'b.ts' };
      const tree: DockNode = mkSplit('row', [well, agent]);

      const result: DockNode = splitStackBeside(tree, well.id, agent.id, 'right');

      // The same node, now on the agent's right — nothing left behind where it stood.
      expect(isSplitNode(result) && result.children).toEqual([agent, well]);
    });

    it('splitStackBeside_whenTheLastDocumentWellMoves_keepsItsAnchorAndLeavesNoEmptyWell', () => {
      const tool: StackNode = mkStack('tool', ['explorer']);
      const well: StackNode = mkStack('document', ['a.ts'], true);
      const tree: DockNode = mkSplit('row', [tool, well]);

      const result: DockNode = splitStackBeside(tree, well.id, tool.id, 'left');

      expect(isSplitNode(result) && result.children).toEqual([well, tool]);
      expect(asStack(findNode(result, well.id)).primary).toBe(true);
    });

    it('splitStackBeside_whenTheSourceStackIsGone_reusesItsIdentity', () => {
      const source: StackNode = mkStack('tool', ['a', 'b']);
      const target: StackNode = mkStack('document', ['doc']);
      const tree: DockNode = mkSplit('row', [source, target]);

      const result: DockNode = splitStackBeside(tree, source.id, target.id, 'top');

      expect(asStack(findNode(result, source.id)).panels).toEqual(['a', 'b']);
    });

    it('splitStackBeside_whenSourceIsTheLastDocumentsHome_mintsAFreshIdentity', () => {
      // The tool-occupied centre is the only documents-home, so lifting it leaves an empty well
      // behind under the source's id — the moved group must not reuse that id.
      const centre: StackNode = { ...mkStack('tool', ['a', 'b'], true), role: 'tool' as const };
      const side: StackNode = mkStack('tool', ['c']);
      const tree: DockNode = mkSplit('row', [centre, side]);

      const result: DockNode = splitStackBeside(tree, centre.id, side.id, 'bottom');
      const kept: StackNode = asStack(findNode(result, centre.id));

      expect(kept.role).toBe('document');
      expect(kept.panels).toEqual([]);
      expect(asStack(findStackOfPanel(result, 'a')).id).not.toBe(centre.id);
      expect(asStack(findStackOfPanel(result, 'a')).panels).toEqual(['a', 'b']);
    });

    it('splitStackBeside_whenTargetIsTheSourceOrMissing_returnsTheSameReference', () => {
      const source: StackNode = mkStack('tool', ['a']);
      const tree: DockNode = mkSplit('row', [source, mkStack('document', ['doc'])]);

      expect(splitStackBeside(tree, source.id, source.id, 'left')).toBe(tree);
      expect(splitStackBeside(tree, source.id, 'absent', 'left')).toBe(tree);
    });
  });

  describe('dockStackEdge', () => {
    it('dockStackEdge_whenToolGroupDocksToAnEdge_movesEveryTabAsOneStack', () => {
      const source: StackNode = mkStack('tool', ['a', 'b']);
      const well: StackNode = mkStack('document', ['doc'], true);
      const tree: DockNode = mkSplit('col', [well, source]);

      const result: DockNode = dockStackEdge(tree, source.id, 'left');

      expect(isSplitNode(result) && result.dir).toBe('row');
      if (isSplitNode(result)) {
        expect(asStack(result.children[0]).panels).toEqual(['a', 'b']);
        expect(result.children[1]).toBe(well);
      }
    });

    it('dockStackEdge_whenSourceIsADocumentWell_returnsTheSameReference', () => {
      const docs: StackNode = mkStack('document', ['doc']);
      const tree: DockNode = mkSplit('row', [mkStack('document', ['other']), docs]);

      expect(dockStackEdge(tree, docs.id, 'left')).toBe(tree);
    });

    it('dockStackEdge_whenSourceMissing_returnsTheSameReference', () => {
      const tree: DockNode = mkStack('tool', ['a']);

      expect(dockStackEdge(tree, 'absent', 'left')).toBe(tree);
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

  describe('findDocumentWell', () => {
    it('findDocumentWell_prefersThePrimaryWell', () => {
      const side: StackNode = mkStack('document', []);
      const primary: StackNode = mkStack('document', [], true);
      const tree: DockNode = mkSplit('row', [side, primary]);

      expect(findDocumentWell(tree)).toBe(primary);
    });

    it('findDocumentWell_whenAToolHoldsTheCentre_findsAnotherWell', () => {
      const well: StackNode = mkStack('document', []);
      const tree: DockNode = mkSplit('row', [mkStack('tool', ['agent'], true), well]);

      expect(findDocumentWell(tree)).toBe(well);
    });

    it('findDocumentWell_withNoWell_returnsNull', () => {
      const tree: DockNode = mkSplit('row', [
        mkStack('tool', ['files']),
        mkStack('tool', ['agent'], true),
      ]);

      expect(findDocumentWell(tree)).toBeNull();
    });
  });

  describe('carryIntoWell', () => {
    it('carryIntoWell_seatsTheDocumentsAfterTheWellsOwn_andActivatesTheGivenOne', () => {
      const well: StackNode = mkStack('document', ['readme'], true);
      const tree: DockNode = mkSplit('row', [mkStack('tool', ['files']), well]);

      const next: StackNode = asStack(
        findDocumentWell(carryIntoWell(tree, ['a', 'readme', 'b'], 'b')),
      );

      expect(next.id).toBe(well.id);
      expect(next.panels).toEqual(['readme', 'a', 'b']);
      expect(next.active).toBe('b');
    });

    it('carryIntoWell_intoAnEmptyWellWithNoActiveGiven_activatesTheFirstCarried', () => {
      const tree: DockNode = mkStack('document', [], true);

      expect(asStack(carryIntoWell(tree, ['a', 'b'], null)).active).toBe('a');
    });

    it('carryIntoWell_withNoWellOrNothingToCarry_returnsTheSameTree', () => {
      const noWell: DockNode = mkStack('tool', ['agent'], true);
      const well: DockNode = mkStack('document', [], true);

      expect(carryIntoWell(noWell, ['a'], 'a')).toBe(noWell);
      expect(carryIntoWell(well, [], null)).toBe(well);
    });
  });

  describe('seatDocuments', () => {
    it('seatDocuments_withAWell_carriesThemIntoIt', () => {
      const well: StackNode = mkStack('document', ['open'], true);
      const tree: DockNode = mkSplit('row', [mkStack('tool', ['files']), well]);

      const next: StackNode = asStack(findDocumentWell(seatDocuments(tree, ['back'], 'back')));

      expect(next.id).toBe(well.id);
      expect(next.panels).toEqual(['open', 'back']);
      expect(next.active).toBe('back');
    });

    it('seatDocuments_whenAToolHoldsTheCentre_opensAWellBesideIt', () => {
      const agent: StackNode = mkStack('tool', ['agent'], true);
      const tree: DockNode = mkSplit('row', [mkStack('tool', ['files']), agent]);

      const next: DockNode = seatDocuments(tree, ['a', 'b'], 'a');

      const well: StackNode = asStack(findDocumentWell(next));
      expect(well.panels).toEqual(['a', 'b']);
      expect(well.active).toBe('a');
      expect(findStackOfPanel(next, 'agent')?.primary).toBe(true);
    });

    it('seatDocuments_withNothingToSeat_returnsTheSameTree', () => {
      const tree: DockNode = mkStack('tool', ['agent'], true);

      expect(seatDocuments(tree, [], null)).toBe(tree);
    });
  });
});
