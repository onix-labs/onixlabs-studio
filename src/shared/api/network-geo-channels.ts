/**
 * The IPC contract for placing IP addresses on a map: the Network Explorer asks where the hops of a
 * route are, and the main process answers from DB-IP's free IP to City Lite database.
 *
 * The database is not shipped with Studio. It is downloaded — only when the user agrees — into
 * Studio's data folder, and every lookup is answered from that file: no address the user's machine
 * talks to is ever sent to a lookup service.
 */
export enum NetworkGeoChannel {
  /**
   * Renderer → main (invoke): whether the database is here, a {@link GeoDatabaseStatus}.
   */
  Status = 'network-geo:status',

  /**
   * Renderer → main (invoke): downloads the database, resolving its {@link GeoDatabaseStatus} once
   * the download ends; progress is pushed on {@link Progress}.
   */
  Download = 'network-geo:download',

  /**
   * Main → renderer (send): the database's {@link GeoDatabaseStatus} as a download progresses.
   */
  Progress = 'network-geo:progress',

  /**
   * Renderer → main (invoke): locates addresses, an array of strings, resolving a
   * {@link GeoLocation} for each, in the same order.
   */
  Locate = 'network-geo:locate',
}

/**
 * The attribution DB-IP's licence (CC BY 4.0) asks for wherever its data is shown.
 */
export const GEO_ATTRIBUTION: string = 'IP Geolocation by DB-IP';

/**
 * Where the attribution links to.
 */
export const GEO_ATTRIBUTION_URL: string = 'https://db-ip.com';

/**
 * The most addresses one lookup may ask for.
 */
export const MAX_LOCATE_ADDRESSES: number = 256;

/**
 * Where the database is: not downloaded, downloading, here, or a download that failed.
 */
export type GeoDatabaseState = 'missing' | 'downloading' | 'ready' | 'failed';

/**
 * Describes the geolocation database.
 */
export interface GeoDatabaseStatus {
  /**
   * Gets where the database is.
   */
  readonly state: GeoDatabaseState;

  /**
   * Gets the release on disk, or being downloaded, as `YYYY-MM`.
   */
  readonly release?: string;

  /**
   * Gets how far a download has got, from 0 to 1, when its size is known.
   */
  readonly progress?: number;

  /**
   * Gets why a download failed, fit to show.
   */
  readonly message?: string;
}

/**
 * Says where an address is, as far as the database knows. An address it cannot place — a private
 * one, or one it has no record of — carries only itself.
 */
export interface GeoLocation {
  /**
   * Gets the address.
   */
  readonly address: string;

  /**
   * Gets the latitude, in degrees.
   */
  readonly latitude?: number;

  /**
   * Gets the longitude, in degrees.
   */
  readonly longitude?: number;

  /**
   * Gets the city's name, in English.
   */
  readonly city?: string;

  /**
   * Gets the country's name, in English.
   */
  readonly country?: string;

  /**
   * Gets the country's two-letter ISO code.
   */
  readonly countryCode?: string;

  /**
   * Gets whether the address is private — on this network, not the internet — and so has no place.
   */
  readonly private?: boolean;
}
