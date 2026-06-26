import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Repository } from '../../../../../services/repository/repository';
import { GitRef, GraphNode } from '../../../../../services/repository/repository-data';
import { AppIcon } from '../../../../shared/icon/app-icon';
import { Icon } from '../../../../../icons/icon';

/**
 * Holds the fixed height, in pixels, of a single graph row.
 */
const ROW_HEIGHT: number = 56;

/**
 * Holds the horizontal distance, in pixels, between adjacent lanes.
 */
const LANE_WIDTH: number = 18;

/**
 * Holds the radius, in pixels, of a commit dot.
 */
const DOT_RADIUS: number = 5;

/**
 * Holds the left padding, in pixels, before the first lane.
 */
const LANE_PADDING: number = 14;

/**
 * Describes a positioned commit dot in the graph gutter.
 */
interface DotViewModel {
  /**
   * Gets the node identifier the dot represents.
   */
  readonly id: string;

  /**
   * Gets the dot's centre x coordinate.
   */
  readonly cx: number;

  /**
   * Gets the dot's centre y coordinate.
   */
  readonly cy: number;

  /**
   * Gets the dot's colour.
   */
  readonly color: string;

  /**
   * Gets a value indicating whether the node is the synthetic working-tree node, drawn hollow.
   */
  readonly working: boolean;
}

/**
 * Describes a positioned edge connecting a node to one of its parents.
 */
interface EdgeViewModel {
  /**
   * Gets the SVG path data for the edge.
   */
  readonly d: string;

  /**
   * Gets the edge's colour.
   */
  readonly color: string;
}

/**
 * Renders the commit history as a GitKraken-style graph: an SVG gutter draws the lanes, branch and
 * merge curves, and commit dots, while an aligned list of rows shows each commit's refs, summary,
 * author, and hash. Selecting a row drives the repository's selection, which the detail and diff
 * panes follow.
 */
@Component({
  selector: 'app-commit-graph',
  imports: [AppIcon],
  templateUrl: './commit-graph.html',
  styleUrl: './commit-graph.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommitGraph {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the per-row height, exposed for the template's row positioning.
   */
  protected readonly rowHeight: number = ROW_HEIGHT;

  /**
   * Holds the repository model the graph renders.
   */
  protected readonly repository: Repository = inject(Repository);

  /**
   * Gets the ordered graph nodes (working node, then commits).
   */
  protected readonly nodes: Signal<readonly GraphNode[]> = this.repository.graph;

  /**
   * Gets the total width, in pixels, of the SVG lane gutter.
   */
  protected readonly gutterWidth: Signal<number> = computed((): number => {
    const lanes: number = this.nodes().reduce(
      (max: number, node: GraphNode): number => Math.max(max, node.lane),
      0,
    );
    return LANE_PADDING * 2 + (lanes + 1) * LANE_WIDTH;
  });

  /**
   * Gets the total height, in pixels, of the graph (and its SVG gutter).
   */
  protected readonly canvasHeight: Signal<number> = computed(
    (): number => this.nodes().length * ROW_HEIGHT,
  );

  /**
   * Gets the positioned edges connecting each node to its parents, drawn beneath the dots.
   */
  protected readonly edges: Signal<readonly EdgeViewModel[]> = computed(
    (): readonly EdgeViewModel[] =>
      this.nodes().flatMap((node: GraphNode): readonly EdgeViewModel[] =>
        node.edges.map((edge: GraphNode['edges'][number]): EdgeViewModel => {
          const x1: number = this.laneX(node.lane);
          const y1: number = this.rowY(node.row);
          const x2: number = this.laneX(edge.toLane);
          const y2: number = this.rowY(edge.toRow);
          return { d: this.edgePath(x1, y1, x2, y2), color: edge.color };
        }),
      ),
  );

  /**
   * Gets the positioned commit dots, drawn over the edges.
   */
  protected readonly dots: Signal<readonly DotViewModel[]> = computed((): readonly DotViewModel[] =>
    this.nodes().map(
      (node: GraphNode): DotViewModel => ({
        id: node.id,
        cx: this.laneX(node.lane),
        cy: this.rowY(node.row),
        color: node.color,
        working: node.kind === 'working',
      }),
    ),
  );

  /**
   * Gets the radius of a commit dot, exposed for the template.
   */
  protected readonly dotRadius: number = DOT_RADIUS;

  /**
   * Gets the top offset, in pixels, of a row.
   * @param row The zero-based row index.
   * @returns Returns the row's top offset.
   */
  protected rowTop(row: number): number {
    return row * ROW_HEIGHT;
  }

  /**
   * Selects a node, driving the detail and diff panes.
   * @param node The node to select.
   */
  protected select(node: GraphNode): void {
    this.repository.selectNode(node.id);
  }

  /**
   * Gets the CSS modifier suffix for a ref badge, keyed to its kind.
   * @param ref The ref to classify.
   * @returns Returns the kind used to build the badge class.
   */
  protected refKind(ref: GitRef): string {
    return ref.kind;
  }

  /**
   * Resolves a lane's centre x coordinate.
   * @param lane The zero-based lane.
   * @returns Returns the lane's centre x coordinate.
   */
  private laneX(lane: number): number {
    return LANE_PADDING + lane * LANE_WIDTH + LANE_WIDTH / 2;
  }

  /**
   * Resolves a row's centre y coordinate.
   * @param row The zero-based row.
   * @returns Returns the row's centre y coordinate.
   */
  private rowY(row: number): number {
    return row * ROW_HEIGHT + ROW_HEIGHT / 2;
  }

  /**
   * Builds the SVG path for an edge: a straight line within a lane, or a smooth S-curve between lanes
   * (a branch or merge).
   * @param x1 The start x coordinate.
   * @param y1 The start y coordinate.
   * @param x2 The end x coordinate.
   * @param y2 The end y coordinate.
   * @returns Returns the SVG path data.
   */
  private edgePath(x1: number, y1: number, x2: number, y2: number): string {
    if (x1 === x2) {
      return `M ${x1} ${y1} L ${x2} ${y2}`;
    }
    const midY: number = y1 + (y2 - y1) / 2;
    return `M ${x1} ${y1} C ${x1} ${midY} ${x2} ${midY} ${x2} ${y2}`;
  }
}
