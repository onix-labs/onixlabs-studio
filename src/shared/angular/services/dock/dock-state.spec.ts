import { TestBed } from '@angular/core/testing';
import { Settings } from '@shared/angular/services/settings/settings';
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
    expect(stackOf(root, 'files').role).toBe('tool');
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
    const filesId: string = stackOf(state.layout(), 'files').id;

    state.splitStack(filesId, 'extra', 'bottom', 'tool');

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

    state.movePanel('files', id, 0);

    const well: StackNode = stackOf(state.layout(), 'doc-a');
    expect(well.panels).toContain('files');
    expect(well.active).toBe('files');
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

  describe('history (undo/redo)', () => {
    it('undo_afterAStructuralMutation_restoresThePreviousLayout', () => {
      const before: DockNode = state.layout();
      expect(state.canUndo()).toBe(false);

      state.tabInto(wellId(), 'doc-a');
      expect(state.canUndo()).toBe(true);

      state.undo();

      expect(state.layout()).toBe(before);
      expect(state.canUndo()).toBe(false);
      expect(state.canRedo()).toBe(true);
    });

    it('redo_afterUndo_reappliesTheLayout', () => {
      state.tabInto(wellId(), 'doc-a');
      const after: DockNode = state.layout();

      state.undo();
      state.redo();

      expect(state.layout()).toBe(after);
      expect(state.canRedo()).toBe(false);
      expect(state.canUndo()).toBe(true);
    });

    it('setActive_whenCalled_doesNotAddToTheUndoHistory', () => {
      const initial: DockNode = state.layout();
      const id: string = wellId();
      state.tabInto(id, 'doc-a');
      state.tabInto(id, 'doc-b');

      // A pure focus change between the two structural mutations must not become its own undo step.
      state.setActive(id, 'doc-a');
      state.undo();
      state.undo();

      expect(state.layout()).toBe(initial);
      expect(state.canUndo()).toBe(false);
    });

    it('mutating_afterUndo_clearsTheRedoHistory', () => {
      const id: string = wellId();
      state.tabInto(id, 'doc-a');
      state.undo();
      expect(state.canRedo()).toBe(true);

      state.tabInto(id, 'doc-b');

      expect(state.canRedo()).toBe(false);
    });

    it('undoStackSize_boundsTheHistoryDepth', () => {
      const settings: Settings = TestBed.inject(Settings);
      settings.setUndoStackSize(10);
      const id: string = wellId();

      for (let index: number = 0; index < 12; index++) {
        state.tabInto(id, `doc-${index}`);
      }

      let steps: number = 0;
      while (state.canUndo()) {
        state.undo();
        steps++;
      }

      expect(steps).toBe(10);
    });
  });
});
