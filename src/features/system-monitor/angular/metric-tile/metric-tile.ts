import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import { Sparkline } from '../sparkline/sparkline';

/**
 * One graphed series within a {@link MetricTile}. A tile has one channel (CPU, GPU, Memory) or several
 * (Network's Received/Sent, Disk's Read/Write), and each channel draws its own independently-scaled
 * sparkline. A channel may carry a secondary ("APP") reading and series, overlaid on the same graph, for
 * the metrics whose usage can be attributed to this app.
 */
export interface TileChannel {
  /**
   * Gets the channel's caption (for example `Received`), or absent for a single-metric tile whose only
   * reading is shown against the tile label.
   */
  readonly caption?: string;

  /**
   * Gets the channel's primary reading, already formatted (for example `42%`). This is the machine-wide
   * ("SYS") reading when an app reading is also supplied.
   */
  readonly value: string;

  /**
   * Gets the channel's primary recent history to plot, oldest first.
   */
  readonly values: readonly number[];

  /**
   * Gets the value that maps to the sparkline's full height, so each channel scales independently.
   * Defaults to 100 (a percentage series).
   */
  readonly max?: number;

  /**
   * Gets this application's own reading for the channel, already formatted, or null/absent when the
   * metric cannot be attributed to the app. When set, the reading splits into `SYS`/`APP`.
   */
  readonly appValue?: string | null;

  /**
   * Gets this application's own recent history for the channel, overlaid on the sparkline. Absent when
   * there is no app series.
   */
  readonly appValues?: readonly number[];
}

/**
 * One metric tile in the System Monitor's top grid: a labelled header over one or more sparklines. A
 * single-channel tile (CPU, GPU, Memory) shows its reading beside the label; a multi-channel tile
 * (Network, Disk) stacks a captioned, independently-scaled graph per channel. The tile stays
 * presentational — the consumer supplies the formatted readings and the numeric series.
 */
@Component({
  selector: 'app-metric-tile',
  imports: [Sparkline],
  templateUrl: './metric-tile.html',
  styleUrl: './metric-tile.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MetricTile {
  /**
   * Gets the metric's name (for example `CPU`).
   */
  public readonly label: InputSignal<string> = input.required<string>();

  /**
   * Gets a short detail shown in parentheses after the label (for example the total memory), or null to
   * show none.
   */
  public readonly suffix: InputSignal<string | null> = input<string | null>(null);

  /**
   * Gets the channels to graph — one for CPU/GPU/Memory, two for Network/Disk.
   */
  public readonly channels: InputSignal<readonly TileChannel[]> =
    input.required<readonly TileChannel[]>();

  /**
   * Gets the single channel whose reading is shown beside the label, or null for a multi-channel tile
   * (whose readings caption each graph instead).
   */
  protected readonly headerChannel: Signal<TileChannel | null> = computed(
    (): TileChannel | null => {
      const channels: readonly TileChannel[] = this.channels();
      return channels.length === 1 && channels[0].caption === undefined ? channels[0] : null;
    },
  );
}
