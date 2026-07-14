import { TestBed } from '@angular/core/testing';
import { PanelLayoutDrag } from './panel-layout-drag';
import { PanelEdge, PanelRect } from './panel-types';

const SOURCE: PanelRect = { left: 500, top: 100, width: 300, height: 400 };

const ALL_EDGES: readonly PanelEdge[] = ['left', 'right', 'top', 'bottom'];
const SIDES: readonly PanelEdge[] = ['left', 'right'];

describe('PanelLayoutDrag', () => {
  let drag: PanelLayoutDrag;
  let drops: { panelId: string; edge: PanelEdge }[];

  beforeEach(() => {
    drag = TestBed.inject(PanelLayoutDrag);
    drops = [];
    const host: HTMLElement = document.createElement('div');
    host.getBoundingClientRect = (): DOMRect =>
      ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect;
    drag.attach(host, (panelId: string, edge: PanelEdge): void => {
      drops.push({ panelId, edge });
    });
  });

  it('active_whenIdle_isFalse', () => {
    expect(drag.active()).toBe(false);
    expect(drag.panelId()).toBeNull();
  });

  it('begin_whenPressMovesPastTheThreshold_activatesTheDragWithGhostAndWorkspace', () => {
    drag.begin(
      'agent',
      'Agent',
      SOURCE,
      new MouseEvent('mousedown', { clientX: 520, clientY: 110 }),
      ALL_EDGES,
    );
    // A press alone arms but does not activate the drag.
    expect(drag.active()).toBe(false);

    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 560, clientY: 150 }));

    expect(drag.active()).toBe(true);
    expect(drag.panelId()).toBe('agent');
    expect(drag.title()).toBe('Agent');
    expect(drag.ghost()).not.toBeNull();
    expect(drag.workspace()).toEqual({ left: 0, top: 0, width: 800, height: 600 });

    document.dispatchEvent(new MouseEvent('mouseup'));
    expect(drag.active()).toBe(false);
  });

  it('begin_whenPressDoesNotMove_neverActivates', () => {
    drag.begin(
      'agent',
      'Agent',
      SOURCE,
      new MouseEvent('mousedown', { clientX: 520, clientY: 110 }),
      ALL_EDGES,
    );

    document.dispatchEvent(new MouseEvent('mouseup'));

    expect(drag.active()).toBe(false);
    expect(drops).toEqual([]);
  });

  it('onMove_nearABorder_targetsTheEdgeAndShowsItsPreview', () => {
    drag.begin(
      'agent',
      'Agent',
      SOURCE,
      new MouseEvent('mousedown', { clientX: 520, clientY: 110 }),
      ALL_EDGES,
    );

    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 300 }));

    expect(drag.hotEdge()).toBe('left');
    expect(drag.preview()).not.toBeNull();
    expect(drag.preview()?.left).toBe(0);

    document.dispatchEvent(new MouseEvent('mouseup'));
  });

  it('onMove_overTheCentre_targetsNoEdge', () => {
    drag.begin(
      'agent',
      'Agent',
      SOURCE,
      new MouseEvent('mousedown', { clientX: 520, clientY: 110 }),
      ALL_EDGES,
    );

    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 400, clientY: 300 }));

    expect(drag.active()).toBe(true);
    expect(drag.hotEdge()).toBeNull();
    expect(drag.preview()).toBeNull();

    document.dispatchEvent(new MouseEvent('mouseup'));
  });

  it('onRelease_overAnEdge_commitsTheDropAndResets', () => {
    drag.begin(
      'agent',
      'Agent',
      SOURCE,
      new MouseEvent('mousedown', { clientX: 520, clientY: 110 }),
      ALL_EDGES,
    );
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 790, clientY: 300 }));

    document.dispatchEvent(new MouseEvent('mouseup'));

    expect(drops).toEqual([{ panelId: 'agent', edge: 'right' }]);
    expect(drag.active()).toBe(false);
    expect(drag.hotEdge()).toBeNull();
  });

  it('onRelease_overNoEdge_dropsNothing', () => {
    drag.begin(
      'agent',
      'Agent',
      SOURCE,
      new MouseEvent('mousedown', { clientX: 520, clientY: 110 }),
      ALL_EDGES,
    );
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 400, clientY: 300 }));

    document.dispatchEvent(new MouseEvent('mouseup'));

    expect(drops).toEqual([]);
  });

  it('begin_whenAlreadyArmed_isIgnored', () => {
    drag.begin(
      'agent',
      'Agent',
      SOURCE,
      new MouseEvent('mousedown', { clientX: 520, clientY: 110 }),
      ALL_EDGES,
    );

    drag.begin(
      'find',
      'Find',
      SOURCE,
      new MouseEvent('mousedown', { clientX: 520, clientY: 110 }),
      ALL_EDGES,
    );
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 560, clientY: 150 }));

    expect(drag.panelId()).toBe('agent');

    document.dispatchEvent(new MouseEvent('mouseup'));
  });

  it('allowedEdges_whileDragging_reflectTheDraggedPanel', () => {
    drag.begin(
      'agent',
      'Agent',
      SOURCE,
      new MouseEvent('mousedown', { clientX: 520, clientY: 110 }),
      SIDES,
    );
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 560, clientY: 150 }));

    expect(drag.allowedEdges()).toEqual(SIDES);

    document.dispatchEvent(new MouseEvent('mouseup'));
  });

  it('onMove_overADisallowedEdge_targetsNoEdge', () => {
    drag.begin(
      'agent',
      'Agent',
      SOURCE,
      new MouseEvent('mousedown', { clientX: 520, clientY: 110 }),
      SIDES,
    );

    // The bottom border would normally target the bottom edge, but it is not an allowed edge.
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 400, clientY: 590 }));

    expect(drag.hotEdge()).toBeNull();
    expect(drag.preview()).toBeNull();

    document.dispatchEvent(new MouseEvent('mouseup'));
  });

  it('onRelease_overADisallowedEdge_dropsNothing', () => {
    drag.begin(
      'agent',
      'Agent',
      SOURCE,
      new MouseEvent('mousedown', { clientX: 520, clientY: 110 }),
      SIDES,
    );
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 400, clientY: 590 }));

    document.dispatchEvent(new MouseEvent('mouseup'));

    expect(drops).toEqual([]);
  });

  it('onMove_overAnAllowedEdge_whenOthersRestricted_stillTargetsIt', () => {
    drag.begin(
      'agent',
      'Agent',
      SOURCE,
      new MouseEvent('mousedown', { clientX: 520, clientY: 110 }),
      SIDES,
    );

    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 300 }));

    expect(drag.hotEdge()).toBe('left');

    document.dispatchEvent(new MouseEvent('mouseup'));
  });
});
