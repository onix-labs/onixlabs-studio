import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Icon } from '@shared/angular/icons/icon';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { NetworkActivity } from '../../network-activity/network-activity';
import {
  activity,
  sampleConnections,
  sampleNetwork,
} from '../../network-activity/network-samples.testing';
import { NetworkProbe } from '../../network-probe/network-probe';
import { FakeNetworkProbe } from '../../network-probe/network-probe.fake';
import { ConnectionsPanel } from './connections-panel';

describe('ConnectionsPanel', () => {
  let fixture: ComponentFixture<ConnectionsPanel>;
  let host: HTMLElement;
  let probe: FakeNetworkProbe;
  let store: NetworkActivity;

  beforeEach(async () => {
    probe = new FakeNetworkProbe();
    probe.network = sampleNetwork;
    await TestBed.configureTestingModule({
      imports: [ConnectionsPanel],
      providers: [NetworkActivity, { provide: NetworkProbe, useValue: probe }],
    }).compileComponents();

    store = TestBed.inject(NetworkActivity);
    fixture = TestBed.createComponent(ConnectionsPanel);
    fixture.componentRef.setInput('panel', {
      id: 'connections',
      title: 'Connections',
      icon: Icon.NETWORK_CONNECTIONS,
      role: 'tool',
      component: ConnectionsPanel,
    } satisfies DockPanel);
    host = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  });

  /**
   * Reads the network into the store, as an open view would.
   */
  async function load(): Promise<void> {
    store.open();
    await store.refresh();
    probe.push({ timestamp: '', interfaces: [activity('en0', 0)], connections: sampleConnections });
    await fixture.whenStable();
  }

  /**
   * Gets the text of the table's body rows.
   * @returns Returns each row's text.
   */
  function rows(): readonly string[] {
    return Array.from(host.querySelectorAll<HTMLElement>('[data-testid="connections"] tbody tr')).map(
      (row: HTMLElement): string => row.textContent.replace(/\s+/g, ' ').trim(),
    );
  }

  it('saysItIsListing_beforeTheConnectionsArrive', () => {
    expect(host.textContent).toContain('Listing connections');
  });

  it('listsRemoteConnections_withTheirProcessEndsAndState', async () => {
    await load();

    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toContain('Safari');
    expect(rows()[0]).toContain('140.82.112.3:443');
    expect(rows()[0]).toContain('ESTABLISHED');
    expect(host.querySelector('[data-testid="connections-summary"]')?.textContent).toBe(
      '1 connection',
    );
  });

  it('summarisesTheSelectedInterface_andOffersAllInterfacesBack', async () => {
    await load();

    store.select('lo0');
    await fixture.whenStable();

    expect(host.querySelector('[data-testid="connections-summary"]')?.textContent).toBe(
      '1 connection over Loopback (lo0)',
    );
    expect(rows()[0]).toContain('node');
    expect(host.textContent).toContain('All Interfaces');
  });

  it('saysSoWhenNothingMatches', async () => {
    await load();

    store.connectionQuery.set('nothing-like-it');
    await fixture.whenStable();

    expect(rows()).toEqual(['No connections.']);
  });
});
