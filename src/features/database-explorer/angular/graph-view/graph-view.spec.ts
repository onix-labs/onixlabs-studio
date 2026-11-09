import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  DatabaseValue,
  GraphNodeValue,
  GraphRelationshipValue,
} from '@shared/api/database-engine-protocol';
import { curveGeometry, GraphPick, GraphView, laneRelationships, loopGeometry } from './graph-view';

/**
 * A point in layout space.
 */
interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * Builds a relationship.
 * @param id Its id.
 * @param start The node it starts at.
 * @param end The node it ends at.
 * @returns Returns the relationship.
 */
function relationship(id: string, start: string, end: string): GraphRelationshipValue {
  return { type: 'relationship', id, relationshipType: 'KNOWS', start, end, properties: {} };
}

/**
 * Builds a node.
 * @param id Its id.
 * @returns Returns the node.
 */
function node(id: string): GraphNodeValue {
  return { type: 'node', id, labels: ['Person'], properties: { name: id } };
}

/**
 * Lays out relationships and reads each one's lane.
 * @param values The relationships.
 * @returns Returns the lanes, by id.
 */
function lanes(
  values: readonly GraphRelationshipValue[],
): ReadonlyMap<
  string,
  { readonly kind: string; readonly offset?: number; readonly angle?: number }
> {
  return laneRelationships(values.map((value: GraphRelationshipValue) => ({ value })));
}

/**
 * Reads the points out of an SVG path, in order.
 * @param path The path.
 * @returns Returns its points.
 */
function pointsOf(path: string): readonly Point[] {
  const numbers: readonly number[] = path
    .split(/[\s,A-Z]+/)
    .filter((part: string): boolean => part !== '')
    .map(Number);
  const points: Point[] = [];
  for (let at: number = 0; at < numbers.length; at += 2) {
    points.push({ x: numbers[at], y: numbers[at + 1] });
  }
  return points;
}

/**
 * Measures the distance between two points.
 * @param a The one.
 * @param b The other.
 * @returns Returns the distance.
 */
function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

describe('laneRelationships', () => {
  it('aLoneRelationship_isDrawnStraight', () => {
    expect(lanes([relationship('r1', 'a', 'b')]).get('r1')).toEqual({ kind: 'pair', offset: 0 });
  });

  it('relationshipsBetweenTheSamePair_fanOutEvenlyEitherSide', () => {
    const laid: ReturnType<typeof lanes> = lanes([
      relationship('r1', 'a', 'b'),
      relationship('r2', 'a', 'b'),
      relationship('r3', 'a', 'b'),
    ]);

    expect(
      ['r1', 'r2', 'r3'].map((id: string): number | undefined => laid.get(id)?.offset),
    ).toEqual([-26, 0, 26]);
  });

  it('relationshipsPointingOppositeWays_areBowedToOppositeSides', () => {
    const laid: ReturnType<typeof lanes> = lanes([
      relationship('there', 'a', 'b'),
      relationship('back', 'b', 'a'),
    ]);

    // Each offset is against its own direction; the reverse one's is flipped, so in the pair's own
    // frame the two stand on opposite sides of the line.
    const there: number = laid.get('there')?.offset ?? Number.NaN;
    const back: number = laid.get('back')?.offset ?? Number.NaN;
    expect(there).toBe(-13);
    expect(back).toBe(-13);
    expect(there).not.toBe(-back);
  });

  it('separatePairs_areLanedApart', () => {
    const laid: ReturnType<typeof lanes> = lanes([
      relationship('r1', 'a', 'b'),
      relationship('r2', 'b', 'c'),
    ]);

    expect(laid.get('r1')).toEqual({ kind: 'pair', offset: 0 });
    expect(laid.get('r2')).toEqual({ kind: 'pair', offset: 0 });
  });

  it('selfLoops_areSpacedAroundTheRimFromTheTop', () => {
    const laid: ReturnType<typeof lanes> = lanes([
      relationship('l1', 'a', 'a'),
      relationship('r1', 'a', 'b'),
      relationship('l2', 'a', 'a'),
    ]);

    expect(laid.get('l1')).toEqual({ kind: 'loop', angle: -Math.PI / 2 });
    expect(laid.get('l2')).toEqual({ kind: 'loop', angle: -Math.PI / 2 + Math.PI / 4 });
    expect(laid.get('r1')).toEqual({ kind: 'pair', offset: 0 });
  });
});

describe('curveGeometry', () => {
  it('withNoOffset_runsStraightFromRimToJustShortOfTheOtherRim', () => {
    const geometry: { path: string; label: Point } = curveGeometry(
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      0,
    );

    expect(geometry.path).toBe('M 22 0 Q 50 0 75 0');
    expect(geometry.label).toEqual({ x: (22 + 100 + 75) / 4, y: 0 });
  });

  it('withAnOffset_bowsToOneSide_andTheOppositeOffsetToTheOther', () => {
    const one: { path: string; label: Point } = curveGeometry({ x: 0, y: 0 }, { x: 100, y: 0 }, 13);
    const other: { path: string; label: Point } = curveGeometry(
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      -13,
    );

    const [, control] = pointsOf(one.path);
    expect(control).toEqual({ x: 50, y: 26 });
    expect(one.label.y).toBeGreaterThan(0);
    expect(other.label.y).toBeCloseTo(-one.label.y);
    expect(other.label.x).toBeCloseTo(one.label.x);
  });

  it('startsOnTheStartsRim_andStopsShortOfTheEndsForItsArrowhead', () => {
    const start: Point = { x: 10, y: 20 };
    const end: Point = { x: 130, y: -70 };
    const [from, , to] = pointsOf(curveGeometry(start, end, 26).path);

    expect(distance(start, from)).toBeCloseTo(22);
    expect(distance(end, to)).toBeCloseTo(25);
  });

  it('betweenNodesOnOneSpot_isStillANumber', () => {
    const geometry: { path: string; label: Point } = curveGeometry(
      { x: 5, y: 5 },
      { x: 5, y: 5 },
      0,
    );

    expect(geometry.path).not.toContain('NaN');
    expect(Number.isFinite(geometry.label.x) && Number.isFinite(geometry.label.y)).toBe(true);
  });
});

describe('loopGeometry', () => {
  it('leavesAndReturnsToTheRim_withItsLabelBeyondTheTop', () => {
    const centre: Point = { x: 40, y: 60 };
    const geometry: { path: string; label: Point } = loopGeometry(centre, -Math.PI / 2);

    expect(geometry.path.startsWith('M ')).toBe(true);
    expect(geometry.path).toContain(' C ');
    const [from, out, back, to] = pointsOf(geometry.path);
    expect(distance(centre, from)).toBeCloseTo(22);
    expect(distance(centre, to)).toBeCloseTo(25);
    expect(distance(centre, out)).toBeCloseTo(70);
    expect(distance(centre, back)).toBeCloseTo(70);
    expect(geometry.label.x).toBeCloseTo(40);
    expect(geometry.label.y).toBeCloseTo(60 - (22 + 48 * 0.85));
  });

  it('standsWhereItsAngleSays', () => {
    const geometry: { path: string; label: Point } = loopGeometry({ x: 0, y: 0 }, 0);

    expect(geometry.label.x).toBeGreaterThan(0);
    expect(geometry.label.y).toBeCloseTo(0);
  });
});

/**
 * The view's protected surface, as its template uses it.
 */
interface GraphViewInternals {
  readonly view: () => { readonly x: number; readonly y: number; readonly k: number };
  readonly graph: () => {
    readonly nodes: readonly { readonly value: GraphNodeValue }[];
    readonly relationships: readonly { readonly value: GraphRelationshipValue }[];
  };
  readonly pickedId: () => string | null;
  onPointerDown(
    event: PointerEvent,
    id?: string,
    relationship?: { readonly value: GraphRelationshipValue },
  ): void;
  onPointerMove(event: PointerEvent): void;
  onPointerUp(node?: { readonly value: GraphNodeValue }): void;
  onWheel(event: WheelEvent): void;
}

/**
 * A stand-in for the canvas: its screen matrix scales by {@link scale} and is offset by (10, 20).
 */
class FakeCanvas {
  /**
   * Creates the canvas.
   * @param scale How many screen pixels one layout unit takes.
   */
  public constructor(private readonly scale: number) {}

  /**
   * Captures a pointer; nothing to do.
   */
  public setPointerCapture(): void {
    return undefined;
  }

  /**
   * Answers the screen matrix.
   * @returns Returns the matrix, with its inverse.
   */
  public getScreenCTM(): object {
    const scale: number = this.scale;
    return {
      a: scale,
      d: scale,
      e: 10,
      f: 20,
      inverse: (): object => ({ a: 1 / scale, d: 1 / scale, e: -10 / scale, f: -20 / scale }),
    };
  }
}

/**
 * A point with the one method the view asks of a `DOMPoint`, which jsdom does not provide.
 */
class FakeDomPoint {
  /**
   * Creates the point.
   * @param x Its x.
   * @param y Its y.
   */
  public constructor(
    public readonly x: number,
    public readonly y: number,
  ) {}

  /**
   * Transforms the point by a scale-and-translate matrix.
   * @param matrix The matrix.
   * @returns Returns the point transformed.
   */
  public matrixTransform(matrix: {
    readonly a: number;
    readonly d: number;
    readonly e: number;
    readonly f: number;
  }): FakeDomPoint {
    return new FakeDomPoint(this.x * matrix.a + matrix.e, this.y * matrix.d + matrix.f);
  }
}

describe('GraphView', () => {
  let fixture: ComponentFixture<GraphView>;
  let view: GraphViewInternals;
  let picks: GraphPick[];
  let canvas: FakeCanvas;

  /**
   * Builds a pointer event over the canvas.
   * @param x The pointer's x on screen.
   * @param y The pointer's y on screen.
   * @returns Returns the event.
   */
  function pointer(x: number, y: number): PointerEvent {
    return {
      clientX: x,
      clientY: y,
      pointerId: 1,
      currentTarget: canvas,
      stopPropagation: (): void => undefined,
    } as unknown as PointerEvent;
  }

  /**
   * Builds a wheel event over the canvas.
   * @param init What the wheel reports.
   * @returns Returns the event.
   */
  function wheel(init: Partial<WheelEvent>): WheelEvent {
    return {
      clientX: 110,
      clientY: 220,
      deltaX: 0,
      deltaY: 0,
      deltaMode: 0,
      altKey: false,
      ctrlKey: false,
      currentTarget: canvas,
      preventDefault: (): void => undefined,
      ...init,
    } as unknown as WheelEvent;
  }

  /**
   * Reads the canvas point under the wheel's pointer, in the graph's own coordinates.
   * @returns Returns the point the zoom must hold still.
   */
  function underPointer(): Point {
    const { x, y, k } = view.view();
    // The pointer at (110, 220) on screen is (100, 200) in the canvas, at scale 1.
    return { x: (100 - x) / k, y: (200 - y) / k };
  }

  beforeEach(() => {
    vi.stubGlobal('DOMPoint', FakeDomPoint);
    canvas = new FakeCanvas(1);
    TestBed.configureTestingModule({ imports: [GraphView] });
    TestBed.overrideComponent(GraphView, { set: { template: '' } });
    fixture = TestBed.createComponent(GraphView);
    const rows: readonly (readonly DatabaseValue[])[] = [
      [node('a'), relationship('r1', 'a', 'b'), node('b')],
    ];
    fixture.componentRef.setInput('rows', rows);
    view = fixture.componentInstance as unknown as GraphViewInternals;
    picks = [];
    fixture.componentInstance.picked.subscribe((pick: GraphPick): number => picks.push(pick));
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    vi.unstubAllGlobals();
  });

  it('graph_findsTheNodesAndRelationshipsInTheRows', () => {
    expect(
      view.graph().nodes.map((laid: { value: GraphNodeValue }): string => laid.value.id),
    ).toEqual(['a', 'b']);
    expect(view.graph().relationships).toHaveLength(1);
  });

  it('aRelationshipPressedAndReleasedInPlace_isPickedOnRelease', () => {
    const laid: { readonly value: GraphRelationshipValue } = view.graph().relationships[0];

    view.onPointerDown(pointer(5, 5), undefined, laid);
    expect(picks).toEqual([]);
    view.onPointerUp();

    expect(view.pickedId()).toBe('r1');
    expect(picks[0].title).toBe('[:KNOWS]');
  });

  it('aRelationshipDragged_pansTheCanvasAndPicksNothing', () => {
    const laid: { readonly value: GraphRelationshipValue } = view.graph().relationships[0];

    view.onPointerDown(pointer(5, 5), undefined, laid);
    view.onPointerMove(pointer(45, 35));
    view.onPointerUp();

    expect(picks).toEqual([]);
    expect(view.view()).toEqual({ x: 40, y: 30, k: 1 });
  });

  it('aNodePressedAndReleasedInPlace_isPicked', () => {
    const a: { readonly value: GraphNodeValue } = view.graph().nodes[0];

    view.onPointerDown(pointer(5, 5), 'a');
    view.onPointerUp(a);

    expect(view.pickedId()).toBe('a');
    expect(picks[0].title).toBe(':Person');
  });

  it('aNodeDragged_isNotPicked_andTheCanvasStaysPut', () => {
    const a: { readonly value: GraphNodeValue } = view.graph().nodes[0];

    view.onPointerDown(pointer(5, 5), 'a');
    view.onPointerMove(pointer(60, 60));
    view.onPointerUp(a);

    expect(picks).toEqual([]);
    expect(view.view()).toEqual({ x: 0, y: 0, k: 1 });
  });

  it('aPlainScroll_pansByTheCanvasUnitsMoved', () => {
    canvas = new FakeCanvas(2);

    view.onWheel(wheel({ deltaX: 10, deltaY: -20 }));

    expect(view.view()).toEqual({ x: -5, y: 10, k: 1 });
  });

  it('optionScroll_zoomsAboutThePointer', () => {
    const before: Point = underPointer();

    view.onWheel(wheel({ deltaY: -20, altKey: true }));

    expect(view.view().k).toBeCloseTo(Math.exp(0.2));
    const after: Point = underPointer();
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('aPinch_whichArrivesAsControlScroll_zoomsToo', () => {
    view.onWheel(wheel({ deltaY: 20, ctrlKey: true }));

    expect(view.view().k).toBeCloseTo(Math.exp(-0.2));
  });

  it('aCoarseWheelNotch_zoomsOneCappedStep', () => {
    view.onWheel(wheel({ deltaY: -1_000, altKey: true }));

    expect(view.view().k).toBeCloseTo(Math.exp(0.4));
  });

  it('aScrollInLines_isCountedInPixels', () => {
    view.onWheel(wheel({ deltaY: -1, deltaMode: 1, altKey: true }));

    expect(view.view().k).toBeCloseTo(Math.exp(0.16));
  });

  it('aModifiedScrollOnTheOtherAxis_stillZooms', () => {
    view.onWheel(wheel({ deltaX: -10, deltaY: 1, altKey: true }));

    expect(view.view().k).toBeCloseTo(Math.exp(0.1));
  });

  it('zoom_isHeldBetweenAFifthAndFourTimes', () => {
    for (let step: number = 0; step < 50; step++) {
      view.onWheel(wheel({ deltaY: -40, altKey: true }));
    }
    expect(view.view().k).toBe(4);

    for (let step: number = 0; step < 100; step++) {
      view.onWheel(wheel({ deltaY: 40, altKey: true }));
    }
    expect(view.view().k).toBe(0.2);
  });
});
