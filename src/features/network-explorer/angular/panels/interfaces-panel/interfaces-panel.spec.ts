import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Icon } from '@shared/angular/icons/icon';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { NetworkInterfaceInfo } from '@shared/api/system-monitor-channels';
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

describe('InterfacesPanel', (): void => {
  let watching: RecordingCaptures;
  let fixture: ComponentFixture<InterfacesPanel>;
  let host: HTMLElement;
  let probe: FakeNetworkProbe;
  let store: NetworkActivity;

  beforeEach(async (): Promise<void> => {
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
   * Gets an element by its test id, failing the test when it is not rendered.
   * @param testId The test id.
   * @returns Returns the element.
   */
  function byTestId(testId: string): HTMLElement {
    const element: HTMLElement | null = host.querySelector<HTMLElement>(
      `[data-testid="${testId}"]`,
    );
    if (element === null) {
      throw new Error(`Nothing rendered with test id ${testId}`);
    }
    return element;
  }

  /**
   * Gets the list option an interface is rendered in.
   * @param id The interface's id.
   * @returns Returns the option.
   */
  function optionFor(id: string): HTMLElement {
    const option: HTMLElement | null = byTestId(`interface-${id}`).closest<HTMLElement>(
      '[role="option"]',
    );
    if (option === null) {
      throw new Error(`Interface ${id} is not a list option`);
    }
    return option;
  }

  /**
   * Gets the Watch action for an interface, by its accessible name.
   * @param name The interface's name.
   * @returns Returns the button.
   */
  function watchButton(name: string): HTMLButtonElement {
    const button: HTMLButtonElement | null = host.querySelector<HTMLButtonElement>(
      `button[aria-label="Watch ${name}"]`,
    );
    if (button === null) {
      throw new Error(`No Watch action for ${name}`);
    }
    return button;
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

  it('says it is reading before the interfaces arrive', (): void => {
    expect(host.textContent).toContain('Reading the network interfaces');
    expect(host.querySelector('[role="listbox"]')).toBeNull();
  });

  it('lists the interfaces in use as list options, default first, with their activity', async (): Promise<void> => {
    await load();

    expect(listedIds()).toEqual(['en0', 'lo0']);
    expect(host.querySelectorAll('[role="listbox"] [role="option"]').length).toBe(2);
    const wifi: HTMLElement = byTestId('interface-en0');
    expect(wifi.textContent).toContain('Wi-Fi');
    expect(wifi.textContent).toContain('en0');
    expect(wifi.textContent).toContain('Default');
    expect(wifi.textContent).toContain('192.168.1.20');
    expect(wifi.textContent).toContain('2.0 KB/s');
    expect(wifi.textContent).toContain('1 connection');
  });

  it('names an interface once when its name is its device', async (): Promise<void> => {
    probe.network = {
      ...sampleNetwork,
      interfaces: [{ ...sampleNetwork.interfaces[1], name: 'en0' }],
    };
    await load();

    expect(byTestId('interface-en0').querySelector('[data-testid="device-name"]')).toBeNull();
  });

  it('says so when no interface is in use', async (): Promise<void> => {
    probe.network = {
      ...sampleNetwork,
      interfaces: sampleNetwork.interfaces.filter(
        (info: NetworkInterfaceInfo): boolean => !info.up,
      ),
    };
    await load();

    expect(listedIds()).toEqual([]);
    expect(host.textContent).toContain('No interfaces in use.');
  });

  it('lists the idle interfaces too when asked', async (): Promise<void> => {
    await load();

    byTestId('show-idle-interfaces').querySelector('button')?.click();
    await fixture.whenStable();

    expect(listedIds()).toEqual(['en0', 'lo0', 'awdl0']);
  });

  it('re-reads the interfaces when refreshed', async (): Promise<void> => {
    await load();
    probe.network = {
      ...sampleNetwork,
      interfaces: sampleNetwork.interfaces.filter(
        (info: NetworkInterfaceInfo): boolean => info.isDefault,
      ),
    };

    byTestId('refresh-interfaces').querySelector('button')?.click();
    await vi.waitFor((): void => {
      fixture.detectChanges();
      expect(listedIds()).toEqual(['en0']);
    });
  });

  it('selects an interface when clicked, and clears it when clicked again', async (): Promise<void> => {
    await load();

    byTestId('interface-en0').click();
    await fixture.whenStable();
    expect(store.selectedInterfaceId()).toBe('en0');
    expect(optionFor('en0').getAttribute('aria-selected')).toBe('true');
    expect(optionFor('lo0').getAttribute('aria-selected')).toBe('false');

    byTestId('interface-en0').click();
    await fixture.whenStable();
    expect(store.selectedInterfaceId()).toBeNull();
    expect(optionFor('en0').getAttribute('aria-selected')).toBeNull();
  });

  it('selects an interface from the keyboard', async (): Promise<void> => {
    await load();

    optionFor('lo0').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await fixture.whenStable();

    expect(store.selectedInterfaceId()).toBe('lo0');
  });

  it('watches an interface without choosing its row', async (): Promise<void> => {
    await load();

    watchButton('Wi-Fi').click();
    await fixture.whenStable();

    expect(watching.watched).toEqual(['interface en0 Wi-Fi']);
    expect(store.selectedInterfaceId()).toBeNull();
  });

  it('keeps Enter on the Watch action from choosing its row', async (): Promise<void> => {
    await load();

    watchButton('Wi-Fi').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    await fixture.whenStable();

    expect(store.selectedInterfaceId()).toBeNull();
  });
});
