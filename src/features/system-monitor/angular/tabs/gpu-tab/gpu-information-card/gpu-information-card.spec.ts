import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SystemMonitorMetrics } from '../../../metrics/system-monitor-metrics';
import { SystemMonitorGpu } from '../../../readings/system-monitor-gpu';
import { SystemMonitorProcesses } from '../../../readings/system-monitor-processes';
import { SystemMonitorReadings } from '../../../readings/system-monitor-readings';
import { GPU_MACHINE, GPU_READING } from '../gpu-test-reading';
import { GpuInformationCard } from './gpu-information-card';

describe('GpuInformationCard', () => {
  let fixture: ComponentFixture<GpuInformationCard>;
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
      imports: [GpuInformationCard],
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
    fixture = TestBed.createComponent(GpuInformationCard);
    host = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    globalThis.localStorage?.clear();
  });

  it('describesTheGpu_withItsClocksAsLastRead', async () => {
    gpu.accept(GPU_READING);
    await settle();

    const rows: string[] = Array.from(
      host.querySelectorAll('[data-testid="gpu-information"] dt'),
    ).map((term: Element): string => term.textContent?.trim() ?? '');
    expect(rows).toEqual([
      'Model',
      'Vendor',
      'Architecture',
      'Driver',
      'VRAM',
      'Bus',
      'Core Clock',
      'Memory Clock',
    ]);
    expect(host.textContent).toContain('AMDRadeonX6000 7.0.1');
    expect(host.textContent).toContain('1988 MHz');
    expect(listing).toBeDefined();
  });
});
