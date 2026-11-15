import { isIP } from 'node:net';

/**
 * Describes how to run one of the operating system's network tools.
 */
export interface NetworkToolCommand {
  /**
   * Gets the executable.
   */
  readonly command: string;

  /**
   * Gets its arguments.
   */
  readonly args: readonly string[];
}

/**
 * Matches a DNS host name: dot-separated labels of letters, digits and inner hyphens, optionally
 * fully qualified with a trailing dot.
 */
const HOST_NAME: RegExp =
  /^(?=.{1,253}\.?$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.?$/;

/**
 * Matches an IPv6 zone, the interface a link-local address is scoped to: `%en0`.
 */
const ZONE: RegExp = /^[A-Za-z0-9_.-]{1,32}$/;

/**
 * Gets whether a host is safe to hand to `ping` or `traceroute` as their last argument: an IPv4 or
 * IPv6 address (with a zone, for a link-local one), or a host name. Anything else — above all, a
 * value starting with `-`, which the tool would read as an option — is refused.
 * @param host The host.
 * @returns Returns true when the host may be run against.
 */
export function isValidHost(host: string): boolean {
  if (host.length === 0 || host.length > 253 || host.startsWith('-')) {
    return false;
  }
  const percent: number = host.indexOf('%');
  if (percent >= 0) {
    return isIP(host.slice(0, percent)) === 6 && ZONE.test(host.slice(percent + 1));
  }
  return isIP(host) !== 0 || HOST_NAME.test(host);
}

/**
 * Gets whether a host is an IPv6 address, which macOS pings and traces with tools of their own.
 * @param host The host.
 * @returns Returns true for an IPv6 address.
 */
function isIpv6(host: string): boolean {
  const percent: number = host.indexOf('%');
  return isIP(percent >= 0 ? host.slice(0, percent) : host) === 6;
}

/**
 * Builds the command that pings a host. macOS and Linux only for now: Windows' `ping` and `tracert`
 * print differently enough to need readers of their own.
 * @param host The host, already validated.
 * @param count How many echo requests to send.
 * @param platform The operating system.
 * @returns Returns the command, or undefined where it is not supported.
 */
export function pingCommand(
  host: string,
  count: number,
  platform: NodeJS.Platform,
): NetworkToolCommand | undefined {
  const args: readonly string[] = ['-c', String(count), host];
  if (platform === 'darwin') {
    return { command: isIpv6(host) ? '/sbin/ping6' : '/sbin/ping', args };
  }
  if (platform === 'linux') {
    return { command: 'ping', args: isIpv6(host) ? ['-6', ...args] : args };
  }
  return undefined;
}

/**
 * Builds the command that traces the route to a host: numeric output (no reverse lookups, which are
 * slow and done better separately), three probes a hop, waiting two seconds for each.
 * @param host The host, already validated.
 * @param maxHops The most hops to probe.
 * @param platform The operating system.
 * @returns Returns the command, or undefined where it is not supported.
 */
export function traceCommand(
  host: string,
  maxHops: number,
  platform: NodeJS.Platform,
): NetworkToolCommand | undefined {
  const args: readonly string[] = ['-n', '-q', '3', '-w', '2', '-m', String(maxHops), host];
  if (platform === 'darwin') {
    return { command: isIpv6(host) ? '/usr/sbin/traceroute6' : '/usr/sbin/traceroute', args };
  }
  if (platform === 'linux') {
    return { command: 'traceroute', args: isIpv6(host) ? ['-6', ...args] : args };
  }
  return undefined;
}
