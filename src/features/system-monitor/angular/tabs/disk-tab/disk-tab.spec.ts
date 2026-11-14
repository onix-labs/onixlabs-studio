import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SystemMonitorReadings } from '../../readings/system-monitor-readings';
import { DiskTab } from './disk-tab';

describe('DiskTab', () => {
  let fixture: ComponentFixture<DiskTab>;
  let host: HTMLElement;
  let readings: SystemMonitorReadings;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DiskTab],
      providers: [SystemMonitorReadings],
    }).compileComponents();
    readings = TestBed.inject(SystemMonitorReadings);
    fixture = TestBed.createComponent(DiskTab);
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => {
    globalThis.localStorage?.clear();
  });

  it('listsEachVolume_withItsSpaceAndUsage', async () => {
    expect(host.querySelector('[data-testid="disk-volumes"]')).toBeNull();

    readings.accept({
      timestamp: 't',
      cpu: 0,
      memory: { usedBytes: 1, totalBytes: 2, percent: 50 },
      volumes: [
        { mount: '/', type: 'apfs', sizeBytes: 1000 * 1024 ** 3, usedBytes: 950 * 1024 ** 3 },
        { mount: '/Volumes/Backup', type: 'hfs', sizeBytes: 100 * 1024 ** 3, usedBytes: 0 },
      ],
    });
    fixture.detectChanges();
    await fixture.whenStable();

    const rows: NodeListOf<HTMLTableRowElement> = host.querySelectorAll(
      '[data-testid="disk-volumes"] tbody tr',
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('950.0 GB');
    expect(rows[0].textContent).toContain('50.0 GB');
    const meters: NodeListOf<HTMLElement> = host.querySelectorAll('[role="meter"]');
    expect(meters[0].getAttribute('aria-valuenow')).toBe('95');
    expect(meters[1].getAttribute('aria-valuenow')).toBe('0');
  });
});
