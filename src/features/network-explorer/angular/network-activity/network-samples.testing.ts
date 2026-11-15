import {
  NetworkConnection,
  NetworkInfo,
  NetworkInterfaceReading,
} from '@shared/api/system-monitor-channels';

/**
 * A Mac's network in miniature: the loopback, Wi-Fi on the default route, and an idle interface.
 */
export const sampleNetwork: NetworkInfo = {
  interfaces: [
    { id: 'lo0', name: 'Loopback', kind: 'loopback', up: true, isDefault: false, ipv4: '127.0.0.1' },
    { id: 'en0', name: 'Wi-Fi', kind: 'wifi', up: true, isDefault: true, ipv4: '192.168.1.20' },
    { id: 'awdl0', name: 'AWDL', kind: 'other', up: false, isDefault: false },
  ],
  dnsServers: [],
};

/**
 * Builds an interface's activity.
 * @param id The interface's id.
 * @param rx The bytes received per second.
 * @returns Returns the reading.
 */
export function activity(id: string, rx: number): NetworkInterfaceReading {
  return {
    id,
    rxBytesPerSecond: rx,
    txBytesPerSecond: 0,
    rxPacketsPerSecond: 0,
    txPacketsPerSecond: 0,
    totalRxBytes: 0,
    totalTxBytes: 0,
    totalRxPackets: 0,
    totalTxPackets: 0,
    rxErrors: 0,
    txErrors: 0,
    dropped: 0,
  };
}

/**
 * A connection over Wi-Fi, one over the loopback, and a listening socket.
 */
export const sampleConnections: readonly NetworkConnection[] = [
  {
    protocol: 'TCP',
    local: '192.168.1.20:50000',
    remote: '140.82.112.3:443',
    state: 'ESTABLISHED',
    pid: 10,
    process: 'Safari',
  },
  {
    protocol: 'TCP',
    local: '127.0.0.1:50001',
    remote: '127.0.0.1:5432',
    state: 'ESTABLISHED',
    pid: 11,
    process: 'node',
  },
  { protocol: 'TCP', local: '*:80', remote: '', state: 'LISTEN', pid: 12, process: 'nginx' },
];
