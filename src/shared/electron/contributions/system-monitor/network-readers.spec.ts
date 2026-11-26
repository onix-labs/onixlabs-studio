import { describe, expect, it } from 'vitest';
import {
  NetworkConnection,
  NetworkInterfaceInfo,
  NetworkInterfaceReading,
} from '@shared/api/system-monitor-channels';
import {
  interfaceKind,
  interfaceReading,
  isActive,
  NetworkCounters,
  parseHardwarePorts,
  parseNetstatInterfaces,
  parseProcNetDev,
  parseWindowsAdapters,
  readConnections,
  readNetworkInterfaces,
} from './network-readers';

/**
 * `netstat -ibnd`, trimmed: the loopback (a link row, then address rows), an interface that is down,
 * and a tunnel with no hardware address.
 */
const NETSTAT: string = [
  'Name       Mtu   Network       Address            Ipkts Ierrs     Ibytes    Opkts Oerrs     Obytes  Coll Drop',
  'lo0        16384 <Link#1>                       1834392     0 4583805416  1834392     0 4583805416     0   0',
  'lo0        16384 127           127.0.0.1        1834392     - 4583805416  1834392     - 4583805416     -   -',
  'en0*       1500  <Link#4>    e4:50:eb:bc:27:2a        0     0          0        0     0          0     0   0',
  'en2        1500  <Link#9>    f8:ff:c2:1a:48:35    50000     2   90000000    40000     1   20000000     0   5',
  'utun0      1500  <Link#20>                            12     0       1200       14     0       1400     0   0',
].join('\n');

describe('parseNetstatInterfaces', () => {
  it('readsEachInterfacesLinkRow_withOrWithoutAnAddress', () => {
    const interfaces: ReadonlyMap<string, NetworkCounters> = parseNetstatInterfaces(NETSTAT);

    expect([...interfaces.keys()]).toEqual(['lo0', 'en0', 'en2', 'utun0']);
    expect(interfaces.get('en2')).toEqual({
      rxPackets: 50000,
      rxErrors: 2,
      rxBytes: 90_000_000,
      txPackets: 40000,
      txErrors: 1,
      txBytes: 20_000_000,
      dropped: 5,
    });
    expect(interfaces.get('utun0')?.rxBytes).toBe(1200);
  });
});

describe('parseProcNetDev', () => {
  it('readsEachInterface', () => {
    const interfaces: ReadonlyMap<string, NetworkCounters> = parseProcNetDev(
      [
        'Inter-|   Receive                                                |  Transmit',
        ' face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed',
        '  eth0: 1000 10 1 2 0 0 0 0 2000 20 3 4 0 0 0 0',
      ].join('\n'),
    );

    expect(interfaces.get('eth0')).toEqual({
      rxBytes: 1000,
      rxPackets: 10,
      rxErrors: 1,
      txBytes: 2000,
      txPackets: 20,
      txErrors: 3,
      dropped: 6,
    });
  });
});

describe('parseWindowsAdapters', () => {
  it('countsEveryKindOfPacket', () => {
    const interfaces: ReadonlyMap<string, NetworkCounters> = parseWindowsAdapters({
      Name: 'Ethernet',
      ReceivedBytes: 100,
      SentBytes: 200,
      ReceivedUnicastPackets: 1,
      ReceivedMulticastPackets: 2,
      ReceivedBroadcastPackets: 3,
      SentUnicastPackets: 4,
      ReceivedDiscardedPackets: 5,
      OutboundDiscardedPackets: 6,
    });

    expect(interfaces.get('Ethernet')).toMatchObject({ rxPackets: 6, txPackets: 4, dropped: 11 });
  });
});

describe('parseHardwarePorts', () => {
  it('namesEachDevicesPort', () => {
    expect(
      Object.fromEntries(
        parseHardwarePorts(
          [
            'Hardware Port: Ethernet 1',
            'Device: en0',
            'Ethernet Address: e4:50:eb:bc:27:2a',
            '',
            'Hardware Port: Wi-Fi',
            'Device: en2',
          ].join('\n'),
        ),
      ),
    ).toEqual({ en0: 'Ethernet 1', en2: 'Wi-Fi' });
  });
});

describe('interfaceKind', () => {
  it('worksOutTheKind_fromTheNameAndPort', () => {
    expect(interfaceKind({ iface: 'lo0', internal: true }, undefined)).toBe('loopback');
    expect(interfaceKind({ iface: 'en2', type: 'wireless' }, 'Wi-Fi')).toBe('wifi');
    expect(interfaceKind({ iface: 'en0', type: 'wired' }, 'Ethernet 1')).toBe('ethernet');
    expect(interfaceKind({ iface: 'bridge0', type: 'wired' }, 'Thunderbolt Bridge')).toBe('bridge');
    expect(interfaceKind({ iface: 'utun3', type: 'wired' }, undefined)).toBe('vpn');
    expect(interfaceKind({ iface: 'awdl0', type: 'wireless' }, undefined)).toBe('virtual');
  });
});

describe('readNetworkInterfaces', () => {
  it('listsTheDefaultFirst_thenTheActive_mergingEachInterfacesAddresses', () => {
    const interfaces: readonly NetworkInterfaceInfo[] = readNetworkInterfaces(
      [
        { iface: 'lo0', internal: true, ip4: '127.0.0.1', operstate: 'unknown' },
        { iface: 'en0', type: 'wired', operstate: 'down', mac: 'e4:50:eb:bc:27:2a', mtu: 1500 },
        { iface: 'en7', type: 'wired', operstate: 'up', ip6: 'fe80::1' },
        {
          iface: 'en2',
          type: 'wireless',
          operstate: 'up',
          ip4: '192.168.1.43',
          ip6: 'fe80::1084',
          speed: 152.16,
          mtu: 1500,
        },
        { iface: 'en2', type: 'wireless', operstate: 'up', ip6: '2a00:23c6::1' },
      ],
      new Map<string, string>([
        ['en0', 'Ethernet 1'],
        ['en2', 'Wi-Fi'],
      ]),
      'en2',
    );

    expect(interfaces.map((info: NetworkInterfaceInfo): string => info.id)).toEqual([
      'en2',
      'en7',
      'lo0',
      'en0',
    ]);
    expect(interfaces[0]).toEqual({
      id: 'en2',
      name: 'Wi-Fi',
      kind: 'wifi',
      up: true,
      isDefault: true,
      ipv4: '192.168.1.43',
      ipv6: '2a00:23c6::1',
      speedMbps: 152.16,
      mtu: 1500,
    });
    expect(interfaces.map(isActive)).toEqual([true, false, false, false]);
  });
});

describe('interfaceReading', () => {
  it('turnsTheCountersIntoRates', () => {
    const reading: NetworkInterfaceReading = interfaceReading(
      'en2',
      {
        rxBytes: 3000,
        txBytes: 1000,
        rxPackets: 30,
        txPackets: 10,
        rxErrors: 0,
        txErrors: 0,
        dropped: 0,
      },
      {
        rxBytes: 1000,
        txBytes: 1000,
        rxPackets: 10,
        txPackets: 10,
        rxErrors: 0,
        txErrors: 0,
        dropped: 0,
      },
      2000,
    );

    expect(reading).toMatchObject({
      rxBytesPerSecond: 1000,
      txBytesPerSecond: 0,
      rxPacketsPerSecond: 10,
      totalRxBytes: 3000,
    });
  });
});

describe('readConnections', () => {
  it('splitsTheProcessFromItsPath_andListsEstablishedFirst', () => {
    const connections: readonly NetworkConnection[] = readConnections([
      {
        protocol: 'udp4',
        localAddress: '0.0.0.0',
        localPort: '5353',
        peerAddress: '*',
        peerPort: '*',
        state: '',
        pid: 400,
        process: 'mDNSResponder',
      },
      {
        protocol: 'tcp6',
        localAddress: '::1',
        localPort: '4200',
        peerAddress: '::1',
        peerPort: '51787',
        state: 'ESTABLISHED',
        pid: 13555,
        process: '/usr/local/bin/node',
      },
    ]);

    expect(connections).toEqual([
      {
        protocol: 'TCP',
        local: '[::1]:4200',
        remote: '[::1]:51787',
        state: 'ESTABLISHED',
        pid: 13555,
        process: 'node',
        location: '/usr/local/bin',
      },
      {
        protocol: 'UDP',
        local: '0.0.0.0:5353',
        remote: '',
        state: '',
        pid: 400,
        process: 'mDNSResponder',
      },
    ]);
  });
});
