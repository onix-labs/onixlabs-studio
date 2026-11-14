import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SystemMonitorReadings } from '../../readings/system-monitor-readings';
import { SystemTab } from './system-tab';

describe('SystemTab', () => {
  let fixture: ComponentFixture<SystemTab>;
  let host: HTMLElement;
  let readings: SystemMonitorReadings;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SystemTab],
      providers: [SystemMonitorReadings],
    }).compileComponents();
    readings = TestBed.inject(SystemMonitorReadings);
    fixture = TestBed.createComponent(SystemTab);
    host = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    globalThis.localStorage?.clear();
  });

  it('statesTheHealth_andWhatIsUnderPressure', async () => {
    readings.accept({
      timestamp: 't',
      cpu: 0,
      memory: { usedBytes: 95, totalBytes: 100, percent: 95 },
      volumes: [{ mount: '/', type: 'apfs', sizeBytes: 100, usedBytes: 99 }],
    });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(host.textContent).toContain('Under pressure');
    expect(host.textContent).toContain('Memory pressure, / nearly full');
    expect(host.querySelector('[data-testid="system-facts"]')).not.toBeNull();
  });
});
