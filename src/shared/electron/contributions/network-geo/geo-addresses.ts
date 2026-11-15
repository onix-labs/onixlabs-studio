import { isIP } from 'node:net';

/**
 * Reads an IPv4 address as its four octets.
 * @param address The address.
 * @returns Returns the octets.
 */
function octets(address: string): readonly number[] {
  return address.split('.').map((part: string): number => Number(part));
}

/**
 * Gets whether an IPv4 address is private or otherwise not on the public internet: RFC 1918, the
 * loopback, link-local, shared address space (carrier-grade NAT), "this network" and multicast and
 * reserved space.
 * @param address The address.
 * @returns Returns true when the address has no place on a map.
 */
function isPrivateIpv4(address: string): boolean {
  const [a, b]: readonly number[] = octets(address);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

/**
 * Gets whether an address is private or otherwise not on the public internet, so a geolocation
 * database has nothing to say about it. IPv6: the loopback and unspecified addresses, unique-local
 * (`fc00::/7`), link-local (`fe80::/10`) and multicast; an IPv4-mapped address is judged as its IPv4.
 * @param address The address, with any IPv6 zone.
 * @returns Returns true when the address has no place on a map.
 */
export function isPrivateAddress(address: string): boolean {
  const host: string = address.split('%')[0].toLowerCase();
  const family: number = isIP(host);
  if (family === 4) {
    return isPrivateIpv4(host);
  }
  if (family !== 6) {
    return true;
  }
  if (host.startsWith('::ffff:') && isIP(host.slice(7)) === 4) {
    return isPrivateIpv4(host.slice(7));
  }
  return (
    host === '::' ||
    host === '::1' ||
    /^f[cd]/.test(host) ||
    /^fe[89ab]/.test(host) ||
    host.startsWith('ff')
  );
}
