import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Icon } from '@shared/angular/icons/icon';
import { Settings } from '@shared/angular/services/settings/settings';
import { SettingsStore } from '@shared/angular/services/settings-store/settings-store';
import { DOCK_BLUEPRINT, DockBlueprint } from './dock-blueprint';
import { DockNode, isSplitNode, isStackNode, mkSplit, mkStack, StackNode } from './dock-node';
import { DockState } from './dock-state';
import { findStackOfPanel, firstStackOfRole } from './dock-tree';

/**
 * An in-memory {@link SettingsStore} stand-in, so persistence tests are hermetic (no localStorage) and
 * can seed and read the stored layout directly.
 */
class FakeStore {
  /**
   * Holds the persisted entries by key.
   */
  public readonly map: Map<string, unknown> = new Map<string, unknown>();

  /**
   * Reads a stored value, or the fallback when absent.
   * @param key The entry key.
   * @param fallback The value to return when the key is absent.
   * @returns Returns the stored value or the fallback.
   */
  public get<T>(key: string, fallback: T): T {
    return this.map.has(key) ? (this.map.get(key) as T) : fallback;
  }

  /**
   * Writes a stored value.
   * @param key The entry key.
   * @param value The value to store.
   */
  public set<T>(key: string, value: T): void {
    this.map.set(key, value);
  }

  /**
   * Cross-window change notifications never fire in this hermetic stand-in.
   * @returns Returns a no-op disposer.
   */
  public onExternalChange(): () => void {
    return (): void => undefined;
  }
}

/**
 * A stand-in panel body; only its type is catalogued, so it is never instantiated.
 */
class PersistStubPanel {}

/**
 * The persistence key the blueprint below stores its layout under.
 */
const PERSIST_LAYOUT_KEY: string = 'dock.layout.persist';

/**
 * A keyed blueprint cataloguing one tool panel, used to drive the persistence tests.
 */
const PERSIST_BLUEPRINT: DockBlueprint = {
  key: 'persist',
  createLayout: (): DockNode =>
    mkSplit('row', [mkStack('tool', ['explorer']), mkStack('document', [])], [1, 2]),
  panels: [
    {
      id: 'explorer',
      title: 'Explorer',
      icon: Icon.CODE,
      role: 'tool',
      component: PersistStubPanel,
    },
  ],
};

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

  it('tabStackInto_whenCalled_movesEveryTabAndIsOneUndoStep', () => {
    const before: DockNode = state.layout();
    const source: StackNode = stackOf(before, 'output');
    const target: StackNode = stackOf(before, 'files');

    state.tabStackInto(source.id, target.id);

    const merged: StackNode = stackOf(state.layout(), 'output');
    expect(merged.id).toBe(target.id);
    expect(merged.panels).toEqual(['files', 'output', 'errors', 'terminal']);

    state.undo();
    expect(state.layout()).toBe(before);
  });

  it('splitStackBeside_whenCalled_docksTheWholeGroupBesideTheTarget', () => {
    const source: StackNode = stackOf(state.layout(), 'output');

    state.splitStackBeside(source.id, stackOf(state.layout(), 'files').id, 'bottom');

    const moved: StackNode = stackOf(state.layout(), 'output');
    expect(moved.panels).toEqual(['output', 'errors', 'terminal']);
    expect(stackOf(state.layout(), 'files').panels).toEqual(['files']);
  });

  it('occupyWellWithStack_whenCalled_seatsTheWholeGroupInTheEmptyCentre', () => {
    const source: StackNode = stackOf(state.layout(), 'output');

    state.occupyWellWithStack(source.id, wellId());

    const centre: StackNode = stackOf(state.layout(), 'output');
    expect(centre.role).toBe('tool');
    expect(centre.panels).toEqual(['output', 'errors', 'terminal']);
    expect(centre.primary).toBe(true);
  });

  it('dockStackEdge_whenCalled_docksTheWholeGroupAgainstTheEdge', () => {
    const source: StackNode = stackOf(state.layout(), 'output');

    state.dockStackEdge(source.id, 'top');

    const root: DockNode = state.layout();
    expect(isSplitNode(root) && root.dir).toBe('col');
    if (isSplitNode(root)) {
      expect(stackOf(root.children[0], 'output').panels).toEqual(['output', 'errors', 'terminal']);
    }
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

describe('DockState close guard', () => {
  let confirmResult: boolean;
  let confirmCalls: number;

  /**
   * Builds a dock whose document well holds one document panel with a controllable close guard.
   * @returns Returns the injected dock state.
   */
  function create(): DockState {
    confirmCalls = 0;
    const blueprint: DockBlueprint = {
      key: 'guard',
      createLayout: (): DockNode =>
        mkSplit('row', [mkStack('tool', ['explorer']), mkStack('document', ['doc-1'])], [1, 2]),
      panels: [
        {
          id: 'explorer',
          title: 'Explorer',
          icon: Icon.CODE,
          role: 'tool',
          component: PersistStubPanel,
        },
        {
          id: 'doc-1',
          title: 'a.ts',
          icon: Icon.CODE,
          role: 'document',
          component: PersistStubPanel,
          confirmClose: (): Promise<boolean> => {
            confirmCalls += 1;
            return Promise.resolve(confirmResult);
          },
        },
      ],
    };
    TestBed.configureTestingModule({
      providers: [{ provide: DOCK_BLUEPRINT, useValue: blueprint }],
    });
    return TestBed.inject(DockState);
  }

  it('requestClose_whenTheGuardAllows_removesThePanel', async () => {
    confirmResult = true;
    const dock: DockState = create();
    expect(findStackOfPanel(dock.layout(), 'doc-1')).not.toBeNull();

    await dock.requestClose('doc-1');

    expect(confirmCalls).toBe(1);
    expect(findStackOfPanel(dock.layout(), 'doc-1')).toBeNull();
  });

  it('requestClose_whenTheGuardCancels_keepsThePanel', async () => {
    confirmResult = false;
    const dock: DockState = create();

    await dock.requestClose('doc-1');

    expect(findStackOfPanel(dock.layout(), 'doc-1')).not.toBeNull();
  });
});

describe('DockState persistence', () => {
  let store: FakeStore;

  /**
   * Configures a DockState backed by the keyed persistence blueprint and the fake store, optionally
   * seeding a persisted layout before the state is constructed.
   * @param seed The value to seed the store's layout entry with, or undefined to leave it empty.
   * @returns Returns the constructed DockState.
   */
  function inject(seed?: unknown): DockState {
    store = new FakeStore();
    if (seed !== undefined) {
      store.set(PERSIST_LAYOUT_KEY, seed);
    }
    TestBed.configureTestingModule({
      providers: [
        { provide: DOCK_BLUEPRINT, useValue: PERSIST_BLUEPRINT },
        { provide: SettingsStore, useValue: store },
      ],
    });
    return TestBed.inject(DockState);
  }

  it('restore_stripsUnknownDocumentPanelsButKeepsTheWell', () => {
    const persisted: unknown = {
      kind: 'split',
      id: 'dock-1',
      dir: 'row',
      children: [
        { kind: 'stack', id: 'dock-2', role: 'tool', panels: ['explorer'], active: 'explorer' },
        { kind: 'stack', id: 'dock-3', role: 'document', panels: ['/gone.ts'], active: '/gone.ts' },
      ],
      sizes: [2, 3],
    };

    const state: DockState = inject(persisted);

    expect(findStackOfPanel(state.layout(), 'explorer')?.role).toBe('tool');
    expect(firstStackOfRole(state.layout(), 'document')?.panels).toEqual([]);
  });

  it('restore_fallsBackToTheBlueprintLayoutOnGarbage', () => {
    const state: DockState = inject({ not: 'a tree' });

    expect(findStackOfPanel(state.layout(), 'explorer')?.role).toBe('tool');
    expect(firstStackOfRole(state.layout(), 'document')).not.toBeNull();
  });

  it('mutation_persistsTheCurrentLayoutToTheStore', () => {
    const state: DockState = inject();
    const well: StackNode = firstStackOfRole(state.layout(), 'document')!;
    state.tabInto(well.id, 'doc-x');

    TestBed.inject(ApplicationRef).tick();

    expect(store.get<DockNode | null>(PERSIST_LAYOUT_KEY, null)).toBe(state.layout());
  });
});
