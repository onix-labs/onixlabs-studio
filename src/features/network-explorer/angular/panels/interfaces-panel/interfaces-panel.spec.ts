import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Icon } from '@shared/angular/icons/icon';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { NetworkActivity } from '../../network-activity/network-activity';
import {
  activity,
  sampleConnections,
  sampleNetwork,
} from '../../network-activity/network-samples.testing';
import { NetworkCaptures } from '../../network-captures/network-captures';
import { NetworkProbe } from '../../network-probe/network-probe';
import { FakeNetworkProbe } from '../../network-probe/network-probe.fake';
import { InterfacesPanel } from './interfaces-panel';

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

describe('InterfacesPanel', () => {
  let watching: RecordingCaptures;
  let fixture: ComponentFixture<InterfacesPanel>;
  let host: HTMLElement;
  let probe: FakeNetworkProbe;
  let store: NetworkActivity;

  beforeEach(async () => {
    probe = new FakeNetworkProbe();
    watching = new RecordingCaptures();
    probe.network = sampleNetwork;
    await TestBed.configureTestingModule({
      imports: [InterfacesPanel],
      providers: [
        NetworkActivity,
        { provide: NetworkProbe, useValue: probe },
        { provide: NetworkCaptures, useValue: watching },
      ],
    }).compileComponents();

    store = TestBed.inject(NetworkActivity);
    fixture = TestBed.createComponent(InterfacesPanel);
    fixture.componentRef.setInput('panel', {
      id: 'interfaces',
      title: 'Interfaces',
      icon: Icon.NETWORK_INTERFACES,
      role: 'tool',
      component: InterfacesPanel,
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
    probe.push({
      timestamp: '',
      interfaces: [activity('en0', 2048)],
      connections: sampleConnections,
    });
    await fixture.whenStable();
  }

  /**
   * Gets the listed interfaces' ids, in order.
   * @returns Returns the ids.
   */
  function listedIds(): readonly string[] {
    return Array.from(host.querySelectorAll<HTMLElement>('[data-testid^="interface-"]')).map(
      (row: HTMLElement): string => (row.dataset['testid'] ?? '').replace('interface-', ''),
    );
  }

  it('saysItIsReading_beforeTheInterfacesArrive', () => {
    expect(host.textContent).toContain('Reading the network interfaces');
  });

  it('listsTheInterfacesInUse_defaultFirst_withTheirActivity', async () => {
    await load();

    expect(listedIds()).toEqual(['en0', 'lo0']);
    const wifi: HTMLElement = host.querySelector<HTMLElement>('[data-testid="interface-en0"]')!;
    expect(wifi.textContent).toContain('Wi-Fi');
    expect(wifi.textContent).toContain('192.168.1.20');
    expect(wifi.textContent).toContain('2.0 KB/s');
    expect(wifi.textContent).toContain('1 connection');
  });

  it('namesAnInterfaceOnce_whenItsNameIsItsDevice', async () => {
    probe.network = {
      ...sampleNetwork,
      interfaces: [{ ...sampleNetwork.interfaces[1], name: 'en0' }],
    };
    await load();

    const row: HTMLElement = host.querySelector<HTMLElement>('[data-testid="interface-en0"]')!;
    expect(row.querySelector('.interfaces__id')).toBeNull();
  });

  it('choosingAnInterface_selectsIt_andChoosingItAgainClears', async () => {
    await load();
    const wifi: HTMLButtonElement = host.querySelector<HTMLButtonElement>(
      '[data-testid="interface-en0"]',
    )!;

    wifi.click();
    await fixture.whenStable();
    expect(store.selectedInterfaceId()).toBe('en0');
    expect(wifi.getAttribute('aria-pressed')).toBe('true');

    wifi.click();
    await fixture.whenStable();
    expect(store.selectedInterfaceId()).toBeNull();
  });

  it('watch_capturesTheInterface', async () => {
    await load();

    host.querySelector<HTMLButtonElement>('button[aria-label="Watch Wi-Fi"]')!.click();

    expect(watching.watched).toEqual(['interface en0 Wi-Fi']);
  });
});
