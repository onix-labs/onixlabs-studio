import { join } from 'node:path';
import { app } from 'electron';
import {
  GeoDatabaseStatus,
  GeoLocation,
  MAX_LOCATE_ADDRESSES,
  NetworkGeoChannel,
} from '@shared/api/network-geo-channels';
import { ContributionContext, MainContribution } from '../main-contribution';
import { GeoDatabase } from './geo-database';

/**
 * Reads the addresses to locate out of what the renderer sent.
 * @param value What was sent.
 * @returns Returns the addresses, or undefined when it is not a list of them.
 */
export function readAddresses(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_LOCATE_ADDRESSES) {
    return undefined;
  }
  const addresses: string[] = [];
  for (const entry of value as readonly unknown[]) {
    if (typeof entry !== 'string' || entry.length === 0 || entry.length > 64) {
      return undefined;
    }
    addresses.push(entry);
  }
  return addresses;
}

/**
 * Places IP addresses on the map for the Network Explorer, from DB-IP's free IP to City Lite
 * database kept in Studio's data folder. The renderer decides when the database may be downloaded —
 * it asks the user first — and this side does the downloading and the looking up. Nothing is ever
 * looked up anywhere but in that file.
 */
export class NetworkGeoContribution implements MainContribution {
  /**
   * The stable contribution id.
   */
  public readonly id: string = 'network-geo';

  /**
   * Holds the database, once activated.
   */
  private database: GeoDatabase | undefined;

  /**
   * Creates the contribution.
   * @param createDatabase Creates the database, given the folder it lives in.
   */
  public constructor(
    private readonly createDatabase: () => GeoDatabase = (): GeoDatabase =>
      new GeoDatabase(join(app.getPath('userData'), 'network-geo')),
  ) {}

  /**
   * Wires the status, download and locate channels.
   * @param context The surface the contribution reaches the application through.
   */
  public activate(context: ContributionContext): void {
    const database: GeoDatabase = this.createDatabase();
    this.database = database;
    context.handle(
      NetworkGeoChannel.Status,
      (): Promise<GeoDatabaseStatus> => database.status(),
    );
    context.handle(NetworkGeoChannel.Download, async (): Promise<GeoDatabaseStatus> => {
      context.log.info('Downloading the IP geolocation database');
      const status: GeoDatabaseStatus = await database.download(
        (progress: GeoDatabaseStatus): void => context.send(NetworkGeoChannel.Progress, progress),
      );
      if (status.state === 'failed') {
        context.log.warn('The IP geolocation database could not be downloaded', status.message);
      } else {
        context.log.info('IP geolocation database ready', status.release);
      }
      context.send(NetworkGeoChannel.Progress, status);
      return status;
    });
    context.handle(
      NetworkGeoChannel.Locate,
      async (_event: unknown, payload: unknown): Promise<readonly GeoLocation[]> => {
        const addresses: readonly string[] | undefined = readAddresses(payload);
        return addresses === undefined ? [] : database.locate(addresses);
      },
    );
  }

  /**
   * Lets the loaded database go.
   */
  public dispose(): void {
    this.database?.dispose();
  }
}

/**
 * The singleton network-geo contribution appended to the `mainContributions` manifest.
 */
export const networkGeoContribution: MainContribution = new NetworkGeoContribution();
