import { TestBed } from '@angular/core/testing';
import { DockNode, isSplitNode, isStackNode, StackNode } from './dock-node';
import { DockState } from './dock-state';

/**
 * Reads the first stack found in depth-first order, failing the test when none exists.
 * @param node The subtree to search.
 * @returns Returns the first stack in the subtree.
 */
function firstStack(node: DockNode): StackNode {
  if (isStackNode(node)) {
    return node;
  }
  return firstStack(node.children[0]);
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

  it('layout_whenCreated_startsWithAnEmptyDocumentWell', () => {
    const root: DockNode = state.layout();

    expect(isStackNode(root)).toBe(true);
    if (isStackNode(root)) {
      expect(root.role).toBe('document');
      expect(root.panels).toEqual([]);
    }
  });

  it('tabInto_whenCalled_replacesTheLayoutSignalWithTheUpdatedTree', () => {
    const before: DockNode = state.layout();
    const wellId: string = firstStack(before).id;

    state.tabInto(wellId, 'doc1');

    expect(state.layout()).not.toBe(before);
    expect(firstStack(state.layout()).panels).toEqual(['doc1']);
  });

  it('setActive_whenCalled_updatesTheActivePanel', () => {
    const wellId: string = firstStack(state.layout()).id;
    state.tabInto(wellId, 'doc1');
    state.tabInto(wellId, 'doc2');

    state.setActive(wellId, 'doc1');

    expect(firstStack(state.layout()).active).toBe('doc1');
  });

  it('splitStack_whenCalled_docksANewStackBesideTheTarget', () => {
    const wellId: string = firstStack(state.layout()).id;
    state.tabInto(wellId, 'doc1');

    state.splitStack(wellId, 'tool1', 'left', 'tool');

    const root: DockNode = state.layout();
    expect(isSplitNode(root)).toBe(true);
    if (isSplitNode(root)) {
      expect(firstStack(root.children[0]).panels).toEqual(['tool1']);
    }
  });

  it('dockEdge_whenCalled_docksAToolStackAgainstTheEdge', () => {
    const wellId: string = firstStack(state.layout()).id;
    state.tabInto(wellId, 'doc1');

    state.dockEdge('output', 'bottom');

    const root: DockNode = state.layout();
    expect(isSplitNode(root) && root.dir).toBe('col');
  });

  it('removeFromLayout_whenLastPanelInAToolStack_prunesTheStack', () => {
    const wellId: string = firstStack(state.layout()).id;
    state.tabInto(wellId, 'doc1');
    state.dockEdge('output', 'bottom');

    state.removeFromLayout('output');

    // Only the document well remains, so the tree collapses back to a single stack.
    expect(isStackNode(state.layout())).toBe(true);
  });

  it('reset_whenCalled_restoresTheEmptyDocumentWell', () => {
    const wellId: string = firstStack(state.layout()).id;
    state.tabInto(wellId, 'doc1');
    state.dockEdge('output', 'bottom');

    state.reset();

    const root: DockNode = state.layout();
    expect(isStackNode(root)).toBe(true);
    if (isStackNode(root)) {
      expect(root.panels).toEqual([]);
    }
  });
});
