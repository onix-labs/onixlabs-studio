import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  InputSignal,
  Signal,
} from '@angular/core';

/**
 * The sparkline's unitless viewBox width and height. The SVG stretches to its host with
 * `preserveAspectRatio="none"`; a non-scaling stroke keeps the line crisp at any size.
 */
const VIEW_WIDTH: number = 100;
const VIEW_HEIGHT: number = 100;

/**
 * A minimal, dependency-free sparkline: a signal-driven SVG line (and a faint filled area beneath it)
 * over a series of values, following the {@link import('@shared/angular/components/panels/commit-graph/commit-graph').CommitGraph}
 * SVG-from-signals pattern. Values are plotted left (oldest) to right (newest), scaled to {@link max}.
 */
@Component({
  selector: 'app-sparkline',
  imports: [],
  templateUrl: './sparkline.html',
  styleUrl: './sparkline.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Sparkline {
  /**
   * Gets the viewBox width, exposed for the template.
   */
  protected readonly width: number = VIEW_WIDTH;

  /**
   * Gets the viewBox height, exposed for the template.
   */
  protected readonly height: number = VIEW_HEIGHT;

  /**
   * Gets the primary series to plot, oldest first.
   */
  public readonly values: InputSignal<readonly number[]> = input.required<readonly number[]>();

  /**
   * Gets an optional secondary series overlaid on the primary one — the app's own share of the metric.
   * Empty (the default) draws no overlay. Plotted against the same {@link max} as the primary series.
   */
  public readonly appValues: InputSignal<readonly number[]> = input<readonly number[]>([]);

  /**
   * Gets the value that maps to the full height. Defaults to 100 (a percentage series).
   */
  public readonly max: InputSignal<number> = input<number>(100);

  /**
   * Gets the SVG path for the primary line, or an empty string when there is nothing to plot.
   */
  protected readonly linePath: Signal<string> = computed((): string => this.toLine(this.values()));

  /**
   * Gets the SVG path for the filled area beneath the primary line, or an empty string when empty.
   */
  protected readonly areaPath: Signal<string> = computed((): string =>
    this.toArea(this.linePath()),
  );

  /**
   * Gets the SVG path for the overlaid app line, or an empty string when no app series was supplied.
   */
  protected readonly appLinePath: Signal<string> = computed((): string =>
    this.toLine(this.appValues()),
  );

  /**
   * Gets the SVG path for the filled area beneath the app line, or an empty string when empty.
   */
  protected readonly appAreaPath: Signal<string> = computed((): string =>
    this.toArea(this.appLinePath()),
  );

  /**
   * Builds the SVG line path for a series, scaled to {@link max}, oldest left to newest right.
   * @param values The series to plot.
   * @returns Returns the path, or an empty string when there is nothing to plot.
   */
  private toLine(values: readonly number[]): string {
    const max: number = this.max() || 1;
    const step: number = values.length > 1 ? VIEW_WIDTH / (values.length - 1) : 0;
    const points: readonly [number, number][] = values.map(
      (value: number, index: number): [number, number] => {
        const clamped: number = Math.min(max, Math.max(0, value));
        return [index * step, VIEW_HEIGHT - (clamped / max) * VIEW_HEIGHT];
      },
    );
    if (points.length === 0) {
      return '';
    }
    if (points.length === 1) {
      // A single reading draws a flat line across, so the tile is not blank.
      const [, y]: [number, number] = points[0];
      return `M 0 ${y} L ${VIEW_WIDTH} ${y}`;
    }
    return points
      .map(
        ([x, y]: [number, number], index: number): string => `${index === 0 ? 'M' : 'L'} ${x} ${y}`,
      )
      .join(' ');
  }

  /**
   * Closes a line path into a filled area down to the baseline.
   * @param line The line path, or an empty string.
   * @returns Returns the area path, or an empty string when the line was empty.
   */
  private toArea(line: string): string {
    return line === '' ? '' : `${line} L ${VIEW_WIDTH} ${VIEW_HEIGHT} L 0 ${VIEW_HEIGHT} Z`;
  }
}
