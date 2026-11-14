import {
  AppUsageMetric,
  CacheInfo,
  DiskMetric,
  GpuInfo,
  GpuMetric,
  InterfaceMetric,
  MemoryDetailMetric,
  NetworkMetric,
  VolumeMetric,
} from '@shared/api/system-monitor-channels';

/**
 * The subset of a `systeminformation` network-interface stat this reads. Structural, so the
 * contribution passes `si.networkStats()` results straight in without this module importing
 * `systeminformation` — keeping the readers pure and unit-testable.
 */
export interface NetworkStat {
  readonly iface?: string;
  readonly rx_sec: number | null;
  readonly tx_sec: number | null;
}

/**
 * The subset of `systeminformation`'s memory reading this reads (`si.mem()`).
 */
export interface MemStat {
  readonly available: number;
  readonly swapused: number;
  readonly swaptotal: number;
}

/**
 * The subset of a `systeminformation` volume this reads (`si.fsSize()`).
 */
export interface FsSizeStat {
  readonly mount: string;
  readonly type: string;
  readonly size: number;
  readonly used: number;
  readonly available?: number;
}

/**
 * The subset of `systeminformation`'s cache reading this reads (`si.cpuCache()`), in bytes.
 */
export interface CpuCacheStat {
  readonly l1d: number | null;
  readonly l1i: number | null;
  readonly l2: number | null;
  readonly l3: number | null;
}

/**
 * The file system types that hold no user data — memory-backed, virtual or read-only images — and so
 * are left out of the volumes listed.
 */
const PSEUDO_FILE_SYSTEMS: ReadonlySet<string> = new Set<string>([
  'tmpfs',
  'devtmpfs',
  'devfs',
  'overlay',
  'squashfs',
  'autofs',
  'proc',
  'sysfs',
  'nullfs',
]);

/**
 * The subset of a `systeminformation` filesystem stat this reads (`si.fsStats()`).
 */
export interface FsStat {
  readonly rx_sec: number | null;
  readonly wx_sec: number | null;
}

/**
 * The subset of a `systeminformation` graphics controller this reads (`si.graphics().controllers`).
 */
export interface GpuController {
  readonly model?: string;
  readonly vendor?: string;
  readonly vram?: number | null;
  readonly driverVersion?: string;
  readonly bus?: string;
  readonly utilizationGpu?: number | null;
}

/**
 * The subset of an Electron process metric this reads (`app.getAppMetrics()`). Structural, so the
 * contribution passes Electron's `ProcessMetric[]` straight in without this module importing electron —
 * keeping the reader pure and unit-testable.
 */
export interface AppProcessMetric {
  /**
   * Gets the process's CPU usage. `percentCPUUsage` is relative to a single core, so summing across
   * processes on a multi-core machine can exceed 100 and must be normalised by the core count.
   */
  readonly cpu?: { readonly percentCPUUsage?: number | null };

  /**
   * Gets the process's memory usage. `workingSetSize` is in kilobytes.
   */
  readonly memory?: { readonly workingSetSize?: number | null };
}

/**
 * Coerces a possibly-null rate to a non-negative number.
 * @param value The rate, possibly null.
 * @returns Returns the rate, or 0 when null/negative.
 */
function rate(value: number | null | undefined): number {
  return typeof value === 'number' && value > 0 ? value : 0;
}

/**
 * Rounds a number to one decimal place.
 * @param value The value to round.
 * @returns Returns the rounded value.
 */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Clamps a number to the 0–100 range.
 * @param value The value to clamp.
 * @returns Returns the clamped value.
 */
function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

/**
 * Sums this application's own CPU and memory use across its whole process tree. Each process's
 * `percentCPUUsage` is single-core-relative, so the summed CPU is divided by the logical core count to
 * express the app's share of total machine capacity (0–100, comparable to the machine-wide CPU). Memory
 * working sets (kilobytes) are summed to bytes and expressed as a share of total physical memory.
 * @param metrics The per-process metrics (`app.getAppMetrics()`).
 * @param coreCount The number of logical CPU cores (`os.cpus().length`).
 * @param totalBytes The total physical memory in bytes (`os.totalmem()`).
 * @returns Returns the app's summed usage.
 */
export function readAppUsage(
  metrics: readonly AppProcessMetric[],
  coreCount: number,
  totalBytes: number,
): AppUsageMetric {
  let cpuSum: number = 0;
  let memoryBytes: number = 0;
  for (const metric of metrics) {
    cpuSum += rate(metric.cpu?.percentCPUUsage);
    memoryBytes += rate(metric.memory?.workingSetSize) * 1024;
  }
  const cores: number = coreCount > 0 ? coreCount : 1;
  const cpuPercent: number = clampPercent(cpuSum / cores);
  const memoryPercent: number = totalBytes > 0 ? clampPercent((memoryBytes / totalBytes) * 100) : 0;
  return { cpuPercent: round1(cpuPercent), memoryBytes, memoryPercent: round1(memoryPercent) };
}

/**
 * Sums per-interface network stats into total throughput.
 * @param stats The per-interface stats (`si.networkStats('*')`).
 * @returns Returns the summed throughput.
 */
export function sumNetwork(stats: readonly NetworkStat[]): NetworkMetric {
  let rxBytesPerSec: number = 0;
  let txBytesPerSec: number = 0;
  for (const stat of stats) {
    rxBytesPerSec += rate(stat.rx_sec);
    txBytesPerSec += rate(stat.tx_sec);
  }
  return { rxBytesPerSec, txBytesPerSec };
}

/**
 * Maps filesystem stats to disk throughput.
 * @param stats The filesystem stats (`si.fsStats()`), or null when unavailable.
 * @returns Returns the disk throughput, or undefined when no stats were provided.
 */
export function readDisk(stats: FsStat | null): DiskMetric | undefined {
  if (stats === null) {
    return undefined;
  }
  return { readBytesPerSec: rate(stats.rx_sec), writeBytesPerSec: rate(stats.wx_sec) };
}

/**
 * Parses a GPU utilisation reading from `ioreg`'s IOAccelerator output on macOS — a no-sudo source
 * `systeminformation` does not read, which is why it reports GPU as unavailable there. The live
 * `"PerformanceStatistics"` dict (distinct from the cumulative `"PerformanceStatisticsAccum"`) carries
 * `"Device Utilization %"` (and `"GPU Activity(%)"` as a fallback); this reads the live dict so the
 * accumulator's value is never mistaken for the current load.
 * @param output The raw `ioreg -r -d 1 -w 0 -c IOAccelerator` output.
 * @returns Returns the GPU reading, marked unavailable when no utilisation is found.
 */
export function parseIoregGpu(output: string): GpuMetric {
  const marker: string = '"PerformanceStatistics" =';
  const at: number = output.indexOf(marker);
  const region: string = at >= 0 ? output.slice(at) : output;
  const match: RegExpExecArray | null =
    /"Device Utilization %"\s*=\s*(\d+)/.exec(region) ??
    /"GPU Activity\(%\)"\s*=\s*(\d+)/.exec(region);
  if (match === null) {
    return { available: false, percent: 0 };
  }
  return { available: true, percent: Math.min(100, Math.max(0, Number(match[1]))) };
}

/**
 * Picks a GPU utilisation reading from the graphics controllers, best-effort: the first controller
 * reporting a numeric utilisation wins; when none does, the reading is marked unavailable rather than
 * reporting a misleading zero.
 * @param controllers The graphics controllers (`si.graphics().controllers`).
 * @returns Returns the GPU reading.
 */
export function pickGpu(controllers: readonly GpuController[]): GpuMetric {
  for (const controller of controllers) {
    if (typeof controller.utilizationGpu === 'number') {
      return { available: true, percent: Math.min(100, Math.max(0, controller.utilizationGpu)) };
    }
  }
  return { available: false, percent: 0 };
}

/**
 * Maps per-interface network stats to each interface's throughput.
 * @param stats The per-interface stats (`si.networkStats('*')`).
 * @returns Returns each named interface's throughput, busiest first.
 */
export function readInterfaces(stats: readonly NetworkStat[]): readonly InterfaceMetric[] {
  return stats
    .filter((stat: NetworkStat): boolean => typeof stat.iface === 'string' && stat.iface.length > 0)
    .map((stat: NetworkStat): InterfaceMetric => ({
      name: stat.iface ?? '',
      rxBytesPerSec: rate(stat.rx_sec),
      txBytesPerSec: rate(stat.tx_sec),
    }))
    .sort(
      (a: InterfaceMetric, b: InterfaceMetric): number =>
        b.rxBytesPerSec + b.txBytesPerSec - (a.rxBytesPerSec + a.txBytesPerSec) ||
        a.name.localeCompare(b.name),
    );
}

/**
 * Maps a memory reading to the breakdown beyond used and total.
 * @param stat The memory reading (`si.mem()`).
 * @returns Returns the breakdown.
 */
export function readMemoryDetail(stat: MemStat): MemoryDetailMetric {
  return {
    availableBytes: Math.max(0, stat.available),
    swapUsedBytes: Math.max(0, stat.swapused),
    swapTotalBytes: Math.max(0, stat.swaptotal),
  };
}

/**
 * Maps the mounted file systems to the volumes worth showing: those holding user data. Memory-backed
 * and virtual file systems are left out, as are macOS's system mounts under `/System` (its volumes
 * share the startup disk's container, so they would only repeat its space, and its asset mounts are
 * not the user's) and anything empty.
 *
 * Used is taken as the space not available, where the OS reports it. On macOS `/` is the sealed system
 * volume, whose own used figure is a few gigabytes however full the disk is; the space not available
 * counts every volume sharing its container, which is what the user means by how full the disk is.
 * @param stats The mounted file systems (`si.fsSize()`).
 * @returns Returns the volumes, in mount order.
 */
export function readVolumes(stats: readonly FsSizeStat[]): readonly VolumeMetric[] {
  const seen: Set<string> = new Set<string>();
  const volumes: VolumeMetric[] = [];
  for (const stat of stats) {
    if (
      stat.size <= 0 ||
      PSEUDO_FILE_SYSTEMS.has(stat.type.toLowerCase()) ||
      stat.mount.startsWith('/System/') ||
      seen.has(stat.mount)
    ) {
      continue;
    }
    seen.add(stat.mount);
    volumes.push({
      mount: stat.mount,
      type: stat.type,
      sizeBytes: stat.size,
      usedBytes: Math.min(
        stat.size,
        Math.max(0, stat.available === undefined ? stat.used : stat.size - stat.available),
      ),
    });
  }
  return volumes;
}

/**
 * Maps the graphics controllers to the machine's GPUs.
 * @param controllers The graphics controllers (`si.graphics().controllers`).
 * @returns Returns each named controller, its dedicated memory in bytes where it reports some.
 */
export function readGpus(controllers: readonly GpuController[]): readonly GpuInfo[] {
  return controllers
    .filter(
      (controller: GpuController): boolean =>
        typeof controller.model === 'string' && controller.model.length > 0,
    )
    .map((controller: GpuController): GpuInfo => {
      const vram: number | null | undefined = controller.vram;
      const driver: string = (controller.driverVersion ?? '').trim();
      const bus: string = (controller.bus ?? '').trim();
      return {
        model: controller.model ?? '',
        vendor: controller.vendor ?? '',
        ...(typeof vram === 'number' && vram > 0 ? { memoryBytes: vram * 1024 * 1024 } : {}),
        ...(driver.length > 0 ? { driver } : {}),
        ...(bus.length > 0 ? { bus } : {}),
      };
    });
}

/**
 * Maps the CPU's cache reading to its levels. macOS reports L1 and L2 per core (`sysctl`), so there
 * each is multiplied out to the processor's total and the per-core share kept; elsewhere the reading
 * is taken as the total (Windows' WMI and current `lscpu` report totals). L1 counts its data and
 * instruction caches together; a level not reported is left out.
 * @param cache The cache reading (`si.cpuCache()`).
 * @param platform The platform it was read on (`process.platform`).
 * @param physicalCores The number of physical cores, or undefined when unknown.
 * @returns Returns the levels, smallest first.
 */
export function readCaches(
  cache: CpuCacheStat,
  platform: string,
  physicalCores: number | undefined,
): readonly CacheInfo[] {
  const positive: (value: number | null) => number = (value: number | null): number =>
    value !== null && value > 0 ? value : 0;
  const perCore: boolean =
    platform === 'darwin' && physicalCores !== undefined && physicalCores > 0;
  const cores: number = perCore ? (physicalCores ?? 1) : 1;
  const levels: CacheInfo[] = [];
  const l1: number = positive(cache.l1d) + positive(cache.l1i);
  if (l1 > 0) {
    levels.push({ level: 'L1', totalBytes: l1 * cores, ...(perCore ? { perCoreBytes: l1 } : {}) });
  }
  const l2: number = positive(cache.l2);
  if (l2 > 0) {
    levels.push({ level: 'L2', totalBytes: l2 * cores, ...(perCore ? { perCoreBytes: l2 } : {}) });
  }
  const l3: number = positive(cache.l3);
  if (l3 > 0) {
    levels.push({ level: 'L3', totalBytes: l3 });
  }
  return levels;
}

/**
 * Names the CPU's architecture as people know it, from Node's name for it.
 * @param arch Node's architecture (`os.arch()`).
 * @returns Returns the architecture (`x86_64`, `arm64`).
 */
export function architectureName(arch: string): string {
  switch (arch) {
    case 'x64':
      return 'x86_64';
    case 'ia32':
      return 'x86';
    default:
      return arch;
  }
}
