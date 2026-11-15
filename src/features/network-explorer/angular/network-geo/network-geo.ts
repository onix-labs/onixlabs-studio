import { inject, Service, Signal, signal, WritableSignal } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import {
  GeoDatabaseStatus,
  GeoLocation,
  MAX_LOCATE_ADDRESSES,
  NetworkGeoChannel,
} from '@shared/api/network-geo-channels';
import { Log } from '@shared/angular/services/log/log';

/**
 * The renderer's view of the IP geolocation database the main process keeps: whether it is here,
 * downloading it when the user agrees, and where the addresses it has been asked about are.
 *
 * One for the whole app rather than one per tab: the database, its download and what it has said
 * about an address are the same whichever explorer asked. Locations are remembered for the session,
 * so a route traced twice is placed once.
 */
@Service()
export class NetworkGeo {
  /**
   * Holds the IPC transport, or undefined when running outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the database's status, or undefined before it is first read.
   */
  private readonly statusState: WritableSignal<GeoDatabaseStatus | undefined> = signal<
    GeoDatabaseStatus | undefined
  >(undefined);

  /**
   * Holds every location learned, by address.
   */
  private readonly locationsState: WritableSignal<ReadonlyMap<string, GeoLocation>> = signal<
    ReadonlyMap<string, GeoLocation>
  >(new Map<string, GeoLocation>());

  /**
   * Holds the addresses asked about and not yet answered, so they are not asked about twice.
   */
  private readonly pending: Set<string> = new Set<string>();

  /**
   * Gets the database's status, or undefined before it is first read.
   */
  public readonly status: Signal<GeoDatabaseStatus | undefined> = this.statusState.asReadonly();

  /**
   * Gets every location learned, by address.
   */
  public readonly locations: Signal<ReadonlyMap<string, GeoLocation>> =
    this.locationsState.asReadonly();

  /**
   * Follows a download's progress, wherever it was started from, and reads the status once.
   */
  public constructor() {
    this.bridge?.on(NetworkGeoChannel.Progress, (...args: unknown[]): void =>
      this.statusState.set(args[0] as GeoDatabaseStatus),
    );
    void this.refresh();
  }

  /**
   * Reads whether the database is here.
   */
  public async refresh(): Promise<void> {
    if (this.bridge === undefined) {
      this.statusState.set({ state: 'failed', message: 'Maps need the desktop app.' });
      return;
    }
    try {
      this.statusState.set(await this.bridge.invoke<GeoDatabaseStatus>(NetworkGeoChannel.Status));
    } catch (error: unknown) {
      this.log.warn('network-explorer.geo', 'Could not read the geolocation database', error);
    }
  }

  /**
   * Downloads the database. Only called once the user has agreed to.
   */
  public async download(): Promise<void> {
    if (this.bridge === undefined || this.statusState()?.state === 'downloading') {
      return;
    }
    this.statusState.set({ state: 'downloading', progress: 0 });
    try {
      const status: GeoDatabaseStatus = await this.bridge.invoke<GeoDatabaseStatus>(
        NetworkGeoChannel.Download,
      );
      this.statusState.set(status);
      if (status.state === 'ready') {
        // Anything asked before the database arrived was placed nowhere; ask again.
        this.locationsState.set(new Map<string, GeoLocation>());
      }
    } catch (error: unknown) {
      this.statusState.set({
        state: 'failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Learns where addresses are, asking only about those not already known or being asked about.
   * Does nothing until the database is here.
   * @param addresses The addresses.
   */
  public async locate(addresses: readonly string[]): Promise<void> {
    if (this.bridge === undefined || this.statusState()?.state !== 'ready') {
      return;
    }
    const known: ReadonlyMap<string, GeoLocation> = this.locationsState();
    const asking: readonly string[] = [...new Set<string>(addresses)]
      .filter((address: string): boolean => !known.has(address) && !this.pending.has(address))
      .slice(0, MAX_LOCATE_ADDRESSES);
    if (asking.length === 0) {
      return;
    }
    asking.forEach((address: string): void => void this.pending.add(address));
    try {
      const found: readonly GeoLocation[] = await this.bridge.invoke<readonly GeoLocation[]>(
        NetworkGeoChannel.Locate,
        asking,
      );
      this.locationsState.update(
        (locations: ReadonlyMap<string, GeoLocation>): ReadonlyMap<string, GeoLocation> => {
          const next: Map<string, GeoLocation> = new Map<string, GeoLocation>(locations);
          found.forEach((location: GeoLocation): void => void next.set(location.address, location));
          return next;
        },
      );
    } catch (error: unknown) {
      this.log.warn('network-explorer.geo', 'Could not locate addresses', error);
    } finally {
      asking.forEach((address: string): void => void this.pending.delete(address));
    }
  }
}
