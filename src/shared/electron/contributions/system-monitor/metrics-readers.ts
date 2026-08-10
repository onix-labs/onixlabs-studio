import { DiskMetric, GpuMetric, NetworkMetric } from '@shared/api/system-monitor-channels';

/**
 * The subset of a `systeminformation` network-interface stat this reads. Structural, so the
 * contribution passes `si.networkStats()` results straight in without this module importing
 * `systeminformation` — keeping the readers pure and unit-testable.
 */
export interface NetworkStat {
  readonly rx_sec: number | null;
  readonly tx_sec: number | null;
}

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
  readonly utilizationGpu?: number | null;
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
    /"Device Utilization %"\s*=\s*(\d+)/.exec(region) ?? /"GPU Activity\(%\)"\s*=\s*(\d+)/.exec(region);
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
