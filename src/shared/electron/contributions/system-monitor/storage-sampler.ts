import { StorageDeviceReading, StorageReading } from '@shared/api/system-monitor-channels';
import { GpuSources } from './gpu-sampler';
import {
  deviceReading,
  parseDiskstats,
  parseIoregStorage,
  parseWindowsDisks,
  StorageCounters,
  WindowsDiskCounter,
  WindowsDisks,
} from './storage-readers';

/**
 * What a storage sampler reads the machine through: commands, files and folders, and the clock — the
 * same as a GPU sampler's.
 */
export type StorageSources = GpuSources;

/**
 * The PowerShell that reads Windows's physical disks' raw (cumulative) performance counters.
 */
export const WINDOWS_DISKS_COMMAND: string =
  'Get-CimInstance Win32_PerfRawData_PerfDisk_PhysicalDisk | Select-Object Name,DiskReadBytesPerSec,DiskWriteBytesPerSec,DiskReadsPerSec,DiskWritesPerSec,PercentIdleTime,Timestamp_Sys100NS | ConvertTo-Json -Compress';

/**
 * Reads the machine's storage devices' activity: each device's cumulative counters, turned into rates
 * against the previous reading, with its busy share and (on Linux, where the kernel exposes it) its
 * temperature.
 *
 * - macOS: the storage drivers' statistics (`ioreg`), keyed by each whole disk's BSD name.
 * - Linux: `/proc/diskstats`, whole disks only; temperatures from each disk's hwmon sensor.
 * - Windows: the PhysicalDisk performance counters, keyed by disk number.
 *
 * The first reading has nothing to compare with, so its rates read 0 and it carries no busy share.
 */
export class StorageSampler {
  /**
   * Holds each device's counters at the last reading.
   */
  private previous: ReadonlyMap<string, StorageCounters> = new Map<string, StorageCounters>();

  /**
   * Holds when the last reading was taken, in milliseconds, or 0 before the first.
   */
  private previousAt: number = 0;

  /**
   * Initializes a new instance of the {@link StorageSampler} class.
   * @param sources What the sampler reads the machine through.
   */
  public constructor(private readonly sources: StorageSources) {}

  /**
   * Reads each device's counters, without turning them into rates: what the platform counts activity
   * for, which is also the set of devices a Storage view lists.
   * @returns Returns each device's counters, by id; empty where they cannot be read.
   */
  public async counters(): Promise<ReadonlyMap<string, StorageCounters>> {
    try {
      switch (this.sources.platform) {
        case 'darwin':
          return parseIoregStorage(
            await this.sources.run('ioreg', [
              '-r',
              '-c',
              'IOBlockStorageDriver',
              '-d',
              '2',
              '-l',
              '-w',
              '0',
            ]),
          );
        case 'linux':
          return parseDiskstats(await this.sources.readFile('/proc/diskstats'));
        case 'win32':
          return (await this.windowsDisks()).counters;
        default:
          return new Map<string, StorageCounters>();
      }
    } catch {
      return new Map<string, StorageCounters>();
    }
  }

  /**
   * Reads Windows's physical disks: their counters, and the disk each drive letter is on.
   * @returns Returns the disks, empty where the counters cannot be read.
   */
  public async windowsDisks(): Promise<WindowsDisks> {
    try {
      const parsed: unknown = JSON.parse(
        await this.sources.run('powershell.exe', [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          WINDOWS_DISKS_COMMAND,
        ]),
      );
      return parseWindowsDisks(parsed as WindowsDiskCounter | WindowsDiskCounter[]);
    } catch {
      return parseWindowsDisks(null);
    }
  }

  /**
   * Takes a reading.
   * @returns Returns the reading, or undefined when no device's counters could be read.
   */
  public async read(): Promise<StorageReading | undefined> {
    const counters: ReadonlyMap<string, StorageCounters> = await this.counters();
    if (counters.size === 0) {
      return undefined;
    }
    const now: number = this.sources.now();
    const elapsedMs: number = this.previousAt === 0 ? 0 : now - this.previousAt;
    const temperatures: ReadonlyMap<string, number> =
      this.sources.platform === 'linux'
        ? await this.linuxTemperatures([...counters.keys()])
        : new Map<string, number>();
    const devices: StorageDeviceReading[] = [...counters].map(
      ([id, current]: [string, StorageCounters]): StorageDeviceReading =>
        deviceReading(id, current, this.previous.get(id), elapsedMs, temperatures.get(id)),
    );
    this.previous = counters;
    this.previousAt = now;
    return { timestamp: new Date(now).toISOString(), devices };
  }

  /**
   * Reads each Linux disk's temperature from its hwmon sensor: an NVMe controller's own
   * (`/sys/block/nvme0n1/device/hwmonN`), or a SATA disk's through the `drivetemp` driver
   * (`/sys/block/sda/device/hwmon/hwmonN`). Best-effort: a disk without one is left out.
   * @param ids The disks.
   * @returns Returns each disk's temperature in °C, by id.
   */
  private async linuxTemperatures(ids: readonly string[]): Promise<ReadonlyMap<string, number>> {
    const temperatures: Map<string, number> = new Map<string, number>();
    await Promise.all(
      ids.map(async (id: string): Promise<void> => {
        for (const folder of [`/sys/block/${id}/device`, `/sys/block/${id}/device/hwmon`]) {
          try {
            const hwmon: string | undefined = (await this.sources.readdir(folder)).find(
              (entry: string): boolean => /^hwmon\d+$/.test(entry),
            );
            if (hwmon !== undefined) {
              const milli: number = Number(
                (await this.sources.readFile(`${folder}/${hwmon}/temp1_input`)).trim(),
              );
              if (Number.isFinite(milli) && milli > 0) {
                temperatures.set(id, milli / 1000);
                return;
              }
            }
          } catch {
            // No sensor here; try the next place, or leave the disk out.
          }
        }
      }),
    );
    return temperatures;
  }
}
