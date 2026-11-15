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
import { InterfacesPanel } from './interfaces-panel';

describe('InterfacesPanel', () => {
  let fixture: ComponentFixture<InterfacesPanel>;
  let host: HTMLElement;
  let probe: FakeNetworkProbe;
  let store: NetworkActivity;

  beforeEach(async () => {
    probe = new FakeNetworkProbe();
    probe.network = sampleNetwork;
    await TestBed.configureTestingModule({
      imports: [InterfacesPanel],
      providers: [NetworkActivity, { provide: NetworkProbe, useValue: probe }],
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
});
