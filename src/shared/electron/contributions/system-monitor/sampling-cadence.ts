import {
  DEFAULT_SAMPLE_INTERVAL_MS,
  SAMPLE_INTERVAL_RANGE_MS,
  SamplingRate,
} from '@shared/api/system-monitor-channels';

/**
 * How often, at most, the costly readings are taken, in milliseconds. Network and disk throughput
 * come from `netstat` and `ioreg` on macOS and GPU utilisation from another `ioreg`: three processes
 * per sample, about 60 ms of CPU a second at the default rate (audit P3). Their values are rates
 * averaged over the gap since the last reading anyway, so reading them every few seconds and carrying
 * the reading forward between times loses nothing the tiles can show. CPU and memory stay on every
 * tick: they are a few syscalls.
 */
export const HEAVY_SAMPLE_INTERVAL_MS: number = 3_000;

/**
 * Reads a sampling rate a renderer sent, falling back to the default when the payload is not one and
 * clamping it to the accepted range.
 * @param payload The payload of a rate message.
 * @returns Returns the interval to sample at, in milliseconds.
 */
export function normaliseSamplingInterval(payload: unknown): number {
  const intervalMs: unknown = (payload as Partial<SamplingRate> | null | undefined)?.intervalMs;
  if (typeof intervalMs !== 'number' || !Number.isFinite(intervalMs)) {
    return DEFAULT_SAMPLE_INTERVAL_MS;
  }
  return Math.min(SAMPLE_INTERVAL_RANGE_MS.max, Math.max(SAMPLE_INTERVAL_RANGE_MS.min, intervalMs));
}

/**
 * Decides, tick by tick, whether the costly readings are due: on the first tick after a reset, and
 * then whenever at least {@link HEAVY_SAMPLE_INTERVAL_MS} has passed since they were last taken. At a
 * sampling interval of that length or longer they are due every tick.
 */
export class HeavyCadence {
  /**
   * Holds when the costly readings were last taken, or null when they have not been since the reset.
   */
  private lastAt: number | null = null;

  /**
   * Creates a cadence.
   * @param everyMs The least time between costly readings, in milliseconds.
   */
  public constructor(private readonly everyMs: number = HEAVY_SAMPLE_INTERVAL_MS) {}

  /**
   * Determines whether the costly readings are due now, and if so marks them taken.
   * @param now The current time, in milliseconds.
   * @returns Returns true when the readings should be taken on this tick.
   */
  public due(now: number): boolean {
    if (this.lastAt !== null && now - this.lastAt < this.everyMs) {
      return false;
    }
    this.lastAt = now;
    return true;
  }
}
