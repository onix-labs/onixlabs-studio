import { TestBed } from '@angular/core/testing';
import { DOCK_BLUEPRINT } from './dock-blueprint';
import { TEST_DOCK_BLUEPRINT } from './dock-test-blueprint';
import { DockDrag } from './dock-drag';
import { DockNode, StackNode } from './dock-node';
import { DockPanel } from './dock-panel';
import { DockState } from './dock-state';
import { findStackOfPanel, firstStackOfRole } from './dock-tree';

describe('DockDrag', () => {
  let drag: DockDrag;
  let state: DockState;

  /**
   * Resolves the stack holding a panel in the seeded layout.
   * @param panelId The identifier of a panel in the layout.
   * @returns Returns the stack holding it.
   */
  function stackOf(panelId: string): StackNode {
    const layout: DockNode = state.layout();
    const stack: StackNode | null = findStackOfPanel(layout, panelId);
    expect(stack).not.toBeNull();
    return stack!;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: DOCK_BLUEPRINT, useValue: TEST_DOCK_BLUEPRINT }],
    });
    drag = TestBed.inject(DockDrag);
    state = TestBed.inject(DockState);
  });

  it('active_whenIdle_isFalse', () => {
    expect(drag.active()).toBe(false);
    expect(drag.panel()).toBeNull();
  });

  it('begin_whenPressMovesPastTheThreshold_activatesTheDragAndEnablesEdgeGuides', () => {
    drag.begin('output', new MouseEvent('mousedown', { clientX: 100, clientY: 100 }));
    // A press alone arms but does not activate the drag.
    expect(drag.active()).toBe(false);

    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 140, clientY: 140 }));

    expect(drag.active()).toBe(true);
    expect(drag.panel()?.id).toBe('output');
    expect(drag.showEdges()).toBe(true);
    expect(drag.ghost()).not.toBeNull();

    document.dispatchEvent(new MouseEvent('mouseup'));
    expect(drag.active()).toBe(false);
  });

  it('begin_whenPressDoesNotMove_neverActivates', () => {
    drag.begin('output', new MouseEvent('mousedown', { clientX: 100, clientY: 100 }));

    document.dispatchEvent(new MouseEvent('mouseup'));

    expect(drag.active()).toBe(false);
  });

  it('begin_whenStartingADocumentPanel_disablesEdgeGuides', () => {
    drag.begin('doc1', new MouseEvent('mousedown', { clientX: 50, clientY: 50 }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 90, clientY: 90 }));

    expect(drag.showEdges()).toBe(false);

    document.dispatchEvent(new MouseEvent('mouseup'));
  });

  it('begin_whenAlreadyDragging_isIgnored', () => {
    drag.begin('output', new MouseEvent('mousedown', { clientX: 100, clientY: 100 }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 140, clientY: 140 }));
    const panel: DockPanel | null = drag.panel();

    drag.begin('solution', new MouseEvent('mousedown'));

    expect(drag.panel()).toBe(panel);
    expect(drag.panel()?.id).toBe('output');
    document.dispatchEvent(new MouseEvent('mouseup'));
  });

  it('begin_whenPanelUnknown_doesNotActivate', () => {
    drag.begin('absent', new MouseEvent('mousedown'));

    expect(drag.active()).toBe(false);
  });

  it('beginGroup_whenPressMovesPastTheThreshold_dragsTheWholeGroup', () => {
    const stack: StackNode = stackOf('output');

    drag.beginGroup(stack.id, new MouseEvent('mousedown', { clientX: 100, clientY: 100 }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 140, clientY: 140 }));

    expect(drag.active()).toBe(true);
    expect(drag.subject()).toEqual({
      kind: 'group',
      stackId: stack.id,
      role: 'tool',
      panel: expect.objectContaining({ id: 'output' }) as DockPanel,
      count: 3,
    });
    // The ghost is labelled by the active tab, with the tabs riding along counted after it.
    expect(drag.title()).toBe('Output +2');
    expect(drag.showEdges()).toBe(true);

    document.dispatchEvent(new MouseEvent('mouseup'));
    expect(drag.active()).toBe(false);
  });

  it('beginGroup_whenTheGroupIsEmpty_neverActivates', () => {
    const well: StackNode | null = firstStackOfRole(state.layout(), 'document');

    drag.beginGroup(well?.id ?? '', new MouseEvent('mousedown', { clientX: 100, clientY: 100 }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 140, clientY: 140 }));

    expect(well?.panels).toEqual([]);
    expect(drag.active()).toBe(false);

    document.dispatchEvent(new MouseEvent('mouseup'));
  });

  it('beginGroup_whenTheStackIsUnknown_neverActivates', () => {
    drag.beginGroup('absent', new MouseEvent('mousedown', { clientX: 100, clientY: 100 }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 140, clientY: 140 }));

    expect(drag.active()).toBe(false);

    document.dispatchEvent(new MouseEvent('mouseup'));
  });

  it('beginGroup_whenReleasedOverNoTarget_leavesTheGroupWhereItIs', () => {
    const stack: StackNode = stackOf('output');
    const before: DockNode = state.layout();
    let offered: number = 0;
    drag.registerExternalDrop((): boolean => {
      offered++;
      return true;
    });

    drag.beginGroup(stack.id, new MouseEvent('mousedown', { clientX: 100, clientY: 100 }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 140, clientY: 140 }));
    document.dispatchEvent(new MouseEvent('mouseup', { screenX: 2000, screenY: 300 }));

    // A whole group has nowhere to float or tear out to, so a void drop is simply not a move.
    expect(offered).toBe(0);
    expect(state.layout()).toBe(before);
    expect(drag.active()).toBe(false);
  });

  it('registerExternalDrop_whenReleaseHitsNoDockTarget_offersTheDropWithTheReleaseEvent', () => {
    const taken: { id: string; screenX: number }[] = [];
    drag.registerExternalDrop((panel: DockPanel, event: MouseEvent): boolean => {
      taken.push({ id: panel.id, screenX: event.screenX });
      return true;
    });
    drag.begin('output', new MouseEvent('mousedown', { clientX: 100, clientY: 100 }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 140, clientY: 140 }));

    document.dispatchEvent(new MouseEvent('mouseup', { screenX: 2000, screenY: 300 }));

    expect(taken).toEqual([{ id: 'output', screenX: 2000 }]);
    expect(drag.active()).toBe(false);
  });

  it('registerExternalDrop_whenThePressNeverBecameADrag_isNotConsulted', () => {
    let offered: number = 0;
    drag.registerExternalDrop((): boolean => {
      offered++;
      return true;
    });
    drag.begin('output', new MouseEvent('mousedown', { clientX: 100, clientY: 100 }));

    document.dispatchEvent(new MouseEvent('mouseup'));

    expect(offered).toBe(0);
  });

  it('registerExternalDrop_disposer_removesTheHandlerUnlessReplaced', () => {
    let offered: number = 0;
    const dispose: () => void = drag.registerExternalDrop((): boolean => {
      offered++;
      return true;
    });
    dispose();
    drag.begin('output', new MouseEvent('mousedown', { clientX: 100, clientY: 100 }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 140, clientY: 140 }));
    document.dispatchEvent(new MouseEvent('mouseup'));

    expect(offered).toBe(0);
  });
});
