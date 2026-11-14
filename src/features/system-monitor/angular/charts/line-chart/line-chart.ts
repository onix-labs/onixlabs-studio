import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  InputSignal,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { ChartSeries } from '../chart-series';
import { niceMax } from '../nice-max';

/**
 * The fractions of the scale the axis ticks and gridlines sit at, top first.
 */
const TICK_FRACTIONS: readonly number[] = [1, 0.75, 0.5, 0.25, 0];

/**
 * Describes one axis tick: its label and how far down the plot it sits.
 */
interface ChartTick {
  /**
   * Gets the tick's label.
   */
  readonly label: string;

  /**
   * Gets the tick's position, as a percentage of the plot's height from the top.
   */
  readonly top: number;
}

/**
 * Describes one series drawn: its paths and how it is drawn.
 */
interface DrawnSeries {
  /**
   * Gets the series.
   */
  readonly series: ChartSeries;

  /**
   * Gets its line's path.
   */
  readonly line: string;

  /**
   * Gets its wash's path, or the empty string when it has none.
   */
  readonly area: string;
}

/**
 * Describes one row of the hover readout: a series' value at the hovered sample.
 */
interface ReadoutRow {
  /**
   * Gets the series' name.
   */
  readonly label: string;

  /**
   * Gets the value, formatted.
   */
  readonly value: string;

  /**
   * Gets how the series is drawn, so the row's key matches its line.
   */
  readonly emphasis: ChartSeries['emphasis'];
}

/**
 * Describes the hover readout.
 */
interface Readout {
  /**
   * Gets the crosshair's position, as a percentage of the plot's width.
   */
  readonly left: number;

  /**
   * Gets whether the readout opens to the crosshair's left, so it stays inside the plot.
   */
  readonly flipped: boolean;

  /**
   * Gets when the sample was taken, relative to now (`Now`, `12 s ago`).
   */
  readonly when: string;

  /**
   * Gets each series' value at the sample.
   */
  readonly rows: readonly ReadoutRow[];
}

/**
 * Formats a value as itself, the default when a chart is given no formatter.
 * @param value The value.
 * @returns Returns the value as text.
 */
function plain(value: number): string {
  return `${Math.round(value)}`;
}

/**
 * Represents a line chart over time: one or two series against a single value axis, the newest sample
 * at the right. The primary series is the accent line over a faint wash; a secondary series is a muted
 * line alone, so the two read apart by more than colour, and a legend names them. The axis has clean
 * quarter ticks with hairline gridlines, and is either fixed (a percentage, 0–100) or scaled to the
 * data's peak.
 *
 * Hovering, or focusing the plot and using the arrow keys, tracks a crosshair to the nearest sample and
 * reads every series' value there. The readout enhances rather than gates: the latest values are
 * always stated beside the chart by whoever hosts it.
 */
@Component({
  selector: 'app-system-monitor-line-chart',
  templateUrl: './line-chart.html',
  styleUrl: './line-chart.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LineChart {
  /**
   * Gets the series to draw: one, or two of the same unit.
   */
  public readonly series: InputSignal<readonly ChartSeries[]> =
    input.required<readonly ChartSeries[]>();

  /**
   * Gets the scale's fixed top, or undefined to scale to the data's peak.
   */
  public readonly max: InputSignal<number | undefined> = input<number | undefined>(undefined);

  /**
   * Gets the base a peak-scaled axis rounds in: 10 for plain numbers, 1024 for bytes.
   */
  public readonly base: InputSignal<10 | 1024> = input<10 | 1024>(10);

  /**
   * Gets the least a peak-scaled axis's top may be, so a flat-lined chart still has a scale.
   */
  public readonly floor: InputSignal<number> = input<number>(1);

  /**
   * Gets how a value is written, on the axis and in the readout.
   */
  public readonly format: InputSignal<(value: number) => string> =
    input<(value: number) => string>(plain);

  /**
   * Gets whether the value axis and its gridlines are drawn.
   */
  public readonly axis: InputSignal<boolean> = input<boolean>(true);

  /**
   * Gets the time between samples in milliseconds, for the readout's "how long ago".
   */
  public readonly intervalMs: InputSignal<number> = input<number>(1000);

  /**
   * Gets the chart's accessible name, which says what it plots.
   */
  public readonly ariaLabel: InputSignal<string> = input.required<string>();

  /**
   * Holds the hovered sample's index, or null when nothing is hovered.
   */
  protected readonly hovered: WritableSignal<number | null> = signal<number | null>(null);

  /**
   * Gets how many samples the longest series holds.
   */
  private readonly length: Signal<number> = computed((): number =>
    Math.max(0, ...this.series().map((series: ChartSeries): number => series.values.length)),
  );

  /**
   * Gets the scale's top.
   */
  private readonly top: Signal<number> = computed((): number => {
    const fixed: number | undefined = this.max();
    if (fixed !== undefined) {
      return fixed;
    }
    const peak: number = Math.max(
      0,
      ...this.series().flatMap((series: ChartSeries): readonly number[] => series.values),
    );
    return niceMax(peak, this.base(), this.floor());
  });

  /**
   * Gets the axis ticks, top first.
   */
  protected readonly ticks: Signal<readonly ChartTick[]> = computed((): readonly ChartTick[] => {
    const top: number = this.top();
    const format: (value: number) => string = this.format();
    return TICK_FRACTIONS.map((fraction: number): ChartTick => ({
      label: format(top * fraction),
      top: (1 - fraction) * 100,
    }));
  });

  /**
   * Gets each series' paths, drawn in a 100 × 100 box the plot stretches to its size.
   */
  protected readonly drawn: Signal<readonly DrawnSeries[]> = computed(
    (): readonly DrawnSeries[] => {
      const top: number = this.top();
      const length: number = this.length();
      return this.series().map((series: ChartSeries): DrawnSeries => {
        const points: readonly string[] = series.values.map(
          (value: number, index: number): string =>
            `${this.x(index, series.values.length, length)},${this.y(value, top)}`,
        );
        const line: string = points.length > 0 ? `M${points.join('L')}` : '';
        const first: string = points.length > 0 ? `${this.x(0, series.values.length, length)}` : '';
        const area: string =
          series.emphasis === 'primary' && points.length > 1 ? `${line}L100,100L${first},100Z` : '';
        return { series, line, area };
      });
    },
  );

  /**
   * Gets whether a legend is shown: whenever two series share the chart.
   */
  protected readonly legend: Signal<boolean> = computed((): boolean => this.series().length > 1);

  /**
   * Gets the hover readout, or null when nothing is hovered.
   */
  protected readonly readout: Signal<Readout | null> = computed((): Readout | null => {
    const index: number | null = this.hovered();
    const length: number = this.length();
    if (index === null || length === 0) {
      return null;
    }
    const format: (value: number) => string = this.format();
    const ago: number = Math.round(((length - 1 - index) * this.intervalMs()) / 1000);
    const left: number = this.x(index, length, length);
    return {
      left,
      flipped: left > 60,
      when: ago === 0 ? 'Now' : `${ago} s ago`,
      rows: this.series().map((series: ChartSeries): ReadoutRow => {
        // A shorter series is right-aligned, so the same sample sits at a different index in it.
        const value: number | undefined = series.values[index - (length - series.values.length)];
        return {
          label: series.label,
          value: value === undefined ? '—' : format(value),
          emphasis: series.emphasis,
        };
      }),
    };
  });

  /**
   * Tracks the crosshair to the sample nearest the pointer.
   * @param event The pointer movement over the plot.
   */
  protected onPointerMove(event: PointerEvent): void {
    const length: number = this.length();
    const target: EventTarget | null = event.currentTarget;
    if (length === 0 || !(target instanceof Element)) {
      return;
    }
    const box: DOMRect = target.getBoundingClientRect();
    const fraction: number = box.width > 0 ? (event.clientX - box.left) / box.width : 1;
    this.hovered.set(Math.min(length - 1, Math.max(0, Math.round(fraction * (length - 1)))));
  }

  /**
   * Clears the crosshair when the pointer leaves the plot.
   */
  protected onPointerLeave(): void {
    this.hovered.set(null);
  }

  /**
   * Moves the crosshair a sample at a time from the keyboard; focusing the plot starts it at the
   * newest sample.
   * @param event The key pressed while the plot has focus.
   */
  protected onKeydown(event: KeyboardEvent): void {
    const length: number = this.length();
    if (length === 0) {
      return;
    }
    const current: number = this.hovered() ?? length - 1;
    if (event.key === 'ArrowLeft') {
      this.hovered.set(Math.max(0, current - 1));
      event.preventDefault();
    } else if (event.key === 'ArrowRight') {
      this.hovered.set(Math.min(length - 1, current + 1));
      event.preventDefault();
    } else if (event.key === 'Escape') {
      this.hovered.set(null);
    }
  }

  /**
   * Starts the keyboard crosshair at the newest sample.
   */
  protected onFocus(): void {
    const length: number = this.length();
    this.hovered.set(length === 0 ? null : length - 1);
  }

  /**
   * Places a sample across the plot. Series are right-aligned to the newest sample, and a series of
   * one sample sits at the right edge.
   * @param index The sample's index in its series.
   * @param count The number of samples in its series.
   * @param length The number of samples in the longest series.
   * @returns Returns the sample's position, 0–100.
   */
  private x(index: number, count: number, length: number): number {
    const slots: number = Math.max(1, length - 1);
    return ((index + (length - count)) / slots) * 100;
  }

  /**
   * Places a value up the plot.
   * @param value The value.
   * @param top The scale's top.
   * @returns Returns the value's position, 0 (top) to 100 (bottom).
   */
  private y(value: number, top: number): number {
    return 100 - (Math.min(top, Math.max(0, value)) / top) * 100;
  }
}
