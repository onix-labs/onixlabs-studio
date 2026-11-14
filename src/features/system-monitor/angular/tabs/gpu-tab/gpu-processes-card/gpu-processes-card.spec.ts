import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SystemMonitorMetrics } from '../../../metrics/system-monitor-metrics';
import { SystemMonitorGpu } from '../../../readings/system-monitor-gpu';
import { SystemMonitorProcesses } from '../../../readings/system-monitor-processes';
import { SystemMonitorReadings } from '../../../readings/system-monitor-readings';
import { GPU_MACHINE, GPU_READING } from '../gpu-test-reading';
import { GpuProcessesCard } from './gpu-processes-card';

describe('GpuProcessesCard', () => {
  let fixture: ComponentFixture<GpuProcessesCard>;
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
      imports: [GpuProcessesCard],
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
    fixture = TestBed.createComponent(GpuProcessesCard);
    host = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    globalThis.localStorage?.clear();
  });

  it('listsTheProcesses_namingThoseTheReadingDoesNotFromTheListing', async () => {
    listing.accept({
      timestamp: 't',
      total: 1,
      processes: [
        {
          pid: 1316,
          parentPid: 1,
          name: 'ONIXLabs Studio Helper (Renderer)',
          command: '',
          user: '',
          cpuPercent: 0,
          memoryBytes: 0,
          memoryPercent: 0,
        },
      ],
    });
    gpu.accept(GPU_READING);
    await settle();

    const headers: string[] = Array.from(host.querySelectorAll('th')).map(
      (header: Element): string => header.textContent?.trim() ?? '',
    );
    // Only GPU % is reported here, so memory and the codecs are left out.
    expect(headers).toEqual(['Name', 'PID', 'GPU %']);
    const names: string[] = Array.from(host.querySelectorAll('tbody tr td:first-child')).map(
      (cell: Element): string => cell.textContent?.trim() ?? '',
    );
    expect(names).toEqual(['WindowServer', 'ONIXLabs Studio Helper (Renderer)']);
  });
});
