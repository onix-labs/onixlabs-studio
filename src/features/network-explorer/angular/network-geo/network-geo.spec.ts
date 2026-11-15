import { TestBed } from '@angular/core/testing';
import { Bridge } from '@shared/api/bridge';
import {
  GeoDatabaseStatus,
  GeoLocation,
  NetworkGeoChannel,
} from '@shared/api/network-geo-channels';
import { NetworkGeo } from './network-geo';

/**
 * Stands in for the main process's geolocation database: it answers a status, a download and lookups,
 * and records what it was asked.
 */
class GeoBridge implements Bridge {
  /**
   * Gets the status it answers.
   */
  public status: GeoDatabaseStatus = { state: 'missing' };

  /**
   * Gets every lookup it was asked, in order.
   */
  public readonly lookups: (readonly string[])[] = [];

  /**
   * Holds the progress listener.
   */
  private progress: ((...args: unknown[]) => void) | undefined;

  /**
   * Answers an invoke.
   * @param channel The channel.
   * @param args The arguments.
   * @returns Returns the answer.
   */
  public invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
    if (channel === String(NetworkGeoChannel.Status)) {
      return Promise.resolve(this.status as T);
    }
    if (channel === String(NetworkGeoChannel.Download)) {
      this.status = { state: 'ready', release: '2026-11' };
      return Promise.resolve(this.status as T);
    }
    const addresses: readonly string[] = args[0] as readonly string[];
    this.lookups.push(addresses);
    return Promise.resolve(
      addresses.map((address: string): GeoLocation => ({
        address,
        latitude: 51.5,
        longitude: -0.1,
        city: 'London',
      })) as T,
    );
  }

  /**
   * Ignores a send.
   */
  public send(): void {
    // Not used.
  }

  /**
   * Records the progress listener.
   * @param _channel The channel.
   * @param listener The listener.
   * @returns Returns the unsubscribe function.
   */
  public on(_channel: string, listener: (...args: unknown[]) => void): () => void {
    this.progress = listener;
    return (): void => undefined;
  }

  /**
   * Pushes a download's progress.
   * @param status The status.
   */
  public push(status: GeoDatabaseStatus): void {
    this.progress?.(status);
  }
}

describe('NetworkGeo', () => {
  let bridge: GeoBridge;

  beforeEach((): void => {
    bridge = new GeoBridge();
    Object.defineProperty(window, 'bridge', { value: bridge, configurable: true });
  });

  afterEach((): void => {
    Reflect.deleteProperty(window, 'bridge');
  });

  /**
   * Creates the client and lets it read the status.
   * @returns Returns the client.
   */
  async function create(): Promise<NetworkGeo> {
    const geo: NetworkGeo = TestBed.inject(NetworkGeo);
    await geo.refresh();
    return geo;
  }

  it('readsTheStatus_andFollowsProgress', async () => {
    const geo: NetworkGeo = await create();
    expect(geo.status()).toEqual({ state: 'missing' });

    bridge.push({ state: 'downloading', release: '2026-11', progress: 0.5 });

    expect(geo.status()?.progress).toBe(0.5);
  });

  it('locate_asksNothing_untilTheDatabaseIsHere', async () => {
    const geo: NetworkGeo = await create();

    await geo.locate(['1.1.1.1']);

    expect(bridge.lookups).toEqual([]);
  });

  it('download_thenLocate_learnsWhereAddressesAre', async () => {
    const geo: NetworkGeo = await create();

    await geo.download();
    await geo.locate(['1.1.1.1', '1.1.1.1', '8.8.8.8']);

    expect(geo.status()?.state).toBe('ready');
    expect(bridge.lookups).toEqual([['1.1.1.1', '8.8.8.8']]);
    expect(geo.locations().get('8.8.8.8')?.city).toBe('London');
  });

  it('locate_asksOnlyAboutAddressesItDoesNotKnow', async () => {
    bridge.status = { state: 'ready', release: '2026-11' };
    const geo: NetworkGeo = await create();

    await geo.locate(['1.1.1.1']);
    await geo.locate(['1.1.1.1', '9.9.9.9']);

    expect(bridge.lookups).toEqual([['1.1.1.1'], ['9.9.9.9']]);
  });
});
