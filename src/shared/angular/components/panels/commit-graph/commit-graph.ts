import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  input,
  InputSignal,
  inject,
  signal,
  Signal,
  viewChild,
  WritableSignal,
} from '@angular/core';
import { Button } from '@shared/angular/components/forms/button/button';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { PanelToolbar } from '@shared/angular/components/panel-toolbar/panel-toolbar';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { HistoryScope, Repository } from '@shared/angular/services/repository/repository';
import { GitCommit, GitRef, GraphNode } from '@shared/angular/services/repository/repository-data';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Icon } from '@shared/angular/icons/icon';

/**
 * Holds the fixed height, in pixels, of a single graph row.
 */
const ROW_HEIGHT: number = 56;

/**
 * Holds the horizontal distance, in pixels, between adjacent lanes.
 */
const LANE_WIDTH: number = 18;

/**
 * Holds the radius, in pixels, of the rounded turn where a branch or merge line changes direction:
 * half a lane, so a turn into the next lane is a single quarter circle.
 */
const CORNER_RADIUS: number = LANE_WIDTH / 2;

/**
 * Holds the radius, in pixels, of a commit dot.
 */
const DOT_RADIUS: number = 5;

/**
 * Holds the left padding, in pixels, before the first lane.
 */
const LANE_PADDING: number = 14;

/**
 * A commit's row as drawn: the node, and the row it sits in — its own while the whole graph is drawn,
 * or its place among the matches while a filter is applied.
 */
interface DisplayedRow {
  /**
   * Gets the graph node.
   */
  readonly node: GraphNode;

  /**
   * Gets the zero-based row it is drawn in.
   */
  readonly row: number;
}

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

  /**
   * Gets how many lanes the edge crosses, which decides the order edges are drawn in.
   */
  readonly span: number;
}

/**
 * Renders the commit history as a GitKraken-style graph: an SVG gutter draws the lanes, branch and
 * merge curves, and commit dots, while an aligned list of rows shows each commit's refs, summary,
 * author, and hash. Selecting a row drives the repository's selection, which the detail and diff
 * panes follow.
 *
 * Its tool strip (#882) holds a Filter toggle, which shows a form beneath the strip, the history's
 * scope — the checked-out branch or every branch, offered when the plugin can read every branch — and
 * Go to HEAD. A filter runs on Enter or its button, and lists the matching commits on their own,
 * without lanes: a graph with rows missing would draw lines between commits that are not related.
 *
 * The history is read a page at a time; when it stopped at its limit the list ends in a Load More row.
 */
@Component({
  selector: 'app-commit-graph',
  imports: [AppIcon, Button, PanelToolbar, TextField],
  templateUrl: './commit-graph.html',
  styleUrl: './commit-graph.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommitGraph {
  /**
   * Gets the dock panel descriptor this panel was projected for. Supplied by the dock outlet; the
   * graph reads its state from the shared {@link Repository} rather than the descriptor.
   */
  public readonly panel: InputSignal<DockPanel> = input.required<DockPanel>();

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
   * Holds the scroll container the rows sit in, used when revealing the selected row.
   */
  private readonly scroller: Signal<ElementRef<HTMLElement> | undefined> =
    viewChild<ElementRef<HTMLElement>>('scroller');

  /**
   * Holds the filter field's host element, focused when the filter form is shown.
   */
  private readonly filterField: Signal<ElementRef<HTMLElement> | undefined> =
    viewChild<ElementRef<HTMLElement>>('filterField');

  /**
   * Holds whether the filter form is shown.
   */
  protected readonly filtering: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the text in the filter field, which filters nothing until it is applied.
   */
  protected readonly filterDraft: WritableSignal<string> = signal<string>('');

  /**
   * Holds the applied filter, lower-cased, or empty when the whole history is drawn.
   */
  private readonly appliedFilter: WritableSignal<string> = signal<string>('');

  /**
   * Wires the graph so the selected commit stays visible: whenever the selection changes — including
   * when a tag or branch is clicked in the Repository rail — its row is scrolled into view. Selecting a
   * row that is already visible (such as clicking it directly) leaves the scroll position untouched.
   */
  public constructor() {
    effect((): void => {
      const selectedId: string | null = this.repository.selectedNodeId();
      if (selectedId === null) {
        return;
      }
      const shown: DisplayedRow | undefined = this.rows().find(
        (candidate: DisplayedRow): boolean => candidate.node.id === selectedId,
      );
      if (shown !== undefined) {
        this.scrollRowIntoView(shown.row);
      }
    });
  }

  /**
   * Gets the ordered graph nodes.
   */
  protected readonly nodes: Signal<readonly GraphNode[]> = this.repository.graph;

  /**
   * Gets whether a filter is applied, during which the matches are listed without lanes.
   */
  protected readonly filtered: Signal<boolean> = computed(
    (): boolean => this.appliedFilter().length > 0,
  );

  /**
   * Gets the rows drawn: every commit in its own row, or, while a filter is applied, the matching
   * commits one after another.
   */
  protected readonly rows: Signal<readonly DisplayedRow[]> = computed(
    (): readonly DisplayedRow[] => {
      const filter: string = this.appliedFilter();
      const nodes: readonly GraphNode[] = this.nodes();
      if (filter.length === 0) {
        return nodes.map((node: GraphNode): DisplayedRow => ({ node, row: node.row }));
      }
      return nodes
        .filter((node: GraphNode): boolean => matches(node, filter))
        .map((node: GraphNode, row: number): DisplayedRow => ({ node, row }));
    },
  );

  /**
   * Gets the filter form's summary: how many of the loaded commits match, or empty with no filter.
   */
  protected readonly filterSummary: Signal<string> = computed((): string => {
    if (!this.filtered()) {
      return '';
    }
    const count: number = this.rows().length;
    const total: number = this.nodes().length;
    return count === 0
      ? 'No commits match'
      : `Matches ${count} of ${total} ${total === 1 ? 'commit' : 'commits'}`;
  });

  /**
   * Gets whether the history can be scoped to every branch: the serving plugin reads them.
   */
  protected readonly offersScope: Signal<boolean> = computed(
    (): boolean => this.repository.capabilities()?.has('allBranchHistory') ?? false,
  );

  /**
   * Gets the note on the Load More row: how much of the history is loaded.
   */
  protected readonly loadedNote: Signal<string> = computed(
    (): string =>
      `${this.filtered() ? 'Filtering' : 'Showing'} the latest ${this.nodes().length} commits`,
  );

  /**
   * Gets the total width, in pixels, of the SVG lane gutter — none while a filter lists its matches.
   */
  protected readonly gutterWidth: Signal<number> = computed((): number => {
    if (this.filtered()) {
      return 0;
    }
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
    (): number => this.rows().length * ROW_HEIGHT,
  );

  /**
   * Gets the positioned edges connecting each node to its parents, drawn beneath the dots.
   *
   * The edges that cross the most lanes are drawn first. Lines turning into the same commit share its
   * row, each running across from its own lane, so they lie on top of one another; drawn longest first,
   * each stretch between two lanes shows the line that turns there, and the colours read off in lane
   * order rather than in whatever order the commits came.
   */
  protected readonly edges: Signal<readonly EdgeViewModel[]> = computed(
    (): readonly EdgeViewModel[] =>
      this.nodes()
        .flatMap((node: GraphNode): readonly EdgeViewModel[] =>
          node.edges.map((edge: GraphNode['edges'][number]): EdgeViewModel => {
            const x1: number = this.laneX(node.lane);
            const y1: number = this.rowY(node.row);
            const x2: number = this.laneX(edge.toLane);
            const y2: number = this.rowY(edge.toRow);
            return {
              d: this.edgePath(x1, y1, x2, y2, edge.merge),
              color: edge.color,
              span: Math.abs(edge.toLane - node.lane),
            };
          }),
        )
        .sort((left: EdgeViewModel, right: EdgeViewModel): number => right.span - left.span),
  );

  /**
   * Gets the positioned commit dots, drawn over the edges.
   */
  protected readonly dots: Signal<readonly DotViewModel[]> = computed((): readonly DotViewModel[] =>
    this.nodes().map((node: GraphNode): DotViewModel => ({
      id: node.id,
      cx: this.laneX(node.lane),
      cy: this.rowY(node.row),
      color: node.color,
    })),
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
   * Shows or hides the filter form; hiding it clears the filter, so the whole graph comes back.
   */
  protected toggleFilter(): void {
    const showing: boolean = !this.filtering();
    this.filtering.set(showing);
    if (showing) {
      queueMicrotask((): void => {
        this.filterField()?.nativeElement.querySelector('input')?.focus();
      });
    } else {
      this.appliedFilter.set('');
    }
  }

  /**
   * Applies the text in the filter field.
   */
  protected applyFilter(): void {
    this.appliedFilter.set(this.filterDraft().trim().toLowerCase());
  }

  /**
   * Clears the filter, drawing the whole graph again.
   */
  protected clearFilter(): void {
    this.filterDraft.set('');
    this.appliedFilter.set('');
  }

  /**
   * Chooses which branches the history shows.
   * @param scope The scope.
   */
  protected setScope(scope: HistoryScope): void {
    this.repository.setHistoryScope(scope);
  }

  /**
   * Selects the commit HEAD points at and scrolls to it. The scroll is its own step: when HEAD is
   * already selected the selection does not change, so the effect that follows it would not run.
   */
  protected goToHead(): void {
    const head: string | null = this.repository.headCommit();
    if (head === null) {
      return;
    }
    this.repository.selectNode(head);
    const shown: DisplayedRow | undefined = this.rows().find(
      (candidate: DisplayedRow): boolean => candidate.node.id === head,
    );
    if (shown !== undefined) {
      this.scrollRowIntoView(shown.row);
    }
  }

  /**
   * Reads another page of older commits.
   */
  protected loadMore(): void {
    void this.repository.loadMoreHistory();
  }

  /**
   * Scrolls the graph so a row is visible, centring it only when it currently falls outside the
   * viewport. A no-op until the scroller has been laid out.
   * @param row The zero-based row to reveal.
   */
  private scrollRowIntoView(row: number): void {
    const container: HTMLElement | undefined = this.scroller()?.nativeElement;
    if (container === undefined) {
      return;
    }
    const viewport: number = container.clientHeight;
    if (viewport === 0) {
      return;
    }
    const top: number = row * ROW_HEIGHT;
    const bottom: number = top + ROW_HEIGHT;
    if (top < container.scrollTop || bottom > container.scrollTop + viewport) {
      container.scrollTop = Math.max(0, top - (viewport - ROW_HEIGHT) / 2);
    }
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
   * Builds the SVG path for an edge from a commit down to its parent. Within a lane it is a straight
   * line. Between lanes it runs like track on a metro map — only down and across, with a rounded
   * quarter turn between — rather than sloping across every row between the two commits:
   *
   * - a branch (a first parent in another lane) runs down the commit's own lane and turns across into
   *   the parent at the parent's row, where the branch began;
   * - a merge (any other parent) leaves the commit across at its own row, where the branch was merged,
   *   and turns down the parent's lane.
   * @param x1 The commit's x coordinate.
   * @param y1 The commit's y coordinate.
   * @param x2 The parent's x coordinate.
   * @param y2 The parent's y coordinate, below the commit.
   * @param merge Whether the parent is merged in rather than continued from.
   * @returns Returns the SVG path data.
   */
  private edgePath(x1: number, y1: number, x2: number, y2: number, merge: boolean): string {
    if (x1 === x2) {
      return `M ${x1} ${y1} L ${x2} ${y2}`;
    }
    const across: number = Math.sign(x2 - x1);
    const radius: number = Math.min(CORNER_RADIUS, Math.abs(x2 - x1), Math.abs(y2 - y1));
    if (merge) {
      // Across, then a turn down: heading east that is a right turn (sweep 1), heading west a left.
      const sweep: number = across > 0 ? 1 : 0;
      return (
        `M ${x1} ${y1} L ${x2 - across * radius} ${y1} ` +
        `A ${radius} ${radius} 0 0 ${sweep} ${x2} ${y1 + radius} L ${x2} ${y2}`
      );
    }
    // Down, then a turn across: heading south, east is a left turn (sweep 0), west a right.
    const sweep: number = across > 0 ? 0 : 1;
    return (
      `M ${x1} ${y1} L ${x1} ${y2 - radius} ` +
      `A ${radius} ${radius} 0 0 ${sweep} ${x1 + across * radius} ${y2} L ${x2} ${y2}`
    );
  }
}

/**
 * Determines whether a commit matches a filter: its summary, message, author, hash or a ref's name
 * contains the text.
 * @param node The commit's node.
 * @param filter The lower-cased filter text.
 * @returns Returns true when it matches.
 */
function matches(node: GraphNode, filter: string): boolean {
  const commit: GitCommit = node.commit;
  return (
    [commit.summary, commit.body, commit.author, commit.email].some((text: string): boolean =>
      text.toLowerCase().includes(filter),
    ) ||
    commit.hash.startsWith(filter) ||
    node.refs.some((ref: GitRef): boolean => ref.name.toLowerCase().includes(filter))
  );
}
