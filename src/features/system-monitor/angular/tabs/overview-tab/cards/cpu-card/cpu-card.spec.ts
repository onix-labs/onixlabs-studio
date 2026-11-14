import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SystemMonitorReadings } from '../../../../readings/system-monitor-readings';
import { CpuCard } from './cpu-card';

describe('CpuCard', () => {
  let fixture: ComponentFixture<CpuCard>;
  let host: HTMLElement;
  let readings: SystemMonitorReadings;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CpuCard],
      providers: [SystemMonitorReadings],
    }).compileComponents();
    readings = TestBed.inject(SystemMonitorReadings);
    fixture = TestBed.createComponent(CpuCard);
    host = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    globalThis.localStorage?.clear();
  });

  it('describesTheProcessor_andDrawsAGraphPerCore', async () => {
    readings.setInfo({
      cpuModel: 'Test CPU',
      logicalCores: 4,
      physicalCores: 2,
      speedGhz: 2.7,
      totalMemoryBytes: 1,
      os: 'TestOS',
      gpus: [],
    });
    readings.accept({
      timestamp: 't',
      cpu: 6,
      memory: { usedBytes: 1, totalBytes: 2, percent: 50 },
      cores: [1, 2, 3, 24],
    });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(host.textContent).toContain('2.70 GHz');
    expect(host.textContent).toContain('6%');
    const cores: NodeListOf<HTMLElement> = host.querySelectorAll(
      '[data-testid="cpu-card-cores"] > div',
    );
    expect(cores).toHaveLength(4);
    expect(cores[3].getAttribute('title')).toBe('Core 4: 24%');
  });
});
