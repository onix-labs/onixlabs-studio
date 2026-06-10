import { TestBed } from '@angular/core/testing';
import { DockGeometry, DockGroupHit } from './dock-geometry';

/**
 * Creates a detached element whose bounding rectangle is fixed for hit-testing.
 * @param left The left coordinate.
 * @param top The top coordinate.
 * @param width The width.
 * @param height The height.
 * @returns Returns the element.
 */
function elementAt(left: number, top: number, width: number, height: number): HTMLElement {
  const element: HTMLElement = document.createElement('div');
  element.getBoundingClientRect = (): DOMRect => ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: (): object => ({}),
  });
  return element;
}

describe('DockGeometry', () => {
  let geometry: DockGeometry;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    geometry = TestBed.inject(DockGeometry);
  });

  it('groupAt_whenPointInsideARegisteredGroup_returnsThatGroup', () => {
    geometry.registerGroup('stack-1', 'tool', elementAt(0, 0, 100, 100));
    geometry.registerGroup('stack-2', 'document', elementAt(100, 0, 100, 100));

    const hit: DockGroupHit | null = geometry.groupAt(150, 50);

    expect(hit?.stackId).toBe('stack-2');
    expect(hit?.role).toBe('document');
  });

  it('groupAt_whenPointOutsideEveryGroup_returnsNull', () => {
    geometry.registerGroup('stack-1', 'tool', elementAt(0, 0, 100, 100));

    expect(geometry.groupAt(500, 500)).toBeNull();
  });

  it('unregisterGroup_whenCalled_removesTheGroupFromHitTesting', () => {
    geometry.registerGroup('stack-1', 'tool', elementAt(0, 0, 100, 100));
    geometry.unregisterGroup('stack-1');

    expect(geometry.groupAt(50, 50)).toBeNull();
  });

  it('rectOf_whenGroupRegistered_returnsItsRectangle', () => {
    geometry.registerGroup('stack-1', 'tool', elementAt(10, 20, 30, 40));

    expect(geometry.rectOf('stack-1')).toEqual({ left: 10, top: 20, width: 30, height: 40 });
    expect(geometry.rectOf('absent')).toBeNull();
  });

  it('workspaceRect_whenWorkspaceSet_returnsItsRectangle', () => {
    geometry.setWorkspace(elementAt(0, 0, 800, 600));

    expect(geometry.workspaceRect()).toEqual({ left: 0, top: 0, width: 800, height: 600 });
  });

  it('workspaceRect_whenNoWorkspaceSet_returnsNull', () => {
    expect(geometry.workspaceRect()).toBeNull();
  });
});
