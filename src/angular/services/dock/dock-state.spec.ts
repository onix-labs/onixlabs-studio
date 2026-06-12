import { TestBed } from '@angular/core/testing';
import { DockNode, isSplitNode, isStackNode, StackNode } from './dock-node';
import { DockState } from './dock-state';
import { findStackOfPanel, firstStackOfRole } from './dock-tree';

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

  /**
   * Resolves the id of the (initially empty) document well.
   */
  function wellId(): string {
    const well: StackNode | null = firstStackOfRole(state.layout(), 'document');
    expect(well).not.toBeNull();
    return well!.id;
  }

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
    expect(firstStackOfRole(root, 'document')?.role).toBe('document');
    expect(stackOf(root, 'solution').role).toBe('tool');
  });

  it('tabInto_whenCalled_replacesTheLayoutSignalAndAddsTheTab', () => {
    const before: DockNode = state.layout();
    state.tabInto(wellId(), 'doc-a');

    state.tabInto(wellId(), 'doc-b');

    expect(state.layout()).not.toBe(before);
    const well: StackNode = stackOf(state.layout(), 'doc-b');
    expect(well.panels).toContain('doc-a');
    expect(well.active).toBe('doc-b');
  });

  it('setActive_whenCalled_updatesTheActivePanel', () => {
    const id: string = wellId();
    state.tabInto(id, 'doc-a');
    state.tabInto(id, 'doc-b');

    state.setActive(id, 'doc-a');

    expect(stackOf(state.layout(), 'doc-a').active).toBe('doc-a');
  });

  it('splitStack_whenCalled_docksANewStackBesideTheTarget', () => {
    const solutionId: string = stackOf(state.layout(), 'solution').id;

    state.splitStack(solutionId, 'extra', 'bottom', 'tool');

    expect(stackOf(state.layout(), 'extra').panels).toEqual(['extra']);
  });

  it('dockEdge_whenAxisDiffersFromRoot_wrapsTheWholeTree', () => {
    state.dockEdge('extra', 'bottom');

    const root: DockNode = state.layout();
    expect(isSplitNode(root) && root.dir).toBe('col');
    expect(stackOf(root, 'extra').role).toBe('tool');
  });

  it('removeFromLayout_whenLastPanelInToolStack_prunesTheStack', () => {
    state.removeFromLayout('output');
    state.removeFromLayout('errors');

    expect(findStackOfPanel(state.layout(), 'output')).toBeNull();
    expect(findStackOfPanel(state.layout(), 'errors')).toBeNull();
  });

  it('reorderTab_whenCalled_reordersThePanelsInTheStack', () => {
    const id: string = wellId();
    state.tabInto(id, 'doc-a');
    state.tabInto(id, 'doc-b');
    state.tabInto(id, 'doc-c');

    state.reorderTab(id, 0, 2);

    expect(stackOf(state.layout(), 'doc-a').panels).toEqual(['doc-b', 'doc-c', 'doc-a']);
  });

  it('movePanel_whenCalled_movesThePanelIntoTheTargetStack', () => {
    const id: string = wellId();
    state.tabInto(id, 'doc-a');

    state.movePanel('solution', id, 0);

    const well: StackNode = stackOf(state.layout(), 'doc-a');
    expect(well.panels).toContain('solution');
    expect(well.active).toBe('solution');
  });

  it('setSizes_whenCalledOnASplit_commitsTheNewWeights', () => {
    const root: DockNode = state.layout();
    expect(isSplitNode(root)).toBe(true);

    if (isSplitNode(root)) {
      const sizes: number[] = root.children.map((): number => 2);
      state.setSizes(root.id, sizes);

      const updated: DockNode = state.layout();
      expect(isSplitNode(updated) && updated.sizes).toEqual(sizes);
    }
  });

  it('removeStack_whenCalled_removesTheWholeStack', () => {
    const agentId: string = stackOf(state.layout(), 'agent').id;

    state.removeStack(agentId);

    expect(findStackOfPanel(state.layout(), 'agent')).toBeNull();
  });

  it('dockStackToEdge_whenCalled_docksTheStackAgainstTheEdge', () => {
    state.dockStackToEdge(['alpha', 'beta'], 'tool', 'left', 'beta');

    const stack: StackNode = stackOf(state.layout(), 'alpha');
    expect(stack.panels).toEqual(['alpha', 'beta']);
    expect(stack.active).toBe('beta');
  });

  it('reset_whenCalled_restoresTheSeededLayout', () => {
    state.tabInto(wellId(), 'doc-a');

    state.reset();

    expect(isStackNode(state.layout())).toBe(false);
    expect(firstStackOfRole(state.layout(), 'document')?.panels).toEqual([]);
  });
});
