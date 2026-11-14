import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  InputSignal,
  Signal,
} from '@angular/core';

/**
 * The width of the box a sparkline is drawn in; the drawing stretches to its host.
 */
const WIDTH: number = 100;

/**
 * The height of the box a sparkline is drawn in.
 */
const HEIGHT: number = 24;

/**
 * The room left above and below the line, so a 2px stroke at 0 or at the scale's top is not clipped.
 */
const INSET: number = 2;

/**
 * Describes a sparkline's drawing: its line, and the wash beneath it.
 */
interface SparklinePaths {
  /**
   * Gets the line's path.
   */
  readonly line: string;

  /**
   * Gets the wash's path, closed along the baseline.
   */
  readonly area: string;
}

/**
 * Represents a sparkline: a series' recent shape, with no axes or labels, for a value shown beside it
 * (a table cell, a summary tile). The newest reading sits at the right edge; a series shorter than the
 * line's capacity starts part-way across, so lines of different ages share one timescale.
 *
 * The line is the accent colour at 2px over a faint wash, as the System Monitor's larger graphs are.
 */
@Component({
  selector: 'app-system-monitor-sparkline',
  templateUrl: './sparkline.html',
  styleUrl: './sparkline.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Sparkline {
  /**
   * Gets the readings, oldest first.
   */
  public readonly values: InputSignal<readonly number[]> = input.required<readonly number[]>();

  /**
   * Gets the value the top of the line stands for.
   */
  public readonly max: InputSignal<number> = input.required<number>();

  /**
   * Gets how many readings span the line's width.
   */
  public readonly capacity: InputSignal<number> = input<number>(60);

  /**
   * Gets the sparkline's accessible name: what it shows and its latest value.
   */
  public readonly ariaLabel: InputSignal<string | undefined> = input<string>();

  /**
   * Gets the line and wash, or null with fewer than two readings to join.
   */
  protected readonly paths: Signal<SparklinePaths | null> = computed((): SparklinePaths | null => {
    const capacity: number = Math.max(2, this.capacity());
    const values: readonly number[] = this.values().slice(-capacity);
    if (values.length < 2) {
      return null;
    }
    const max: number = this.max() > 0 ? this.max() : 1;
    const step: number = WIDTH / (capacity - 1);
    const start: number = WIDTH - step * (values.length - 1);
    const points: string[] = values.map((value: number, index: number): string => {
      const held: number = Number.isFinite(value) ? Math.min(max, Math.max(0, value)) : 0;
      const x: number = start + step * index;
      const y: number = HEIGHT - INSET - (held / max) * (HEIGHT - 2 * INSET);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });
    const line: string = `M${points.join('L')}`;
    return {
      line,
      area: `${line}L${WIDTH},${HEIGHT}L${start.toFixed(2)},${HEIGHT}Z`,
    };
  });
}
