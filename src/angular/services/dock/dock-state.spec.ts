import { TestBed } from '@angular/core/testing';
import { DockNode, isSplitNode, isStackNode, StackNode } from './dock-node';
import { DockState } from './dock-state';
import { findStackOfPanel } from './dock-tree';

/**
 * Asserts a stack holds the given panel and returns it, failing the test otherwise.
 * @param tree The tree to search.
 * @param panelId The panel whose stack to resolve.
 * @returns Returns the stack holding the panel.
 */
function stackOf(tree: DockNode, panelId: string): StackNode {
  const stack: StackNode | null = findStackOfPanel(tree, panelId);
  expect(stack).not.toBeNull();
  return stack!;
}

describe('DockState', () => {
  let state: DockState;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    state = TestBed.inject(DockState);
  });

  it('should create', () => {
    expect(state).toBeTruthy();
  });

  it('layout_whenCreated_seedsTheDefaultLayout', () => {
    const root: DockNode = state.layout();

    expect(isSplitNode(root)).toBe(true);
    expect(stackOf(root, 'doc1').role).toBe('document');
    expect(stackOf(root, 'solution').role).toBe('tool');
  });

  it('tabInto_whenCalled_replacesTheLayoutSignalAndAddsTheTab', () => {
    const before: DockNode = state.layout();
    const wellId: string = stackOf(before, 'doc1').id;

    state.tabInto(wellId, 'doc4');

    expect(state.layout()).not.toBe(before);
    const well: StackNode = stackOf(state.layout(), 'doc4');
    expect(well.panels).toContain('doc1');
    expect(well.active).toBe('doc4');
  });

  it('setActive_whenCalled_updatesTheActivePanel', () => {
    const wellId: string = stackOf(state.layout(), 'doc1').id;

    state.setActive(wellId, 'doc2');

    expect(stackOf(state.layout(), 'doc2').active).toBe('doc2');
  });

  it('splitStack_whenCalled_docksANewStackBesideTheTarget', () => {
    const solutionId: string = stackOf(state.layout(), 'solution').id;

    state.splitStack(solutionId, 'toolbox', 'bottom', 'tool');

    expect(stackOf(state.layout(), 'toolbox').panels).toEqual(['toolbox']);
  });

  it('dockEdge_whenAxisDiffersFromRoot_wrapsTheWholeTree', () => {
    state.dockEdge('toolbox', 'bottom');

    const root: DockNode = state.layout();
    expect(isSplitNode(root) && root.dir).toBe('col');
    expect(stackOf(root, 'toolbox').role).toBe('tool');
  });

  it('removeFromLayout_whenLastPanelInToolStack_prunesTheStack', () => {
    state.removeFromLayout('output');
    state.removeFromLayout('errors');

    expect(findStackOfPanel(state.layout(), 'output')).toBeNull();
    expect(findStackOfPanel(state.layout(), 'errors')).toBeNull();
  });

  it('reorderTab_whenCalled_reordersThePanelsInTheStack', () => {
    const wellId: string = stackOf(state.layout(), 'doc1').id;

    state.reorderTab(wellId, 0, 2);

    expect(stackOf(state.layout(), 'doc1').panels).toEqual(['doc2', 'doc3', 'doc1']);
  });

  it('movePanel_whenCalled_movesThePanelIntoTheTargetStack', () => {
    const wellId: string = stackOf(state.layout(), 'doc1').id;

    state.movePanel('solution', wellId, 0);

    const well: StackNode = stackOf(state.layout(), 'doc1');
    expect(well.panels).toContain('solution');
    expect(well.active).toBe('solution');
  });

  it('setSizes_whenCalledOnASplit_commitsTheNewWeights', () => {
    const root: DockNode = state.layout();
    expect(isSplitNode(root)).toBe(true);
    const sizes: number[] = [2, 2, 2];

    if (isSplitNode(root)) {
      state.setSizes(root.id, sizes);
    }

    const updated: DockNode = state.layout();
    expect(isSplitNode(updated) && updated.sizes).toEqual(sizes);
  });

  it('reset_whenCalled_restoresTheSeededLayout', () => {
    const wellId: string = stackOf(state.layout(), 'doc1').id;
    state.tabInto(wellId, 'doc4');

    state.reset();

    expect(isStackNode(state.layout())).toBe(false);
    expect(stackOf(state.layout(), 'doc1').panels).toEqual(['doc1', 'doc2', 'doc3']);
  });
});
