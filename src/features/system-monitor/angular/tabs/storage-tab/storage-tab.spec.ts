import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StorageInfo, StorageReading } from '@shared/api/system-monitor-channels';
import { SystemMonitorReadings } from '../../readings/system-monitor-readings';
import { SystemMonitorStorage } from '../../readings/system-monitor-storage';
import { StorageTab } from './storage-tab';

/**
 * Two drives, the system's first, and the volume on each.
 */
const INFO: StorageInfo = {
  devices: [
    {
      id: 'disk1',
      name: 'Samsung SSD 990 PRO 2TB',
      vendor: 'Samsung',
      kind: 'nvme',
      connection: 'PCIe 4.0 x4',
      sizeBytes: 2_000_398_934_016,
      serial: 'S6Z2',
      firmware: '3B2QJXD7',
      health: 'ok',
    },
    { id: 'disk0', name: 'APPLE SSD AP0256M', kind: 'nvme', sizeBytes: 251_000_193_024 },
  ],
  volumes: [
    { mount: '/', deviceId: 'disk1', name: 'Macintosh HD' },
    { mount: '/Volumes/Spare', deviceId: 'disk0', name: 'Spare' },
  ],
};

/**
 * Builds a reading in which the system drive reads 2 MB/s at 40% busy.
 * @param at The reading's time.
 * @returns Returns the reading.
 */
function reading(at: string): StorageReading {
  return {
    timestamp: at,
    devices: [
      {
        id: 'disk1',
        readBytesPerSecond: 2 * 1024 ** 2,
        writeBytesPerSecond: 1024,
        readOpsPerSecond: 354,
        writeOpsPerSecond: 1042,
        utilisationPercent: 40,
        totalReadBytes: 1024 ** 3,
        totalWriteBytes: 2 * 1024 ** 3,
        totalReadOps: 1000,
        totalWriteOps: 4000,
      },
      {
        id: 'disk5',
        readBytesPerSecond: 1024 ** 3,
        writeBytesPerSecond: 0,
        readOpsPerSecond: 0,
        writeOpsPerSecond: 0,
        totalReadBytes: 0,
        totalWriteBytes: 0,
        totalReadOps: 0,
        totalWriteOps: 0,
      },
    ],
  };
}

describe('StorageTab', () => {
  let fixture: ComponentFixture<StorageTab>;
  let host: HTMLElement;
  let storage: SystemMonitorStorage;

  /**
   * Settles the fixture after a change.
   */
  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StorageTab],
      providers: [SystemMonitorReadings, SystemMonitorStorage],
    }).compileComponents();
    storage = TestBed.inject(SystemMonitorStorage);
    TestBed.inject(SystemMonitorReadings).accept({
      timestamp: 't',
      cpu: 0,
      memory: { usedBytes: 1, totalBytes: 2, percent: 50 },
      volumes: [
        { mount: '/', type: 'apfs', sizeBytes: 1000 * 1024 ** 3, usedBytes: 250 * 1024 ** 3 },
        { mount: '/Volumes/Spare', type: 'apfs', sizeBytes: 200 * 1024 ** 3, usedBytes: 0 },
        { mount: '/Volumes/Share', type: 'smbfs', sizeBytes: 8 * 1024 ** 4, usedBytes: 1024 ** 4 },
      ],
    });
    fixture = TestBed.createComponent(StorageTab);
    host = fixture.nativeElement as HTMLElement;
    await settle();
  });

  afterEach(() => {
    globalThis.localStorage?.clear();
  });

  it('saysItIsReadingTheDrives_untilTheyAreRead', () => {
    expect(host.textContent).toContain('Reading the drives…');
  });

  it('summarisesTheDrivesAndVolumes_countingOnlyListedDrivesActivity', async () => {
    storage.setInfo(INFO);
    storage.accept(reading('2026-11-14T10:00:00Z'));
    await settle();

    const summary: string = host.querySelector('[aria-label="Summary"]')?.textContent ?? '';
    expect(host.textContent).toContain('2 devices • 3 volumes');
    expect(summary).toContain('2.0 TB');
    // The network share is listed with the volumes but not counted in the drives' space.
    expect(summary).toContain('250.0 GB (21%)');
    expect(summary).toContain('950.0 GB');
    // The disk image's gigabyte a second is left out of the machine's reads.
    expect(summary).toContain('2.0 MB/s');
  });

  it('describesTheSystemDrive_untilAnotherIsChosen', async () => {
    storage.setInfo(INFO);
    storage.accept(reading('2026-11-14T10:00:00Z'));
    await settle();

    const device: string = host.querySelector('[data-testid="storage-device"]')?.textContent ?? '';
    expect(device).toContain('PCIe 4.0 x4');
    expect(device).toContain('2,000,398,934,016 bytes');
    expect(device).toContain('OK');
    expect(host.querySelector('[data-testid="storage-statistics"]')?.textContent).toContain(
      '1,000',
    );
    expect(host.querySelector('[data-testid="storage-utilisation-stats"]')?.textContent).toContain(
      '354 / 1,042',
    );

    host.querySelectorAll<HTMLButtonElement>('[role="radio"]')[1].click();
    await settle();

    expect(host.querySelector('[data-testid="storage-device"]')?.textContent).toContain(
      'APPLE SSD AP0256M',
    );
    expect(host.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toContain(
      'APPLE',
    );
  });

  it('listsEachVolume_withItsNameSpaceAndUsage', async () => {
    storage.setInfo(INFO);
    await settle();

    const rows: NodeListOf<HTMLTableRowElement> = host.querySelectorAll(
      '[data-testid="storage-volumes"] tbody tr',
    );
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain('Macintosh HD');
    expect(rows[0].textContent).toContain('750.0 GB');
    expect(rows[0].querySelector('[role="meter"]')?.getAttribute('aria-valuenow')).toBe('25');
  });
});
