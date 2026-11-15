import { PingReply, TraceHop, TraceProbe } from '@shared/api/network-tools-channels';

/**
 * Matches a reply line of BSD and iputils `ping` and of macOS `ping6`:
 * `64 bytes from 1.1.1.1: icmp_seq=0 ttl=57 time=13.979 ms`, or
 * `16 bytes from ::1, icmp_seq=0 hlim=64 time=0.083 ms`, or iputils naming the host first:
 * `64 bytes from one.one.one.one (1.1.1.1): icmp_seq=1 ttl=57 time=13.9 ms`. The address is matched
 * lazily up to the `:` or `,` that a space follows, since an IPv6 address is full of colons.
 */
const PING_REPLY: RegExp =
  /bytes from (?:\S+ \()?([^\s,()]+?)\)?[:,]\s+icmp_seq=(\d+)\s+(?:ttl|hlim)=(\d+)\s+time=([\d.]+)\s*ms/;

/**
 * Matches the line BSD `ping` prints for a request that went unanswered:
 * `Request timeout for icmp_seq 1`.
 */
const PING_TIMEOUT: RegExp = /^Request timeout for icmp_seq[= ](\d+)/;

/**
 * Matches the first line of `ping` and `ping6`, which names the address the host resolved to:
 * `PING 1.1.1.1 (1.1.1.1): 56 data bytes`, `PING example.com (93.184.215.14) 56(84) bytes of data.`,
 * or `PING6(56=40+8+8 bytes) ::1 --> ::1`.
 */
const PING_HEADER: RegExp = /^PING\s+\S+\s+\(([^)]+)\)|^PING6\([^)]*\)\s+\S+\s+-->\s+(\S+)/;

/**
 * Matches the statistics line `ping` closes with, BSD's and iputils':
 * `3 packets transmitted, 3 packets received, 0.0% packet loss`, or
 * `3 packets transmitted, 3 received, 0% packet loss, time 2003ms`.
 */
const PING_STATISTICS: RegExp = /^(\d+) packets transmitted, (\d+) (?:packets )?received/;

/**
 * Matches the first line of `traceroute` and `traceroute6`, which names the address the host
 * resolved to: `traceroute to 1.1.1.1 (1.1.1.1), 8 hops max, 40 byte packets`.
 */
const TRACE_HEADER: RegExp = /^traceroute6? to \S+ \(([^)]+)\)/;

/**
 * Matches a line that starts a hop: its number, then its probes.
 */
const TRACE_HOP: RegExp = /^\s*(\d+)\s+(.*)$/;

/**
 * Reads one line of `ping` output.
 * @param line The line.
 * @returns Returns the reply or timeout it reports, or undefined for any other line.
 */
export function parsePingLine(line: string): PingReply | undefined {
  const reply: RegExpExecArray | null = PING_REPLY.exec(line);
  if (reply !== null) {
    return {
      sequence: Number(reply[2]),
      address: reply[1],
      ttl: Number(reply[3]),
      rttMs: Number(reply[4]),
    };
  }
  const timeout: RegExpExecArray | null = PING_TIMEOUT.exec(line.trim());
  return timeout === null ? undefined : { sequence: Number(timeout[1]) };
}

/**
 * Reads the address a host resolved to from the first line of `ping` output.
 * @param line The line.
 * @returns Returns the address, or undefined when the line is not the header.
 */
export function parsePingAddress(line: string): string | undefined {
  const header: RegExpExecArray | null = PING_HEADER.exec(line.trim());
  return header === null ? undefined : (header[1] ?? header[2]);
}

/**
 * Reads how many echo requests were sent from the statistics line `ping` closes with.
 * @param line The line.
 * @returns Returns the count, or undefined when the line is not the statistics.
 */
export function parsePingTransmitted(line: string): number | undefined {
  const statistics: RegExpExecArray | null = PING_STATISTICS.exec(line.trim());
  return statistics === null ? undefined : Number(statistics[1]);
}

/**
 * Reads the address a host resolved to from the first line of `traceroute` output.
 * @param line The line.
 * @returns Returns the address, or undefined when the line is not the header.
 */
export function parseTraceAddress(line: string): string | undefined {
  return TRACE_HEADER.exec(line.trim())?.[1];
}

/**
 * Reads the probes on one line of `traceroute -n` output, after the hop number if it has one. An
 * address applies to the times after it until the next address; a `*` is a probe nothing answered;
 * a `!X` annotates the probe before it.
 * @param text The line's probes.
 * @returns Returns the probes.
 */
function parseProbes(text: string): TraceProbe[] {
  const probes: TraceProbe[] = [];
  const tokens: readonly string[] = text.trim().split(/\s+/).filter(Boolean);
  let address: string | undefined;
  for (let index: number = 0; index < tokens.length; index += 1) {
    const token: string = tokens[index];
    if (token === '*') {
      probes.push({});
    } else if (token.startsWith('!')) {
      const last: TraceProbe | undefined = probes.pop();
      if (last !== undefined) {
        probes.push({ ...last, note: token });
      }
    } else if (/^[\d.]+$/.test(token) && tokens[index + 1] === 'ms') {
      probes.push({ ...(address === undefined ? {} : { address }), rttMs: Number(token) });
      index += 1;
    } else if (token !== 'ms') {
      address = token;
    }
  }
  return probes;
}

/**
 * Reads `traceroute -n` output a line at a time into hops. A hop's probes may span lines — the
 * continuation lines of a load-balanced hop carry no number — so each line yields the hop it added
 * to, as it now stands.
 */
export class TraceOutputReader {
  /**
   * Holds the hop the latest lines belonged to, or undefined before the first.
   */
  private current: TraceHop | undefined;

  /**
   * Reads one line.
   * @param line The line.
   * @returns Returns the hop the line added to, or undefined when it added to none.
   */
  public accept(line: string): TraceHop | undefined {
    if (line.trim().length === 0 || parseTraceAddress(line) !== undefined) {
      return undefined;
    }
    const start: RegExpExecArray | null = TRACE_HOP.exec(line);
    if (start !== null && /^\s{0,3}\d/.test(line)) {
      this.current = { index: Number(start[1]), probes: parseProbes(start[2]) };
      return this.current;
    }
    if (this.current === undefined) {
      return undefined;
    }
    this.current = {
      index: this.current.index,
      probes: [...this.current.probes, ...parseProbes(line)],
    };
    return this.current;
  }
}
