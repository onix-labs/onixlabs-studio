/**
 * A point in layout space.
 */
export interface SimulationPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * How strongly every pair of nodes pushes apart, as like poles of two magnets do.
 */
const CHARGE: number = 500;

/**
 * The length a relationship's spring rests at.
 */
const SPRING_LENGTH: number = 110;

/**
 * How stiff a relationship's spring is.
 */
const SPRING_STIFFNESS: number = 0.08;

/**
 * How firmly everything is drawn back towards the centre.
 */
const CENTRING: number = 0.03;

/**
 * How much of its velocity a node keeps from one tick to the next.
 */
const FRICTION: number = 0.6;

/**
 * How quickly the simulation cools towards its target heat each tick.
 */
const COOLING: number = 0.0228;

/**
 * The heat below which a cooling simulation stops.
 */
const STILL: number = 0.002;

/**
 * How many passes the collision force makes each tick, so a crowd is pushed apart and not just its
 * nearest pairs.
 */
const COLLISION_PASSES: number = 2;

/**
 * A live force layout for the Graph view (#1093), in the manner of d3-force and so of Neo4j Browser:
 * every node repels every other, each relationship is a spring, everything is drawn gently to the
 * centre, and no two circles may overlap. It runs hot and cools to rest; dragging a node holds it to
 * the pointer and keeps the simulation warm, so its neighbours are shoved aside, and letting go
 * frees it to settle with the rest.
 *
 * Deterministic — the nodes start on a spiral, not at random — so a result lays out the same way
 * every time it is drawn.
 */
export class ForceSimulation {
  private readonly x: Float64Array;
  private readonly y: Float64Array;
  private readonly vx: Float64Array;
  private readonly vy: Float64Array;

  /**
   * Holds each pinned node's position, or NaN for a node that is free.
   */
  private readonly px: Float64Array;
  private readonly py: Float64Array;

  /**
   * Holds the springs, as pairs of node indices.
   */
  private readonly springs: readonly (readonly [number, number])[];

  /**
   * Holds the index of each node, by id.
   */
  private readonly index: ReadonlyMap<string, number>;

  /**
   * Holds the simulation's heat: how far each force moves a node this tick.
   */
  private heat: number = 1;

  /**
   * Holds the heat the simulation cools (or warms) towards — none at rest, some while a node is held.
   */
  private targetHeat: number = 0;

  /**
   * Creates the simulation.
   * @param ids The nodes' ids.
   * @param links The relationships, as start and end ids.
   * @param radius The radius of a node's circle, which no other circle may enter.
   */
  public constructor(
    private readonly ids: readonly string[],
    links: readonly { readonly start: string; readonly end: string }[],
    private readonly radius: number,
  ) {
    this.index = new Map<string, number>(
      ids.map((id: string, at: number): [string, number] => [id, at]),
    );
    const count: number = ids.length;
    this.x = new Float64Array(count);
    this.y = new Float64Array(count);
    this.vx = new Float64Array(count);
    this.vy = new Float64Array(count);
    this.px = new Float64Array(count).fill(Number.NaN);
    this.py = new Float64Array(count).fill(Number.NaN);
    for (let at: number = 0; at < count; at++) {
      const angle: number = at * 2.399963;
      const distance: number = 40 * Math.sqrt(at + 1);
      this.x[at] = Math.cos(angle) * distance;
      this.y[at] = Math.sin(angle) * distance;
    }
    this.springs = links
      .map((link: { readonly start: string; readonly end: string }): [number, number] => [
        this.index.get(link.start) ?? -1,
        this.index.get(link.end) ?? -1,
      ])
      .filter(([a, b]: [number, number]): boolean => a >= 0 && b >= 0 && a !== b);
  }

  /**
   * Gets whether the simulation is still moving, or held warm.
   */
  public get active(): boolean {
    return this.heat > STILL || this.targetHeat > 0;
  }

  /**
   * Advances the simulation one step.
   */
  public tick(): void {
    const count: number = this.ids.length;
    const heat: number = this.heat;
    // Every pair repels, by the inverse of their distance.
    for (let a: number = 0; a < count; a++) {
      for (let b: number = a + 1; b < count; b++) {
        let dx: number = this.x[b] - this.x[a];
        let dy: number = this.y[b] - this.y[a];
        if (dx === 0 && dy === 0) {
          // Two nodes on one spot: part them along a direction of their own, not along nothing.
          dx = (b - a) * 0.01;
          dy = 0.01;
        }
        const squared: number = Math.max(dx * dx + dy * dy, this.radius * this.radius);
        const push: number = (CHARGE * heat) / squared;
        this.vx[a] -= dx * push;
        this.vy[a] -= dy * push;
        this.vx[b] += dx * push;
        this.vy[b] += dy * push;
      }
    }
    // Each relationship pulls or pushes its two ends towards its resting length.
    for (const [a, b] of this.springs) {
      const dx: number = this.x[b] - this.x[a];
      const dy: number = this.y[b] - this.y[a];
      const length: number = Math.max(1, Math.hypot(dx, dy));
      const pull: number = ((length - SPRING_LENGTH) / length) * SPRING_STIFFNESS * heat;
      this.vx[a] += dx * pull;
      this.vy[a] += dy * pull;
      this.vx[b] -= dx * pull;
      this.vy[b] -= dy * pull;
    }
    for (let at: number = 0; at < count; at++) {
      this.vx[at] -= this.x[at] * CENTRING * heat;
      this.vy[at] -= this.y[at] * CENTRING * heat;
      this.vx[at] *= FRICTION;
      this.vy[at] *= FRICTION;
      if (Number.isNaN(this.px[at])) {
        this.x[at] += this.vx[at];
        this.y[at] += this.vy[at];
      } else {
        this.x[at] = this.px[at];
        this.y[at] = this.py[at];
        this.vx[at] = 0;
        this.vy[at] = 0;
      }
    }
    this.separate();
    this.heat += (this.targetHeat - this.heat) * COOLING;
  }

  /**
   * Pushes apart any two circles that overlap, however cool the simulation — the one force that is
   * not a tendency but a rule. A pinned node does not move, so its neighbour moves the whole way.
   */
  private separate(): void {
    const count: number = this.ids.length;
    const gap: number = this.radius * 2 + 8;
    for (let pass: number = 0; pass < COLLISION_PASSES; pass++) {
      for (let a: number = 0; a < count; a++) {
        for (let b: number = a + 1; b < count; b++) {
          const dx: number = this.x[b] - this.x[a];
          const dy: number = this.y[b] - this.y[a];
          const distance: number = Math.hypot(dx, dy) || 0.01;
          if (distance >= gap) {
            continue;
          }
          const overlap: number = (gap - distance) / distance;
          const pinnedA: boolean = !Number.isNaN(this.px[a]);
          const pinnedB: boolean = !Number.isNaN(this.px[b]);
          const shareA: number = pinnedA ? 0 : pinnedB ? 1 : 0.5;
          const shareB: number = pinnedB ? 0 : pinnedA ? 1 : 0.5;
          this.x[a] -= dx * overlap * shareA;
          this.y[a] -= dy * overlap * shareA;
          this.x[b] += dx * overlap * shareB;
          this.y[b] += dy * overlap * shareB;
        }
      }
    }
  }

  /**
   * Runs the simulation until it has cooled to a given heat, without drawing — so a result opens
   * already laid out, and only the last of its settling is seen.
   * @param heat The heat to stop at.
   */
  public settle(heat: number): void {
    while (this.heat > heat && this.targetHeat === 0) {
      this.tick();
    }
  }

  /**
   * Pins a node to a position and keeps the simulation warm while it is held.
   * @param id The node's id.
   * @param point Where it is held.
   */
  public hold(id: string, point: SimulationPoint): void {
    const at: number | undefined = this.index.get(id);
    if (at === undefined) {
      return;
    }
    this.px[at] = point.x;
    this.py[at] = point.y;
    this.x[at] = point.x;
    this.y[at] = point.y;
    this.targetHeat = 0.3;
    this.heat = Math.max(this.heat, 0.3);
  }

  /**
   * Lets go of a held node: it goes back to moving with the rest, from where it was dropped, and the
   * whole graph rearranges itself around it as it cools. Nothing stays pinned — a pinned node no
   * longer moves out of anything's way, and a graph of them stops behaving like one.
   * @param id The node's id.
   */
  public release(id: string): void {
    const at: number | undefined = this.index.get(id);
    if (at !== undefined) {
      this.px[at] = Number.NaN;
      this.py[at] = Number.NaN;
      this.vx[at] = 0;
      this.vy[at] = 0;
    }
    this.targetHeat = 0;
  }

  /**
   * Gets every node's position.
   * @returns Returns the positions, by id.
   */
  public positions(): ReadonlyMap<string, SimulationPoint> {
    return new Map<string, SimulationPoint>(
      this.ids.map((id: string, at: number): [string, SimulationPoint] => [
        id,
        { x: this.x[at], y: this.y[at] },
      ]),
    );
  }

  /**
   * Gets one node's position.
   * @param id The node's id.
   * @returns Returns the position, or null for a node the simulation does not hold.
   */
  public position(id: string): SimulationPoint | null {
    const at: number | undefined = this.index.get(id);
    return at === undefined ? null : { x: this.x[at], y: this.y[at] };
  }
}
