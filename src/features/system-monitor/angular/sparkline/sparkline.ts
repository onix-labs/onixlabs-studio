import { ChangeDetectionStrategy, Component, computed, input, InputSignal, Signal } from '@angular/core';

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
   * Gets the series to plot, oldest first.
   */
  public readonly values: InputSignal<readonly number[]> = input.required<readonly number[]>();

  /**
   * Gets the value that maps to the full height. Defaults to 100 (a percentage series).
   */
  public readonly max: InputSignal<number> = input<number>(100);

  /**
   * Gets the points as `[x, y]` pairs in viewBox space, oldest left to newest right.
   */
  private readonly points: Signal<readonly [number, number][]> = computed(
    (): readonly [number, number][] => {
      const values: readonly number[] = this.values();
      const max: number = this.max() || 1;
      const step: number = values.length > 1 ? VIEW_WIDTH / (values.length - 1) : 0;
      return values.map((value: number, index: number): [number, number] => {
        const clamped: number = Math.min(max, Math.max(0, value));
        return [index * step, VIEW_HEIGHT - (clamped / max) * VIEW_HEIGHT];
      });
    },
  );

  /**
   * Gets the SVG path for the line, or an empty string when there is nothing to plot.
   */
  protected readonly linePath: Signal<string> = computed((): string => {
    const points: readonly [number, number][] = this.points();
    if (points.length === 0) {
      return '';
    }
    if (points.length === 1) {
      // A single reading draws a flat line across, so the tile is not blank.
      const [, y]: [number, number] = points[0];
      return `M 0 ${y} L ${VIEW_WIDTH} ${y}`;
    }
    return points
      .map(([x, y]: [number, number], index: number): string => `${index === 0 ? 'M' : 'L'} ${x} ${y}`)
      .join(' ');
  });

  /**
   * Gets the SVG path for the filled area beneath the line, or an empty string when there is nothing
   * to plot.
   */
  protected readonly areaPath: Signal<string> = computed((): string => {
    const line: string = this.linePath();
    return line === '' ? '' : `${line} L ${VIEW_WIDTH} ${VIEW_HEIGHT} L 0 ${VIEW_HEIGHT} Z`;
  });
}
