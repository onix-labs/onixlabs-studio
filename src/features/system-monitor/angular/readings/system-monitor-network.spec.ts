import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { NetworkInterfaceReading, NetworkReading } from '@shared/api/system-monitor-channels';
import { SystemMonitorNetwork } from './system-monitor-network';

/**
 * Builds an interface's reading.
 * @param id The interface.
 * @param rx The bytes received per second.
 * @returns Returns the reading.
 */
function item(id: string, rx: number): NetworkInterfaceReading {
  return {
    id,
    rxBytesPerSecond: rx,
    txBytesPerSecond: 0,
    rxPacketsPerSecond: 0,
    txPacketsPerSecond: 0,
    totalRxBytes: 0,
    totalTxBytes: 0,
    totalRxPackets: 0,
    totalTxPackets: 0,
    rxErrors: 0,
    txErrors: 0,
    dropped: 0,
  };
}

describe('SystemMonitorNetwork', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    globalThis.localStorage?.clear();
  });

  /**
   * Creates the service, knowing a Wi-Fi interface and the loopback.
   * @returns Returns it.
   */
  function create(): SystemMonitorNetwork {
    TestBed.configureTestingModule({ providers: [SystemMonitorNetwork] });
    const network: SystemMonitorNetwork = TestBed.inject(SystemMonitorNetwork);
    network.setInfo({
      interfaces: [
        { id: 'en2', name: 'Wi-Fi', kind: 'wifi', up: true, isDefault: true },
        { id: 'lo0', name: 'lo0', kind: 'loopback', up: true, isDefault: false },
      ],
      dnsServers: [],
    });
    return network;
  }

  it('leavesTheLoopbackOutOfTheTotals', () => {
    const network: SystemMonitorNetwork = create();
    network.accept({ timestamp: 't', interfaces: [item('en2', 10), item('lo0', 1000)] });

    expect(network.totals().rxBytesPerSecond).toBe(10);
  });

  it('keepsTheLastConnectionsAndLatency_throughReadingsWithout', () => {
    const network: SystemMonitorNetwork = create();
    const first: NetworkReading = {
      timestamp: 't',
      interfaces: [item('en2', 0)],
      connections: [{ protocol: 'TCP', local: 'a', remote: 'b', state: 'ESTABLISHED' }],
      dnsLatencyMs: 9,
    };
    network.accept(first);
    network.accept({ timestamp: 't', interfaces: [item('en2', 0)] });

    expect(network.connections()).toHaveLength(1);
    expect(network.dnsLatencyMs()).toBe(9);
  });

  it('describesTheDefault_untilAnotherIsChosen_andKeepsItsHistory', () => {
    const network: SystemMonitorNetwork = create();
    network.accept({ timestamp: 't', interfaces: [item('en2', 1), item('lo0', 5)] });
    network.accept({ timestamp: 't', interfaces: [item('en2', 2), item('lo0', 6)] });

    expect(network.selected()?.id).toBe('en2');
    network.select('lo0');

    expect(
      network
        .selectedHistory()
        .map((reading: NetworkInterfaceReading): number => reading.rxBytesPerSecond),
    ).toEqual([5, 6]);
  });
});
