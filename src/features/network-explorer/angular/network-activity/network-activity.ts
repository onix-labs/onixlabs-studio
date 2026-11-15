import { computed, inject, Service, Signal, signal, WritableSignal } from '@angular/core';
import {
  NetworkConnection,
  NetworkInfo,
  NetworkInterfaceInfo,
  NetworkInterfaceReading,
  NetworkReading,
} from '@shared/api/system-monitor-channels';
import { Log } from '@shared/angular/services/log/log';
import { NetworkProbe } from '../network-probe/network-probe';
import { endpointHost, hasRemotePeer, interfaceOf, isLoopbackHost } from './network-endpoints';

/**
 * Describes one interface as the Interfaces panel lists it: what it is, how busy it is, and how many
 * remote connections are made over it.
 */
export interface InterfaceRow {
  /**
   * Gets the interface.
   */
  readonly info: NetworkInterfaceInfo;

  /**
   * Gets the interface's latest activity, or undefined before the first reading.
   */
  readonly reading: NetworkInterfaceReading | undefined;

  /**
   * Gets the number of connections to a remote peer made over the interface.
   */
  readonly connections: number;
}

/**
 * Describes one connection as the Connections panel lists it.
 */
export interface ConnectionRow {
  /**
   * Gets the connection.
   */
  readonly connection: NetworkConnection;

  /**
   * Gets the row's identity, unique within the list.
   */
  readonly key: string;

  /**
   * Gets the remote peer's host, without its port.
   */
  readonly remoteHost: string;

  /**
   * Gets the id of the interface the connection is made over, or undefined when none carries its
   * local address.
   */
  readonly interfaceId: string | undefined;
}

/**
 * Gets whether an interface is worth listing by default: up, and carrying an address. A Mac reports a
 * dozen interfaces that are neither (`awdl0`, `llw0`, idle `utun`s, `anpi`s), which would bury the two
 * that matter.
 * @param info The interface.
 * @returns Returns true when the interface is in use.
 */
function isInUse(info: NetworkInterfaceInfo): boolean {
  return info.up && (info.ipv4 !== undefined || info.ipv6 !== undefined);
}

/**
 * The Network Explorer's live picture of the machine's network, shared by every panel in one tab: the
 * interfaces, their activity, the connections made over them, and what the user has chosen to look at.
 *
 * Provided by the view rather than a panel, because a dock tool stack destroys an inactive panel when a
 * sibling activates; the readings and the selection must outlive that. Readings flow only while the
 * view is open — {@link open} and {@link close} bracket them — so a closed explorer costs nothing.
 */
@Service({ autoProvided: false })
export class NetworkActivity {
  /**
   * Holds the client for the backend's network readings.
   */
  private readonly probe: NetworkProbe = inject(NetworkProbe);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the machine's interfaces, DNS servers and gateway, or null before they are read.
   */
  private readonly infoState: WritableSignal<NetworkInfo | null> = signal<NetworkInfo | null>(null);

  /**
   * Holds the latest activity of each interface, keyed by interface id.
   */
  private readonly readingsState: WritableSignal<ReadonlyMap<string, NetworkInterfaceReading>> =
    signal<ReadonlyMap<string, NetworkInterfaceReading>>(
      new Map<string, NetworkInterfaceReading>(),
    );

  /**
   * Holds the latest connections, or null before the first listing arrives.
   */
  private readonly connectionsState: WritableSignal<readonly NetworkConnection[] | null> = signal<
    readonly NetworkConnection[] | null
  >(null);

  /**
   * Holds the function that removes the reading subscription, or null while closed.
   */
  private unsubscribe: (() => void) | null = null;

  /**
   * Gets the interface the Connections panel is narrowed to, or null for every interface.
   */
  public readonly selectedInterfaceId: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Gets whether interfaces that are down or carry no address are listed too.
   */
  public readonly showIdleInterfaces: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets whether connections between this machine and itself are listed too.
   */
  public readonly showLoopback: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets the text the connections are filtered by.
   */
  public readonly connectionQuery: WritableSignal<string> = signal<string>('');

  /**
   * Gets the machine's network, or null before it is read.
   */
  public readonly info: Signal<NetworkInfo | null> = this.infoState.asReadonly();

  /**
   * Gets whether the connections have been listed at least once.
   */
  public readonly connectionsLoaded: Signal<boolean> = computed(
    (): boolean => this.connectionsState() !== null,
  );

  /**
   * Gets every connection with a remote peer, each resolved to the interface it is made over.
   */
  private readonly remoteRows: Signal<readonly ConnectionRow[]> = computed(
    (): readonly ConnectionRow[] => {
      const interfaces: readonly NetworkInterfaceInfo[] = this.infoState()?.interfaces ?? [];
      return (this.connectionsState() ?? [])
        .filter(hasRemotePeer)
        .map((connection: NetworkConnection, index: number): ConnectionRow => ({
          connection,
          key: `${connection.protocol} ${connection.local} ${connection.remote} ${connection.pid ?? ''} ${index}`,
          remoteHost: endpointHost(connection.remote),
          interfaceId: interfaceOf(connection, interfaces),
        }));
    },
  );

  /**
   * Gets the interfaces the Interfaces panel lists: those in use, or all of them when idle ones are
   * shown, the default route's first.
   */
  public readonly interfaces: Signal<readonly InterfaceRow[]> = computed(
    (): readonly InterfaceRow[] => {
      const readings: ReadonlyMap<string, NetworkInterfaceReading> = this.readingsState();
      const counts: Map<string, number> = new Map<string, number>();
      for (const row of this.remoteRows()) {
        if (row.interfaceId !== undefined) {
          counts.set(row.interfaceId, (counts.get(row.interfaceId) ?? 0) + 1);
        }
      }
      const showIdle: boolean = this.showIdleInterfaces();
      return (this.infoState()?.interfaces ?? [])
        .filter((info: NetworkInterfaceInfo): boolean => showIdle || isInUse(info))
        .map((info: NetworkInterfaceInfo): InterfaceRow => ({
          info,
          reading: readings.get(info.id),
          connections: counts.get(info.id) ?? 0,
        }))
        .sort(
          (a: InterfaceRow, b: InterfaceRow): number =>
            Number(b.info.isDefault) - Number(a.info.isDefault),
        );
    },
  );

  /**
   * Gets the selected interface, or undefined when every interface is shown.
   */
  public readonly selectedInterface: Signal<NetworkInterfaceInfo | undefined> = computed(
    (): NetworkInterfaceInfo | undefined => {
      const id: string | null = this.selectedInterfaceId();
      return id === null
        ? undefined
        : this.infoState()?.interfaces.find(
            (info: NetworkInterfaceInfo): boolean => info.id === id,
          );
    },
  );

  /**
   * Gets the connections the Connections panel lists: those with a remote peer, over the selected
   * interface, without loopback ones unless asked, and matching the filter by process, address,
   * protocol or state.
   */
  public readonly connections: Signal<readonly ConnectionRow[]> = computed(
    (): readonly ConnectionRow[] => {
      const selected: string | null = this.selectedInterfaceId();
      const showLoopback: boolean = this.showLoopback();
      const needle: string = this.connectionQuery().trim().toLowerCase();
      return this.remoteRows().filter((row: ConnectionRow): boolean => {
        if (selected !== null && row.interfaceId !== selected) {
          return false;
        }
        if (!showLoopback && selected === null && isLoopbackHost(row.remoteHost)) {
          return false;
        }
        if (needle.length === 0) {
          return true;
        }
        const connection: NetworkConnection = row.connection;
        return [
          connection.process ?? '',
          connection.local,
          connection.remote,
          connection.protocol,
          connection.state,
          String(connection.pid ?? ''),
        ].some((field: string): boolean => field.toLowerCase().includes(needle));
      });
    },
  );

  /**
   * Starts reading the network: subscribes to the backend's readings, asks it to sample, and reads the
   * interfaces. Opening an open store does nothing.
   */
  public open(): void {
    if (this.unsubscribe !== null) {
      return;
    }
    this.unsubscribe = this.probe.onReading((reading: NetworkReading): void =>
      this.accept(reading),
    );
    this.probe.start();
    void this.refresh();
  }

  /**
   * Stops reading the network. The last readings stay, so reopening shows them until fresh ones land.
   */
  public close(): void {
    if (this.unsubscribe === null) {
      return;
    }
    this.probe.stop();
    this.unsubscribe();
    this.unsubscribe = null;
  }

  /**
   * Re-reads the interfaces, which change far less often than their activity — a VPN coming up, a
   * cable unplugged — and so are not part of every reading.
   */
  public async refresh(): Promise<void> {
    const info: NetworkInfo | null = await this.probe.info();
    if (info === null) {
      this.log.warn('network-explorer', 'Could not read the network interfaces');
      return;
    }
    this.infoState.set(info);
    const selected: string | null = this.selectedInterfaceId();
    if (
      selected !== null &&
      !info.interfaces.some((entry: NetworkInterfaceInfo): boolean => entry.id === selected)
    ) {
      this.selectedInterfaceId.set(null);
    }
  }

  /**
   * Narrows the Connections panel to one interface, or widens it back to every interface when the
   * selected one is chosen again.
   * @param id The interface's id, or null for every interface.
   */
  public select(id: string | null): void {
    this.selectedInterfaceId.set(id === this.selectedInterfaceId() ? null : id);
  }

  /**
   * Takes in one reading from the backend.
   * @param reading The reading.
   */
  private accept(reading: NetworkReading): void {
    this.readingsState.set(
      new Map<string, NetworkInterfaceReading>(
        reading.interfaces.map(
          (entry: NetworkInterfaceReading): [string, NetworkInterfaceReading] => [entry.id, entry],
        ),
      ),
    );
    if (reading.connections !== undefined) {
      this.connectionsState.set(reading.connections);
    }
  }
}
