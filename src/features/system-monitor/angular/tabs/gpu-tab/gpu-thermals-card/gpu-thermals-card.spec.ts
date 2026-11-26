import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SystemMonitorMetrics } from '../../../metrics/system-monitor-metrics';
import { SystemMonitorGpu } from '../../../readings/system-monitor-gpu';
import { SystemMonitorProcesses } from '../../../readings/system-monitor-processes';
import { SystemMonitorReadings } from '../../../readings/system-monitor-readings';
import { GPU_MACHINE, GPU_READING } from '../gpu-test-reading';
import { GpuThermalsCard } from './gpu-thermals-card';

describe('GpuThermalsCard', () => {
  let fixture: ComponentFixture<GpuThermalsCard>;
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
      imports: [GpuThermalsCard],
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
    fixture = TestBed.createComponent(GpuThermalsCard);
    host = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    globalThis.localStorage?.clear();
  });

  it('showsTemperaturePowerAndFan_barringWhatHasAScale', async () => {
    gpu.accept(GPU_READING);
    await settle();

    const rows: string[] = Array.from(host.querySelectorAll('[data-testid="gpu-thermals"] li')).map(
      (row: Element): string => row.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    );
    expect(rows).toEqual(['62 °C', '71 W', '589 RPM']);
    // Power has no limit here, so no bar; temperature and the fan do.
    expect(host.querySelectorAll('[role="meter"]')).toHaveLength(2);
    expect(listing).toBeDefined();
  });

  it('notesAStoppedFan_andAPowerDrawsShareOfItsLimit', async () => {
    gpu.accept({ ...GPU_READING, fanRpm: 0, powerLimitWatts: 284 });
    await settle();

    expect(host.textContent).toContain('Fan Stop');
    expect(host.textContent).toContain('25% of 284 W');
  });
});
