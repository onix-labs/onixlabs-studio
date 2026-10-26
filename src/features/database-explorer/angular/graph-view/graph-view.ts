import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  Signal,
  signal,
  untracked,
  WritableSignal,
} from '@angular/core';
import {
  DatabaseValue,
  GraphNodeValue,
  GraphRelationshipValue,
} from '@shared/api/database-engine-protocol';
import { cellText } from '../database-values';

/**
 * The theme's accent hues, cycled through per label so every label keeps one colour across a result.
 */
const LABEL_COLOURS: readonly string[] = [
  'var(--accent-blue)',
  'var(--accent-mint)',
  'var(--accent-orange)',
  'var(--accent-purple)',
  'var(--accent-pink)',
  'var(--accent-cyan)',
  'var(--accent-yellow)',
  'var(--accent-coral)',
  'var(--accent-green)',
  'var(--accent-violet)',
];

/**
 * The radius of a node's circle, in layout units.
 */
const NODE_RADIUS: number = 22;

/**
 * How many steps the force layout runs before the graph is drawn.
 */
const LAYOUT_STEPS: number = 320;

/**
 * The most nodes the view draws. A larger result is drawn in part, with a note: a force layout of
 * thousands of nodes is a hairball nobody can read, and Neo4j Browser caps its view the same way.
 */
const MAX_NODES: number = 300;

/**
 * A node as the view lays it out.
 */
interface LaidNode {
  readonly value: GraphNodeValue;
  readonly caption: string;
  readonly colour: string;
}

/**
 * A relationship as the view lays it out.
 */
interface LaidRelationship {
  readonly value: GraphRelationshipValue;
}

/**
 * A point in layout space.
 */
interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * What a click in the graph picked, for the Properties panel.
 */
export interface GraphPick {
  readonly title: string;
  readonly properties: readonly { readonly name: string; readonly value: string }[];
}

/**
 * The Graph view of a result: every node, relationship and path anywhere in its cells, laid
 * out by a small force simulation and drawn as SVG — the view Neo4j Browser opens Cypher results in.
 * Drag the background to pan, scroll to zoom, drag a node to move it, click one to show its properties.
 *
 * Hand-rolled rather than a charting dependency: the simulation is a few dozen lines (repulsion,
 * springs, a pull to the centre), which is all a result-sized graph needs.
 */
@Component({
  selector: 'app-graph-view',
  templateUrl: './graph-view.html',
  styleUrl: './graph-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GraphView {
  /**
   * Gets the result's rows, whose cells are searched for graph values.
   */
  public readonly rows: InputSignal<readonly (readonly DatabaseValue[])[]> =
    input.required<readonly (readonly DatabaseValue[])[]>();

  /**
   * Emits what a click picked.
   */
  public readonly picked: OutputEmitterRef<GraphPick> = output<GraphPick>();

  /**
   * Gets the graph found in the rows.
   */
  protected readonly graph: Signal<{
    readonly nodes: readonly LaidNode[];
    readonly relationships: readonly LaidRelationship[];
    readonly truncated: boolean;
  }> = computed(() => {
    const nodes: Map<string, GraphNodeValue> = new Map<string, GraphNodeValue>();
    const relationships: Map<string, GraphRelationshipValue> = new Map<
      string,
      GraphRelationshipValue
    >();
    const visit: (value: DatabaseValue) => void = (value: DatabaseValue): void => {
      if (value === null || typeof value !== 'object') {
        return;
      }
      switch (value.type) {
        case 'node':
          nodes.set(value.id, value);
          return;
        case 'relationship':
          relationships.set(value.id, value);
          return;
        case 'path':
          value.nodes.forEach(visit);
          value.relationships.forEach(visit);
          return;
        case 'list':
          value.items.forEach(visit);
          return;
        default:
          return;
      }
    };
    for (const row of this.rows()) {
      row.forEach(visit);
    }
    // A relationship returned without its ends still deserves to be drawn: stand an unlabelled node in
    // for each missing end.
    for (const relationship of relationships.values()) {
      for (const end of [relationship.start, relationship.end]) {
        if (!nodes.has(end)) {
          nodes.set(end, { type: 'node', id: end, labels: [], properties: {} });
        }
      }
    }
    const labels: string[] = [];
    const all: GraphNodeValue[] = [...nodes.values()];
    const kept: GraphNodeValue[] = all.slice(0, MAX_NODES);
    const keptIds: ReadonlySet<string> = new Set<string>(
      kept.map((node: GraphNodeValue): string => node.id),
    );
    return {
      nodes: kept.map((node: GraphNodeValue): LaidNode => {
        const label: string = node.labels[0] ?? '';
        if (!labels.includes(label)) {
          labels.push(label);
        }
        return {
          value: node,
          caption: captionOf(node),
          colour: LABEL_COLOURS[labels.indexOf(label) % LABEL_COLOURS.length],
        };
      }),
      relationships: [...relationships.values()]
        .filter(
          (relationship: GraphRelationshipValue): boolean =>
            keptIds.has(relationship.start) && keptIds.has(relationship.end),
        )
        .map((value: GraphRelationshipValue): LaidRelationship => ({ value })),
      truncated: all.length > kept.length,
    };
  });

  /**
   * Holds each node's position, keyed by node id.
   */
  protected readonly positions: WritableSignal<ReadonlyMap<string, Point>> = signal<
    ReadonlyMap<string, Point>
  >(new Map<string, Point>());

  /**
   * Holds the pan and zoom.
   */
  protected readonly view: WritableSignal<{
    readonly x: number;
    readonly y: number;
    readonly k: number;
  }> = signal({
    x: 0,
    y: 0,
    k: 1,
  });

  /**
   * Holds the id of the picked node or relationship.
   */
  protected readonly pickedId: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Gets the SVG transform the pan and zoom amount to.
   */
  protected readonly transform: Signal<string> = computed((): string => {
    const view: { readonly x: number; readonly y: number; readonly k: number } = this.view();
    return `translate(${view.x} ${view.y}) scale(${view.k})`;
  });

  /**
   * Holds the pointer drag in progress: panning the background, or moving a node.
   */
  private drag: {
    readonly kind: 'pan' | 'node';
    readonly id?: string;
    x: number;
    y: number;
    moved: boolean;
  } | null = null;

  /**
   * Holds the SVG's viewBox: the laid-out graph's bounds with a margin, so the graph fills the pane
   * however large or small it laid out.
   */
  protected readonly viewBox: WritableSignal<string> = signal<string>('-400 -300 800 600');

  /**
   * Lays the graph out afresh whenever the result changes.
   */
  public constructor() {
    effect((): void => {
      const graph: {
        readonly nodes: readonly LaidNode[];
        readonly relationships: readonly LaidRelationship[];
      } = this.graph();
      untracked((): void => {
        const positions: ReadonlyMap<string, Point> = layout(graph.nodes, graph.relationships);
        this.positions.set(positions);
        this.viewBox.set(fit(positions));
        this.view.set({ x: 0, y: 0, k: 1 });
      });
    });
  }

  /**
   * Gets a node's position.
   * @param id The node's id.
   * @returns Returns the position.
   */
  protected at(id: string): Point {
    return this.positions().get(id) ?? { x: 0, y: 0 };
  }

  /**
   * Gets the midpoint of a relationship, where its type is written.
   * @param relationship The relationship.
   * @returns Returns the midpoint.
   */
  protected middle(relationship: LaidRelationship): Point {
    const start: Point = this.at(relationship.value.start);
    const end: Point = this.at(relationship.value.end);
    return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  }

  /**
   * Gets the end of a relationship's line, stopped at the target circle's edge so the arrowhead shows.
   * @param relationship The relationship.
   * @returns Returns the end point.
   */
  protected lineEnd(relationship: LaidRelationship): Point {
    const start: Point = this.at(relationship.value.start);
    const end: Point = this.at(relationship.value.end);
    const dx: number = end.x - start.x;
    const dy: number = end.y - start.y;
    const length: number = Math.hypot(dx, dy) || 1;
    return {
      x: end.x - (dx / length) * (NODE_RADIUS + 3),
      y: end.y - (dy / length) * (NODE_RADIUS + 3),
    };
  }

  /**
   * Starts a pan or a node drag.
   * @param event The pointer event.
   * @param id The node pressed on, or undefined for the background.
   */
  protected onPointerDown(event: PointerEvent, id?: string): void {
    event.stopPropagation();
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    this.drag = {
      kind: id === undefined ? 'pan' : 'node',
      id,
      x: event.clientX,
      y: event.clientY,
      moved: false,
    };
  }

  /**
   * Moves the pan or the dragged node.
   * @param event The pointer event.
   */
  protected onPointerMove(event: PointerEvent): void {
    const drag: {
      readonly kind: 'pan' | 'node';
      readonly id?: string;
      x: number;
      y: number;
      moved: boolean;
    } | null = this.drag;
    if (drag === null) {
      return;
    }
    const units: number = unitsPerPixel(event.currentTarget as SVGSVGElement);
    const moveX: number = event.clientX - drag.x;
    const moveY: number = event.clientY - drag.y;
    const dx: number = moveX * units;
    const dy: number = moveY * units;
    drag.x = event.clientX;
    drag.y = event.clientY;
    drag.moved = drag.moved || Math.abs(moveX) + Math.abs(moveY) > 2;
    if (drag.kind === 'pan') {
      this.view.update((view) => ({ ...view, x: view.x + dx, y: view.y + dy }));
      return;
    }
    const k: number = this.view().k;
    const id: string = drag.id ?? '';
    this.positions.update((positions: ReadonlyMap<string, Point>): ReadonlyMap<string, Point> => {
      const current: Point = positions.get(id) ?? { x: 0, y: 0 };
      return new Map<string, Point>([
        ...positions,
        [id, { x: current.x + dx / k, y: current.y + dy / k }],
      ]);
    });
  }

  /**
   * Ends a drag; a press that did not move is a click, and picks what it was on.
   * @param node The node released over, if the drag was of one.
   */
  protected onPointerUp(node?: LaidNode): void {
    const drag: { readonly kind: 'pan' | 'node'; moved: boolean } | null = this.drag;
    this.drag = null;
    if (drag !== null && !drag.moved && node !== undefined) {
      this.pickNode(node.value);
    }
  }

  /**
   * Zooms about the pointer.
   * @param event The wheel event.
   */
  protected onWheel(event: WheelEvent): void {
    event.preventDefault();
    const svg: SVGSVGElement = event.currentTarget as SVGSVGElement;
    const point: DOMPoint | undefined = svg
      .getScreenCTM()
      ?.inverse()
      .transformPoint(new DOMPoint(event.clientX, event.clientY));
    const px: number = point?.x ?? 0;
    const py: number = point?.y ?? 0;
    this.view.update((view) => {
      const k: number = Math.min(4, Math.max(0.2, view.k * Math.exp(-event.deltaY * 0.0015)));
      const scale: number = k / view.k;
      return { k, x: px - (px - view.x) * scale, y: py - (py - view.y) * scale };
    });
  }

  /**
   * Picks a node.
   * @param node The node.
   */
  private pickNode(node: GraphNodeValue): void {
    this.pickedId.set(node.id);
    this.picked.emit({
      title:
        node.labels.length > 0
          ? node.labels.map((label: string): string => `:${label}`).join('')
          : 'Node',
      properties: [
        { name: '<id>', value: node.id },
        { name: '<labels>', value: node.labels.join(', ') || '(none)' },
        ...Object.entries(node.properties).map(([name, value]: [string, DatabaseValue]) => ({
          name,
          value: cellText(value).text,
        })),
      ],
    });
  }

  /**
   * Picks a relationship.
   * @param relationship The relationship.
   */
  protected pickRelationship(relationship: LaidRelationship): void {
    const value: GraphRelationshipValue = relationship.value;
    this.pickedId.set(value.id);
    this.picked.emit({
      title: `[:${value.relationshipType}]`,
      properties: [
        { name: '<id>', value: value.id },
        { name: '<type>', value: value.relationshipType },
        { name: '<start>', value: value.start },
        { name: '<end>', value: value.end },
        ...Object.entries(value.properties).map(([name, item]: [string, DatabaseValue]) => ({
          name,
          value: cellText(item).text,
        })),
      ],
    });
  }
}

/**
 * Works out the viewBox that fits laid-out nodes, with room for their circles and captions.
 * @param positions The nodes' positions.
 * @returns Returns the viewBox attribute.
 */
function fit(positions: ReadonlyMap<string, Point>): string {
  const points: readonly Point[] = [...positions.values()];
  if (points.length === 0) {
    return '-400 -300 800 600';
  }
  const margin: number = NODE_RADIUS * 3;
  const xs: readonly number[] = points.map((point: Point): number => point.x);
  const ys: readonly number[] = points.map((point: Point): number => point.y);
  const minX: number = Math.min(...xs) - margin;
  const minY: number = Math.min(...ys) - margin;
  const width: number = Math.max(300, Math.max(...xs) + margin - minX);
  const height: number = Math.max(200, Math.max(...ys) + margin - minY);
  return `${minX} ${minY} ${width} ${height}`;
}

/**
 * Measures how many viewBox units one screen pixel spans, so a drag moves exactly with the pointer.
 * @param svg The SVG.
 * @returns Returns the units per pixel.
 */
function unitsPerPixel(svg: SVGSVGElement): number {
  const matrix: DOMMatrix | null = svg.getScreenCTM();
  return matrix === null || matrix.a === 0 ? 1 : 1 / matrix.a;
}

/**
 * Picks the caption a node is drawn with: its name, title or first string property, else its label.
 * @param node The node.
 * @returns Returns the caption.
 */
function captionOf(node: GraphNodeValue): string {
  for (const key of ['name', 'title', 'label', 'id']) {
    const value: DatabaseValue | undefined = node.properties[key];
    if (value !== undefined && value !== null) {
      return shorten(cellText(value).text);
    }
  }
  const first: DatabaseValue | undefined = Object.values(node.properties).find(
    (value: DatabaseValue): boolean => typeof value === 'string',
  );
  return typeof first === 'string' ? shorten(first) : (node.labels[0] ?? '');
}

/**
 * Lays a graph out with a small force simulation: every pair of nodes repels, every relationship pulls
 * its ends together like a spring, and everything is pulled gently to the centre. Deterministic — the
 * nodes start on a spiral, not at random — so the same result draws the same way twice.
 * @param nodes The nodes.
 * @param relationships The relationships.
 * @returns Returns each node's position.
 */
function layout(
  nodes: readonly LaidNode[],
  relationships: readonly LaidRelationship[],
): ReadonlyMap<string, Point> {
  const ids: readonly string[] = nodes.map((node: LaidNode): string => node.value.id);
  const index: ReadonlyMap<string, number> = new Map<string, number>(
    ids.map((id: string, at: number): [string, number] => [id, at]),
  );
  const x: Float64Array = new Float64Array(ids.length);
  const y: Float64Array = new Float64Array(ids.length);
  ids.forEach((_: string, at: number): void => {
    const angle: number = at * 2.399963;
    const radius: number = 30 * Math.sqrt(at + 1);
    x[at] = Math.cos(angle) * radius;
    y[at] = Math.sin(angle) * radius;
  });
  const springs: readonly [number, number][] = relationships
    .map((relationship: LaidRelationship): [number, number] => [
      index.get(relationship.value.start) ?? -1,
      index.get(relationship.value.end) ?? -1,
    ])
    .filter(([a, b]: [number, number]): boolean => a >= 0 && b >= 0 && a !== b);
  for (let step: number = 0; step < LAYOUT_STEPS; step++) {
    const heat: number = 1 - step / LAYOUT_STEPS;
    const fx: Float64Array = new Float64Array(ids.length);
    const fy: Float64Array = new Float64Array(ids.length);
    for (let a: number = 0; a < ids.length; a++) {
      for (let b: number = a + 1; b < ids.length; b++) {
        const dx: number = x[a] - x[b];
        const dy: number = y[a] - y[b];
        const distance: number = Math.max(1, dx * dx + dy * dy);
        const force: number = 9000 / distance;
        const length: number = Math.sqrt(distance);
        fx[a] += (dx / length) * force;
        fy[a] += (dy / length) * force;
        fx[b] -= (dx / length) * force;
        fy[b] -= (dy / length) * force;
      }
    }
    for (const [a, b] of springs) {
      const dx: number = x[b] - x[a];
      const dy: number = y[b] - y[a];
      const length: number = Math.max(1, Math.hypot(dx, dy));
      const force: number = (length - 120) * 0.05;
      fx[a] += (dx / length) * force;
      fy[a] += (dy / length) * force;
      fx[b] -= (dx / length) * force;
      fy[b] -= (dy / length) * force;
    }
    for (let at: number = 0; at < ids.length; at++) {
      fx[at] -= x[at] * 0.01;
      fy[at] -= y[at] * 0.01;
      const limit: number = 30 * heat + 1;
      x[at] += Math.max(-limit, Math.min(limit, fx[at]));
      y[at] += Math.max(-limit, Math.min(limit, fy[at]));
    }
  }
  return new Map<string, Point>(
    ids.map((id: string, at: number): [string, Point] => [id, { x: x[at], y: y[at] }]),
  );
}

/**
 * Shortens a caption to what fits inside a node's circle.
 * @param caption The caption.
 * @returns Returns it, cut with an ellipsis when too long.
 */
function shorten(caption: string): string {
  return caption.length > 11 ? `${caption.slice(0, 10)}…` : caption;
}
