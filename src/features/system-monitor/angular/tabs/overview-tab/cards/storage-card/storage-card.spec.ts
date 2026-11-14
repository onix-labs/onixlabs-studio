import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SystemMonitorReadings } from '../../../../readings/system-monitor-readings';
import { StorageCard } from './storage-card';

describe('StorageCard', () => {
  let fixture: ComponentFixture<StorageCard>;
  let host: HTMLElement;
  let readings: SystemMonitorReadings;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StorageCard],
      providers: [SystemMonitorReadings],
    }).compileComponents();
    readings = TestBed.inject(SystemMonitorReadings);
    fixture = TestBed.createComponent(StorageCard);
    host = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    globalThis.localStorage?.clear();
  });

  it('showsEachVolumesSpace_aSliverReadingAsUnderOnePercent', async () => {
    readings.accept({
      timestamp: 't',
      cpu: 0,
      memory: { usedBytes: 1, totalBytes: 2, percent: 50 },
      disk: { readBytesPerSec: 2048, writeBytesPerSec: 0 },
      volumes: [
        { mount: '/', type: 'APFS', sizeBytes: 1000 * 1024 ** 3, usedBytes: 100 * 1024 ** 3 },
        { mount: '/Volumes/Spare', type: 'APFS', sizeBytes: 1024 ** 3, usedBytes: 1024 ** 2 },
      ],
    });
    fixture.detectChanges();
    await fixture.whenStable();

    const rows: NodeListOf<HTMLTableRowElement> = host.querySelectorAll(
      '[data-testid="storage-card-volumes"] tbody tr',
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('100.0 GB / 1000.0 GB');
    expect(rows[0].textContent).toContain('10%');
    expect(rows[1].textContent).toContain('<1%');
    expect(host.textContent).toContain('2.0 KB/s');
  });
});
