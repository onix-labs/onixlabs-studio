import {
  StorageDevice,
  StorageDeviceKind,
  StorageDeviceReading,
} from '@shared/api/system-monitor-channels';

/**
 * Describes a storage device's cumulative counters, as the platform keeps them from boot (or from the
 * device appearing).
 */
export interface StorageCounters {
  /**
   * Gets the bytes read.
   */
  readonly readBytes: number;

  /**
   * Gets the bytes written.
   */
  readonly writeBytes: number;

  /**
   * Gets the read operations.
   */
  readonly readOps: number;

  /**
   * Gets the write operations.
   */
  readonly writeOps: number;

  /**
   * Gets the time the device has been busy, in milliseconds, where the platform counts it.
   */
  readonly busyMs?: number;
}

/**
 * The subset of a `systeminformation` disk this reads (`si.diskLayout()`).
 */
export interface DiskLayoutStat {
  readonly device: string;
  readonly type: string;
  readonly name: string;
  readonly vendor: string;
  readonly size: number;
  readonly serialNum: string;
  readonly firmwareRevision: string;
  readonly interfaceType: string;
  readonly smartStatus: string;
}

/**
 * Describes what macOS's System Information says of a disk beyond systeminformation.
 */
export interface ProfiledDisk {
  /**
   * Gets how the disk is connected (`PCIe 3.0 x4`, `SATA`).
   */
  readonly connection?: string;

  /**
   * Gets the disk's S.M.A.R.T. health, where reported.
   */
  readonly health?: 'ok' | 'failing';
}

/**
 * A Windows physical disk's raw performance counters (`Win32_PerfRawData_PerfDisk_PhysicalDisk`).
 */
export interface WindowsDiskCounter {
  readonly Name: string;
  readonly DiskReadBytesPerSec: number | string;
  readonly DiskWriteBytesPerSec: number | string;
  readonly DiskReadsPerSec: number | string;
  readonly DiskWritesPerSec: number | string;
  readonly PercentIdleTime: number | string;
  readonly Timestamp_Sys100NS: number | string;
}

/**
 * Describes Windows's physical disks: each one's counters, and the disk each drive letter is on.
 */
export interface WindowsDisks {
  /**
   * Gets each disk's counters, by disk number.
   */
  readonly counters: ReadonlyMap<string, StorageCounters>;

  /**
   * Gets the disk number each drive letter (`C:`) is on.
   */
  readonly letters: ReadonlyMap<string, string>;
}

/**
 * The bytes in one sector, as Linux's `/proc/diskstats` counts them whatever the device's own size.
 */
const LINUX_SECTOR_BYTES: number = 512;

/**
 * The Linux block devices that are whole disks rather than partitions, RAM disks, loop devices or
 * device-mapper volumes.
 */
const LINUX_WHOLE_DISK: RegExp = /^(?:[shv]d[a-z]+|xvd[a-z]+|nvme\d+n\d+|mmcblk\d+)$/;

/**
 * The PCIe generation each link speed belongs to.
 */
const PCIE_GENERATIONS: Readonly<Record<string, string>> = {
  '2.5': '1.0',
  '5.0': '2.0',
  '8.0': '3.0',
  '16.0': '4.0',
  '32.0': '5.0',
  '64.0': '6.0',
};

/**
 * Reads a number from a counter, which Windows's JSON may give as a string.
 * @param value The value.
 * @returns Returns the number, or 0 when it is not one.
 */
function numberOf(value: number | string | undefined): number {
  const parsed: number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Reads a text property from parsed JSON.
 * @param value The property.
 * @returns Returns the text, or the empty string when it is not text.
 */
function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Reads macOS's storage drivers' statistics (`ioreg -r -c IOBlockStorageDriver -d 2 -l -w 0`): each
 * driver's counters, keyed by the BSD name of the whole disk beneath it. Times are in nanoseconds; the
 * busy time is the read and write times together.
 * @param text The `ioreg` output.
 * @returns Returns each disk's counters, by BSD name (`disk0`).
 */
export function parseIoregStorage(text: string): ReadonlyMap<string, StorageCounters> {
  const disks: Map<string, StorageCounters> = new Map<string, StorageCounters>();
  let pending: StorageCounters | null = null;
  for (const line of text.split('\n')) {
    const statistics: RegExpExecArray | null = /"Statistics" = \{(.*)\}/.exec(line);
    if (statistics !== null) {
      const values: Map<string, number> = new Map<string, number>();
      for (const pair of statistics[1].matchAll(/"([^"]+)"=(\d+)/g)) {
        values.set(pair[1], Number(pair[2]));
      }
      const value: (key: string) => number = (key: string): number => values.get(key) ?? 0;
      pending = {
        readBytes: value('Bytes (Read)'),
        writeBytes: value('Bytes (Write)'),
        readOps: value('Operations (Read)'),
        writeOps: value('Operations (Write)'),
        busyMs: (value('Total Time (Read)') + value('Total Time (Write)')) / 1e6,
      };
      continue;
    }
    const name: RegExpExecArray | null = /"BSD Name" = "(disk\d+)"/.exec(line);
    if (name !== null && pending !== null) {
      disks.set(name[1], pending);
      pending = null;
    }
  }
  return disks;
}

/**
 * Reads which physical disk each APFS container is on (`diskutil apfs list`), so a volume in a
 * container is counted against the drive it lives on.
 * @param text The `diskutil apfs list` output.
 * @returns Returns each container's whole physical disk, by the container's BSD name.
 */
export function parseApfsContainers(text: string): ReadonlyMap<string, string> {
  const containers: Map<string, string> = new Map<string, string>();
  let container: string | null = null;
  for (const line of text.split('\n')) {
    const start: RegExpExecArray | null = /Container (disk\d+)\b/.exec(line);
    if (start !== null) {
      container = start[1];
      continue;
    }
    const store: RegExpExecArray | null = /APFS Physical Store Disk:\s+(disk\d+)(?:s\d+)?/.exec(
      line,
    );
    if (store !== null && container !== null && !containers.has(container)) {
      containers.set(container, store[1]);
    }
  }
  return containers;
}

/**
 * Reads Linux's block device counters (`/proc/diskstats`), keeping whole disks only.
 * @param text The file's content.
 * @returns Returns each disk's counters, by kernel name (`nvme0n1`).
 */
export function parseDiskstats(text: string): ReadonlyMap<string, StorageCounters> {
  const disks: Map<string, StorageCounters> = new Map<string, StorageCounters>();
  for (const line of text.split('\n')) {
    const fields: readonly string[] = line.trim().split(/\s+/);
    if (fields.length < 13 || !LINUX_WHOLE_DISK.test(fields[2])) {
      continue;
    }
    const field: (index: number) => number = (index: number): number => numberOf(fields[index]);
    disks.set(fields[2], {
      readOps: field(3),
      readBytes: field(5) * LINUX_SECTOR_BYTES,
      writeOps: field(7),
      writeBytes: field(9) * LINUX_SECTOR_BYTES,
      busyMs: field(12),
    });
  }
  return disks;
}

/**
 * Reads Windows's physical disks' raw performance counters. Each instance is named for its disk number
 * and the drive letters on it (`0 C: D:`); `_Total` is left out. The byte and operation counts are
 * cumulative; the busy time is the time elapsed less the idle time, both in 100 ns ticks.
 * @param counters The counters, one object or an array of them as `ConvertTo-Json` gives.
 * @returns Returns each disk's counters and the disk each drive letter is on.
 */
export function parseWindowsDisks(
  counters: WindowsDiskCounter | readonly WindowsDiskCounter[] | null | undefined,
): WindowsDisks {
  const list: readonly WindowsDiskCounter[] =
    counters === null || counters === undefined
      ? []
      : Array.isArray(counters)
        ? counters
        : [counters];
  const disks: Map<string, StorageCounters> = new Map<string, StorageCounters>();
  const letters: Map<string, string> = new Map<string, string>();
  for (const counter of list) {
    const [id, ...drives]: string[] = `${counter.Name}`.trim().split(/\s+/);
    if (!/^\d+$/.test(id)) {
      continue;
    }
    disks.set(id, {
      readBytes: numberOf(counter.DiskReadBytesPerSec),
      writeBytes: numberOf(counter.DiskWriteBytesPerSec),
      readOps: numberOf(counter.DiskReadsPerSec),
      writeOps: numberOf(counter.DiskWritesPerSec),
      busyMs: (numberOf(counter.Timestamp_Sys100NS) - numberOf(counter.PercentIdleTime)) / 10_000,
    });
    for (const drive of drives) {
      if (/^[A-Za-z]:$/.test(drive)) {
        letters.set(drive.toUpperCase(), id);
      }
    }
  }
  return { counters: disks, letters };
}

/**
 * Works out the id of a disk as systeminformation names it: the BSD or kernel name on macOS and Linux
 * (`/dev/disk0` → `disk0`), the physical drive number on Windows (`\\.\PHYSICALDRIVE0` → `0`).
 * @param device The disk's device (`si.diskLayout()[].device`).
 * @param platform The platform.
 * @returns Returns the id, or the empty string when it cannot be worked out.
 */
export function deviceIdOf(device: string, platform: string): string {
  if (platform === 'win32') {
    return /(\d+)\s*$/.exec(device)?.[1] ?? '';
  }
  return device.replace(/^\/dev\//, '');
}

/**
 * Works out which disk a volume is on, from the device it is mounted from.
 * @param fs The volume's device (`si.fsSize()[].fs`): `/dev/disk3s1s1`, `/dev/nvme0n1p2`, `C:`.
 * @param platform The platform.
 * @param map On macOS, the physical disk of each APFS container; on Windows, the disk of each drive
 * letter.
 * @returns Returns the disk's id, or undefined when it cannot be worked out (a network share, a
 * device-mapper volume).
 */
export function deviceOfVolume(
  fs: string,
  platform: string,
  map: ReadonlyMap<string, string>,
): string | undefined {
  if (platform === 'darwin') {
    const disk: string | undefined = /^\/dev\/(disk\d+)/.exec(fs)?.[1];
    return disk === undefined ? undefined : (map.get(disk) ?? disk);
  }
  if (platform === 'win32') {
    return map.get(fs.slice(0, 2).toUpperCase());
  }
  const name: string = fs.replace(/^\/dev\//, '');
  const partition: RegExpExecArray | null =
    /^(nvme\d+n\d+|mmcblk\d+)p\d+$/.exec(name) ?? /^([shv]d[a-z]+|xvd[a-z]+)\d+$/.exec(name);
  if (partition !== null) {
    return partition[1];
  }
  return LINUX_WHOLE_DISK.test(name) ? name : undefined;
}

/**
 * Reads what macOS's System Information says of its NVMe and SATA disks
 * (`system_profiler SPNVMeDataType SPSerialATADataType -json`): how each is connected, and its
 * S.M.A.R.T. status.
 * @param json The parsed output.
 * @returns Returns each disk's details, by BSD name.
 */
export function parseProfiledDisks(json: unknown): ReadonlyMap<string, ProfiledDisk> {
  const disks: Map<string, ProfiledDisk> = new Map<string, ProfiledDisk>();
  const root: Record<string, unknown> =
    typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : {};
  const visit: (items: unknown, sata: boolean) => void = (items: unknown, sata: boolean): void => {
    if (!Array.isArray(items)) {
      return;
    }
    for (const item of items as Record<string, unknown>[]) {
      const bsd: unknown = item['bsd_name'];
      if (typeof bsd === 'string' && /^disk\d+$/.test(bsd)) {
        const speed: string = textOf(item['spnvme_linkspeed'])
          .replace(/\s*GT\/s/i, '')
          .trim();
        const width: string = textOf(item['spnvme_linkwidth']).trim();
        const generation: string | undefined = PCIE_GENERATIONS[speed];
        const connection: string | undefined = sata
          ? 'SATA'
          : generation !== undefined
            ? `PCIe ${generation}${width.length > 0 ? ` ${width}` : ''}`
            : width.length > 0
              ? `PCIe ${width}`
              : undefined;
        const status: string = textOf(item['smart_status']).toLowerCase();
        const health: 'ok' | 'failing' | undefined =
          status === 'verified' ? 'ok' : status === 'failing' ? 'failing' : undefined;
        disks.set(bsd, {
          ...(connection === undefined ? {} : { connection }),
          ...(health === undefined ? {} : { health }),
        });
      }
      visit(item['_items'], sata);
    }
  };
  visit(root['SPNVMeDataType'], false);
  visit(root['SPSerialATADataType'], true);
  return disks;
}

/**
 * Works out the kind of a disk from what systeminformation says of it.
 * @param disk The disk.
 * @returns Returns its kind.
 */
export function storageKind(disk: DiskLayoutStat): StorageDeviceKind {
  const type: string = disk.type.toLowerCase();
  const connection: string = disk.interfaceType.toLowerCase();
  if (type.includes('image') || type.includes('virtual') || /virtual|vbox/i.test(disk.name)) {
    return 'virtual';
  }
  if (connection.includes('usb')) {
    return 'usb';
  }
  if (type.includes('nvme') || connection.includes('nvme')) {
    return 'nvme';
  }
  if (type === 'ssd' || type === 'scm') {
    return 'ssd';
  }
  return type === 'hd' || type === 'hdd' ? 'hdd' : 'other';
}

/**
 * Maps systeminformation's disks to the devices a Storage view lists: those the platform counts
 * activity for (which leaves out macOS's synthesized APFS containers), less disk images and other
 * virtual disks, the one the system runs from first.
 * @param layout The disks (`si.diskLayout()`).
 * @param platform The platform.
 * @param counted The ids of the disks the platform counts activity for.
 * @param profiled What macOS's System Information adds, by id.
 * @param systemId The id of the disk the system runs from, where known.
 * @returns Returns the devices.
 */
export function readStorageDevices(
  layout: readonly DiskLayoutStat[],
  platform: string,
  counted: ReadonlySet<string>,
  profiled: ReadonlyMap<string, ProfiledDisk>,
  systemId: string | undefined,
): readonly StorageDevice[] {
  const devices: StorageDevice[] = [];
  for (const disk of layout) {
    const id: string = deviceIdOf(disk.device, platform);
    const kind: StorageDeviceKind = storageKind(disk);
    if (id.length === 0 || !counted.has(id) || kind === 'virtual' || disk.size <= 0) {
      continue;
    }
    const details: ProfiledDisk | undefined = profiled.get(id);
    const smart: string = disk.smartStatus.toLowerCase();
    const health: 'ok' | 'failing' | undefined =
      details?.health ??
      (smart === 'ok'
        ? 'ok'
        : smart.includes('fail') || smart === 'degraded'
          ? 'failing'
          : undefined);
    const connection: string = details?.connection ?? disk.interfaceType.trim();
    const optional: (value: string) => string | undefined = (value: string): string | undefined =>
      value.trim().length > 0 ? value.trim() : undefined;
    const vendor: string | undefined = optional(disk.vendor);
    const serial: string | undefined = optional(disk.serialNum);
    const firmware: string | undefined = optional(disk.firmwareRevision);
    devices.push({
      id,
      name: disk.name.trim().length > 0 ? disk.name.trim() : id,
      kind,
      sizeBytes: disk.size,
      ...(vendor === undefined ? {} : { vendor }),
      ...(connection.length === 0 ? {} : { connection }),
      ...(serial === undefined ? {} : { serial }),
      ...(firmware === undefined ? {} : { firmware }),
      ...(health === undefined ? {} : { health }),
    });
  }
  return devices.sort(
    (a: StorageDevice, b: StorageDevice): number =>
      Number(b.id === systemId) - Number(a.id === systemId),
  );
}

/**
 * Works out a device's activity between two readings of its counters. A counter that went backwards
 * (the device was removed and returned, or the counters were reset) reads as no activity.
 * @param id The device's id.
 * @param current The counters now.
 * @param previous The counters at the last reading, or undefined for the first.
 * @param elapsedMs The time between the two readings, in milliseconds.
 * @param temperatureC The device's temperature, where read.
 * @returns Returns the reading.
 */
export function deviceReading(
  id: string,
  current: StorageCounters,
  previous: StorageCounters | undefined,
  elapsedMs: number,
  temperatureC?: number,
): StorageDeviceReading {
  const seconds: number = elapsedMs / 1000;
  const rate: (now: number, before: number | undefined) => number = (
    now: number,
    before: number | undefined,
  ): number =>
    before === undefined || seconds <= 0 || now < before ? 0 : (now - before) / seconds;
  const busy: number | undefined =
    current.busyMs === undefined || previous?.busyMs === undefined || elapsedMs <= 0
      ? undefined
      : Math.min(100, Math.max(0, ((current.busyMs - previous.busyMs) / elapsedMs) * 100));
  return {
    id,
    readBytesPerSecond: rate(current.readBytes, previous?.readBytes),
    writeBytesPerSecond: rate(current.writeBytes, previous?.writeBytes),
    readOpsPerSecond: rate(current.readOps, previous?.readOps),
    writeOpsPerSecond: rate(current.writeOps, previous?.writeOps),
    totalReadBytes: current.readBytes,
    totalWriteBytes: current.writeBytes,
    totalReadOps: current.readOps,
    totalWriteOps: current.writeOps,
    ...(busy === undefined ? {} : { utilisationPercent: busy }),
    ...(temperatureC === undefined ? {} : { temperatureC }),
  };
}
