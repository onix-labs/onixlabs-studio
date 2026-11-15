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
   * Gets how the series is drawn: `primary` as the accent line over a faint accent wash, `secondary` as
   * the muted grey line over a faint grey wash.
   */
  readonly emphasis: 'primary' | 'secondary';
}
