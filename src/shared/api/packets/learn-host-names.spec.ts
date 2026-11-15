import { HostNameSighting, LINKTYPE_ETHERNET, LINKTYPE_RAW } from './packet-model';
import { learnHostNames } from './learn-host-names';
import {
  dnsAliasResponse,
  dnsQuery,
  dnsResponse,
  ethernet,
  hostMac,
  ipv4,
  ipv6,
  routerMac,
  tcp,
  tlsClientHello,
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
 * Builds a DNS response from the router to this host.
 * @param message The DNS message.
 * @returns Returns the frame.
 */
function fromResolver(message: Uint8Array): Uint8Array {
  return overEthernet(ipv4('192.168.1.1', '192.168.1.43', 17, udp(53, 53000, message)));
}

describe('learnHostNames', () => {
  it('aDnsResponse_namesItsAddress', () => {
    const sightings: readonly HostNameSighting[] = learnHostNames(
      LINKTYPE_ETHERNET,
      fromResolver(dnsResponse(7, 'github.com', '140.82.112.3')),
    );

    expect(sightings).toEqual([{ name: 'github.com', address: '140.82.112.3' }]);
  });

  it('aDnsResponseThroughCnames_namesTheAddressByTheNameAskedFor', () => {
    const sightings: readonly HostNameSighting[] = learnHostNames(
      LINKTYPE_ETHERNET,
      fromResolver(
        dnsAliasResponse(
          8,
          'API.GitHub.com',
          ['lb.github.com', 'lb-140-82-113-25-iad.github.com'],
          '140.82.113.25',
        ),
      ),
    );

    expect(sightings).toEqual([{ name: 'api.github.com', address: '140.82.113.25' }]);
  });

  it('anAaaaAnswer_namesTheIpv6AddressCanonically', () => {
    const sightings: readonly HostNameSighting[] = learnHostNames(
      LINKTYPE_ETHERNET,
      fromResolver(dnsAliasResponse(9, 'example.com', [], '2606:2800:0220:0001:0:0:0:0001')),
    );

    expect(sightings).toEqual([{ name: 'example.com', address: '2606:2800:220:1::1' }]);
  });

  it('aFailedResponse_namesNothing', () => {
    const sightings: readonly HostNameSighting[] = learnHostNames(
      LINKTYPE_ETHERNET,
      fromResolver(dnsAliasResponse(10, 'gone.example', [], '192.0.2.1', 3)),
    );

    expect(sightings).toEqual([]);
  });

  it('aDnsQuery_namesNothing', () => {
    const sightings: readonly HostNameSighting[] = learnHostNames(
      LINKTYPE_ETHERNET,
      overEthernet(ipv4('192.168.1.43', '192.168.1.1', 17, udp(53000, 53, dnsQuery(7, 'a.com')))),
    );

    expect(sightings).toEqual([]);
  });

  it('aClientHello_namesTheAddressItIsSentTo', () => {
    const sightings: readonly HostNameSighting[] = learnHostNames(
      LINKTYPE_ETHERNET,
      overEthernet(
        ipv4(
          '192.168.1.43',
          '140.82.112.3',
          6,
          tcp(50000, 443, 0x18, tlsClientHello('GitHub.com')),
        ),
      ),
    );

    expect(sightings).toEqual([{ name: 'github.com', address: '140.82.112.3' }]);
  });

  it('aClientHelloOverIpv6_namesTheIpv6Address', () => {
    const sightings: readonly HostNameSighting[] = learnHostNames(
      LINKTYPE_RAW,
      ipv6(
        '2a00:23c6::1',
        '2606:4700::6810:84e5',
        6,
        tcp(50000, 443, 0x18, tlsClientHello('cf.example')),
      ),
    );

    expect(sightings).toEqual([{ name: 'cf.example', address: '2606:4700::6810:84e5' }]);
  });

  it('otherPackets_nameNothing', () => {
    expect(
      learnHostNames(
        LINKTYPE_ETHERNET,
        overEthernet(ipv4('192.168.1.43', '140.82.112.3', 6, tcp(50000, 443, 0x02))),
      ),
    ).toEqual([]);
    expect(learnHostNames(LINKTYPE_ETHERNET, new Uint8Array(10))).toEqual([]);
  });
});
