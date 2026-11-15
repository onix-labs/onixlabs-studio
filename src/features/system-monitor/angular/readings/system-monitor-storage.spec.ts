import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { StorageDeviceReading, StorageReading } from '@shared/api/system-monitor-channels';
import { STORAGE_LIVE_READINGS, SystemMonitorStorage } from './system-monitor-storage';

/**
 * Builds a device's reading.
 * @param id The device.
 * @param readBytesPerSecond Its reads.
 * @param utilisationPercent How busy it was.
 * @returns Returns the reading.
 */
function device(
  id: string,
  readBytesPerSecond: number,
  utilisationPercent?: number,
): StorageDeviceReading {
  return {
    id,
    readBytesPerSecond,
    writeBytesPerSecond: 0,
    readOpsPerSecond: 1,
    writeOpsPerSecond: 2,
    totalReadBytes: 0,
    totalWriteBytes: 0,
    totalReadOps: 0,
    totalWriteOps: 0,
    ...(utilisationPercent === undefined ? {} : { utilisationPercent }),
  };
}

/**
 * Builds a reading of the given devices.
 * @param devices The devices.
 * @returns Returns the reading.
 */
function reading(...devices: StorageDeviceReading[]): StorageReading {
  return { timestamp: 't', devices };
}

describe('SystemMonitorStorage', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    globalThis.localStorage?.clear();
  });

  /**
   * Creates the service.
   * @returns Returns it.
   */
  function create(): SystemMonitorStorage {
    TestBed.configureTestingModule({ providers: [SystemMonitorStorage] });
    return TestBed.inject(SystemMonitorStorage);
  }

  it('countsEveryDevice_untilTheDevicesAreKnown_thenOnlyThoseListed', () => {
    const storage: SystemMonitorStorage = create();
    storage.accept(reading(device('disk1', 10), device('disk5', 100)));

    expect(storage.totals().readBytesPerSecond).toBe(110);

    storage.setInfo({
      devices: [{ id: 'disk1', name: 'SSD', kind: 'nvme', sizeBytes: 1 }],
      volumes: [],
    });

    expect(storage.totals().readBytesPerSecond).toBe(10);
    expect(storage.totals().writeOpsPerSecond).toBe(2);
  });

  it('describesTheFirstDevice_untilAnotherIsChosen_andGraphsItsUtilisation', () => {
    const storage: SystemMonitorStorage = create();
    storage.setInfo({
      devices: [
        { id: 'disk1', name: 'A', kind: 'nvme', sizeBytes: 1 },
        { id: 'disk0', name: 'B', kind: 'ssd', sizeBytes: 1 },
      ],
      volumes: [],
    });
    storage.accept(reading(device('disk1', 0), device('disk0', 0)));
    storage.accept(reading(device('disk1', 0, 20), device('disk0', 0, 70)));

    expect(storage.selected()?.id).toBe('disk1');
    expect(storage.utilisationHistory()).toEqual([20]);

    storage.select('disk0');

    expect(storage.selectedReading()?.utilisationPercent).toBe(70);
    expect(storage.utilisationHistory()).toEqual([70]);
  });

  it('keepsFiveMinutesOfReadings', () => {
    const storage: SystemMonitorStorage = create();
    for (let index: number = 0; index < STORAGE_LIVE_READINGS + 5; index += 1) {
      storage.accept(reading(device('disk1', index)));
    }

    expect(storage.totals().readBytesPerSecond).toBe(STORAGE_LIVE_READINGS + 4);
  });
});
