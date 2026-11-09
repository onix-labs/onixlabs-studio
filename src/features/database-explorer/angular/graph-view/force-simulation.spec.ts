import { describe, expect, it } from 'vitest';
import { ForceSimulation, SimulationPoint } from './force-simulation';

/**
 * The circle radius the Graph view lays out with.
 */
const RADIUS: number = 22;

/**
 * The least distance two circles' centres keep once the collision force has run: two radii and a gap.
 */
const GAP: number = RADIUS * 2 + 8;

/**
 * A small graph: a triangle with a tail.
 */
const IDS: readonly string[] = ['a', 'b', 'c', 'd', 'e'];
const LINKS: readonly { readonly start: string; readonly end: string }[] = [
  { start: 'a', end: 'b' },
  { start: 'b', end: 'c' },
  { start: 'c', end: 'a' },
  { start: 'c', end: 'd' },
  { start: 'd', end: 'e' },
];

/**
 * Builds the small graph's simulation.
 * @returns Returns the simulation.
 */
function simulation(): ForceSimulation {
  return new ForceSimulation(IDS, LINKS, RADIUS);
}

/**
 * Lists every position, in id order.
 * @param positions The positions.
 * @returns Returns them as pairs.
 */
function pairs(positions: ReadonlyMap<string, SimulationPoint>): readonly [number, number][] {
  return [...positions.values()].map((point: SimulationPoint): [number, number] => [
    point.x,
    point.y,
  ]);
}

/**
 * Gets the nearest any two nodes are.
 * @param positions The positions.
 * @returns Returns the least distance between two centres.
 */
function nearest(positions: ReadonlyMap<string, SimulationPoint>): number {
  const points: readonly SimulationPoint[] = [...positions.values()];
  let least: number = Number.POSITIVE_INFINITY;
  for (let a: number = 0; a < points.length; a++) {
    for (let b: number = a + 1; b < points.length; b++) {
      least = Math.min(least, Math.hypot(points[b].x - points[a].x, points[b].y - points[a].y));
    }
  }
  return least;
}

/**
 * Ticks a simulation until it rests, or gives up.
 * @param sim The simulation.
 * @param limit The most ticks to run.
 * @returns Returns the ticks it took.
 */
function runToRest(sim: ForceSimulation, limit: number = 5_000): number {
  let ticks: number = 0;
  while (sim.active && ticks < limit) {
    sim.tick();
    ticks++;
  }
  return ticks;
}

describe('ForceSimulation', () => {
  it('isDeterministic_layingAGraphOutTheSameWayEveryTime', () => {
    const first: ForceSimulation = simulation();
    const second: ForceSimulation = simulation();

    first.settle(0.01);
    second.settle(0.01);

    expect(pairs(first.positions())).toEqual(pairs(second.positions()));
  });

  it('positions_areGivenForEveryNode_byId', () => {
    const positions: ReadonlyMap<string, SimulationPoint> = simulation().positions();

    expect([...positions.keys()]).toEqual(IDS);
    for (const point of positions.values()) {
      expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
    }
  });

  it('startsActive_andComesToRest', () => {
    const sim: ForceSimulation = simulation();
    expect(sim.active).toBe(true);

    const ticks: number = runToRest(sim);

    expect(sim.active).toBe(false);
    expect(ticks).toBeLessThan(5_000);
  });

  it('settle_runsUntilItHasCooled_thenStops', () => {
    const sim: ForceSimulation = simulation();

    sim.settle(0.08);
    const settled: readonly [number, number][] = pairs(sim.positions());
    sim.settle(0.08);

    expect(pairs(sim.positions())).toEqual(settled);
    expect(sim.active).toBe(true);
  });

  it('afterSettling_noTwoCirclesOverlap', () => {
    const sim: ForceSimulation = simulation();

    sim.settle(0.01);

    expect(nearest(sim.positions())).toBeGreaterThanOrEqual(GAP - 1);
  });

  it('aRelationship_drawsItsEndsCloserThanAPairWithout', () => {
    const sim: ForceSimulation = new ForceSimulation(
      ['a', 'b', 'c'],
      [{ start: 'a', end: 'b' }],
      RADIUS,
    );

    runToRest(sim);

    const a: SimulationPoint | null = sim.position('a');
    const b: SimulationPoint | null = sim.position('b');
    const c: SimulationPoint | null = sim.position('c');
    if (a === null || b === null || c === null) {
      throw new Error('A node went missing');
    }
    const linked: number = Math.hypot(b.x - a.x, b.y - a.y);
    expect(linked).toBeLessThan(Math.hypot(c.x - a.x, c.y - a.y));
    expect(linked).toBeLessThan(Math.hypot(c.x - b.x, c.y - b.y));
  });

  it('linksToUnknownNodesOrToThemselves_areIgnored', () => {
    const sim: ForceSimulation = new ForceSimulation(
      ['a', 'b'],
      [
        { start: 'a', end: 'ghost' },
        { start: 'a', end: 'a' },
      ],
      RADIUS,
    );

    runToRest(sim);

    for (const point of sim.positions().values()) {
      expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
    }
  });

  it('hold_pinsTheNodeWhereItIsHeld_andKeepsTheSimulationWarm', () => {
    const sim: ForceSimulation = simulation();
    runToRest(sim);
    expect(sim.active).toBe(false);

    sim.hold('a', { x: 300, y: -200 });
    for (let tick: number = 0; tick < 2_000; tick++) {
      sim.tick();
    }

    expect(sim.position('a')).toEqual({ x: 300, y: -200 });
    expect(sim.active).toBe(true);
  });

  it('hold_movesItsNeighboursOutOfTheWay', () => {
    const sim: ForceSimulation = simulation();
    runToRest(sim);
    const b: SimulationPoint | null = sim.position('b');
    if (b === null) {
      throw new Error('No b');
    }

    // Dropped right on top of another node, which must give way: a held node does not.
    sim.hold('a', b);
    sim.tick();

    const a: SimulationPoint | null = sim.position('a');
    const moved: SimulationPoint | null = sim.position('b');
    expect(a).toEqual(b);
    expect(moved).not.toEqual(b);
    expect(nearest(sim.positions())).toBeGreaterThan(0);
  });

  it('release_freesTheNode_andTheSimulationComesToRestAgain', () => {
    const sim: ForceSimulation = simulation();
    runToRest(sim);
    sim.hold('a', { x: 300, y: -200 });
    for (let tick: number = 0; tick < 50; tick++) {
      sim.tick();
    }

    sim.release('a');
    const ticks: number = runToRest(sim);

    expect(sim.active).toBe(false);
    expect(ticks).toBeLessThan(5_000);
    // Freed, it is drawn back towards the rest rather than left where it was dropped.
    expect(sim.position('a')).not.toEqual({ x: 300, y: -200 });
  });

  it('holdOrRelease_ofAnUnknownNode_changesNothing', () => {
    const sim: ForceSimulation = simulation();
    runToRest(sim);
    const before: readonly [number, number][] = pairs(sim.positions());

    sim.hold('ghost', { x: 1, y: 1 });

    expect(sim.active).toBe(false);
    expect(pairs(sim.positions())).toEqual(before);
    expect(sim.position('ghost')).toBeNull();

    sim.release('ghost');
    expect(sim.active).toBe(false);
  });

  it('twoNodesOnOneSpot_arePartedRatherThanLeftTogether', () => {
    const sim: ForceSimulation = new ForceSimulation(['a', 'b'], [], RADIUS);
    sim.hold('a', { x: 0, y: 0 });
    sim.hold('b', { x: 0, y: 0 });
    sim.release('b');

    sim.tick();

    const a: SimulationPoint | null = sim.position('a');
    const b: SimulationPoint | null = sim.position('b');
    if (a === null || b === null) {
      throw new Error('A node went missing');
    }
    expect(Number.isFinite(b.x) && Number.isFinite(b.y)).toBe(true);
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThanOrEqual(GAP - 1);
  });

  it('withNoNodes_isHarmless', () => {
    const sim: ForceSimulation = new ForceSimulation([], [], RADIUS);

    runToRest(sim);

    expect(sim.positions().size).toBe(0);
    expect(sim.active).toBe(false);
  });
});
