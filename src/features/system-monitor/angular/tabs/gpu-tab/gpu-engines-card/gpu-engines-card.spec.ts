import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SystemMonitorMetrics } from '../../../metrics/system-monitor-metrics';
import { SystemMonitorGpu } from '../../../readings/system-monitor-gpu';
import { SystemMonitorProcesses } from '../../../readings/system-monitor-processes';
import { SystemMonitorReadings } from '../../../readings/system-monitor-readings';
import { GPU_MACHINE, GPU_READING } from '../gpu-test-reading';
import { GpuEnginesCard } from './gpu-engines-card';

describe('GpuEnginesCard', () => {
  let fixture: ComponentFixture<GpuEnginesCard>;
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
      imports: [GpuEnginesCard],
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
    fixture = TestBed.createComponent(GpuEnginesCard);
    host = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    globalThis.localStorage?.clear();
  });

  it('listsEachEngine_inCommandsASecondWhereThatIsAllTheGpuSays', async () => {
    gpu.accept(GPU_READING);
    await settle();

    const rows: string[] = Array.from(host.querySelectorAll('[data-testid="gpu-engines"] li')).map(
      (row: Element): string =>
        `${row.querySelector('.gpu-engines__name')?.textContent?.trim()} ${row.querySelector('.gpu-engines__value')?.textContent?.trim()}`,
    );
    expect(rows).toEqual(['3D / Graphics 106/s', 'Video Decode 0/s']);
    expect(host.textContent).toContain('Commands / second');
    expect(listing).toBeDefined();
  });

  it('readsPercentages_whereTheGpuReportsThem', async () => {
    gpu.accept({
      ...GPU_READING,
      engines: [{ kind: 'encode', label: 'Video Encode', value: 12, unit: 'percent' }],
    });
    await settle();

    expect(host.textContent).toContain('12%');
    expect(host.textContent).not.toContain('Commands / second');
  });
});
