import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  NetworkInfo,
  NetworkInterfaceReading,
  NetworkReading,
} from '@shared/api/system-monitor-channels';
import { SystemMonitorMetrics } from '../../metrics/system-monitor-metrics';
import { SystemMonitorNetwork } from '../../readings/system-monitor-network';
import { SystemMonitorReadings } from '../../readings/system-monitor-readings';
import { NetworkTab } from './network-tab';

/**
 * Wi-Fi (the default), the loopback, and an Ethernet port that is down.
 */
const INFO: NetworkInfo = {
  interfaces: [
    {
      id: 'en2',
      name: 'Wi-Fi',
      kind: 'wifi',
      up: true,
      isDefault: true,
      mac: 'f8:ff:c2:1a:48:35',
      ipv4: '192.168.1.43',
      speedMbps: 10_000,
      mtu: 1500,
    },
    { id: 'lo0', name: 'lo0', kind: 'loopback', up: true, isDefault: false, ipv4: '127.0.0.1' },
    { id: 'en0', name: 'Ethernet 1', kind: 'ethernet', up: false, isDefault: false },
  ],
  dnsServers: ['192.168.1.1', '1.1.1.1'],
  gateway: '192.168.1.1',
};

/**
 * Builds an interface's reading.
 * @param id The interface.
 * @param rx The bytes received per second.
 * @returns Returns the reading.
 */
function reading(id: string, rx: number): NetworkInterfaceReading {
  return {
    id,
    rxBytesPerSecond: rx,
    txBytesPerSecond: rx / 2,
    rxPacketsPerSecond: 10,
    txPacketsPerSecond: 5,
    totalRxBytes: rx * 1000,
    totalTxBytes: rx * 500,
    totalRxPackets: 1_203_450,
    totalTxPackets: 2_615_981,
    rxErrors: 0,
    txErrors: 1,
    dropped: 2,
  };
}

/**
 * A reading in which Wi-Fi downloads 1 MB/s and the loopback 1 GB/s, with two connections.
 */
const READING: NetworkReading = {
  timestamp: 't',
  interfaces: [reading('en2', 1024 ** 2), reading('lo0', 1024 ** 3), reading('en0', 0)],
  connections: [
    {
      protocol: 'TCP',
      local: '192.168.1.43:52138',
      remote: '142.250.186.142:443',
      state: 'ESTABLISHED',
      pid: 21438,
      process: 'Arc',
      location: '/Applications/Arc.app/Contents/MacOS',
    },
    { protocol: 'UDP', local: '0.0.0.0:5353', remote: '', state: '', process: 'mDNSResponder' },
  ],
  dnsLatencyMs: 12,
};

describe('NetworkTab', () => {
  let fixture: ComponentFixture<NetworkTab>;
  let host: HTMLElement;
  let network: SystemMonitorNetwork;

  /**
   * Settles the fixture after a change.
   */
  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NetworkTab],
      providers: [
        SystemMonitorReadings,
        SystemMonitorNetwork,
        {
          provide: SystemMonitorMetrics,
          useValue: { processIcon: (): Promise<null> => Promise.resolve(null) },
        },
      ],
    }).compileComponents();
    network = TestBed.inject(SystemMonitorNetwork);
    fixture = TestBed.createComponent(NetworkTab);
    host = fixture.nativeElement as HTMLElement;
    await settle();
  });

  afterEach(() => {
    globalThis.localStorage?.clear();
  });

  it('saysItIsReadingTheInterfaces_untilTheyAreRead', () => {
    expect(host.textContent).toContain('Reading the interfaces…');
    expect(host.textContent).toContain('Listing connections…');
  });

  it('summarisesTheTraffic_leavingOutTheLoopback', async () => {
    network.setInfo(INFO);
    network.accept(READING);
    await settle();

    const summary: string = host.querySelector('[aria-label="Summary"]')?.textContent ?? '';
    expect(host.textContent).toContain('3 interfaces • 1 active');
    expect(summary).toContain('1.0 MB/s');
    expect(summary).toContain('512.0 KB/s');
    expect(summary).toContain('12 ms');
    expect(summary).toContain('Connections2');
  });

  it('describesTheDefaultInterface_untilAnotherIsChosen', async () => {
    network.setInfo(INFO);
    network.accept(READING);
    await settle();

    const details: string =
      host.querySelector('[data-testid="network-interface"]')?.textContent ?? '';
    expect(details).toContain('Wi-Fi');
    expect(details).toContain('192.168.1.43');
    expect(details).toContain('10 Gbit/s');
    expect(details).toContain('192.168.1.1, 1.1.1.1');
    expect(host.querySelector('[data-testid="network-interfaces"]')?.textContent).toContain(
      '(Active)',
    );

    host.querySelectorAll<HTMLButtonElement>('[role="radio"]')[2].click();
    await settle();

    expect(host.querySelector('[data-testid="network-interface"]')?.textContent).toContain('Down');
    expect(host.textContent).toContain('Network Statistics — en0');
  });

  it('listsTheConnections_withTheirStates', async () => {
    network.setInfo(INFO);
    network.accept(READING);
    await settle();

    const rows: NodeListOf<HTMLTableRowElement> = host.querySelectorAll(
      '[data-testid="network-connections"] tbody tr',
    );
    expect(host.textContent).toContain('Active Connections (2)');
    expect(rows[0].textContent).toContain('Arc');
    expect(rows[0].textContent).toContain('ESTABLISHED');
    expect(rows[1].textContent).toContain('mDNSResponder');
  });
});
