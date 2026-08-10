import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  Signal,
} from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { Log } from '@shared/angular/services/log/log';
import {
  MarkdownCommands,
  OutlineHeading,
} from '@shared/angular/services/markdown-commands/markdown-commands';
import { MarkdownPanels } from '@features/markdown/angular/markdown-panels/markdown-panels';
import { ToolPanel } from '@shared/angular/components/panels/tool-panel/tool-panel';

/**
 * Fixed height, in pixels, of each outline row. The connector and marker geometry assume uniform rows.
 */
const ROW_HEIGHT: number = 34;

/**
 * Horizontal pixels added to the indicator position per heading level.
 */
const INDENT_STEP: number = 12;

/**
 * Indicator x-position, in pixels, of a level-1 heading (the line's left margin).
 */
const INDENT_BASE: number = 13;

/**
 * Upper bound on the rounded-corner radius where the connector line steps between levels.
 */
const MAX_CORNER_RADIUS: number = 8;

/**
 * Divisor used to take a half value.
 */
const HALF: number = 2;

/**
 * Decimal places the connector path coordinates are rounded to.
 */
const PATH_PRECISION: number = 2;

/**
 * Corner radius, in pixels, of the connector line's level steps.
 */
const CORNER_RADIUS: number = Math.min(MAX_CORNER_RADIUS, INDENT_STEP / HALF);

/**
 * Horizontal gap, in pixels, between the indicator line and a row's text.
 */
const TEXT_GAP: number = 18;

/**
 * Half the marker's width, in pixels, used to centre it on the indicator line.
 */
const MARKER_LEFT_INSET: number = 1.5;

/**
 * Vertical inset, in pixels, of the marker from the top of its row.
 */
const MARKER_TOP_INSET: number = 7;

/**
 * Total vertical inset, in pixels, removed from the row height to size the marker.
 */
const MARKER_VERTICAL_INSET: number = 14;

/**
 * Gets the indicator x-position, in pixels, for a heading level.
 * @param level The heading level (1–6).
 * @returns Returns the x-position.
 */
function xForLevel(level: number): number {
  return INDENT_BASE + (level - 1) * INDENT_STEP;
}

/**
 * Computes the Euclidean distance between two points.
 * @param a The first point.
 * @param b The second point.
 * @returns Returns the distance.
 */
function distance(a: readonly [number, number], b: readonly [number, number]): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/**
 * Builds the SVG path for the stepped, rounded connector line: a vertical segment per row at that
 * row's indent, with rounded jogs where the level changes. Ported from the design's reference
 * algorithm.
 * @param rows The outline headings in document order.
 * @returns Returns the SVG path `d` attribute, or an empty string when there are too few rows.
 */
function buildConnectorPath(rows: readonly OutlineHeading[]): string {
  const points: [number, number][] = [];
  rows.forEach((row: OutlineHeading, index: number): void => {
    const x: number = xForLevel(row.level);
    points.push([x, index * ROW_HEIGHT]);
    points.push([x, (index + 1) * ROW_HEIGHT]);
  });
  if (points.length < HALF) {
    return '';
  }

  let path: string = `M ${points[0][0]} ${points[0][1]}`;
  for (let index: number = 1; index < points.length - 1; index++) {
    const previous: [number, number] = points[index - 1];
    const vertex: [number, number] = points[index];
    const next: [number, number] = points[index + 1];
    const lengthIn: number = distance(previous, vertex);
    const lengthOut: number = distance(vertex, next);
    const radius: number = Math.min(CORNER_RADIUS, lengthIn / HALF, lengthOut / HALF);
    const unitInX: number = lengthIn ? (vertex[0] - previous[0]) / lengthIn : 0;
    const unitInY: number = lengthIn ? (vertex[1] - previous[1]) / lengthIn : 0;
    const unitOutX: number = lengthOut ? (next[0] - vertex[0]) / lengthOut : 0;
    const unitOutY: number = lengthOut ? (next[1] - vertex[1]) / lengthOut : 0;
    const beforeX: string = (vertex[0] - unitInX * radius).toFixed(PATH_PRECISION);
    const beforeY: string = (vertex[1] - unitInY * radius).toFixed(PATH_PRECISION);
    const afterX: string = (vertex[0] + unitOutX * radius).toFixed(PATH_PRECISION);
    const afterY: string = (vertex[1] + unitOutY * radius).toFixed(PATH_PRECISION);
    path += ` L ${beforeX} ${beforeY} Q ${vertex[0]} ${vertex[1]} ${afterX} ${afterY}`;
  }
  const last: [number, number] = points[points.length - 1];
  path += ` L ${last[0]} ${last[1]}`;
  return path;
}

/**
 * The Outline tool panel: a navigable outline of the document's headings (including setext headings),
 * with a stepped, rounded indicator line down the left edge and an accent marker that sweeps — both
 * vertically and horizontally, following the indent — to the heading the reader is currently at.
 * Clicking a heading scrolls the editor to it.
 */
@Component({
  selector: 'app-markdown-outline-panel',
  imports: [ToolPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './markdown-outline-panel.html',
  styleUrl: './markdown-outline-panel.scss',
})
export class MarkdownOutlinePanel {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the markdown panel registry the tool panel's close button dismisses this panel through.
   */
  protected readonly panels: MarkdownPanels = inject(MarkdownPanels);

  /**
   * Holds the markdown command registry publishing the active editor's outline and active heading.
   */
  private readonly commands: MarkdownCommands = inject(MarkdownCommands);

  /**
   * Holds the structured logging client for outline navigation.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the panel's host element, used to find and reveal the active row.
   */
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef) as ElementRef<HTMLElement>;

  /**
   * Initialises the panel, keeping the active heading scrolled into view in the outline as the reader
   * moves through the document.
   */
  public constructor() {
    afterRenderEffect((): void => {
      // Track the active index so this re-runs whenever it changes, after the row's active class has
      // been applied. `nearest` scrolls only when the row is off-screen, and only as far as needed.
      this.activeIndex();
      this.host.nativeElement
        .querySelector<HTMLElement>('.outline__item--active')
        ?.scrollIntoView({ block: 'nearest' });
    });
  }

  /**
   * Gets the active document's headings, in document order.
   */
  protected readonly rows: Signal<readonly OutlineHeading[]> = this.commands.outline;

  /**
   * Gets the total pixel height of the outline (one row per heading), sizing the connector overlay.
   */
  protected readonly height: Signal<number> = computed(
    (): number => this.rows().length * ROW_HEIGHT,
  );

  /**
   * Gets the SVG path describing the stepped, rounded connector line.
   */
  protected readonly connectorPath: Signal<string> = computed((): string =>
    buildConnectorPath(this.rows()),
  );

  /**
   * Gets the index of the active heading, clamped to the current outline's bounds.
   */
  protected readonly activeIndex: Signal<number> = computed((): number => {
    const count: number = this.rows().length;
    if (count === 0) {
      return 0;
    }
    return Math.min(Math.max(0, this.commands.activeHeadingIndex()), count - 1);
  });

  /**
   * Gets the marker's left offset, in pixels, centred on the active heading's indent.
   */
  protected readonly markerLeft: Signal<number> = computed((): number => {
    const level: number = this.rows()[this.activeIndex()]?.level ?? 1;
    return xForLevel(level) - MARKER_LEFT_INSET;
  });

  /**
   * Gets the marker's top offset, in pixels, for the active heading's row.
   */
  protected readonly markerTop: Signal<number> = computed(
    (): number => this.activeIndex() * ROW_HEIGHT + MARKER_TOP_INSET,
  );

  /**
   * Gets the marker's height, in pixels.
   */
  protected readonly markerHeight: number = ROW_HEIGHT - MARKER_VERTICAL_INSET;

  /**
   * Gets the left padding, in pixels, for a heading row so its text clears the indicator line.
   * @param level The heading level.
   * @returns Returns the padding in pixels.
   */
  protected textPadding(level: number): number {
    return xForLevel(level) + TEXT_GAP;
  }

  /**
   * Navigates the editor to the given heading.
   * @param heading The heading to scroll to.
   */
  protected goTo(heading: OutlineHeading): void {
    this.log.info('markdown.view', 'Outline navigation', {
      index: heading.index,
      level: heading.level,
    });
    this.commands.goToHeading(heading.index);
  }
}
