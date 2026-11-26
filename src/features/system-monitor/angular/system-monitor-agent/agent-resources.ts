import {
  GpuProcessReading,
  GpuReading,
  NetworkConnection,
  NetworkInterfaceInfo,
  NetworkInterfaceReading,
  NetworkSnapshot,
  ProcessesSnapshot,
  ProcessSample,
  StorageDevice,
  StorageDeviceReading,
  StorageSnapshot,
  StorageVolumeDevice,
  VolumeMetric,
} from '@shared/api/system-monitor-channels';

/**
 * The processes a listing returns when the model names no limit.
 */
export const DEFAULT_PROCESSES: number = 25;

/**
 * The most processes one listing returns.
 */
export const MAX_PROCESSES: number = 100;

/**
 * The most connections a network reading lists one by one; the rest are only counted.
 */
export const MAX_CONNECTIONS: number = 150;

/**
 * The most characters of a process's command line the model is shown.
 */
const MAX_COMMAND_CHARS: number = 300;

/**
 * Identifies what a process listing is ordered by.
 */
export type ProcessOrder = 'cpu' | 'memory' | 'gpu' | 'threads' | 'uptime';

/**
 * Identifies which processes a listing includes.
 */
export type ProcessScope = 'all' | 'user' | 'system' | 'studio';

/**
 * Describes what the model asked a process listing for, read from its untrusted input.
 */
export interface ProcessQuery {
  /**
   * Gets what the listing is ordered by, busiest first.
   */
  readonly sort: ProcessOrder;

  /**
   * Gets which processes it includes.
   */
  readonly scope: ProcessScope;

  /**
   * Gets text a process's name, command, user or PID must contain, or the empty string for any.
   */
  readonly text: string;

  /**
   * Gets the most processes to return.
   */
  readonly limit: number;
}

/**
 * Rounds to one decimal place.
 * @param value The value.
 * @returns Returns the rounded value.
 */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Reads what the model asked a process listing for, falling back to the busiest 25 by CPU.
 * @param input The model's input.
 * @returns Returns the query.
 */
export function readProcessQuery(input: unknown): ProcessQuery {
  const request: Record<string, unknown> =
    input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const sorts: readonly ProcessOrder[] = ['cpu', 'memory', 'gpu', 'threads', 'uptime'];
  const scopes: readonly ProcessScope[] = ['all', 'user', 'system', 'studio'];
  const sort: unknown = request['sort'];
  const scope: unknown = request['scope'];
  const limit: unknown = request['limit'];
  return {
    sort: sorts.includes(sort as ProcessOrder) ? (sort as ProcessOrder) : 'cpu',
    scope: scopes.includes(scope as ProcessScope) ? (scope as ProcessScope) : 'all',
    text: typeof request['text'] === 'string' ? request['text'].trim().toLowerCase() : '',
    limit:
      typeof limit === 'number' && Number.isFinite(limit)
        ? Math.min(MAX_PROCESSES, Math.max(1, Math.floor(limit)))
        : DEFAULT_PROCESSES,
  };
}

/**
 * Reads the account name out of a process's user, which Windows qualifies with a domain.
 * @param user The user.
 * @returns Returns the account name, lower-cased.
 */
function accountOf(user: string): string {
  return user.slice(user.lastIndexOf('\\') + 1).toLowerCase();
}

/**
 * Describes one process for the model: its identity, owner, readings and command line.
 * @param process The process.
 * @param now When the listing was taken, in milliseconds since the epoch.
 * @param gpuPercent Its share of the GPU, where read.
 * @returns Returns the description.
 */
function describeProcess(
  process: ProcessSample,
  now: number,
  gpuPercent: number | undefined,
): Record<string, unknown> {
  return {
    pid: process.pid,
    parentPid: process.parentPid,
    name: process.name,
    user: process.user,
    cpuPercent: process.cpuPercent,
    memoryBytes: process.memoryBytes,
    memoryPercent: process.memoryPercent,
    ...(gpuPercent === undefined ? {} : { gpuPercent: round1(gpuPercent) }),
    ...(process.threads === undefined ? {} : { threads: process.threads }),
    ...(process.cpuTimeSeconds === undefined ? {} : { cpuTimeSeconds: process.cpuTimeSeconds }),
    ...(process.startedAt === undefined
      ? {}
      : { uptimeSeconds: Math.max(0, Math.round((now - process.startedAt) / 1000)) }),
    ...(process.studio === undefined ? {} : { studio: process.studio }),
    command:
      process.command.length > MAX_COMMAND_CHARS
        ? `${process.command.slice(0, MAX_COMMAND_CHARS)}…`
        : process.command,
  };
}

/**
 * Lists processes for the model: those in scope that match the text, busiest first by the order asked
 * for, up to the limit, with how many there are in all.
 * @param snapshot The listing.
 * @param query What the model asked for.
 * @param gpu A GPU reading for per-process shares, or null where none was read.
 * @returns Returns the listing.
 */
export function listProcesses(
  snapshot: ProcessesSnapshot,
  query: ProcessQuery,
  gpu: GpuReading | null,
): Record<string, unknown> {
  const now: number = Date.parse(snapshot.timestamp);
  const account: string = accountOf(snapshot.user);
  const shares: Map<number, number> = new Map<number, number>(
    (gpu?.processes ?? [])
      .filter((process: GpuProcessReading): boolean => process.gpuPercent !== undefined)
      .map((process: GpuProcessReading): [number, number] => [
        process.pid,
        process.gpuPercent ?? 0,
      ]),
  );
  const inScope: (process: ProcessSample) => boolean = (process: ProcessSample): boolean => {
    switch (query.scope) {
      case 'user':
        return account.length > 0 && accountOf(process.user) === account;
      case 'system':
        return account.length > 0 && accountOf(process.user) !== account;
      case 'studio':
        return process.studio !== undefined;
      default:
        return true;
    }
  };
  const matches: (process: ProcessSample) => boolean = (process: ProcessSample): boolean =>
    query.text.length === 0 ||
    `${process.pid}` === query.text ||
    `${process.name} ${process.command} ${process.user}`.toLowerCase().includes(query.text);
  const key: (process: ProcessSample) => number = (process: ProcessSample): number => {
    switch (query.sort) {
      case 'memory':
        return process.memoryBytes;
      case 'gpu':
        return shares.get(process.pid) ?? 0;
      case 'threads':
        return process.threads ?? 0;
      case 'uptime':
        return process.startedAt === undefined ? 0 : now - process.startedAt;
      default:
        return process.cpuPercent;
    }
  };
  const chosen: readonly ProcessSample[] = snapshot.processes
    .filter((process: ProcessSample): boolean => inScope(process) && matches(process))
    .sort((a: ProcessSample, b: ProcessSample): number => key(b) - key(a));
  return {
    takenAt: snapshot.timestamp,
    runningOnMachine: snapshot.total,
    listed: snapshot.processes.length,
    note: "Only Studio's own processes and the busiest of the rest are listed. CPU is a share of the whole machine.",
    matching: chosen.length,
    order: query.sort,
    scope: query.scope,
    processes: chosen
      .slice(0, query.limit)
      .map((process: ProcessSample): Record<string, unknown> =>
        describeProcess(process, now, shares.get(process.pid)),
      ),
  };
}

/**
 * Describes the GPU for the model: its reading, with each process's name joined from a listing.
 * @param gpu The reading.
 * @param snapshot A process listing to name the GPU's processes from, or null.
 * @returns Returns the description.
 */
export function describeGpu(
  gpu: GpuReading,
  snapshot: ProcessesSnapshot | null,
): Record<string, unknown> {
  const names: Map<number, string> = new Map<number, string>(
    (snapshot?.processes ?? []).map((process: ProcessSample): [number, string] => [
      process.pid,
      process.name,
    ]),
  );
  return {
    ...gpu,
    processes: gpu.processes.map((process: GpuProcessReading): GpuProcessReading => ({
      ...process,
      ...(process.name === undefined && names.has(process.pid)
        ? { name: names.get(process.pid) }
        : {}),
    })),
  };
}

/**
 * Describes the storage for the model: each drive with its activity and the volumes on it, and any
 * volume on no listed drive (a network share) apart.
 * @param snapshot The drives and their activity.
 * @param volumes The mounted volumes' space.
 * @returns Returns the description.
 */
export function describeStorage(
  snapshot: StorageSnapshot,
  volumes: readonly VolumeMetric[],
): Record<string, unknown> {
  const readings: Map<string, StorageDeviceReading> = new Map<string, StorageDeviceReading>(
    (snapshot.reading?.devices ?? []).map(
      (device: StorageDeviceReading): [string, StorageDeviceReading] => [device.id, device],
    ),
  );
  const places: Map<string, StorageVolumeDevice> = new Map<string, StorageVolumeDevice>(
    snapshot.info.volumes.map((volume: StorageVolumeDevice): [string, StorageVolumeDevice] => [
      volume.mount,
      volume,
    ]),
  );
  const describeVolume: (volume: VolumeMetric) => Record<string, unknown> = (
    volume: VolumeMetric,
  ): Record<string, unknown> => ({
    mount: volume.mount,
    ...(places.get(volume.mount)?.name === undefined
      ? {}
      : { name: places.get(volume.mount)?.name }),
    fileSystem: volume.type,
    sizeBytes: volume.sizeBytes,
    usedBytes: volume.usedBytes,
    freeBytes: Math.max(0, volume.sizeBytes - volume.usedBytes),
    usedPercent: volume.sizeBytes > 0 ? round1((volume.usedBytes / volume.sizeBytes) * 100) : 0,
  });
  const listed: Set<string> = new Set<string>(
    snapshot.info.devices.map((device: StorageDevice): string => device.id),
  );
  return {
    activityNote:
      "Rates are over the last second; totals are since the drive's counters started (usually boot).",
    devices: snapshot.info.devices.map((device: StorageDevice): Record<string, unknown> => ({
      ...device,
      activity: readings.get(device.id) ?? null,
      volumes: volumes
        .filter((volume: VolumeMetric): boolean => places.get(volume.mount)?.deviceId === device.id)
        .map(describeVolume),
    })),
    otherVolumes: volumes
      .filter((volume: VolumeMetric): boolean => {
        const deviceId: string | undefined = places.get(volume.mount)?.deviceId;
        return deviceId === undefined || !listed.has(deviceId);
      })
      .map(describeVolume),
  };
}

/**
 * Describes the network for the model: each interface with its activity, the DNS servers, gateway and
 * latency, and the connections — counted by state and protocol, and listed (established first) up to
 * {@link MAX_CONNECTIONS}.
 * @param snapshot The network.
 * @returns Returns the description.
 */
export function describeNetwork(snapshot: NetworkSnapshot): Record<string, unknown> {
  const readings: Map<string, NetworkInterfaceReading> = new Map<string, NetworkInterfaceReading>(
    snapshot.reading.interfaces.map(
      (item: NetworkInterfaceReading): [string, NetworkInterfaceReading] => [item.id, item],
    ),
  );
  const connections: readonly NetworkConnection[] = snapshot.reading.connections ?? [];
  const count: (key: (connection: NetworkConnection) => string) => Record<string, number> = (
    key: (connection: NetworkConnection) => string,
  ): Record<string, number> => {
    const counts: Record<string, number> = {};
    for (const connection of connections) {
      const name: string = key(connection) || 'NONE';
      counts[name] = (counts[name] ?? 0) + 1;
    }
    return counts;
  };
  return {
    activityNote:
      "Rates are over the last second; totals are since the interface's counters started (usually boot).",
    dnsServers: snapshot.info.dnsServers,
    ...(snapshot.info.gateway === undefined ? {} : { gateway: snapshot.info.gateway }),
    ...(snapshot.reading.dnsLatencyMs === undefined
      ? {}
      : { dnsLatencyMs: snapshot.reading.dnsLatencyMs }),
    interfaces: snapshot.info.interfaces.map(
      (item: NetworkInterfaceInfo): Record<string, unknown> => ({
        ...item,
        activity: readings.get(item.id) ?? null,
      }),
    ),
    connections: {
      total: connections.length,
      byState: count((connection: NetworkConnection): string => connection.state),
      byProtocol: count((connection: NetworkConnection): string => connection.protocol),
      listed: connections.slice(0, MAX_CONNECTIONS),
      ...(connections.length > MAX_CONNECTIONS
        ? { more: connections.length - MAX_CONNECTIONS }
        : {}),
    },
  };
}
