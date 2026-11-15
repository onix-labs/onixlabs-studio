import { describe, expect, it } from 'vitest';
import { StorageDevice, StorageDeviceReading } from '@shared/api/system-monitor-channels';
import {
  deviceOfVolume,
  deviceReading,
  DiskLayoutStat,
  parseApfsContainers,
  parseDiskstats,
  parseIoregStorage,
  parseProfiledDisks,
  parseWindowsDisks,
  readStorageDevices,
  StorageCounters,
  WindowsDisks,
} from './storage-readers';

/**
 * `ioreg -r -c IOBlockStorageDriver -d 2 -l -w 0`, trimmed: an optical drive with no media, an
 * internal SSD, and a disk image.
 */
const IOREG: string = [
  '+-o IODVDBlockStorageDriver  <class IODVDBlockStorageDriver, id 0x10000073c>',
  '      "Statistics" = {"Operations (Write)"=0,"Bytes (Read)"=0,"Total Time (Read)"=0,"Total Time (Write)"=0,"Bytes (Write)"=0,"Operations (Read)"=0}',
  '+-o IOBlockStorageDriver  <class IOBlockStorageDriver, id 0x1000005e4>',
  '  |   "Statistics" = {"Operations (Write)"=5755392,"Latency Time (Write)"=0,"Bytes (Read)"=37601213952,"Total Time (Read)"=4000000000,"Total Time (Write)"=2000000000,"Bytes (Write)"=69434662912,"Operations (Read)"=1815005}',
  '  +-o Samsung SSD 990 PRO 2TB Media  <class IOMedia, id 0x1000005e7>',
  '        "Whole" = Yes',
  '        "BSD Name" = "disk1"',
  '+-o IOBlockStorageDriver  <class IOBlockStorageDriver, id 0x10000074f>',
  '  |   "Statistics" = {"Operations (Write)"=0,"Bytes (Read)"=315904,"Total Time (Read)"=8621871,"Total Time (Write)"=0,"Bytes (Write)"=0,"Operations (Read)"=12}',
  '  +-o Apple disk image Media  <class IOMedia, id 0x100000750>',
  '        "BSD Name" = "disk5"',
].join('\n');

/**
 * `diskutil apfs list`, trimmed to two containers.
 */
const APFS: string = [
  '+-- Container disk2 0848F44B-AC2E-42E2-A856-4AE71FA166E6',
  '|   +-< Physical Store disk0s2 B0CAFE15-BAE1-4661-91F6-468D4CB993F2',
  '|   |   APFS Physical Store Disk:   disk0s2',
  '|       APFS Volume Disk (Role):   disk2s1 (No specific role)',
  '+-- Container disk3 AABA11AF-D03A-4815-88B8-21DFA9704B95',
  '|   +-< Physical Store disk1s2 CAF83891-C2EA-423F-87E8-7C15DCA924A6',
  '|   |   APFS Physical Store Disk:   disk1s2',
].join('\n');

/**
 * Builds a systeminformation disk.
 * @param device The device.
 * @param overrides What differs from an internal NVMe SSD.
 * @returns Returns the disk.
 */
function disk(device: string, overrides: Partial<DiskLayoutStat> = {}): DiskLayoutStat {
  return {
    device,
    type: 'NVMe',
    name: 'Samsung SSD 990 PRO 2TB',
    vendor: 'Samsung',
    size: 2_000_398_934_016,
    serialNum: 'S6Z2',
    firmwareRevision: '3B2QJXD7',
    interfaceType: 'PCIe x4',
    smartStatus: 'unknown',
    ...overrides,
  };
}

describe('parseIoregStorage', () => {
  it('readsEachWholeDisksCounters_byItsBsdName', () => {
    const disks: ReadonlyMap<string, StorageCounters> = parseIoregStorage(IOREG);

    expect([...disks.keys()]).toEqual(['disk1', 'disk5']);
    expect(disks.get('disk1')).toEqual({
      readBytes: 37_601_213_952,
      writeBytes: 69_434_662_912,
      readOps: 1_815_005,
      writeOps: 5_755_392,
      busyMs: 6000,
    });
  });
});

describe('parseApfsContainers', () => {
  it('mapsEachContainer_toTheWholeDiskItIsOn', () => {
    expect(Object.fromEntries(parseApfsContainers(APFS))).toEqual({
      disk2: 'disk0',
      disk3: 'disk1',
    });
  });
});

describe('parseDiskstats', () => {
  it('readsWholeDisks_inBytes_leavingOutPartitionsAndLoopDevices', () => {
    const disks: ReadonlyMap<string, StorageCounters> = parseDiskstats(
      [
        ' 259       0 nvme0n1 100 0 2000 50 300 0 4000 60 0 900 110 0 0 0 0',
        ' 259       1 nvme0n1p1 10 0 200 5 30 0 400 6 0 90 11 0 0 0 0',
        '   7       0 loop0 1 0 2 0 0 0 0 0 0 0 0 0 0 0 0',
        '   8       0 sda 5 0 8 1 6 0 16 2 0 3 3 0 0 0 0',
      ].join('\n'),
    );

    expect([...disks.keys()]).toEqual(['nvme0n1', 'sda']);
    expect(disks.get('nvme0n1')).toEqual({
      readOps: 100,
      readBytes: 2000 * 512,
      writeOps: 300,
      writeBytes: 4000 * 512,
      busyMs: 900,
    });
  });
});

describe('parseWindowsDisks', () => {
  it('readsEachDiskByNumber_andTheDriveLettersOnIt', () => {
    const disks: WindowsDisks = parseWindowsDisks([
      {
        Name: '0 C: D:',
        DiskReadBytesPerSec: '1000',
        DiskWriteBytesPerSec: 2000,
        DiskReadsPerSec: 10,
        DiskWritesPerSec: 20,
        PercentIdleTime: 70_000,
        Timestamp_Sys100NS: 100_000,
      },
      {
        Name: '_Total',
        DiskReadBytesPerSec: 1000,
        DiskWriteBytesPerSec: 2000,
        DiskReadsPerSec: 10,
        DiskWritesPerSec: 20,
        PercentIdleTime: 0,
        Timestamp_Sys100NS: 0,
      },
    ]);

    expect(disks.counters.get('0')).toEqual({
      readBytes: 1000,
      writeBytes: 2000,
      readOps: 10,
      writeOps: 20,
      busyMs: 3,
    });
    expect([...disks.counters.keys()]).toEqual(['0']);
    expect(Object.fromEntries(disks.letters)).toEqual({ 'C:': '0', 'D:': '0' });
  });

  it('readsNothing_fromNothing', () => {
    expect(parseWindowsDisks(null).counters.size).toBe(0);
  });
});

describe('deviceOfVolume', () => {
  it('tracesAnApfsVolume_throughItsContainer_toTheDrive', () => {
    const containers: ReadonlyMap<string, string> = parseApfsContainers(APFS);

    expect(deviceOfVolume('/dev/disk3s1s1', 'darwin', containers)).toBe('disk1');
    expect(deviceOfVolume('/dev/disk4s1', 'darwin', containers)).toBe('disk4');
    expect(deviceOfVolume('map auto_home', 'darwin', containers)).toBeUndefined();
  });

  it('stripsTheLinuxPartition', () => {
    const none: ReadonlyMap<string, string> = new Map<string, string>();

    expect(deviceOfVolume('/dev/nvme0n1p2', 'linux', none)).toBe('nvme0n1');
    expect(deviceOfVolume('/dev/mmcblk0p1', 'linux', none)).toBe('mmcblk0');
    expect(deviceOfVolume('/dev/sda1', 'linux', none)).toBe('sda');
    expect(deviceOfVolume('/dev/mapper/vg-root', 'linux', none)).toBeUndefined();
  });

  it('findsAWindowsDriveLetters_disk', () => {
    expect(deviceOfVolume('C:', 'win32', new Map<string, string>([['C:', '0']]))).toBe('0');
  });
});

describe('parseProfiledDisks', () => {
  it('readsTheNvmeLink_andTheSmartStatus', () => {
    const disks: ReadonlyMap<string, unknown> = parseProfiledDisks({
      SPNVMeDataType: [
        {
          _name: 'Apple SSD Controller',
          _items: [
            {
              bsd_name: 'disk0',
              smart_status: 'Verified',
              spnvme_linkspeed: '8.0 GT/s',
              spnvme_linkwidth: 'x4',
              volumes: [{ bsd_name: 'disk0s1' }],
            },
          ],
        },
      ],
      SPSerialATADataType: [{ _items: [{ bsd_name: 'disk6', smart_status: 'Failing' }] }],
    });

    expect(disks.get('disk0')).toEqual({ connection: 'PCIe 3.0 x4', health: 'ok' });
    expect(disks.get('disk6')).toEqual({ connection: 'SATA', health: 'failing' });
  });
});

describe('readStorageDevices', () => {
  it('listsTheCountedDrives_systemFirst_leavingOutImagesAndContainers', () => {
    const devices: readonly StorageDevice[] = readStorageDevices(
      [
        disk('disk0', { name: 'APPLE SSD AP0256M', size: 251_000_193_024 }),
        disk('disk1'),
        disk('disk3', { type: 'PCI-Express', serialNum: '' }),
        disk('disk5', { type: 'Disk Image', name: 'Disk Image' }),
      ],
      'darwin',
      new Set<string>(['disk0', 'disk1', 'disk5']),
      new Map([['disk1', { connection: 'PCIe 4.0 x4', health: 'ok' as const }]]),
      'disk1',
    );

    expect(devices.map((device: StorageDevice): string => device.id)).toEqual(['disk1', 'disk0']);
    expect(devices[0]).toEqual({
      id: 'disk1',
      name: 'Samsung SSD 990 PRO 2TB',
      vendor: 'Samsung',
      kind: 'nvme',
      sizeBytes: 2_000_398_934_016,
      connection: 'PCIe 4.0 x4',
      serial: 'S6Z2',
      firmware: '3B2QJXD7',
      health: 'ok',
    });
  });
});

describe('deviceReading', () => {
  const before: StorageCounters = {
    readBytes: 1000,
    writeBytes: 0,
    readOps: 10,
    writeOps: 0,
    busyMs: 100,
  };

  it('turnsTheCountersIntoRates_andABusyShare', () => {
    const reading: StorageDeviceReading = deviceReading(
      'disk1',
      { readBytes: 5000, writeBytes: 2000, readOps: 30, writeOps: 4, busyMs: 600 },
      before,
      2000,
    );

    expect(reading).toMatchObject({
      readBytesPerSecond: 2000,
      writeBytesPerSecond: 1000,
      readOpsPerSecond: 10,
      writeOpsPerSecond: 2,
      utilisationPercent: 25,
      totalReadBytes: 5000,
    });
  });

  it('readsNoActivity_onTheFirstReading_orAfterTheCountersReset', () => {
    expect(deviceReading('disk1', before, undefined, 0).readBytesPerSecond).toBe(0);
    expect(deviceReading('disk1', before, undefined, 0).utilisationPercent).toBeUndefined();
    expect(
      deviceReading('disk1', { ...before, readBytes: 10 }, before, 2000).readBytesPerSecond,
    ).toBe(0);
  });
});
