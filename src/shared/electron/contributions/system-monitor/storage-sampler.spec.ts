import { describe, expect, it } from 'vitest';
import { StorageReading } from '@shared/api/system-monitor-channels';
import { FakeMachine, fakeMachine } from './sampler-test-sources';
import { StorageSampler } from './storage-sampler';

/**
 * Builds macOS's storage driver statistics for one disk.
 * @param readBytes The bytes read so far.
 * @param busyNs The time busy so far, in nanoseconds.
 * @returns Returns the `ioreg` output.
 */
function ioreg(readBytes: number, busyNs: number): string {
  return [
    '+-o IOBlockStorageDriver  <class IOBlockStorageDriver, id 0x1>',
    `  |   "Statistics" = {"Operations (Write)"=0,"Bytes (Read)"=${readBytes},"Total Time (Read)"=${busyNs},"Total Time (Write)"=0,"Bytes (Write)"=0,"Operations (Read)"=${readBytes / 1000}}`,
    '  +-o SSD Media  <class IOMedia, id 0x2>',
    '        "BSD Name" = "disk1"',
  ].join('\n');
}

/**
 * Builds Linux's block device counters for one disk.
 * @param sectorsRead The sectors read so far.
 * @returns Returns the `/proc/diskstats` content.
 */
function diskstats(sectorsRead: number): string {
  return ` 259 0 nvme0n1 10 0 ${sectorsRead} 5 0 0 0 0 0 100 5 0 0 0 0`;
}

describe('StorageSampler', () => {
  it('readsNoActivityAtFirst_thenTheRatesSinceTheLastReading_onMacOS', async () => {
    const machine: FakeMachine = fakeMachine('darwin', {
      ioreg: [ioreg(1000, 0), ioreg(5000, 500_000_000)],
    });
    const sampler: StorageSampler = new StorageSampler(machine.sources);

    const first: StorageReading | undefined = await sampler.read();
    machine.advance(2000);
    const second: StorageReading | undefined = await sampler.read();

    expect(first?.devices[0]).toMatchObject({ id: 'disk1', readBytesPerSecond: 0 });
    expect(first?.devices[0].utilisationPercent).toBeUndefined();
    // 4000 bytes and half a second busy over two seconds.
    expect(second?.devices[0]).toMatchObject({
      readBytesPerSecond: 2000,
      utilisationPercent: 25,
      totalReadBytes: 5000,
    });
  });

  it('readsLinuxDisks_withTheirHwmonTemperature', async () => {
    const machine: FakeMachine = fakeMachine(
      'linux',
      {},
      {
        '/proc/diskstats': diskstats(8),
        '/sys/block/nvme0n1/device/hwmon3/temp1_input': '41850\n',
      },
      { '/sys/block/nvme0n1/device': ['hwmon3', 'model'] },
    );

    const reading: StorageReading | undefined = await new StorageSampler(machine.sources).read();

    expect(reading?.devices[0]).toMatchObject({
      id: 'nvme0n1',
      totalReadBytes: 8 * 512,
      temperatureC: 41.85,
    });
  });

  it('readsNothing_whereTheCountersCannotBeRead', async () => {
    const machine: FakeMachine = fakeMachine('darwin', {});

    expect(await new StorageSampler(machine.sources).read()).toBeUndefined();
    expect(await new StorageSampler(fakeMachine('aix', {}).sources).read()).toBeUndefined();
  });

  it('readsWindowsDisks_andTheirDriveLetters', async () => {
    const machine: FakeMachine = fakeMachine('win32', {
      'powershell.exe': [
        JSON.stringify({
          Name: '0 C:',
          DiskReadBytesPerSec: 100,
          DiskWriteBytesPerSec: 0,
          DiskReadsPerSec: 1,
          DiskWritesPerSec: 0,
          PercentIdleTime: 0,
          Timestamp_Sys100NS: 0,
        }),
      ],
    });

    const disks: Awaited<ReturnType<StorageSampler['windowsDisks']>> = await new StorageSampler(
      machine.sources,
    ).windowsDisks();

    expect([...disks.counters.keys()]).toEqual(['0']);
    expect(disks.letters.get('C:')).toBe('0');
  });
});
