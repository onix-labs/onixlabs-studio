import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Settings } from '@shared/angular/services/settings/settings';
import { SystemMonitorReadings } from '../../../../readings/system-monitor-readings';
import { GpuCard } from './gpu-card';

describe('GpuCard', () => {
  let fixture: ComponentFixture<GpuCard>;
  let host: HTMLElement;
  let readings: SystemMonitorReadings;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GpuCard],
      providers: [SystemMonitorReadings],
    }).compileComponents();
    readings = TestBed.inject(SystemMonitorReadings);
    fixture = TestBed.createComponent(GpuCard);
    host = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    globalThis.localStorage?.clear();
  });

  it('namesTheGpusModelAndMemory', async () => {
    readings.setInfo({
      cpuModel: 'CPU',
      logicalCores: 1,
      totalMemoryBytes: 1,
      os: 'TestOS',
      gpus: [{ model: 'Radeon Pro', vendor: 'AMD', memoryBytes: 16 * 1024 ** 3 }],
    });
    readings.accept({
      timestamp: 't',
      cpu: 0,
      memory: { usedBytes: 1, totalBytes: 2, percent: 50 },
      gpu: { available: true, percent: 2, source: 'ioreg' },
    });
    fixture.detectChanges();
    await fixture.whenStable();

    // The utilisation is the badge; the facts are the GPU itself.
    expect(
      Array.from(host.querySelectorAll('dt')).map(
        (term: Element): string => term.textContent?.trim() ?? '',
      ),
    ).toEqual(['Model', 'Memory']);
    expect(host.textContent).toContain('Radeon Pro');
    expect(host.textContent).toContain('16.0 GB');
  });

  it('saysSo_whenGpuMonitoringIsOff', async () => {
    TestBed.inject(Settings).set('systemMonitor.gpuMonitoring', false);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(host.textContent).toContain('GPU Monitoring is off');
    expect(host.querySelector('app-system-monitor-line-chart')).toBeNull();
  });
});
