/**
 * Describes one series a {@link LineChart} draws.
 */
export interface ChartSeries {
  /**
   * Gets the series' name, shown in the legend and the tooltip.
   */
  readonly label: string;

  /**
   * Gets the series' values, oldest first.
   */
  readonly values: readonly number[];

  /**
   * Gets how the series is drawn: `primary` as the accent line over a faint wash, `secondary` as a
   * muted line alone, so two series read apart by more than colour.
   */
  readonly emphasis: 'primary' | 'secondary';
}
