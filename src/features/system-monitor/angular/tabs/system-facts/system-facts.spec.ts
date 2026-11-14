import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SystemMonitorReadings } from '../../readings/system-monitor-readings';
import { SystemFacts } from './system-facts';

describe('SystemFacts', () => {
  let fixture: ComponentFixture<SystemFacts>;
  let host: HTMLElement;
  let readings: SystemMonitorReadings;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SystemFacts],
      providers: [SystemMonitorReadings],
    }).compileComponents();
    readings = TestBed.inject(SystemMonitorReadings);
    fixture = TestBed.createComponent(SystemFacts);
    host = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    globalThis.localStorage?.clear();
  });

  it('describesTheMachine_withItsUptimeToTheLatestSample', async () => {
    const boot: number = Date.parse('2026-11-12T00:00:00.000Z');
    readings.setInfo({
      cpuModel: 'Intel Xeon',
      logicalCores: 48,
      physicalCores: 24,
      totalMemoryBytes: 256 * 1024 ** 3,
      os: 'macOS 26.7.3',
      bootTime: boot,
      gpus: [],
    });
    readings.accept({
      // Two days, an hour, two minutes and three seconds after boot.
      timestamp: new Date(boot + ((2 * 24 + 1) * 3600 + 2 * 60 + 3) * 1000).toISOString(),
      cpu: 0,
      memory: { usedBytes: 1, totalBytes: 2, percent: 50 },
    });
    fixture.detectChanges();
    await fixture.whenStable();

    const text: string = host.textContent ?? '';
    expect(text).toContain('macOS 26.7.3');
    expect(text).toContain('24 / 48');
    expect(text).toContain('256.0 GB');
    expect(text).toContain('2d 01:02:03');
  });

  it('showsPlaceholders_untilTheMachineIsDescribed', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    expect(host.querySelectorAll('dd')[0].textContent?.trim()).toBe('—');
  });
});
