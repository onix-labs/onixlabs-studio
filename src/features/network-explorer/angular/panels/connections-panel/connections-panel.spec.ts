import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Icon } from '@shared/angular/icons/icon';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { NetworkActivity } from '../../network-activity/network-activity';
import {
  activity,
  sampleConnections,
  sampleNetwork,
} from '../../network-activity/network-samples.testing';
import { NetworkNames } from '../../network-names/network-names';
import { FakeNetworkNames } from '../../network-names/network-names.fake';
import { NetworkRuns } from '../../network-runs/network-runs';
import { NetworkCaptures } from '../../network-captures/network-captures';
import { NetworkProbe } from '../../network-probe/network-probe';
import { FakeNetworkProbe } from '../../network-probe/network-probe.fake';
import { ConnectionsPanel } from './connections-panel';

/**
 * A stand-in for the tab's runs that records what it is asked to run.
 */
class RecordingRuns {
  /**
   * Gets what was asked, in order.
   */
  public readonly calls: string[] = [];

  /**
   * Records a ping.
   * @param host The host.
   * @returns Returns a run id.
   */
  public ping(host: string): string {
    this.calls.push(`ping ${host}`);
    return 'ping';
  }

  /**
   * Records a trace.
   * @param host The host.
   * @returns Returns a run id.
   */
  public trace(host: string): string {
    this.calls.push(`trace ${host}`);
    return 'trace';
  }
}

/**
 * A stand-in for the tab's captures that records what it is asked to watch.
 */
class RecordingCaptures {
  /**
   * Gets what was asked, in order.
   */
  public readonly watched: string[] = [];

  /**
   * Records watching an interface.
   * @param interfaceId The interface's id.
   * @param name Its name.
   * @returns Returns a capture id.
   */
  public watchInterface(interfaceId: string, name: string): string {
    this.watched.push(`interface ${interfaceId} ${name}`);
    return 'capture';
  }

  /**
   * Records watching a connection.
   * @param interfaceId The interface's id.
   * @param host The remote host.
   * @param port The remote port.
   * @returns Returns a capture id.
   */
  public watchConnection(interfaceId: string, host: string, port: number): string {
    this.watched.push(`connection ${interfaceId} ${host} ${String(port)}`);
    return 'capture';
  }
}

describe('ConnectionsPanel', () => {
  let watching: RecordingCaptures;
  let runs: RecordingRuns;
  let fixture: ComponentFixture<ConnectionsPanel>;
  let host: HTMLElement;
  let probe: FakeNetworkProbe;
  let store: NetworkActivity;
  let names: FakeNetworkNames;

  beforeEach(async () => {
    probe = new FakeNetworkProbe();
    names = new FakeNetworkNames();
    watching = new RecordingCaptures();
    probe.network = sampleNetwork;
    runs = new RecordingRuns();
    await TestBed.configureTestingModule({
      imports: [ConnectionsPanel],
      providers: [
        NetworkActivity,
        { provide: NetworkProbe, useValue: probe },
        { provide: NetworkCaptures, useValue: watching },
        { provide: NetworkRuns, useValue: runs },
        { provide: NetworkNames, useValue: names },
      ],
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
   * Gets the text of the connections listed, one entry per connection.
   * @returns Returns each connection's row text.
   */
  function rows(): readonly string[] {
    return Array.from(
      host.querySelectorAll<HTMLElement>(
        '[data-testid="connections"] [data-testid="connection-process"]',
      ),
    ).map((cell: HTMLElement): string =>
      (cell.closest('tr')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    );
  }

  /**
   * Gets the text the list shows.
   * @returns Returns it, whitespace collapsed.
   */
  function listText(): string {
    return (host.querySelector('[data-testid="connections"]')?.textContent ?? '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  it('saysItIsListing_beforeTheConnectionsArrive', () => {
    expect(listText()).toContain('Listing connections');
    expect(rows()).toEqual([]);
  });

  it('headsTheColumns', async () => {
    await load();

    const headers: readonly string[] = Array.from(
      host.querySelectorAll<HTMLElement>('[data-testid="connections"] th'),
    ).map((cell: HTMLElement): string => cell.textContent.trim());
    expect(headers).toEqual([
      'Process',
      'Host',
      'Remote Address',
      'Local Address',
      'Protocol',
      'State',
      '',
    ]);
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

    expect(rows()).toEqual([]);
    expect(listText()).toContain('No connections.');
  });

  it('showsTheRemoteHostsName_orAQuietDashUntilOneIsKnown', async () => {
    await load();
    const cell: () => HTMLElement | null = (): HTMLElement | null =>
      host.querySelector<HTMLElement>('[data-testid="connection-host"]');
    expect(cell()?.textContent.trim()).toBe('—');

    names.name('140.82.112.3', 'api.github.com');
    await fixture.whenStable();

    expect(cell()?.textContent.trim()).toBe('api.github.com');
    expect(cell()?.title).toBe('api.github.com');
  });

  it('theFilter_findsConnectionsByHostName', async () => {
    await load();
    names.name('140.82.112.3', 'api.github.com');

    store.connectionQuery.set('github');
    await fixture.whenStable();

    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toContain('Safari');
  });

  it('eachConnection_pingsOrTracesItsRemotePeer', async () => {
    await load();

    host.querySelector<HTMLButtonElement>('button[aria-label="Ping 140.82.112.3"]')!.click();
    host
      .querySelector<HTMLButtonElement>('button[aria-label="Trace Route to 140.82.112.3"]')!
      .click();

    expect(runs.calls).toEqual(['ping 140.82.112.3', 'trace 140.82.112.3']);
  });

  it('watch_capturesTheConnection_onTheInterfaceItIsMadeOver', async () => {
    await load();

    host.querySelector<HTMLButtonElement>('button[aria-label="Watch 140.82.112.3:443"]')!.click();

    expect(watching.watched).toEqual(['connection en0 140.82.112.3 443']);
  });
});
