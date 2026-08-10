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
 * Describes network throughput at a moment, summed across interfaces. Network is a rate, not a
 * percentage — the tile shows bytes/second, not a fabricated "%".
 */
export interface NetworkMetric {
  /**
   * Gets the inbound throughput in bytes per second.
   */
  readonly rxBytesPerSec: number;

  /**
   * Gets the outbound throughput in bytes per second.
   */
  readonly txBytesPerSec: number;
}

/**
 * Describes disk I/O throughput at a moment. Disk is a rate, not a percentage — the tile shows
 * bytes/second read and written.
 */
export interface DiskMetric {
  /**
   * Gets the read throughput in bytes per second.
   */
  readonly readBytesPerSec: number;

  /**
   * Gets the write throughput in bytes per second.
   */
  readonly writeBytesPerSec: number;
}

/**
 * Describes GPU utilisation at a moment. GPU load is best-effort and platform-dependent (commonly
 * unavailable on macOS), so {@link available} states whether a real reading was obtained rather than
 * reporting a misleading zero.
 */
export interface GpuMetric {
  /**
   * Gets a value indicating whether a real GPU utilisation reading was obtained.
   */
  readonly available: boolean;

  /**
   * Gets the GPU utilisation, 0–100; meaningful only when {@link available} is true.
   */
  readonly percent: number;
}

/**
 * Describes this application's own share of resource use at a moment, summed across its whole process
 * tree (the Electron main, every renderer window, the GPU and any utility processes). Only CPU and
 * memory can be attributed to the app portably; network, disk and GPU utilisation have no per-process
 * source, so they are reported machine-wide only.
 */
export interface AppUsageMetric {
  /**
   * Gets the app's CPU use as a share of total machine capacity, 0–100 — normalised by the logical
   * core count so it is directly comparable to the machine-wide {@link MetricsSample.cpu}.
   */
  readonly cpuPercent: number;

  /**
   * Gets the bytes of physical memory the app's processes hold (summed working sets).
   */
  readonly memoryBytes: number;

  /**
   * Gets the app's memory use as a percentage of total physical memory, 0–100.
   */
  readonly memoryPercent: number;
}

/**
 * Describes one sampled snapshot of machine metrics. CPU and memory are always present; network, disk
 * and GPU are present when the platform provides them (GPU is best-effort); the app's own share is
 * present when it could be read.
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

  /**
   * Gets the network throughput, or undefined when unavailable.
   */
  readonly network?: NetworkMetric;

  /**
   * Gets the disk I/O throughput, or undefined when unavailable.
   */
  readonly disk?: DiskMetric;

  /**
   * Gets the GPU utilisation reading, or undefined when unavailable.
   */
  readonly gpu?: GpuMetric;

  /**
   * Gets this application's own share of CPU and memory, or undefined when it could not be read (for
   * example outside the Electron runtime).
   */
  readonly app?: AppUsageMetric;
}
