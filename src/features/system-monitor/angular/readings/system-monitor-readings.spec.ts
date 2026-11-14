import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Settings } from '@shared/angular/services/settings/settings';
import { MetricsSample } from '@shared/api/system-monitor-channels';
import { SystemMonitorReadings } from './system-monitor-readings';

/**
 * Builds a sample with only CPU and memory, overridable per test.
 * @param over The fields to override.
 * @returns Returns the sample.
 */
function sample(over: Partial<MetricsSample> = {}): MetricsSample {
  return {
    timestamp: 't',
    cpu: 10,
    memory: { usedBytes: 512, totalBytes: 1024, percent: 50 },
    ...over,
  };
}

describe('SystemMonitorReadings', () => {
  let readings: SystemMonitorReadings;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [SystemMonitorReadings] });
    readings = TestBed.inject(SystemMonitorReadings);
  });

  afterEach(() => {
    globalThis.localStorage?.clear();
    TestBed.resetTestingModule();
  });

  it('cores_keepAHistoryPerCore', () => {
    readings.accept(sample({ cores: [10, 20] }));
    readings.accept(sample({ cores: [30, 40] }));

    expect(readings.coreHistories()).toEqual([
      [10, 30],
      [20, 40],
    ]);
    expect(readings.cores()).toEqual([30, 40]);
  });

  it('cores_restartTheirHistories_whenTheCoreCountChanges', () => {
    readings.accept(sample({ cores: [10, 20] }));
    readings.accept(sample({ cores: [50] }));

    expect(readings.coreHistories()).toEqual([[50]]);
  });

  it('histories_areHeldToGraphHistoryAtTheRefreshRate', () => {
    // One minute at ten seconds a sample is six samples.
    TestBed.inject(Settings).set('systemMonitor.graphHistoryMinutes', 1);
    TestBed.inject(Settings).set('systemMonitor.refreshRate', 10_000);
    for (let cpu: number = 1; cpu <= 9; cpu += 1) {
      readings.accept(sample({ cpu }));
    }

    expect(readings.cpuHistory()).toEqual([4, 5, 6, 7, 8, 9]);
  });

  it('swap_isGraphedAsAShareOfTheSwapConfigured_andNotAtAllWithoutSwap', () => {
    readings.accept(
      sample({ memoryDetail: { availableBytes: 1, swapUsedBytes: 0, swapTotalBytes: 0 } }),
    );
    expect(readings.swapHistory()).toEqual([]);

    readings.accept(
      sample({ memoryDetail: { availableBytes: 1, swapUsedBytes: 25, swapTotalBytes: 100 } }),
    );
    expect(readings.swapHistory()).toEqual([25]);
  });

  it('interfacesAndVolumes_followTheLatestSample', () => {
    readings.accept(
      sample({
        interfaces: [{ name: 'en0', rxBytesPerSec: 1, txBytesPerSec: 2 }],
        volumes: [{ mount: '/', type: 'apfs', sizeBytes: 10, usedBytes: 5 }],
      }),
    );

    expect(readings.interfaces().map((metric: { name: string }): string => metric.name)).toEqual([
      'en0',
    ]);
    expect(readings.volumes()).toHaveLength(1);
  });
});
