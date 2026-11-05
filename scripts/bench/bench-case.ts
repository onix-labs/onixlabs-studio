/**
 * Describes one measured operation of a benchmark.
 */
export interface BenchCase {
  /**
   * Specifies the name shown in the results.
   */
  readonly name: string;

  /**
   * Specifies a cap on the iterations, for a case too slow to repeat the full count.
   */
  readonly maxIterations?: number;

  /**
   * Prepares the case once, outside the measurement.
   */
  readonly setup?: () => Promise<void> | void;

  /**
   * Runs the operation being measured, which may be asynchronous. What it returns is held until the heap has been read, so a
   * result is not collected before it is counted.
   */
  readonly run: () => unknown;

  /**
   * Describes what time and heap cannot show about the runs, for the results.
   */
  readonly note?: () => string;

  /**
   * Cleans up once, outside the measurement.
   */
  readonly teardown?: () => Promise<void> | void;
}
