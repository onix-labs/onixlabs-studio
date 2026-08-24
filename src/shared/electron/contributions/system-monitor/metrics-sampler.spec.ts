import { describe, expect, it } from 'vitest';
import { MetricsSample } from '@shared/api/system-monitor-channels';
import { CpuSnapshot, MetricsSampler } from './metrics-sampler';

/**
 * Builds a one-core snapshot with the given busy (user) and idle counters.
 * @param user The cumulative user (busy) counter.
 * @param idle The cumulative idle counter.
 * @returns Returns the snapshot.
 */
function core(user: number, idle: number): CpuSnapshot {
  return { times: { user, nice: 0, sys: 0, idle, irq: 0 } };
}

describe('MetricsSampler', () => {
  it('firstSample_reportsZeroCpuUntilADeltaExists', () => {
    const sampler: MetricsSampler = new MetricsSampler();
    const sample: MetricsSample = sampler.sample([core(0, 100)], 1000, 250, 't');
    expect(sample.cpu).toBe(0);
  });

  it('cpu_isTheBusyFractionOfTheDeltaBetweenSamples', () => {
    const sampler: MetricsSampler = new MetricsSampler();
    sampler.sample([core(0, 100)], 1000, 250, 't0');
    // Busy +50, idle +50 → 50% of the interval was busy.
    const sample: MetricsSample = sampler.sample([core(50, 150)], 1000, 250, 't1');
    expect(sample.cpu).toBe(50);
  });

  it('cpu_aggregatesEveryCore', () => {
    const sampler: MetricsSampler = new MetricsSampler();
    sampler.sample([core(0, 100), core(0, 100)], 1000, 250, 't0');
    // Core A fully busy (+100 busy), core B fully idle (+100 idle) → 50% across both.
    const sample: MetricsSample = sampler.sample([core(100, 100), core(0, 200)], 1000, 250, 't1');
    expect(sample.cpu).toBe(50);
  });

  it('cpu_isZeroWhenNoTimePassed', () => {
    const sampler: MetricsSampler = new MetricsSampler();
    sampler.sample([core(0, 100)], 1000, 250, 't0');
    const sample: MetricsSample = sampler.sample([core(0, 100)], 1000, 250, 't1');
    expect(sample.cpu).toBe(0);
  });

  it('memory_isUsedOverTotalAsBytesAndPercent', () => {
    const sample: MetricsSample = new MetricsSampler().sample([core(0, 100)], 1000, 250, 't');
    expect(sample.memory).toEqual({ usedBytes: 750, totalBytes: 1000, percent: 75 });
  });

  it('memory_isZeroPercentWhenTotalIsZero', () => {
    const sample: MetricsSample = new MetricsSampler().sample([core(0, 100)], 0, 0, 't');
    expect(sample.memory.percent).toBe(0);
  });

  it('carriesTheTimestampThrough', () => {
    const sample: MetricsSample = new MetricsSampler().sample(
      [core(0, 100)],
      1000,
      250,
      '2026-08-10T00:00:00.000Z',
    );
    expect(sample.timestamp).toBe('2026-08-10T00:00:00.000Z');
  });
});
