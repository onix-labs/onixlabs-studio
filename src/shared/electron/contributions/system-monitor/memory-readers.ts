import {
  MemoryDetailMetric,
  MemoryModule,
  MemoryPressure,
} from '@shared/api/system-monitor-channels';

/**
 * The parts of the memory breakdown a platform's own tools add to systeminformation's reading.
 */
export type MemoryBreakdown = Omit<
  MemoryDetailMetric,
  'availableBytes' | 'swapUsedBytes' | 'swapTotalBytes'
>;

/**
 * The installed memory modules, with what the platform says of them as a whole.
 */
export interface MemoryModules {
  /**
   * Gets the filled slots' modules.
   */
  readonly modules: readonly MemoryModule[];

  /**
   * Gets the number of slots, filled or not, or undefined when unknown.
   */
  readonly slots?: number;

  /**
   * Gets whether the memory corrects errors, or undefined when unknown.
   */
  readonly ecc?: boolean;
}

/**
 * One slot of macOS's `system_profiler -json SPMemoryDataType`.
 */
export interface SystemProfilerSlot {
  readonly _name?: string;
  readonly dimm_size?: string;
  readonly dimm_type?: string;
  readonly dimm_speed?: string;
  readonly dimm_status?: string;
  readonly dimm_manufacturer?: string;
  readonly dimm_part_number?: string;
}

/**
 * macOS's `system_profiler -json SPMemoryDataType`.
 */
export interface SystemProfilerMemory {
  readonly SPMemoryDataType?: readonly {
    readonly global_ecc_state?: string;
    readonly _items?: readonly SystemProfilerSlot[];
  }[];
}

/**
 * The subset of a `systeminformation` memory module this reads (`si.memLayout()`).
 */
export interface MemoryLayoutStat {
  readonly size: number;
  readonly bank: string;
  readonly type: string;
  readonly ecc?: boolean | null;
  readonly clockSpeed: number | null;
  readonly formFactor: string;
  readonly manufacturer?: string;
  readonly partNum: string;
}

/**
 * Windows' memory counters and Memory Compression's working set, as the monitor's PowerShell writes
 * them.
 */
export interface WindowsMemory {
  readonly memory?: {
    readonly PagesInputPersec?: number;
    readonly PagesOutputPersec?: number;
    readonly CacheBytes?: number;
    readonly StandbyCacheNormalPriorityBytes?: number;
    readonly StandbyCacheReserveBytes?: number;
    readonly StandbyCacheCoreBytes?: number;
    readonly ModifiedPageListBytes?: number;
    readonly PoolNonpagedBytes?: number;
    readonly FreeAndZeroPageListBytes?: number;
  };
  readonly compressed?: number | null;
}

/**
 * macOS's pressure levels (`kern.memorystatus_vm_pressure_level`).
 */
const DARWIN_PRESSURE: Readonly<Record<number, MemoryPressure['level']>> = {
  1: 'normal',
  2: 'warning',
  4: 'critical',
};

/**
 * Parses a block of `name: value` lines into numbers, by name (`vm_stat`, `/proc/meminfo`).
 * @param text The block.
 * @returns Returns each line's leading number, by its name.
 */
function readFields(text: string): ReadonlyMap<string, number> {
  const fields: Map<string, number> = new Map<string, number>();
  for (const line of text.split('\n')) {
    const match: RegExpExecArray | null = /^\s*"?([^":]+)"?:\s*([\d.]+)/.exec(line);
    if (match !== null) {
      fields.set(match[1].trim(), Number(match[2]));
    }
  }
  return fields;
}

/**
 * Keeps a reading only when it is a non-negative number.
 * @param value The reading.
 * @returns Returns the reading, or undefined.
 */
function counted(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * Drops the readings that are undefined, so a breakdown carries only what the platform reported.
 * @param breakdown The breakdown.
 * @returns Returns the breakdown's defined readings.
 */
function defined(breakdown: Record<string, unknown>): MemoryBreakdown {
  return Object.fromEntries(
    Object.entries(breakdown).filter(
      ([, value]: [string, unknown]): boolean => value !== undefined,
    ),
  );
}

/**
 * Reads macOS's memory breakdown the way Activity Monitor does, from `vm_stat` and the kernel's
 * pressure readings: app memory is anonymous memory less what may be purged, cached files are
 * file-backed memory plus the purgeable, compressed is what the compressor occupies.
 * @param vmStat The output of `vm_stat`.
 * @param pressure The output of `sysctl -n kern.memorystatus_vm_pressure_level kern.memorystatus_level`.
 * @returns Returns the breakdown.
 */
export function darwinMemory(vmStat: string, pressure: string): MemoryBreakdown {
  const pageSize: number = Number(/page size of (\d+) bytes/.exec(vmStat)?.[1] ?? 4096);
  const fields: ReadonlyMap<string, number> = readFields(vmStat);
  const pages: (name: string) => number | undefined = (name: string): number | undefined => {
    const value: number | undefined = counted(fields.get(name));
    return value === undefined ? undefined : value * pageSize;
  };
  const anonymous: number | undefined = pages('Anonymous pages');
  const purgeable: number = pages('Pages purgeable') ?? 0;
  const fileBacked: number | undefined = pages('File-backed pages');
  const [level, free]: number[] = pressure
    .trim()
    .split(/\s+/)
    .map((part: string): number => Number(part));
  const pressureLevel: MemoryPressure['level'] | undefined = DARWIN_PRESSURE[level];
  return defined({
    appBytes: anonymous === undefined ? undefined : Math.max(0, anonymous - purgeable),
    wiredBytes: pages('Pages wired down'),
    compressedBytes: pages('Pages occupied by compressor'),
    cachedBytes: fileBacked === undefined ? undefined : fileBacked + purgeable,
    freeBytes: pages('Pages free'),
    pageIns: counted(fields.get('Pageins')),
    pageOuts: counted(fields.get('Pageouts')),
    pressure:
      pressureLevel === undefined || !Number.isFinite(free)
        ? undefined
        : { level: pressureLevel, percent: Math.min(100, Math.max(0, 100 - free)) },
  });
}

/**
 * Reads Linux's memory breakdown from `/proc/meminfo`, `/proc/vmstat` and `/proc/pressure/memory`.
 * App memory is anonymous memory; wired is what cannot be evicted; compressed is zswap's pool; cached
 * is the page cache with reclaimable slab. Pressure is the share of the last ten seconds some task
 * stalled waiting for memory.
 * @param meminfo `/proc/meminfo`.
 * @param vmstat `/proc/vmstat`, or the empty string when unread.
 * @param psi `/proc/pressure/memory`, or the empty string where the kernel has no pressure stall info.
 * @returns Returns the breakdown.
 */
export function linuxMemory(meminfo: string, vmstat: string, psi: string): MemoryBreakdown {
  const fields: ReadonlyMap<string, number> = readFields(meminfo);
  const kib: (name: string) => number | undefined = (name: string): number | undefined => {
    const value: number | undefined = counted(fields.get(name));
    return value === undefined ? undefined : value * 1024;
  };
  const stats: Map<string, number> = new Map<string, number>(
    vmstat
      .split('\n')
      .map((line: string): string[] => line.trim().split(/\s+/))
      .filter((parts: string[]): boolean => parts.length === 2)
      .map((parts: string[]): [string, number] => [parts[0], Number(parts[1])]),
  );
  const cached: number | undefined = kib('Cached');
  const stall: number = Number(/some\s+avg10=([\d.]+)/.exec(psi)?.[1] ?? Number.NaN);
  return defined({
    appBytes: kib('AnonPages'),
    wiredBytes: kib('Unevictable'),
    compressedBytes: kib('Zswap'),
    cachedBytes:
      cached === undefined
        ? undefined
        : cached + (kib('Buffers') ?? 0) + (kib('SReclaimable') ?? 0),
    freeBytes: kib('MemFree'),
    pageIns: counted(stats.get('pswpin')),
    pageOuts: counted(stats.get('pswpout')),
    pressure: Number.isFinite(stall)
      ? {
          level: stall >= 20 ? 'critical' : stall >= 5 ? 'warning' : 'normal',
          percent: Math.min(100, stall),
        }
      : undefined,
  });
}

/**
 * Reads Windows' memory breakdown from its memory counters. Windows reports no pressure level, so it is
 * worked out from how much is not available.
 * @param reading The counters and Memory Compression's working set.
 * @param totalBytes The total physical memory, in bytes.
 * @param availableBytes The memory available, in bytes.
 * @returns Returns the breakdown.
 */
export function windowsMemory(
  reading: WindowsMemory,
  totalBytes: number,
  availableBytes: number,
): MemoryBreakdown {
  const memory: WindowsMemory['memory'] = reading.memory ?? {};
  const standby: number =
    (memory.StandbyCacheNormalPriorityBytes ?? 0) +
    (memory.StandbyCacheReserveBytes ?? 0) +
    (memory.StandbyCacheCoreBytes ?? 0);
  const percent: number =
    totalBytes > 0 ? Math.min(100, Math.max(0, 100 - (availableBytes / totalBytes) * 100)) : 0;
  return defined({
    wiredBytes: counted(memory.PoolNonpagedBytes),
    compressedBytes: counted(reading.compressed ?? undefined),
    cachedBytes: memory.CacheBytes === undefined ? undefined : memory.CacheBytes + standby,
    freeBytes: counted(memory.FreeAndZeroPageListBytes),
    pageIns: counted(memory.PagesInputPersec),
    pageOuts: counted(memory.PagesOutputPersec),
    pressure: {
      level: percent >= 90 ? 'critical' : percent >= 80 ? 'warning' : 'normal',
      percent,
    },
  });
}

/**
 * Parses a size as `system_profiler` writes it (`32 GB`).
 * @param text The size.
 * @returns Returns the size in bytes, or undefined when it does not parse.
 */
function parseSize(text: string | undefined): number | undefined {
  const match: RegExpExecArray | null = /^([\d.]+)\s*(KB|MB|GB|TB)$/i.exec((text ?? '').trim());
  if (match === null) {
    return undefined;
  }
  const units: readonly string[] = ['KB', 'MB', 'GB', 'TB'];
  return Number(match[1]) * 1024 ** (units.indexOf(match[2].toUpperCase()) + 1);
}

/**
 * Reads macOS's memory modules from `system_profiler -json SPMemoryDataType`. A slot reported as
 * `empty` is counted among the slots but has no module. The speed it reports in MHz is DDR's data
 * rate, so it is read as MT/s.
 * @param profile The parsed output.
 * @returns Returns the modules, the slot count and whether the memory corrects errors.
 */
export function darwinMemoryModules(profile: SystemProfilerMemory): MemoryModules {
  const section: NonNullable<SystemProfilerMemory['SPMemoryDataType']>[number] | undefined =
    profile.SPMemoryDataType?.[0];
  const slots: readonly SystemProfilerSlot[] = section?._items ?? [];
  const modules: MemoryModule[] = [];
  for (const slot of slots) {
    const size: number | undefined = parseSize(slot.dimm_size);
    if (size === undefined) {
      continue;
    }
    const speed: number = Number(/^([\d.]+)/.exec(slot.dimm_speed ?? '')?.[1] ?? Number.NaN);
    const status: string = slot.dimm_status ?? '';
    modules.push({
      slot: slot._name ?? `Slot ${modules.length + 1}`,
      sizeBytes: size,
      type: slot.dimm_type ?? '',
      ...(Number.isFinite(speed) ? { speedMts: speed } : {}),
      ...(status.length > 0 ? { status: status.toLowerCase() === 'ok' ? 'OK' : status } : {}),
      manufacturer: slot.dimm_manufacturer ?? '',
      partNumber: slot.dimm_part_number ?? '',
    });
  }
  const ecc: string | undefined = section?.global_ecc_state;
  return {
    modules,
    ...(slots.length > 0 ? { slots: slots.length } : {}),
    ...(ecc === undefined ? {} : { ecc: ecc === 'ecc_enabled' }),
  };
}

/**
 * Reads the memory modules systeminformation reports (Windows' WMI, Linux's dmidecode), leaving out
 * empty slots.
 * @param layout The modules (`si.memLayout()`).
 * @returns Returns the modules, the slot count and whether the memory corrects errors.
 */
export function layoutMemoryModules(layout: readonly MemoryLayoutStat[]): MemoryModules {
  const modules: readonly MemoryModule[] = layout
    .filter((stat: MemoryLayoutStat): boolean => stat.size > 0)
    .map((stat: MemoryLayoutStat, index: number): MemoryModule => ({
      slot: stat.bank.length > 0 ? stat.bank : `DIMM ${index + 1}`,
      sizeBytes: stat.size,
      type: [stat.type, stat.formFactor]
        .filter((part: string): boolean => part.length > 0 && part !== 'Unknown')
        .join(' '),
      ...(stat.clockSpeed !== null && stat.clockSpeed > 0 ? { speedMts: stat.clockSpeed } : {}),
      manufacturer: stat.manufacturer ?? '',
      partNumber: stat.partNum,
    }));
  const ecc: boolean | null | undefined = layout.find(
    (stat: MemoryLayoutStat): boolean => typeof stat.ecc === 'boolean',
  )?.ecc;
  return {
    modules,
    ...(layout.length > 0 ? { slots: layout.length } : {}),
    ...(typeof ecc === 'boolean' ? { ecc } : {}),
  };
}
