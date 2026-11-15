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
import { ChartLayer } from '../chart-layer';

/**
 * The fractions of the scale the axis ticks and gridlines sit at, top first.
 */
const TICK_FRACTIONS: readonly number[] = [1, 0.75, 0.5, 0.25, 0];

/**
 * Describes one axis tick.
 */
interface StackTick {
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
 * Describes one layer drawn.
 */
interface DrawnLayer {
  /**
   * Gets the layer.
   */
  readonly layer: ChartLayer;

  /**
   * Gets the band's path: the layer's top edge along, and the layer beneath's back.
   */
  readonly path: string;
}

/**
 * Describes one row of the hover readout.
 */
interface StackRow {
  /**
   * Gets the layer's name.
   */
  readonly label: string;

  /**
   * Gets the layer's value, formatted.
   */
  readonly value: string;

  /**
   * Gets the layer's colour.
   */
  readonly color: string;
}

/**
 * Describes the hover readout.
 */
interface StackReadout {
  /**
   * Gets the crosshair's position, as a percentage of the plot's width.
   */
  readonly left: number;

  /**
   * Gets whether the readout opens to the crosshair's left.
   */
  readonly flipped: boolean;

  /**
   * Gets when the sample was taken, relative to now.
   */
  readonly when: string;

  /**
   * Gets each layer's value at the sample, the top layer first (as the bands read).
   */
  readonly rows: readonly StackRow[];
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
 * Represents a stacked area chart over time: parts of a whole stacked one on another, the newest
 * sample at the right, against a single axis running to the whole. The bands are separated by a
 * hairline in the surface colour rather than outlined, and each wears its layer's colour; the host
 * names the layers beside the chart. Hovering, or focusing the plot and using the arrow keys, reads
 * every layer at the nearest sample.
 */
@Component({
  selector: 'app-system-monitor-stacked-area-chart',
  templateUrl: './stacked-area-chart.html',
  styleUrl: './stacked-area-chart.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StackedAreaChart {
  /**
   * Gets the layers, bottom first.
   */
  public readonly layers: InputSignal<readonly ChartLayer[]> =
    input.required<readonly ChartLayer[]>();

  /**
   * Gets the scale's top: the whole the layers are parts of.
   */
  public readonly max: InputSignal<number> = input.required<number>();

  /**
   * Gets how a value is written, on the axis and in the readout.
   */
  public readonly format: InputSignal<(value: number) => string> =
    input<(value: number) => string>(plain);

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
   * Gets how many samples the longest layer holds.
   */
  private readonly length: Signal<number> = computed((): number =>
    Math.max(0, ...this.layers().map((layer: ChartLayer): number => layer.values.length)),
  );

  /**
   * Gets the axis ticks, top first.
   */
  protected readonly ticks: Signal<readonly StackTick[]> = computed((): readonly StackTick[] => {
    const top: number = this.max();
    const format: (value: number) => string = this.format();
    return TICK_FRACTIONS.map((fraction: number): StackTick => ({
      label: format(top * fraction),
      top: (1 - fraction) * 100,
    }));
  });

  /**
   * Gets each layer's band, stacked on those beneath, drawn in a 100 × 100 box the plot stretches to.
   */
  protected readonly drawn: Signal<readonly DrawnLayer[]> = computed((): readonly DrawnLayer[] => {
    const length: number = this.length();
    const top: number = Math.max(1, this.max());
    const slots: number = Math.max(1, length - 1);
    const x: (index: number) => number = (index: number): number => (index / slots) * 100;
    const y: (value: number) => number = (value: number): number =>
      100 - (Math.min(top, Math.max(0, value)) / top) * 100;
    let below: readonly number[] = Array.from({ length }, (): number => 0);
    return this.layers().map((layer: ChartLayer): DrawnLayer => {
      // A shorter layer is right-aligned, its missing past read as nothing.
      const offset: number = length - layer.values.length;
      const above: readonly number[] = below.map(
        (base: number, index: number): number => base + (layer.values[index - offset] ?? 0),
      );
      const along: string = above
        .map((value: number, index: number): string => `${x(index)},${y(value)}`)
        .join('L');
      const back: string = below
        .map((value: number, index: number): string => `${x(index)},${y(value)}`)
        .reverse()
        .join('L');
      below = above;
      return { layer, path: length === 0 ? '' : `M${along}L${back}Z` };
    });
  });

  /**
   * Gets the hover readout, or null when nothing is hovered.
   */
  protected readonly readout: Signal<StackReadout | null> = computed((): StackReadout | null => {
    const index: number | null = this.hovered();
    const length: number = this.length();
    if (index === null || length === 0) {
      return null;
    }
    const format: (value: number) => string = this.format();
    const ago: number = Math.round(((length - 1 - index) * this.intervalMs()) / 1000);
    const left: number = (index / Math.max(1, length - 1)) * 100;
    return {
      left,
      flipped: left > 60,
      when: ago === 0 ? 'Now' : `${ago} s ago`,
      rows: [...this.layers()].reverse().map((layer: ChartLayer): StackRow => {
        const value: number | undefined = layer.values[index - (length - layer.values.length)];
        return {
          label: layer.label,
          value: value === undefined ? '—' : format(value),
          color: layer.color,
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
   * Moves the crosshair a sample at a time from the keyboard.
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
}
