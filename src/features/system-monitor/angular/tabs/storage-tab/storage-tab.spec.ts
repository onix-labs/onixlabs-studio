import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SystemMonitorReadings } from '../../readings/system-monitor-readings';
import { StorageTab } from './storage-tab';

describe('StorageTab', () => {
  let fixture: ComponentFixture<StorageTab>;
  let host: HTMLElement;
  let readings: SystemMonitorReadings;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StorageTab],
      providers: [SystemMonitorReadings],
    }).compileComponents();
    readings = TestBed.inject(SystemMonitorReadings);
    fixture = TestBed.createComponent(StorageTab);
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => {
    globalThis.localStorage?.clear();
  });

  it('listsEachVolume_withItsSpaceAndUsage', async () => {
    expect(host.querySelector('[data-testid="storage-volumes"]')).toBeNull();

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
      '[data-testid="storage-volumes"] tbody tr',
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('950.0 GB');
    expect(rows[0].textContent).toContain('50.0 GB');
    const meters: NodeListOf<HTMLElement> = host.querySelectorAll('[role="meter"]');
    expect(meters[0].getAttribute('aria-valuenow')).toBe('95');
    expect(meters[1].getAttribute('aria-valuenow')).toBe('0');
  });
});
