import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SystemMonitorReadings } from '../../readings/system-monitor-readings';
import { CpuTab } from './cpu-tab';

describe('CpuTab', () => {
  let fixture: ComponentFixture<CpuTab>;
  let host: HTMLElement;
  let readings: SystemMonitorReadings;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CpuTab],
      providers: [SystemMonitorReadings],
    }).compileComponents();
    readings = TestBed.inject(SystemMonitorReadings);
    fixture = TestBed.createComponent(CpuTab);
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => {
    globalThis.localStorage?.clear();
  });

  it('drawsAGraphPerCore_onceThereIsAPerCoreReading', async () => {
    expect(host.querySelector('[data-testid="cpu-cores"]')).toBeNull();

    readings.accept({
      timestamp: 't',
      cpu: 30,
      memory: { usedBytes: 1, totalBytes: 2, percent: 50 },
      cores: [10, 50],
    });
    fixture.detectChanges();
    await fixture.whenStable();

    const cores: HTMLElement | null = host.querySelector('[data-testid="cpu-cores"]');
    expect(cores?.querySelectorAll('app-metric-tile')).toHaveLength(2);
    expect(cores?.textContent).toContain('Core 2');
    expect(cores?.textContent).toContain('50%');
  });

  it('showsTheHybridSplit_onlyForAHybridCpu', async () => {
    readings.setInfo({
      cpuModel: 'Test CPU',
      logicalCores: 8,
      physicalCores: 8,
      performanceCores: 6,
      efficiencyCores: 2,
      speedGhz: 3.2,
      totalMemoryBytes: 1,
      os: 'TestOS',
    });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(host.textContent).toContain('Performance / efficiency');
    expect(host.textContent).toContain('6 / 2');
    expect(host.textContent).toContain('3.20 GHz');
  });
});
