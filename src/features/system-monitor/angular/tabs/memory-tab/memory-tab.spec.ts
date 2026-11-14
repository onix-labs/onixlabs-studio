import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MetricsSample } from '@shared/api/system-monitor-channels';
import { SystemMonitorReadings } from '../../readings/system-monitor-readings';
import { MemoryTab } from './memory-tab';

/**
 * Builds a sample with the given memory breakdown.
 * @param over The fields to override.
 * @returns Returns the sample.
 */
function sample(over: Partial<MetricsSample> = {}): MetricsSample {
  return {
    timestamp: 't',
    cpu: 0,
    memory: { usedBytes: 8 * 1024 ** 3, totalBytes: 16 * 1024 ** 3, percent: 50 },
    ...over,
  };
}

describe('MemoryTab', () => {
  let fixture: ComponentFixture<MemoryTab>;
  let host: HTMLElement;
  let readings: SystemMonitorReadings;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MemoryTab],
      providers: [SystemMonitorReadings],
    }).compileComponents();
    readings = TestBed.inject(SystemMonitorReadings);
    fixture = TestBed.createComponent(MemoryTab);
    host = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    globalThis.localStorage?.clear();
  });

  /**
   * Shows the tab with one sample accepted.
   * @param value The sample.
   */
  async function show(value: MetricsSample): Promise<void> {
    readings.accept(value);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  it('showsAvailableBesideInUse_andSwapWhenThereIsSome', async () => {
    await show(
      sample({
        memoryDetail: {
          availableBytes: 12 * 1024 ** 3,
          swapUsedBytes: 1024 ** 3,
          swapTotalBytes: 2 * 1024 ** 3,
        },
      }),
    );

    expect(host.textContent).toContain('In use');
    expect(host.textContent).toContain('8.0 GB (50%)');
    expect(host.textContent).toContain('Available');
    expect(host.textContent).toContain('12.0 GB');
    expect(host.textContent).toContain('1.0 GB of 2.0 GB');
    expect(host.querySelectorAll('app-metric-tile')).toHaveLength(2);
  });

  it('leavesSwapOut_whenNoneIsConfigured', async () => {
    await show(
      sample({ memoryDetail: { availableBytes: 1, swapUsedBytes: 0, swapTotalBytes: 0 } }),
    );

    expect(host.textContent).not.toContain('Swap');
    expect(host.querySelectorAll('app-metric-tile')).toHaveLength(1);
  });
});
