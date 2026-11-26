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

  /**
   * Describes a machine whose GPU has 16 GB of video memory.
   */
  function machine(): void {
    readings.setInfo({
      cpuModel: 'CPU',
      logicalCores: 1,
      totalMemoryBytes: 1,
      os: 'TestOS',
      architecture: 'x86_64',
      caches: [],
      gpus: [{ model: 'Radeon Pro', vendor: 'AMD', memoryBytes: 16 * 1024 ** 3 }],
      memoryModules: [],
    });
  }

  /**
   * Reads the video memory's breakdown, label and value.
   * @returns Returns each entry as `label value`.
   */
  function entries(): string[] {
    return Array.from(host.querySelectorAll('[data-testid="gpu-card-vram"] > div')).map(
      (entry: Element): string =>
        `${entry.querySelector('dt')?.textContent?.trim()} ${entry.querySelector('dd')?.textContent?.trim()}`,
    );
  }

  it('showsTheVideoMemoryInUse_asAMeterAndABreakdown', async () => {
    machine();
    readings.accept({
      timestamp: 't',
      cpu: 0,
      memory: { usedBytes: 1, totalBytes: 2, percent: 50 },
      gpu: {
        available: true,
        percent: 2,
        source: 'ioreg',
        memoryUsedBytes: 4 * 1024 ** 3,
        memoryTotalBytes: 16 * 1024 ** 3,
      },
    });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(entries()).toEqual(['In Use 4.0 GB', 'Available 12.0 GB', 'Total 16.0 GB']);
    expect(host.querySelector('app-system-monitor-radial-meter')?.textContent).toContain('25%');
    // The model is the GPU view's; the card is the GPU's use.
    expect(host.textContent).not.toContain('Radeon Pro');
  });

  it('fallsBackToTheGpusOwnTotal_andDashesWhatIsNotReported', async () => {
    machine();
    readings.accept({
      timestamp: 't',
      cpu: 0,
      memory: { usedBytes: 1, totalBytes: 2, percent: 50 },
      gpu: { available: true, percent: 2, source: 'nvidia-smi' },
    });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(entries()).toEqual(['In Use —', 'Available —', 'Total 16.0 GB']);
  });

  it('saysSo_whenGpuMonitoringIsOff', async () => {
    TestBed.inject(Settings).set('systemMonitor.gpuMonitoring', false);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(host.textContent).toContain('GPU Monitoring is off');
    expect(host.querySelector('app-system-monitor-line-chart')).toBeNull();
  });
});
