import { MetricsSample } from '@shared/api/system-monitor-channels';

/**
 * The subset of a CPU core's cumulative time counters the sampler reads. Structurally matches
 * `os.cpus()[n].times`, so the contribution passes that straight in without this module importing the
 * node `os` module — keeping the sampler pure and unit-testable.
 */
export interface CpuTimes {
  readonly user: number;
  readonly nice: number;
  readonly sys: number;
  readonly idle: number;
  readonly irq: number;
}

/**
 * A CPU core snapshot: its cumulative time counters.
 */
export interface CpuSnapshot {
  readonly times: CpuTimes;
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
 * Computes machine metrics samples from raw OS readings. CPU utilisation is derived from the change in
 * the cores' cumulative busy/idle counters between successive samples, so the first sample after a
 * reset reports 0 (and no per-core readings) until a delta exists. Deliberately free of the electron and node modules — the
 * contribution feeds it `os.cpus()`/`os.totalmem()`/`os.freemem()` and it stays unit-testable.
 */
export class MetricsSampler {
  /**
   * Holds the previous aggregate CPU counters, or null before the first sample.
   */
  private previous: { total: number; idle: number } | null = null;

  /**
   * Holds the previous per-core counters, or null before the first sample.
   */
  private previousCores: readonly { total: number; idle: number }[] | null = null;

  /**
   * Produces one sample from the current OS readings, folding in the CPU delta since the last call.
   * @param cpus The per-core CPU time counters (`os.cpus()`).
   * @param totalBytes The total physical memory in bytes (`os.totalmem()`).
   * @param freeBytes The free physical memory in bytes (`os.freemem()`).
   * @param timestamp The sample time as an ISO-8601 string.
   * @returns Returns the sample.
   */
  public sample(
    cpus: readonly CpuSnapshot[],
    totalBytes: number,
    freeBytes: number,
    timestamp: string,
  ): MetricsSample {
    const aggregate: { total: number; idle: number } = this.aggregate(cpus);
    let cpu: number = 0;
    if (this.previous !== null) {
      const deltaTotal: number = aggregate.total - this.previous.total;
      const deltaIdle: number = aggregate.idle - this.previous.idle;
      cpu = deltaTotal > 0 ? clampPercent((1 - deltaIdle / deltaTotal) * 100) : 0;
    }
    this.previous = aggregate;

    const perCore: readonly { total: number; idle: number }[] = cpus.map(
      (core: CpuSnapshot): { total: number; idle: number } => this.aggregate([core]),
    );
    const cores: readonly number[] | undefined = this.coreLoads(perCore);
    this.previousCores = perCore;

    const usedBytes: number = Math.max(0, totalBytes - freeBytes);
    const percent: number = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;
    return {
      timestamp,
      cpu: round1(cpu),
      memory: { usedBytes, totalBytes, percent: round1(percent) },
      ...(cores === undefined ? {} : { cores }),
    };
  }

  /**
   * Works out each core's utilisation from its counters' change since the last sample.
   * @param perCore Each core's current busy and idle counters.
   * @returns Returns each core's utilisation, or undefined before a delta exists or when the core count
   * changed (a core taken offline), since the deltas would then pair up the wrong cores.
   */
  private coreLoads(
    perCore: readonly { total: number; idle: number }[],
  ): readonly number[] | undefined {
    const previous: readonly { total: number; idle: number }[] | null = this.previousCores;
    if (previous?.length !== perCore.length) {
      return undefined;
    }
    return perCore.map((core: { total: number; idle: number }, index: number): number => {
      const deltaTotal: number = core.total - previous[index].total;
      const deltaIdle: number = core.idle - previous[index].idle;
      return round1(deltaTotal > 0 ? clampPercent((1 - deltaIdle / deltaTotal) * 100) : 0);
    });
  }

  /**
   * Sums the cores' busy and idle counters into machine totals.
   * @param cpus The per-core CPU time counters.
   * @returns Returns the aggregate total and idle counters.
   */
  private aggregate(cpus: readonly CpuSnapshot[]): { total: number; idle: number } {
    let total: number = 0;
    let idle: number = 0;
    for (const core of cpus) {
      const times: CpuTimes = core.times;
      total += times.user + times.nice + times.sys + times.idle + times.irq;
      idle += times.idle;
    }
    return { total, idle };
  }
}
