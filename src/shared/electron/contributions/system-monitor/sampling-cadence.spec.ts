import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SAMPLE_INTERVAL_MS,
  SAMPLE_INTERVAL_RANGE_MS,
} from '@shared/api/system-monitor-channels';
import { HeavyCadence, normaliseSamplingInterval } from './sampling-cadence';

describe('normaliseSamplingInterval', () => {
  it('acceptsARateInsideTheRange', () => {
    expect(normaliseSamplingInterval({ intervalMs: 500 })).toBe(500);
    expect(normaliseSamplingInterval({ intervalMs: 4000 })).toBe(4000);
  });

  it('clampsARateOutsideTheRange_soAStrayValueCannotSpinOrSilenceTheLoop', () => {
    expect(normaliseSamplingInterval({ intervalMs: 1 })).toBe(SAMPLE_INTERVAL_RANGE_MS.min);
    expect(normaliseSamplingInterval({ intervalMs: 0 })).toBe(SAMPLE_INTERVAL_RANGE_MS.min);
    expect(normaliseSamplingInterval({ intervalMs: 1e9 })).toBe(SAMPLE_INTERVAL_RANGE_MS.max);
  });

  it('fallsBackToTheDefaultWhenThePayloadIsNotARate', () => {
    expect(normaliseSamplingInterval(undefined)).toBe(DEFAULT_SAMPLE_INTERVAL_MS);
    expect(normaliseSamplingInterval(null)).toBe(DEFAULT_SAMPLE_INTERVAL_MS);
    expect(normaliseSamplingInterval({})).toBe(DEFAULT_SAMPLE_INTERVAL_MS);
    expect(normaliseSamplingInterval({ intervalMs: 'fast' })).toBe(DEFAULT_SAMPLE_INTERVAL_MS);
    expect(normaliseSamplingInterval({ intervalMs: Number.NaN })).toBe(DEFAULT_SAMPLE_INTERVAL_MS);
  });
});

describe('HeavyCadence', () => {
  it('isDueOnTheFirstTick_thenOnlyOnceTheGapHasPassed', () => {
    const cadence: HeavyCadence = new HeavyCadence(3000);
    expect(cadence.due(0)).toBe(true);
    expect(cadence.due(1000)).toBe(false);
    expect(cadence.due(2000)).toBe(false);
    expect(cadence.due(3000)).toBe(true);
    expect(cadence.due(4000)).toBe(false);
    expect(cadence.due(6500)).toBe(true);
  });

  it('isDueEveryTickWhenTicksAreFurtherApartThanTheGap', () => {
    const cadence: HeavyCadence = new HeavyCadence(3000);
    expect(cadence.due(0)).toBe(true);
    expect(cadence.due(4000)).toBe(true);
    expect(cadence.due(8000)).toBe(true);
  });
});
