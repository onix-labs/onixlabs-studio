import { NetworkConnection, NetworkInterfaceInfo } from '@shared/api/system-monitor-channels';

/**
 * Gets the host part of an endpoint as the backend joins it: `host:port`, `[v6]:port`, `*:port`, a
 * bare host, or empty for none. An IPv6 host is returned without its brackets.
 * @param endpoint The endpoint.
 * @returns Returns the host, or an empty string when there is none.
 */
export function endpointHost(endpoint: string): string {
  const trimmed: string = endpoint.trim();
  if (trimmed.startsWith('[')) {
    const close: number = trimmed.indexOf(']');
    return close > 0 ? trimmed.slice(1, close) : trimmed.slice(1);
  }
  const colon: number = trimmed.lastIndexOf(':');
  // A bare IPv6 address has several colons and no port; only a single colon separates a port.
  return colon >= 0 && trimmed.indexOf(':') === colon ? trimmed.slice(0, colon) : trimmed;
}

/**
 * Gets the port of an endpoint as the backend joins it: `host:port` or `[v6]:port`.
 * @param endpoint The endpoint.
 * @returns Returns the port, or undefined when there is none.
 */
export function endpointPort(endpoint: string): number | undefined {
  const trimmed: string = endpoint.trim();
  const colon: number = trimmed.lastIndexOf(':');
  const bracketed: boolean = trimmed.startsWith('[');
  if (
    colon < 0 ||
    (bracketed && colon < trimmed.indexOf(']')) ||
    (!bracketed && trimmed.indexOf(':') !== colon)
  ) {
    return undefined;
  }
  const port: number = Number(trimmed.slice(colon + 1));
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined;
}

/**
 * Gets whether a host is unspecified: no host, a wildcard, or the any-address of either family. A
 * connection to one is a socket waiting for a peer, not a connection to anywhere.
 * @param host The host.
 * @returns Returns true when the host names no machine.
 */
export function isUnspecifiedHost(host: string): boolean {
  return host === '' || host === '*' || host === '0.0.0.0' || host === '::';
}

/**
 * Gets whether a host is this machine's loopback: `127.0.0.0/8`, `::1`, or `localhost`, including an
 * IPv4 loopback mapped into IPv6.
 * @param host The host, without brackets or port.
 * @returns Returns true when the host is the loopback.
 */
export function isLoopbackHost(host: string): boolean {
  const lowered: string = host.toLowerCase();
  return (
    lowered === 'localhost' ||
    lowered === '::1' ||
    lowered.startsWith('127.') ||
    lowered.startsWith('::ffff:127.')
  );
}

/**
 * Gets whether a connection has a remote peer: a real host on the far end, which a listening socket,
 * or one bound but not yet connected, does not.
 * @param connection The connection.
 * @returns Returns true when the connection reaches a peer.
 */
export function hasRemotePeer(connection: NetworkConnection): boolean {
  return !isUnspecifiedHost(endpointHost(connection.remote));
}

/**
 * Finds the interface a connection is made over, from the address its local end is bound to. An IPv6
 * link-local address names its interface outright in its zone (`fe80::1%en0`); any other address is
 * matched against the interfaces' own. A connection bound to an address no interface reports — an
 * IPv6 privacy address the listing does not carry, say — belongs to none.
 * @param connection The connection.
 * @param interfaces The machine's interfaces.
 * @returns Returns the interface's id, or undefined when none carries the local address.
 */
export function interfaceOf(
  connection: NetworkConnection,
  interfaces: readonly NetworkInterfaceInfo[],
): string | undefined {
  const host: string = endpointHost(connection.local);
  const percent: number = host.indexOf('%');
  if (percent >= 0) {
    const zone: string = host.slice(percent + 1);
    return interfaces.find((info: NetworkInterfaceInfo): boolean => info.id === zone)?.id;
  }
  const lowered: string = host.toLowerCase();
  const loopback: boolean = isLoopbackHost(lowered);
  return interfaces.find(
    (info: NetworkInterfaceInfo): boolean =>
      info.ipv4 === lowered ||
      info.ipv6?.toLowerCase() === lowered ||
      `::ffff:${info.ipv4 ?? ''}` === lowered ||
      (loopback && info.kind === 'loopback'),
  )?.id;
}
