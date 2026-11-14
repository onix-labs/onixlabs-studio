/**
 * Describes one layer a {@link StackedAreaChart} stacks.
 */
export interface ChartLayer {
  /**
   * Gets the layer's name, shown in the readout.
   */
  readonly label: string;

  /**
   * Gets the layer's values, oldest first.
   */
  readonly values: readonly number[];

  /**
   * Gets the layer's colour, as a CSS colour (a custom property, so it follows the theme).
   */
  readonly color: string;
}
