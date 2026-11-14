import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SystemMonitorMetrics } from '../../../metrics/system-monitor-metrics';
import { SystemMonitorGpu } from '../../../readings/system-monitor-gpu';
import { SystemMonitorProcesses } from '../../../readings/system-monitor-processes';
import { SystemMonitorReadings } from '../../../readings/system-monitor-readings';
import { GPU_MACHINE, GPU_READING } from '../gpu-test-reading';
import { GpuMemoryCard } from './gpu-memory-card';

describe('GpuMemoryCard', () => {
  let fixture: ComponentFixture<GpuMemoryCard>;
  let host: HTMLElement;
  let gpu: SystemMonitorGpu;
  let readings: SystemMonitorReadings;
  let listing: SystemMonitorProcesses;

  /**
   * Settles the fixture after a change.
   */
  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GpuMemoryCard],
      providers: [
        SystemMonitorReadings,
        SystemMonitorProcesses,
        SystemMonitorGpu,
        {
          provide: SystemMonitorMetrics,
          useValue: { gpuHistory: (): Promise<null> => Promise.resolve(null) },
        },
      ],
    }).compileComponents();
    gpu = TestBed.inject(SystemMonitorGpu);
    readings = TestBed.inject(SystemMonitorReadings);
    listing = TestBed.inject(SystemMonitorProcesses);
    readings.setInfo(GPU_MACHINE);
    fixture = TestBed.createComponent(GpuMemoryCard);
    host = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    globalThis.localStorage?.clear();
  });

  it('metersTheVideoMemory_againstWhatTheGpuHas', async () => {
    gpu.accept(GPU_READING);
    await settle();

    expect(host.textContent).toContain('2.0 GB / 16.0 GB');
    expect(host.querySelector('[role="meter"]')?.getAttribute('aria-valuenow')).toBe('12.5');
    expect(host.textContent).toContain('14.0 GB');
    expect(listing).toBeDefined();
  });

  it('metersAnIdleGpu_ratherThanSayingItReportsNothing', async () => {
    gpu.accept({ ...GPU_READING, memoryUsedBytes: 0 });
    await settle();

    expect(host.querySelector('[role="meter"]')?.getAttribute('aria-valuenow')).toBe('0');
  });
});
