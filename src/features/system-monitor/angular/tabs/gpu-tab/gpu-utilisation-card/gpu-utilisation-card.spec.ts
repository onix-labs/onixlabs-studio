import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SystemMonitorMetrics } from '../../../metrics/system-monitor-metrics';
import { SystemMonitorGpu } from '../../../readings/system-monitor-gpu';
import { SystemMonitorProcesses } from '../../../readings/system-monitor-processes';
import { SystemMonitorReadings } from '../../../readings/system-monitor-readings';
import { GPU_MACHINE, GPU_READING } from '../gpu-test-reading';
import { GpuUtilisationCard } from './gpu-utilisation-card';

describe('GpuUtilisationCard', () => {
  let fixture: ComponentFixture<GpuUtilisationCard>;
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
      imports: [GpuUtilisationCard],
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
    fixture = TestBed.createComponent(GpuUtilisationCard);
    host = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    globalThis.localStorage?.clear();
  });

  it('graphsTheUtilisation_withItsLatestReading', async () => {
    gpu.accept(GPU_READING);
    await settle();

    expect(host.textContent).toContain('2%');
    expect(host.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe(
      'GPU utilisation over time',
    );
    expect(listing).toBeDefined();
  });
});
