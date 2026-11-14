import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SystemMonitorReadings } from '../../readings/system-monitor-readings';
import { GpuTab } from './gpu-tab';

describe('GpuTab', () => {
  let fixture: ComponentFixture<GpuTab>;
  let host: HTMLElement;
  let readings: SystemMonitorReadings;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GpuTab],
      providers: [SystemMonitorReadings],
    }).compileComponents();
    readings = TestBed.inject(SystemMonitorReadings);
    fixture = TestBed.createComponent(GpuTab);
    host = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    globalThis.localStorage?.clear();
  });

  it('showsNotAvailable_whereThePlatformDoesNotReportTheGpu', async () => {
    readings.accept({
      timestamp: 't',
      cpu: 0,
      memory: { usedBytes: 1, totalBytes: 2, percent: 50 },
      gpu: { available: false, percent: 0 },
    });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(host.textContent).toContain('N/A');
  });
});
