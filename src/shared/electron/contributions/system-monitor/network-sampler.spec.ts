import { describe, expect, it } from 'vitest';
import { NetworkInterfaceReading } from '@shared/api/system-monitor-channels';
import { NetworkSampler } from './network-sampler';
import { FakeMachine, fakeMachine } from './sampler-test-sources';

/**
 * Builds macOS's interface counters for Wi-Fi.
 * @param rxBytes The bytes received so far.
 * @returns Returns the `netstat -ibnd` output.
 */
function netstat(rxBytes: number): string {
  return [
    'Name  Mtu   Network       Address            Ipkts Ierrs     Ibytes    Opkts Oerrs     Obytes  Coll Drop',
    `en2   1500  <Link#9>    f8:ff:c2:1a:48:35    100     0   ${rxBytes}    50     0   500     0   0`,
  ].join('\n');
}

describe('NetworkSampler', () => {
  it('readsNoActivityAtFirst_thenTheRatesSinceTheLastReading', async () => {
    const machine: FakeMachine = fakeMachine('darwin', { netstat: [netstat(1000), netstat(3000)] });
    const sampler: NetworkSampler = new NetworkSampler(machine.sources);

    const first: readonly NetworkInterfaceReading[] = await sampler.read();
    machine.advance(2000);
    const second: readonly NetworkInterfaceReading[] = await sampler.read();

    expect(first[0]).toMatchObject({ id: 'en2', rxBytesPerSecond: 0, totalRxBytes: 1000 });
    expect(second[0]).toMatchObject({ rxBytesPerSecond: 1000, totalRxBytes: 3000 });
  });

  it('keepsItsLastCounters_throughAReadingThatFails', async () => {
    const machine: FakeMachine = fakeMachine('darwin', { netstat: [netstat(1000)] });
    const sampler: NetworkSampler = new NetworkSampler(machine.sources);
    await sampler.read();
    machine.advance(2000);

    expect(await sampler.read()).toEqual([]);
  });

  it('readsLinuxInterfaces', async () => {
    const machine: FakeMachine = fakeMachine(
      'linux',
      {},
      { '/proc/net/dev': '  eth0: 1000 10 0 0 0 0 0 0 2000 20 0 0 0 0 0 0' },
    );

    const readings: readonly NetworkInterfaceReading[] = await new NetworkSampler(
      machine.sources,
    ).read();

    expect(readings[0]).toMatchObject({ id: 'eth0', totalRxBytes: 1000, totalTxPackets: 20 });
  });
});
