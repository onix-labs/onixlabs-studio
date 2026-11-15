/**
 * The IPC contract for naming the hosts the Network Explorer lists: the renderer asks what the remote
 * addresses of its connections are called, and the main process answers from what it has learned.
 *
 * A name comes from one of two places. Names seen in a capture — a DNS answer, or the server name a
 * TLS Client Hello asked for — are what an application actually connected to (`api.github.com`), so
 * they are preferred. Otherwise the address's reverse DNS (PTR) record is asked for, which often
 * names the infrastructure instead (`lb-140-82-113-25-iad.github.com`). Addresses on this network,
 * the loopback and multicast are never looked up.
 */
export enum NetworkNamesChannel {
  /**
   * Renderer → main (invoke): names addresses, an array of strings, resolving a
   * {@link HostNamesAnswer}.
   */
  Resolve = 'network-names:resolve',

  /**
   * Main → renderer (send): names just learned from a capture, an array of {@link HostName}.
   */
  Learned = 'network-names:learned',
}

/**
 * The most addresses one request may ask about.
 */
export const MAX_RESOLVE_ADDRESSES: number = 256;

/**
 * Where a name was learned: seen in a capture, or the address's reverse DNS record.
 */
export type HostNameSource = 'capture' | 'reverse';

/**
 * What is known of one address's name.
 */
export interface HostName {
  /**
   * Gets the address, as it was asked about.
   */
  readonly address: string;

  /**
   * Gets the address's name, or undefined when it has none that is known.
   */
  readonly name?: string;

  /**
   * Gets where the name was learned, when there is one.
   */
  readonly source?: HostNameSource;
}

/**
 * Answers a request to name addresses: a name, or none, for each address, in the order asked; or why
 * the request could not be answered.
 */
export type HostNamesAnswer =
  | { readonly kind: 'resolved'; readonly names: readonly HostName[] }
  | { readonly kind: 'failed'; readonly message: string };

/**
 * Writes an IP address the one way both sides key names by: without an IPv6 zone, IPv6 lower-case and
 * compressed (RFC 5952), and an IPv4 address mapped into IPv6 as the IPv4 address it is. A connection
 * listing and a packet may write the same address differently; this makes them meet.
 * @param address The address, possibly with an IPv6 zone.
 * @returns Returns the address's canonical text, or the address unchanged when it is not IPv6.
 */
export function canonicalAddress(address: string): string {
  const host: string = address.split('%')[0].trim().toLowerCase();
  if (!host.includes(':')) {
    return host;
  }
  let canonical: string;
  try {
    // The URL parser writes an IPv6 host in its canonical, compressed form.
    canonical = new URL(`http://[${host}]/`).hostname.slice(1, -1);
  } catch {
    return host;
  }
  const mapped: RegExpExecArray | null = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(canonical);
  if (mapped === null) {
    return canonical;
  }
  const high: number = parseInt(mapped[1], 16);
  const low: number = parseInt(mapped[2], 16);
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
}
