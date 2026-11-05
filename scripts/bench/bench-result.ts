/**
 * Holds what one benchmark case measured.
 */
export interface BenchResult {
  /**
   * Specifies the name of the case.
   */
  readonly name: string;

  /**
   * Specifies the iterations that were measured.
   */
  readonly iterations: number;

  /**
   * Specifies the median duration, in milliseconds.
   */
  readonly medianMs: number;

  /**
   * Specifies the 95th percentile duration, in milliseconds.
   */
  readonly p95Ms: number;

  /**
   * Specifies the median heap growth across one iteration, in mebibytes.
   */
  readonly heapDeltaMb: number;
}
