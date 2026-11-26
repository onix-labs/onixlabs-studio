import {
  NetworkConnection,
  NetworkInterfaceInfo,
  NetworkInterfaceKind,
  NetworkInterfaceReading,
} from '@shared/api/system-monitor-channels';

/**
 * Describes a network interface's cumulative counters, as the platform keeps them from boot (or from
 * the interface appearing).
 */
export interface NetworkCounters {
  readonly rxBytes: number;
  readonly txBytes: number;
  readonly rxPackets: number;
  readonly txPackets: number;
  readonly rxErrors: number;
  readonly txErrors: number;
  readonly dropped: number;
}

/**
 * The subset of a `systeminformation` interface this reads (`si.networkInterfaces()`).
 */
export interface InterfaceStat {
  readonly iface: string;
  readonly ifaceName?: string;
  readonly ip4?: string;
  readonly ip6?: string;
  readonly mac?: string;
  readonly internal?: boolean;
  readonly operstate?: string;
  readonly type?: string;
  readonly speed?: number | null;
  readonly mtu?: number | null;
}

/**
 * The subset of a `systeminformation` connection this reads (`si.networkConnections()`).
 */
export interface ConnectionStat {
  readonly protocol: string;
  readonly localAddress: string;
  readonly localPort: string;
  readonly peerAddress: string;
  readonly peerPort: string;
  readonly state: string;
  readonly pid: number;
  readonly process: string;
}

/**
 * A Windows adapter's statistics (`Get-NetAdapterStatistics`).
 */
export interface WindowsAdapterStatistics {
  readonly Name: string;
  readonly ReceivedBytes?: number;
  readonly SentBytes?: number;
  readonly ReceivedUnicastPackets?: number;
  readonly ReceivedMulticastPackets?: number;
  readonly ReceivedBroadcastPackets?: number;
  readonly SentUnicastPackets?: number;
  readonly SentMulticastPackets?: number;
  readonly SentBroadcastPackets?: number;
  readonly ReceivedPacketErrors?: number;
  readonly OutboundPacketErrors?: number;
  readonly ReceivedDiscardedPackets?: number;
  readonly OutboundDiscardedPackets?: number;
}

/**
 * One interface gathered from systeminformation's entries for it (one per address).
 */
interface MergedInterface {
  readonly stat: InterfaceStat;
  ipv4?: string;
  readonly ipv6: string[];
}

/**
 * The states a connection is listed by, most interesting first.
 */
const STATE_ORDER: readonly string[] = ['ESTABLISHED', 'LISTEN', 'LISTENING'];

/**
 * Reads a number, treating anything not finite as 0.
 * @param value The value.
 * @returns Returns the number.
 */
function numberOf(value: number | string | undefined | null): number {
  const parsed: number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Reads macOS's interface counters (`netstat -ibnd`): one link-level row per interface, its counters
 * the last eight columns (packets, errors and bytes in; packets, errors and bytes out; collisions;
 * drops). An interface that is down is named with a trailing `*`.
 * @param text The `netstat` output.
 * @returns Returns each interface's counters, by name.
 */
export function parseNetstatInterfaces(text: string): ReadonlyMap<string, NetworkCounters> {
  const interfaces: Map<string, NetworkCounters> = new Map<string, NetworkCounters>();
  for (const line of text.split('\n')) {
    if (!line.includes('<Link#')) {
      continue;
    }
    const fields: readonly string[] = line.trim().split(/\s+/);
    const name: string = fields[0].replace(/\*$/, '');
    const counts: readonly number[] = fields.slice(-8).map(numberOf);
    if (counts.length < 8 || interfaces.has(name)) {
      continue;
    }
    const [
      rxPackets,
      rxErrors,
      rxBytes,
      txPackets,
      txErrors,
      txBytes,
      ,
      dropped,
    ]: readonly number[] = counts;
    interfaces.set(name, { rxBytes, txBytes, rxPackets, txPackets, rxErrors, txErrors, dropped });
  }
  return interfaces;
}

/**
 * Reads Linux's interface counters (`/proc/net/dev`).
 * @param text The file's content.
 * @returns Returns each interface's counters, by name.
 */
export function parseProcNetDev(text: string): ReadonlyMap<string, NetworkCounters> {
  const interfaces: Map<string, NetworkCounters> = new Map<string, NetworkCounters>();
  for (const line of text.split('\n')) {
    const match: RegExpExecArray | null = /^\s*([^:\s]+):\s*(.*)$/.exec(line);
    if (match === null) {
      continue;
    }
    const fields: readonly number[] = match[2].trim().split(/\s+/).map(numberOf);
    if (fields.length < 12) {
      continue;
    }
    interfaces.set(match[1], {
      rxBytes: fields[0],
      rxPackets: fields[1],
      rxErrors: fields[2],
      txBytes: fields[8],
      txPackets: fields[9],
      txErrors: fields[10],
      dropped: fields[3] + fields[11],
    });
  }
  return interfaces;
}

/**
 * Reads Windows's adapter statistics (`Get-NetAdapterStatistics`), counting unicast, multicast and
 * broadcast packets together.
 * @param statistics The statistics, one object or an array of them as `ConvertTo-Json` gives.
 * @returns Returns each adapter's counters, by name.
 */
export function parseWindowsAdapters(
  statistics: WindowsAdapterStatistics | readonly WindowsAdapterStatistics[] | null | undefined,
): ReadonlyMap<string, NetworkCounters> {
  const list: readonly WindowsAdapterStatistics[] =
    statistics === null || statistics === undefined
      ? []
      : Array.isArray(statistics)
        ? statistics
        : [statistics];
  const interfaces: Map<string, NetworkCounters> = new Map<string, NetworkCounters>();
  for (const adapter of list) {
    if (typeof adapter.Name !== 'string' || adapter.Name.length === 0) {
      continue;
    }
    interfaces.set(adapter.Name, {
      rxBytes: numberOf(adapter.ReceivedBytes),
      txBytes: numberOf(adapter.SentBytes),
      rxPackets:
        numberOf(adapter.ReceivedUnicastPackets) +
        numberOf(adapter.ReceivedMulticastPackets) +
        numberOf(adapter.ReceivedBroadcastPackets),
      txPackets:
        numberOf(adapter.SentUnicastPackets) +
        numberOf(adapter.SentMulticastPackets) +
        numberOf(adapter.SentBroadcastPackets),
      rxErrors: numberOf(adapter.ReceivedPacketErrors),
      txErrors: numberOf(adapter.OutboundPacketErrors),
      dropped:
        numberOf(adapter.ReceivedDiscardedPackets) + numberOf(adapter.OutboundDiscardedPackets),
    });
  }
  return interfaces;
}

/**
 * Reads macOS's hardware port names (`networksetup -listallhardwareports`): `Wi-Fi`, `Ethernet 1`,
 * `Thunderbolt Bridge`.
 * @param text The `networksetup` output.
 * @returns Returns each device's port name, by device (`en0`).
 */
export function parseHardwarePorts(text: string): ReadonlyMap<string, string> {
  const ports: Map<string, string> = new Map<string, string>();
  let port: string | null = null;
  for (const line of text.split('\n')) {
    const name: RegExpExecArray | null = /^Hardware Port:\s*(.+)$/.exec(line.trim());
    if (name !== null) {
      port = name[1].trim();
      continue;
    }
    const device: RegExpExecArray | null = /^Device:\s*(\S+)$/.exec(line.trim());
    if (device !== null && port !== null) {
      ports.set(device[1], port);
      port = null;
    }
  }
  return ports;
}

/**
 * Works out the kind of an interface from its name, its hardware port's name and what
 * systeminformation says of it.
 * @param stat The interface.
 * @param port Its hardware port's name, where the platform names one.
 * @returns Returns its kind.
 */
export function interfaceKind(stat: InterfaceStat, port: string | undefined): NetworkInterfaceKind {
  const id: string = stat.iface.toLowerCase();
  const label: string = `${port ?? ''} ${stat.ifaceName ?? ''}`.toLowerCase();
  if (stat.internal === true || /^lo\d*$/.test(id) || label.includes('loopback')) {
    return 'loopback';
  }
  if (/^(utun|tun|tap|wg|ipsec|ppp|gpd)\d*/.test(id) || /vpn|wireguard|tunnel/.test(label)) {
    return 'vpn';
  }
  if (/^(bridge|br)\d*/.test(id) || label.includes('bridge')) {
    return 'bridge';
  }
  if (
    /^(awdl|llw|ap|anpi|docker|veth|vmnet|vboxnet|virbr|gif|stf)\d*/.test(id) ||
    /virtual|hyper-v/.test(label)
  ) {
    return 'virtual';
  }
  if (
    stat.type === 'wireless' ||
    /wi-?fi|wireless|wlan|airport/.test(label) ||
    id.startsWith('wl')
  ) {
    return 'wifi';
  }
  if (stat.type === 'wired' || /ethernet|thunderbolt|lan/.test(label) || /^(en|eth)/.test(id)) {
    return 'ethernet';
  }
  return 'other';
}

/**
 * Picks the IPv6 address to show: a global one where the interface has one, its link-local one
 * otherwise.
 * @param addresses The interface's IPv6 addresses.
 * @returns Returns the address, or undefined when it has none.
 */
function preferredIpv6(addresses: readonly string[]): string | undefined {
  return addresses.find((address: string): boolean => !/^fe80:/i.test(address)) ?? addresses[0];
}

/**
 * Maps systeminformation's interfaces to those a Network view lists: named, their kind worked out,
 * the default one first, then those up with an address, then the rest by name. An interface listed
 * more than once (one entry per address) is merged.
 * @param stats The interfaces (`si.networkInterfaces()`).
 * @param ports Each device's hardware port name, where the platform names them.
 * @param defaultId The default interface's id, where known.
 * @returns Returns the interfaces.
 */
export function readNetworkInterfaces(
  stats: readonly InterfaceStat[],
  ports: ReadonlyMap<string, string>,
  defaultId: string | undefined,
): readonly NetworkInterfaceInfo[] {
  const merged: Map<string, MergedInterface> = new Map<string, MergedInterface>();
  for (const stat of stats) {
    if (stat.iface.length === 0) {
      continue;
    }
    const entry: MergedInterface = merged.get(stat.iface) ?? { stat, ipv6: [] };
    if (entry.ipv4 === undefined && (stat.ip4 ?? '').length > 0) {
      entry.ipv4 = stat.ip4;
    }
    if ((stat.ip6 ?? '').length > 0) {
      entry.ipv6.push(stat.ip6 ?? '');
    }
    merged.set(stat.iface, entry);
  }
  const interfaces: NetworkInterfaceInfo[] = [...merged.values()].map(
    ({
      stat,
      ipv4,
      ipv6,
    }: {
      stat: InterfaceStat;
      ipv4?: string;
      ipv6: string[];
    }): NetworkInterfaceInfo => {
      const port: string | undefined = ports.get(stat.iface);
      const kind: NetworkInterfaceKind = interfaceKind(stat, port);
      const address: string | undefined = preferredIpv6(ipv6);
      const mac: string = (stat.mac ?? '').trim();
      const speed: number = numberOf(stat.speed);
      const mtu: number = numberOf(stat.mtu);
      const named: string = (stat.ifaceName ?? '').trim();
      return {
        id: stat.iface,
        name: port ?? (named.length > 0 && named !== stat.iface ? named : stat.iface),
        kind,
        up: kind === 'loopback' || stat.operstate === 'up',
        isDefault: stat.iface === defaultId,
        ...(mac.length > 0 && mac !== '00:00:00:00:00:00' ? { mac } : {}),
        ...(ipv4 === undefined ? {} : { ipv4 }),
        ...(address === undefined ? {} : { ipv6: address }),
        ...(speed > 0 ? { speedMbps: speed } : {}),
        ...(mtu > 0 ? { mtu } : {}),
      };
    },
  );
  const rank: (info: NetworkInterfaceInfo) => number = (info: NetworkInterfaceInfo): number =>
    info.isDefault ? 0 : isActive(info) ? 1 : info.up ? 2 : 3;
  return interfaces.sort(
    (a: NetworkInterfaceInfo, b: NetworkInterfaceInfo): number =>
      rank(a) - rank(b) || a.id.localeCompare(b.id, undefined, { numeric: true }),
  );
}

/**
 * Decides whether an interface is active: up, not the loopback, with an IPv4 address or a global IPv6
 * one.
 * @param info The interface.
 * @returns Returns true when it is active.
 */
export function isActive(info: NetworkInterfaceInfo): boolean {
  return (
    info.up &&
    info.kind !== 'loopback' &&
    (info.ipv4 !== undefined || (info.ipv6 !== undefined && !/^fe80:/i.test(info.ipv6)))
  );
}

/**
 * Works out an interface's activity between two readings of its counters. A counter that went
 * backwards (the interface was reset) reads as no activity.
 * @param id The interface's id.
 * @param current The counters now.
 * @param previous The counters at the last reading, or undefined for the first.
 * @param elapsedMs The time between the two readings, in milliseconds.
 * @returns Returns the reading.
 */
export function interfaceReading(
  id: string,
  current: NetworkCounters,
  previous: NetworkCounters | undefined,
  elapsedMs: number,
): NetworkInterfaceReading {
  const seconds: number = elapsedMs / 1000;
  const rate: (now: number, before: number | undefined) => number = (
    now: number,
    before: number | undefined,
  ): number =>
    before === undefined || seconds <= 0 || now < before ? 0 : (now - before) / seconds;
  return {
    id,
    rxBytesPerSecond: rate(current.rxBytes, previous?.rxBytes),
    txBytesPerSecond: rate(current.txBytes, previous?.txBytes),
    rxPacketsPerSecond: rate(current.rxPackets, previous?.rxPackets),
    txPacketsPerSecond: rate(current.txPackets, previous?.txPackets),
    totalRxBytes: current.rxBytes,
    totalTxBytes: current.txBytes,
    totalRxPackets: current.rxPackets,
    totalTxPackets: current.txPackets,
    rxErrors: current.rxErrors,
    txErrors: current.txErrors,
    dropped: current.dropped,
  };
}

/**
 * Joins an address and a port, bracketing an IPv6 address (`[::1]:8080`).
 * @param address The address.
 * @param port The port.
 * @returns Returns the endpoint, or the empty string for a wildcard peer.
 */
function endpoint(address: string, port: string): string {
  const host: string = address.trim();
  if (host.length === 0 || host === '*') {
    return port.trim().length > 0 && port !== '*' ? `*:${port}` : '';
  }
  const bracketed: string = host.includes(':') ? `[${host}]` : host;
  return port.trim().length > 0 && port !== '*' ? `${bracketed}:${port}` : bracketed;
}

/**
 * Maps systeminformation's connections to those a Network view lists: protocol without its address
 * family, endpoints joined, the owning process's name and executable folder split from its path.
 * Established connections come first, then listening sockets, then the rest.
 * @param stats The connections (`si.networkConnections()`).
 * @returns Returns the connections.
 */
export function readConnections(stats: readonly ConnectionStat[]): readonly NetworkConnection[] {
  const connections: NetworkConnection[] = stats.map((stat: ConnectionStat): NetworkConnection => {
    const path: string = (stat.process ?? '').trim();
    const slash: number = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    const process: string = slash >= 0 ? path.slice(slash + 1) : path;
    return {
      protocol: stat.protocol.replace(/[46]$/, '').toUpperCase(),
      local: endpoint(stat.localAddress, stat.localPort),
      remote: endpoint(stat.peerAddress, stat.peerPort),
      state: (stat.state ?? '').trim().toUpperCase(),
      ...(stat.pid > 0 ? { pid: stat.pid } : {}),
      ...(process.length > 0 ? { process } : {}),
      ...(slash > 0 ? { location: path.slice(0, slash) } : {}),
    };
  });
  const rank: (state: string) => number = (state: string): number => {
    const index: number = STATE_ORDER.indexOf(state);
    return index < 0 ? STATE_ORDER.length : Math.min(index, 1);
  };
  return connections.sort(
    (a: NetworkConnection, b: NetworkConnection): number =>
      rank(a.state) - rank(b.state) || (a.process ?? '~').localeCompare(b.process ?? '~'),
  );
}
