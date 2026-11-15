import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform, TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { createGunzip } from 'node:zlib';
import { CityResponse, Reader } from 'mmdb-lib';
import { GeoDatabaseStatus, GeoLocation } from '@shared/api/network-geo-channels';
import { isPrivateAddress } from './geo-addresses';

/**
 * Fetches a URL. A seam, so the download can be tested without the network.
 */
export type GeoFetch = (url: string) => Promise<Response>;

/**
 * The database's file name in its folder.
 */
const DATABASE_FILE: string = 'dbip-city-lite.mmdb';

/**
 * The file beside it recording which release it is.
 */
const RELEASE_FILE: string = 'dbip-city-lite.json';

/**
 * How long a loaded database is kept in memory after its last lookup. It is over a hundred megabytes,
 * and routes are traced now and then, not all day.
 */
const IDLE_UNLOAD_MS: number = 5 * 60 * 1000;

/**
 * Builds the address of one month's release of DB-IP's IP to City Lite database.
 * @param release The release, as `YYYY-MM`.
 * @returns Returns its download address.
 */
export function releaseUrl(release: string): string {
  return `https://download.db-ip.com/free/dbip-city-lite-${release}.mmdb.gz`;
}

/**
 * Names the releases worth trying at a moment: this month's, and last month's in case this month's is
 * not out yet — DB-IP publishes on the first, and a clock in another time zone may be ahead of it.
 * @param now The moment.
 * @returns Returns the releases, newest first, as `YYYY-MM`.
 */
export function candidateReleases(now: Date): readonly string[] {
  const name: (year: number, month: number) => string = (year: number, month: number): string =>
    `${String(year)}-${String(month + 1).padStart(2, '0')}`;
  const year: number = now.getUTCFullYear();
  const month: number = now.getUTCMonth();
  return [name(year, month), month === 0 ? name(year - 1, 11) : name(year, month - 1)];
}

/**
 * Reads the place a database record gives an address.
 * @param address The address.
 * @param record The record, or null when the database has none.
 * @returns Returns the location.
 */
export function toLocation(address: string, record: CityResponse | null): GeoLocation {
  const latitude: number | undefined = record?.location?.latitude;
  const longitude: number | undefined = record?.location?.longitude;
  const city: string | undefined = record?.city?.names.en;
  const country: string | undefined = record?.country?.names.en;
  const countryCode: string | undefined = record?.country?.iso_code;
  return {
    address,
    ...(latitude === undefined || longitude === undefined ? {} : { latitude, longitude }),
    ...(city === undefined ? {} : { city }),
    ...(country === undefined ? {} : { country }),
    ...(countryCode === undefined ? {} : { countryCode }),
  };
}

/**
 * DB-IP's IP to City Lite database, as Studio keeps it: downloaded on request into a folder of its
 * own, then answering lookups from memory, loaded when first asked and let go again when idle.
 *
 * A download is written beside the database and only replaces it once it has been read back as a
 * database, so a failed or interrupted download never leaves a broken one behind.
 */
export class GeoDatabase {
  /**
   * Holds the loaded database, or undefined while it is not in memory.
   */
  private reader: Reader<CityResponse> | undefined;

  /**
   * Holds the timer that lets the loaded database go, or undefined when none is set.
   */
  private idleTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * Holds the download under way, so a second request joins it rather than starting another.
   */
  private downloading: Promise<GeoDatabaseStatus> | undefined;

  /**
   * Holds the latest download's progress, while one is under way.
   */
  private progress: GeoDatabaseStatus | undefined;

  /**
   * Holds why the latest download failed, until another succeeds.
   */
  private failure: string | undefined;

  /**
   * Creates the database.
   * @param directory The folder it is kept in.
   * @param fetchUrl Fetches a URL.
   * @param now Gets the current moment.
   */
  public constructor(
    private readonly directory: string,
    private readonly fetchUrl: GeoFetch = (url: string): Promise<Response> => fetch(url),
    private readonly now: () => Date = (): Date => new Date(),
  ) {}

  /**
   * Gets where the database is.
   * @returns Returns a promise resolving its status.
   */
  public async status(): Promise<GeoDatabaseStatus> {
    if (this.progress !== undefined) {
      return this.progress;
    }
    const release: string | undefined = await this.readRelease();
    if (release !== undefined) {
      return { state: 'ready', release };
    }
    return this.failure === undefined
      ? { state: 'missing' }
      : { state: 'failed', message: this.failure };
  }

  /**
   * Downloads the newest release, replacing any database already here once it has arrived whole.
   * @param onProgress Receives the download's status as it progresses.
   * @returns Returns a promise resolving the database's status once the download ends.
   */
  public download(onProgress: (status: GeoDatabaseStatus) => void): Promise<GeoDatabaseStatus> {
    this.downloading ??= this.downloadNewest(onProgress).finally((): void => {
      this.downloading = undefined;
      this.progress = undefined;
    });
    return this.downloading;
  }

  /**
   * Locates addresses. Private ones are not looked up; with no database, nothing is placed.
   * @param addresses The addresses.
   * @returns Returns a promise resolving a location for each, in order.
   */
  public async locate(addresses: readonly string[]): Promise<readonly GeoLocation[]> {
    const reader: Reader<CityResponse> | undefined = await this.load();
    return addresses.map((address: string): GeoLocation => {
      if (isPrivateAddress(address)) {
        return { address, private: true };
      }
      if (reader === undefined) {
        return { address };
      }
      try {
        return toLocation(address, reader.get(address.split('%')[0]));
      } catch {
        return { address };
      }
    });
  }

  /**
   * Lets the loaded database go, and any timer waiting to.
   */
  public dispose(): void {
    clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
    this.reader = undefined;
  }

  /**
   * Downloads the newest release that is out.
   * @param onProgress Receives the download's status as it progresses.
   * @returns Returns a promise resolving the database's status once the download ends.
   */
  private async downloadNewest(
    onProgress: (status: GeoDatabaseStatus) => void,
  ): Promise<GeoDatabaseStatus> {
    const report: (status: GeoDatabaseStatus) => void = (status: GeoDatabaseStatus): void => {
      this.progress = status;
      onProgress(status);
    };
    let lastError: string = 'The database could not be downloaded.';
    for (const release of candidateReleases(this.now())) {
      report({ state: 'downloading', release, progress: 0 });
      try {
        const response: Response = await this.fetchUrl(releaseUrl(release));
        if (response.status === 404) {
          lastError = `DB-IP has no ${release} release yet.`;
          continue;
        }
        if (!response.ok || response.body === null) {
          throw new Error(`DB-IP answered ${String(response.status)} ${response.statusText}`);
        }
        await this.save(release, response, report);
        this.failure = undefined;
        return { state: 'ready', release };
      } catch (error: unknown) {
        lastError = error instanceof Error ? error.message : String(error);
        break;
      }
    }
    this.failure = lastError;
    return { state: 'failed', message: lastError };
  }

  /**
   * Writes a downloaded release, checks it reads as a database, and puts it in place.
   * @param release The release.
   * @param response The download.
   * @param report Receives the download's progress.
   */
  private async save(
    release: string,
    response: Response,
    report: (status: GeoDatabaseStatus) => void,
  ): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const partial: string = join(this.directory, `${DATABASE_FILE}.download`);
    const total: number = Number(response.headers.get('content-length') ?? 0);
    let received: number = 0;
    let reported: number = 0;
    const counter: Transform = new Transform({
      transform: (chunk: Buffer, _encoding: BufferEncoding, done: TransformCallback): void => {
        received += chunk.length;
        const progress: number = total > 0 ? Math.min(received / total, 1) : 0;
        if (progress - reported >= 0.01) {
          reported = progress;
          report({ state: 'downloading', release, progress });
        }
        done(null, chunk);
      },
    });
    try {
      await pipeline(
        Readable.fromWeb(response.body as WebReadableStream<Uint8Array>),
        counter,
        createGunzip(),
        createWriteStream(partial),
      );
      // Read it back before trusting it: a truncated or mangled file throws here, not on a lookup.
      void new Reader<CityResponse>(await readFile(partial));
      this.dispose();
      await rename(partial, join(this.directory, DATABASE_FILE));
      await writeFile(join(this.directory, RELEASE_FILE), JSON.stringify({ release }));
    } catch (error: unknown) {
      await rm(partial, { force: true });
      throw error;
    }
  }

  /**
   * Reads which release is on disk.
   * @returns Returns a promise resolving the release, or undefined when there is no database.
   */
  private async readRelease(): Promise<string | undefined> {
    try {
      const recorded: unknown = JSON.parse(
        await readFile(join(this.directory, RELEASE_FILE), 'utf8'),
      );
      const release: unknown =
        typeof recorded === 'object' && recorded !== null
          ? (recorded as Record<string, unknown>)['release']
          : undefined;
      return typeof release === 'string' ? release : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Loads the database, if it is not loaded already, and keeps it a while longer.
   * @returns Returns a promise resolving it, or undefined when there is none.
   */
  private async load(): Promise<Reader<CityResponse> | undefined> {
    if (this.reader === undefined) {
      if ((await this.readRelease()) === undefined) {
        return undefined;
      }
      try {
        this.reader = new Reader<CityResponse>(await readFile(join(this.directory, DATABASE_FILE)));
      } catch {
        return undefined;
      }
    }
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout((): void => this.dispose(), IDLE_UNLOAD_MS);
    this.idleTimer.unref();
    return this.reader;
  }
}
