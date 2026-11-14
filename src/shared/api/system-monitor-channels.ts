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

  /**
   * Sets how often samples are taken (renderer→main, fire-and-forget), carrying a
   * {@link SamplingRate}. Shared by every consumer, like the loop itself: the last rate set wins,
   * and a loop already running is re-timed at once.
   */
  Rate = 'system-monitor:rate',

  /**
   * Renderer → main (send): a Processes view became visible and wants process snapshots. Ref-counted
   * separately from {@link Start}, because a process listing is far costlier than a metrics sample.
   */
  ProcessesStart = 'system-monitor:processes-start',

  /**
   * Renderer → main (send): a Processes view is no longer visible.
   */
  ProcessesStop = 'system-monitor:processes-stop',

  /**
   * Main → renderer (send): one {@link ProcessesSnapshot}.
   */
  Processes = 'system-monitor:processes',

  /**
   * Renderer → main (invoke): the machine's static description, a {@link SystemInfo}.
   */
  Info = 'system-monitor:info',
}

/**
 * The time between process snapshots, in milliseconds. Fixed rather than following the refresh rate:
 * listing every process is a `ps` (or WMI query) each time, too costly to run at a metrics sample's
 * pace.
 */
export const PROCESS_SAMPLE_INTERVAL_MS: number = 2_000;

/**
 * The most processes a snapshot carries: the busiest by CPU, then by memory.
 */
export const PROCESS_SNAPSHOT_LIMIT: number = 200;

/**
 * The number of samples the agent's capabilities keep to answer from.
 */
export const METRICS_HISTORY: number = 60;

/**
 * Works out how many samples hold a span of time, so a graph's history is the same length of time at
 * every Refresh Rate.
 * @param minutes The span of time, in minutes.
 * @param intervalMs The time between samples, in milliseconds; 0 while paused.
 * @returns Returns the number of samples.
 */
export function historySamples(minutes: number, intervalMs: number): number {
  const interval: number = intervalMs > 0 ? intervalMs : DEFAULT_SAMPLE_INTERVAL_MS;
  return Math.ceil((minutes * 60_000) / interval);
}

/**
 * How often samples are taken unless the user chose otherwise, in milliseconds: once a second, the
 * rate the sparklines were drawn for.
 */
export const DEFAULT_SAMPLE_INTERVAL_MS: number = 1_000;

/**
 * The shortest and longest sampling interval the backend accepts, in milliseconds. A rate outside
 * this range is clamped to it, so a stray value cannot make the backend spin or go quiet for good.
 */
export const SAMPLE_INTERVAL_RANGE_MS: { readonly min: number; readonly max: number } = {
  min: 250,
  max: 10_000,
};

/**
 * Describes how often the backend should sample.
 */
export interface SamplingRate {
  /**
   * Gets the time between samples, in milliseconds.
   */
  readonly intervalMs: number;

  /**
   * Gets whether the GPU is read; absent means it is.
   */
  readonly gpu?: boolean;
}

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

  /**
   * Gets where the reading came from, or undefined when none was obtained.
   */
  readonly source?: GpuSource;
}

/**
 * Identifies where a GPU reading came from.
 * - `ioreg`: macOS's IOAccelerator statistics.
 * - `nvidia-smi`: NVIDIA's driver tool, which systeminformation reads on Windows and Linux.
 */
export type GpuSource = 'ioreg' | 'nvidia-smi';

/**
 * Describes one graphics controller.
 */
export interface GpuInfo {
  /**
   * Gets the controller's model (for example `AMD Radeon Pro W5700X`).
   */
  readonly model: string;

  /**
   * Gets the controller's vendor, or the empty string when unknown.
   */
  readonly vendor: string;

  /**
   * Gets the controller's dedicated memory in bytes, or undefined when it has none or it is unknown.
   */
  readonly memoryBytes?: number;
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

  /**
   * Gets each logical core's utilisation, 0–100, in the order the OS lists them, or undefined before
   * the first delta.
   */
  readonly cores?: readonly number[];

  /**
   * Gets the memory breakdown beyond used and total, or undefined when unavailable.
   */
  readonly memoryDetail?: MemoryDetailMetric;

  /**
   * Gets each network interface's throughput, or undefined when unavailable.
   */
  readonly interfaces?: readonly InterfaceMetric[];

  /**
   * Gets each mounted volume's space, or undefined when unavailable.
   */
  readonly volumes?: readonly VolumeMetric[];
}

/**
 * Describes memory beyond used and total.
 */
export interface MemoryDetailMetric {
  /**
   * Gets the memory available to start new work without swapping, in bytes. On macOS and Linux this is
   * more than the free memory, since cached file data is given up on demand.
   */
  readonly availableBytes: number;

  /**
   * Gets the swap space in use, in bytes.
   */
  readonly swapUsedBytes: number;

  /**
   * Gets the swap space configured, in bytes.
   */
  readonly swapTotalBytes: number;
}

/**
 * Describes one network interface's throughput.
 */
export interface InterfaceMetric {
  /**
   * Gets the interface's name (for example `en0`).
   */
  readonly name: string;

  /**
   * Gets the received throughput, in bytes per second.
   */
  readonly rxBytesPerSec: number;

  /**
   * Gets the sent throughput, in bytes per second.
   */
  readonly txBytesPerSec: number;
}

/**
 * Describes one mounted volume's space.
 */
export interface VolumeMetric {
  /**
   * Gets where the volume is mounted (for example `/` or `C:`).
   */
  readonly mount: string;

  /**
   * Gets the file system type (for example `apfs` or `NTFS`).
   */
  readonly type: string;

  /**
   * Gets the volume's size, in bytes.
   */
  readonly sizeBytes: number;

  /**
   * Gets the space in use, in bytes.
   */
  readonly usedBytes: number;
}

/**
 * Identifies which of Studio's own processes a process is.
 * - `main`: Electron's main (browser) process.
 * - `renderer`: a window's renderer.
 * - `gpu`: Electron's GPU process.
 * - `utility`: another Electron helper (network service, utility process).
 * - `child`: a process Studio started, or one started by one of those (shells, language servers,
 *   agents, builds).
 */
export type StudioProcessKind = 'main' | 'renderer' | 'gpu' | 'utility' | 'child';

/**
 * Describes one process in a {@link ProcessesSnapshot}.
 */
export interface ProcessSample {
  /**
   * Gets the process identifier.
   */
  readonly pid: number;

  /**
   * Gets the parent's process identifier, or 0 when unknown.
   */
  readonly parentPid: number;

  /**
   * Gets the process's name.
   */
  readonly name: string;

  /**
   * Gets the process's command line, or its name when the OS does not report one.
   */
  readonly command: string;

  /**
   * Gets the user the process runs as, or the empty string when unknown.
   */
  readonly user: string;

  /**
   * Gets the process's share of the whole machine's CPU, 0–100, comparable to the machine reading.
   */
  readonly cpuPercent: number;

  /**
   * Gets the process's resident memory, in bytes.
   */
  readonly memoryBytes: number;

  /**
   * Gets the process's resident memory as a share of physical memory, 0–100.
   */
  readonly memoryPercent: number;

  /**
   * Gets which of Studio's own processes this is, or undefined when it is not Studio's.
   */
  readonly studio?: StudioProcessKind;

  /**
   * Gets the number of threads the process runs, or undefined when it could not be read.
   */
  readonly threads?: number;

  /**
   * Gets the CPU time the process has used since it started (user and system), in seconds, or
   * undefined when it could not be read.
   */
  readonly cpuTimeSeconds?: number;
}

/**
 * Describes one level of the CPU's cache.
 */
export interface CacheInfo {
  /**
   * Gets the cache level (`L1`, `L2`, `L3`). L1 counts its data and instruction caches together.
   */
  readonly level: 'L1' | 'L2' | 'L3';

  /**
   * Gets the cache's size across the whole processor, in bytes.
   */
  readonly totalBytes: number;

  /**
   * Gets each core's own share, in bytes, where the cache is per core and the platform says so;
   * undefined for a shared cache, or where the platform reports only the total.
   */
  readonly perCoreBytes?: number;
}

/**
 * Describes one listing of the machine's processes.
 */
export interface ProcessesSnapshot {
  /**
   * Gets the time the listing was taken, as an ISO-8601 string.
   */
  readonly timestamp: string;

  /**
   * Gets the processes listed: every one of Studio's, and the busiest of the rest up to
   * {@link PROCESS_SNAPSHOT_LIMIT} in all.
   */
  readonly processes: readonly ProcessSample[];

  /**
   * Gets the number of processes running, listed or not.
   */
  readonly total: number;
}

/**
 * Describes the machine: what does not change while Studio runs.
 */
export interface SystemInfo {
  /**
   * Gets the CPU's model name.
   */
  readonly cpuModel: string;

  /**
   * Gets the number of logical cores (hardware threads).
   */
  readonly logicalCores: number;

  /**
   * Gets the number of physical cores, or undefined when unknown.
   */
  readonly physicalCores?: number;

  /**
   * Gets the number of performance cores on a hybrid CPU, or undefined when not hybrid or unknown.
   */
  readonly performanceCores?: number;

  /**
   * Gets the number of efficiency cores on a hybrid CPU, or undefined when not hybrid or unknown.
   */
  readonly efficiencyCores?: number;

  /**
   * Gets the CPU's base speed in GHz, or undefined when unknown.
   */
  readonly speedGhz?: number;

  /**
   * Gets the CPU's maximum (turbo) speed in GHz, or undefined unless the OS reports one above the base.
   */
  readonly maxSpeedGhz?: number;

  /**
   * Gets the CPU's architecture (`x86_64`, `arm64`).
   */
  readonly architecture: string;

  /**
   * Gets the CPU's caches, smallest level first, those the OS reports.
   */
  readonly caches: readonly CacheInfo[];

  /**
   * Gets the total physical memory, in bytes.
   */
  readonly totalMemoryBytes: number;

  /**
   * Gets the operating system's name and version (for example `macOS 26.6`).
   */
  readonly os: string;

  /**
   * Gets when the machine started, in milliseconds since the epoch, for its uptime; undefined where the
   * OS will not say (a sandboxed process can be refused it).
   */
  readonly bootTime?: number;

  /**
   * Gets the machine's graphics controllers, or an empty list when they could not be read.
   */
  readonly gpus: readonly GpuInfo[];
}
