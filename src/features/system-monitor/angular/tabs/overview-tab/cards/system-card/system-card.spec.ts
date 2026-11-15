import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SystemMonitorReadings } from '../../../../readings/system-monitor-readings';
import { SystemCard } from './system-card';

describe('SystemCard', () => {
  let fixture: ComponentFixture<SystemCard>;
  let host: HTMLElement;
  let readings: SystemMonitorReadings;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SystemCard],
      providers: [SystemMonitorReadings],
    }).compileComponents();
    readings = TestBed.inject(SystemMonitorReadings);
    fixture = TestBed.createComponent(SystemCard);
    host = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    globalThis.localStorage?.clear();
  });

  it('saysTheMachineIsHealthy_untilSomethingIsUnderPressure', async () => {
    readings.accept({
      timestamp: 't',
      cpu: 0,
      memory: { usedBytes: 1, totalBytes: 2, percent: 50 },
    });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(host.textContent).toContain('Healthy');

    readings.accept({
      timestamp: 't',
      cpu: 0,
      memory: { usedBytes: 95, totalBytes: 100, percent: 95 },
    });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(host.textContent).toContain('Memory pressure');
  });
});
