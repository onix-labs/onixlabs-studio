import { TraceHop } from '@shared/api/network-tools-channels';
import {
  parsePingAddress,
  parsePingLine,
  parsePingTransmitted,
  parseTraceAddress,
  TraceOutputReader,
} from './network-tool-output';

/**
 * A trace to 1.1.1.1 as macOS `traceroute -n -q 3` printed it, load-balanced hops included.
 */
const TRACE: string = [
  'traceroute to 1.1.1.1 (1.1.1.1), 8 hops max, 40 byte packets',
  ' 1  192.168.1.1  4.884 ms  4.851 ms  4.920 ms',
  ' 2  * * *',
  ' 5  141.101.71.174  15.617 ms  17.027 ms',
  '    141.101.71.175  15.719 ms',
  ' 6  141.101.71.215  12.634 ms',
  '    141.101.71.205  19.519 ms',
  '    141.101.71.223  13.771 ms',
  ' 7  1.1.1.1  12.195 ms !H  *  18.708 ms',
  '10  10.0.0.1  1.000 ms',
].join('\n');

/**
 * Reads a whole trace, keeping each hop as it last stood.
 * @param text The output.
 * @returns Returns the hops by number.
 */
function readTrace(text: string): ReadonlyMap<number, TraceHop> {
  const reader: TraceOutputReader = new TraceOutputReader();
  const hops: Map<number, TraceHop> = new Map<number, TraceHop>();
  for (const line of text.split('\n')) {
    const hop: TraceHop | undefined = reader.accept(line);
    if (hop !== undefined) {
      hops.set(hop.index, hop);
    }
  }
  return hops;
}

describe('network tool output', () => {
  it('parsePingLine_readsAnIpv4Reply', () => {
    expect(parsePingLine('64 bytes from 1.1.1.1: icmp_seq=0 ttl=57 time=13.979 ms')).toEqual({
      sequence: 0,
      address: '1.1.1.1',
      ttl: 57,
      rttMs: 13.979,
    });
  });

  it('parsePingLine_readsAnIpv6Reply', () => {
    expect(parsePingLine('16 bytes from ::1, icmp_seq=1 hlim=64 time=0.095 ms')).toEqual({
      sequence: 1,
      address: '::1',
      ttl: 64,
      rttMs: 0.095,
    });
  });

  it('parsePingLine_readsLinuxReplies_namedAndIpv6', () => {
    expect(
      parsePingLine('64 bytes from one.one.one.one (1.1.1.1): icmp_seq=1 ttl=57 time=13.9 ms')
        ?.address,
    ).toBe('1.1.1.1');
    expect(
      parsePingLine('64 bytes from 2001:db8::1: icmp_seq=1 ttl=57 time=13.9 ms')?.address,
    ).toBe('2001:db8::1');
  });

  it('parsePingLine_readsATimeout', () => {
    expect(parsePingLine('Request timeout for icmp_seq 3')).toEqual({ sequence: 3 });
  });

  it('parsePingLine_ignoresEverythingElse', () => {
    expect(parsePingLine('--- 1.1.1.1 ping statistics ---')).toBeUndefined();
    expect(parsePingLine('round-trip min/avg/max/stddev = 1/2/3/4 ms')).toBeUndefined();
  });

  it('parsePingAddress_readsEachHeader', () => {
    expect(parsePingAddress('PING one.one.one.one (1.1.1.1): 56 data bytes')).toBe('1.1.1.1');
    expect(parsePingAddress('PING6(56=40+8+8 bytes) ::1 --> ::1')).toBe('::1');
    expect(parsePingAddress('64 bytes from 1.1.1.1: icmp_seq=0 ttl=57 time=1 ms')).toBeUndefined();
  });

  it('parsePingTransmitted_readsBothStatisticsLines', () => {
    expect(
      parsePingTransmitted('10 packets transmitted, 0 packets received, 100.0% packet loss'),
    ).toBe(10);
    expect(
      parsePingTransmitted('3 packets transmitted, 3 received, 0% packet loss, time 2003ms'),
    ).toBe(3);
    expect(parsePingTransmitted('--- 1.1.1.1 ping statistics ---')).toBeUndefined();
  });

  it('parseTraceAddress_readsTheHeader', () => {
    expect(parseTraceAddress(TRACE.split('\n')[0])).toBe('1.1.1.1');
    expect(parseTraceAddress(' 1  192.168.1.1  4.884 ms')).toBeUndefined();
  });

  it('reader_readsAHopOfThreeAnswers', () => {
    expect(readTrace(TRACE).get(1)?.probes).toEqual([
      { address: '192.168.1.1', rttMs: 4.884 },
      { address: '192.168.1.1', rttMs: 4.851 },
      { address: '192.168.1.1', rttMs: 4.92 },
    ]);
  });

  it('reader_readsAHopNothingAnswered', () => {
    expect(readTrace(TRACE).get(2)?.probes).toEqual([{}, {}, {}]);
  });

  it('reader_gathersALoadBalancedHop_acrossItsLines', () => {
    const hops: ReadonlyMap<number, TraceHop> = readTrace(TRACE);

    expect(hops.get(5)?.probes.map((probe) => probe.address)).toEqual([
      '141.101.71.174',
      '141.101.71.174',
      '141.101.71.175',
    ]);
    expect(hops.get(6)?.probes.map((probe) => probe.address)).toEqual([
      '141.101.71.215',
      '141.101.71.205',
      '141.101.71.223',
    ]);
  });

  it('reader_keepsAnnotationsAndTimeouts_inOrder', () => {
    expect(readTrace(TRACE).get(7)?.probes).toEqual([
      { address: '1.1.1.1', rttMs: 12.195, note: '!H' },
      {},
      { address: '1.1.1.1', rttMs: 18.708 },
    ]);
  });

  it('reader_readsTwoDigitHops', () => {
    expect(readTrace(TRACE).get(10)?.probes).toEqual([{ address: '10.0.0.1', rttMs: 1 }]);
  });
});
