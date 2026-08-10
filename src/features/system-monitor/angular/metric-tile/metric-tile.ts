import { ChangeDetectionStrategy, Component, input, InputSignal } from '@angular/core';
import { Sparkline } from '../sparkline/sparkline';

/**
 * One metric tile in the System Monitor's top grid: a labelled header with the current reading, over a
 * sparkline of its recent history. The consumer supplies the formatted value string and the numeric
 * series; the tile stays presentational.
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
   * Gets the current reading, already formatted for display (for example `37%`).
   */
  public readonly value: InputSignal<string> = input.required<string>();

  /**
   * Gets the recent history to plot, oldest first.
   */
  public readonly values: InputSignal<readonly number[]> = input.required<readonly number[]>();

  /**
   * Gets the value that maps to the sparkline's full height. Defaults to 100 (a percentage series).
   */
  public readonly max: InputSignal<number> = input<number>(100);
}
