import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Settings } from '@shared/angular/services/settings/settings';
import { SystemMonitorMetrics } from '../../metrics/system-monitor-metrics';
import { SystemMonitorGpu } from '../../readings/system-monitor-gpu';
import { SystemMonitorProcesses } from '../../readings/system-monitor-processes';
import { SystemMonitorReadings } from '../../readings/system-monitor-readings';
import { GpuTab } from './gpu-tab';
import { GPU_MACHINE, GPU_READING } from './gpu-test-reading';

describe('GpuTab', () => {
  let fixture: ComponentFixture<GpuTab>;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GpuTab],
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
    TestBed.inject(SystemMonitorReadings).setInfo(GPU_MACHINE);
    TestBed.inject(SystemMonitorGpu).accept(GPU_READING);
    fixture = TestBed.createComponent(GpuTab);
    host = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    globalThis.localStorage?.clear();
  });

  it('namesTheGpu_withItsHeadlineFigures', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    expect(host.textContent).toContain('AMD Radeon RX 6900 XT');
    const chips: string[] = Array.from(host.querySelectorAll('[aria-label="Summary"] li')).map(
      (chip: Element): string =>
        `${chip.querySelector('.view-summary__label')?.textContent?.trim() ?? ''} ${chip.querySelector('.view-summary__value')?.textContent?.trim() ?? ''}`,
    );
    expect(chips).toEqual([
      'Driver AMDRadeonX6000 7.0.1',
      'VRAM 16.0 GB',
      'Bus PCIe ×16',
      'Power 71 W',
      'Temp 62 °C',
    ]);
  });

  it('laysOutTheSketchsCards', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    expect(
      Array.from(host.querySelectorAll('article')).map(
        (card: Element): string => card.getAttribute('aria-label') ?? '',
      ),
    ).toEqual([
      'GPU Utilisation',
      'Memory (VRAM)',
      'Temperature & Power',
      'GPU Engines',
      'GPU Memory Usage',
      'Processes Using the GPU',
      'GPU Information',
      'GPU Utilisation History',
    ]);
  });

  it('saysSo_whenGpuMonitoringIsOff', async () => {
    TestBed.inject(Settings).set('systemMonitor.gpuMonitoring', false);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(host.textContent).toContain('GPU Monitoring is off');
    expect(host.querySelectorAll('article')).toHaveLength(0);
  });
});
