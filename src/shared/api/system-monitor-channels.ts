/**
 * Names the System Monitor's metrics IPC channels and their payload contracts — the metrics slice of
 * the contribution's IPC surface, over the generic {@link import('./bridge').Bridge} transport. The
 * renderer starts and stops sampling as its view shows and hides (so nothing is sampled when the tab
 * is not visible), and the main-process contribution pushes one {@link MetricsSample} per tick while
 * any consumer is active.
 */
export enum SystemMonitorChannel {
  /**
   * Asks the backend to begin sampling (renderer→main, fire-and-forget). Ref-counted: sampling runs
   * while at least one consumer has started and stops when the last stops.
   */
  Start = 'system-monitor:start',

  /**
   * Asks the backend to stop sampling for this consumer (renderer→main, fire-and-forget).
   */
  Stop = 'system-monitor:stop',

  /**
   * Pushes one metrics sample to the renderer (main→renderer).
   */
  Sample = 'system-monitor:sample',
}

/**
 * The number of samples the tiles keep for their sparklines.
 */
export const METRICS_HISTORY: number = 60;

/**
 * Describes machine memory use at a moment.
 */
export interface MemoryMetric {
  /**
   * Gets the bytes of physical memory in use.
   */
  readonly usedBytes: number;

  /**
   * Gets the total bytes of physical memory.
   */
  readonly totalBytes: number;

  /**
   * Gets the percentage of physical memory in use, 0–100.
   */
  readonly percent: number;
}

/**
 * Describes one sampled snapshot of machine metrics. This phase (epic #395 P3) carries CPU and
 * memory; network, disk and GPU are added as further fields in P4.
 */
export interface MetricsSample {
  /**
   * Gets the time the sample was taken, as an ISO-8601 string.
   */
  readonly timestamp: string;

  /**
   * Gets the machine-wide CPU utilisation, 0–100.
   */
  readonly cpu: number;

  /**
   * Gets the machine memory use.
   */
  readonly memory: MemoryMetric;
}
