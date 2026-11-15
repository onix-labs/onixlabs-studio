import {
  DissectedPacket,
  LINKTYPE_ETHERNET,
  LINKTYPE_NULL,
  LINKTYPE_RAW,
  PacketField,
  PacketLayer,
} from './packet-model';
import { dissectPacket } from './dissect-packet';
import { formatIpv6 } from './packet-bytes';
import {
  arpRequest,
  bytesOf,
  dnsQuery,
  dnsResponse,
  ethernet,
  hostMac,
  icmpEcho,
  ipv4,
  ipv6,
  ipv6Bytes,
  routerMac,
  tcp,
  tlsClientHello,
  u16,
  udp,
} from './packet-samples.testing';

/**
 * Wraps an IPv4 packet in Ethernet, from this host to the router.
 * @param packet The IPv4 packet.
 * @returns Returns the frame.
 */
function overEthernet(packet: Uint8Array): Uint8Array {
  return ethernet(hostMac, routerMac, 0x0800, packet);
}

/**
 * Gets a layer's fields as `label: value` lines.
 * @param layer The layer.
 * @returns Returns the lines.
 */
function fieldsOf(layer: PacketLayer | undefined): readonly string[] {
  return (layer?.fields ?? []).map(
    (entry: PacketField): string => `${entry.label}: ${entry.value}`,
  );
}

/**
 * Gets the protocols of a packet's layers, outermost first.
 * @param packet The packet.
 * @returns Returns them.
 */
function stack(packet: DissectedPacket): readonly string[] {
  return packet.layers.map((layer: PacketLayer): string => layer.protocol);
}

describe('dissectPacket', () => {
  it('aTcpSyn_isSummarisedWithItsPortsAndFlags', () => {
    const packet: DissectedPacket = dissectPacket(
      LINKTYPE_ETHERNET,
      overEthernet(ipv4('192.168.1.43', '140.82.112.3', 6, tcp(50000, 443, 0x02))),
    );

    expect(stack(packet)).toEqual(['Ethernet', 'IPv4', 'TCP']);
    expect(packet.summary).toEqual({
      protocol: 'TCP',
      source: '192.168.1.43:50000',
      destination: '140.82.112.3:443',
      info: '50000 → 443 [SYN] Seq=1000 Win=65535 Len=0',
    });
    expect(packet.truncated).toBe(false);
  });

  it('aSynAck_listsItsFlagsTheConventionalWay', () => {
    const packet: DissectedPacket = dissectPacket(
      LINKTYPE_ETHERNET,
      overEthernet(
        ipv4(
          '140.82.112.3',
          '192.168.1.43',
          6,
          tcp(443, 50000, 0x12, new Uint8Array(0), 5000, 1001),
        ),
      ),
    );

    expect(packet.summary.info).toBe('443 → 50000 [SYN, ACK] Seq=5000 Ack=1001 Win=65535 Len=0');
  });

  it('aDnsQueryAndItsCompressedAnswer_areRead', () => {
    const query: DissectedPacket = dissectPacket(
      LINKTYPE_ETHERNET,
      overEthernet(
        ipv4('192.168.1.43', '192.168.1.1', 17, udp(53000, 53, dnsQuery(0x1a2b, 'github.com'))),
      ),
    );
    const answer: DissectedPacket = dissectPacket(
      LINKTYPE_ETHERNET,
      overEthernet(
        ipv4(
          '192.168.1.1',
          '192.168.1.43',
          17,
          udp(53, 53000, dnsResponse(0x1a2b, 'github.com', '140.82.112.3')),
        ),
      ),
    );

    expect(query.summary.protocol).toBe('DNS');
    expect(query.summary.info).toBe('Standard query 0x1a2b A github.com');
    expect(answer.summary.info).toBe('Standard query response 0x1a2b A github.com A 140.82.112.3');
    expect(fieldsOf(answer.layers.at(-1))).toContain('Answer: github.com: type A, 140.82.112.3');
  });

  it('aTlsClientHello_namesTheServerAndProtocols', () => {
    const packet: DissectedPacket = dissectPacket(
      LINKTYPE_ETHERNET,
      overEthernet(
        ipv4(
          '192.168.1.43',
          '140.82.112.3',
          6,
          tcp(50000, 443, 0x18, tlsClientHello('github.com')),
        ),
      ),
    );

    expect(packet.summary.protocol).toBe('TLS');
    expect(packet.summary.info).toBe('Client Hello (github.com)');
    expect(fieldsOf(packet.layers.at(-1))).toEqual(
      expect.arrayContaining(['Server Name: github.com', 'Application Protocols: h2, http/1.1']),
    );
  });

  it('anHttpRequest_showsItsRequestLine', () => {
    const request: Uint8Array = new TextEncoder().encode(
      'GET /index.html HTTP/1.1\r\nHost: example.com\r\n\r\n',
    );

    const packet: DissectedPacket = dissectPacket(
      LINKTYPE_ETHERNET,
      overEthernet(ipv4('192.168.1.43', '93.184.215.14', 6, tcp(50001, 80, 0x18, request))),
    );

    expect(packet.summary.protocol).toBe('HTTP');
    expect(packet.summary.info).toBe('GET /index.html HTTP/1.1');
  });

  it('anArpRequest_asksWhoHasTheAddress', () => {
    const packet: DissectedPacket = dissectPacket(
      LINKTYPE_ETHERNET,
      ethernet(
        hostMac,
        [0xff, 0xff, 0xff, 0xff, 0xff, 0xff],
        0x0806,
        arpRequest(hostMac, '192.168.1.43', '192.168.1.1'),
      ),
    );

    expect(packet.summary).toEqual({
      protocol: 'ARP',
      source: '3c:22:fb:12:34:56',
      destination: 'ff:ff:ff:ff:ff:ff',
      info: 'Who has 192.168.1.1? Tell 192.168.1.43',
    });
  });

  it('aPingOverTheLoopback_isReadFromAHostOrderFamily', () => {
    const packet: DissectedPacket = dissectPacket(
      LINKTYPE_NULL,
      bytesOf([2, 0, 0, 0], ipv4('127.0.0.1', '127.0.0.1', 1, icmpEcho(0x77, 3))),
    );

    expect(stack(packet)).toEqual(['Loopback', 'IPv4', 'ICMP']);
    expect(packet.summary.info).toBe('Echo (ping) request id=0x0077, seq=3');
  });

  it('anIpv6Segment_bracketsItsEndpoints_andWalksExtensionHeaders', () => {
    const hopByHop: Uint8Array = bytesOf([6, 0], new Uint8Array(6));
    const packet: DissectedPacket = dissectPacket(
      LINKTYPE_RAW,
      ipv6('2001:db8::1', '2606:4700::1111', 0, bytesOf(hopByHop, tcp(50000, 443, 0x10))),
    );

    expect(packet.summary.source).toBe('[2001:db8::1]:50000');
    expect(packet.summary.destination).toBe('[2606:4700::1111]:443');
    expect(packet.summary.protocol).toBe('TCP');
  });

  it('aVlanTaggedFrame_isReadPastItsTag', () => {
    const packet: DissectedPacket = dissectPacket(
      LINKTYPE_ETHERNET,
      bytesOf(
        routerMac,
        hostMac,
        u16(0x8100),
        u16(42),
        u16(0x0800),
        ipv4('10.0.0.1', '10.0.0.2', 1, icmpEcho(1, 1)),
      ),
    );

    expect(fieldsOf(packet.layers[0])).toContain('VLAN: 42');
    expect(packet.summary.protocol).toBe('ICMP');
  });

  it('aPacketCutShort_isDissectedAsFarAsItGoes_andSaysSo', () => {
    const whole: Uint8Array = overEthernet(
      ipv4('192.168.1.43', '140.82.112.3', 6, tcp(50000, 443, 0x02)),
    );

    const packet: DissectedPacket = dissectPacket(LINKTYPE_ETHERNET, whole.subarray(0, 40));

    expect(stack(packet)).toEqual(['Ethernet', 'IPv4']);
    expect(packet.truncated).toBe(true);
  });

  it('neverThrows_onRandomOrCutShortBytes', () => {
    const samples: readonly Uint8Array[] = [
      overEthernet(
        ipv4('1.1.1.1', '2.2.2.2', 17, udp(53, 53, dnsResponse(1, 'a.example', '3.3.3.3'))),
      ),
      overEthernet(ipv4('1.1.1.1', '2.2.2.2', 6, tcp(1, 443, 0x18, tlsClientHello('example.com')))),
    ];
    let seed: number = 42;
    const random: () => number = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    for (const linkType of [0, 1, 101, 108, 113, 12, 999]) {
      for (let round: number = 0; round < 300; round += 1) {
        const noise: Uint8Array = Uint8Array.from(
          { length: random() % 200 },
          (): number => random() & 0xff,
        );
        expect(() => dissectPacket(linkType, noise)).not.toThrow();
      }
      for (const sample of samples) {
        for (let length: number = 0; length <= sample.length; length += 1) {
          expect(() => dissectPacket(linkType, sample.subarray(0, length))).not.toThrow();
        }
      }
    }
  });

  it('aCompressionLoop_doesNotHang', () => {
    const looping: Uint8Array = bytesOf(
      u16(1),
      u16(0x0100),
      u16(1),
      u16(0),
      u16(0),
      u16(0),
      [0xc0, 12],
      u16(1),
      u16(1),
    );

    const packet: DissectedPacket = dissectPacket(
      LINKTYPE_ETHERNET,
      overEthernet(ipv4('1.1.1.1', '2.2.2.2', 17, udp(5000, 53, looping))),
    );

    expect(packet.truncated).toBe(true);
  });
});

describe('formatIpv6', () => {
  it('compressesTheLongestRunOfZeros_inCanonicalForm', () => {
    expect(formatIpv6(Uint8Array.from(ipv6Bytes('2001:db8::1')))).toBe('2001:db8::1');
    expect(formatIpv6(Uint8Array.from(ipv6Bytes('::1')))).toBe('::1');
    expect(formatIpv6(Uint8Array.from(ipv6Bytes('2001:db8:0:1:1:1:1:1')))).toBe(
      '2001:db8:0:1:1:1:1:1',
    );
    expect(formatIpv6(Uint8Array.from(ipv6Bytes('2001:0:0:1::1')))).toBe('2001:0:0:1::1');
    expect(formatIpv6(new Uint8Array(16))).toBe('::');
  });
});
