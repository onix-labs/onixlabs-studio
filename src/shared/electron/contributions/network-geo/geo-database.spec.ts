import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { GeoDatabaseStatus } from '@shared/api/network-geo-channels';
import {
  candidateReleases,
  GeoDatabase,
  releaseUrl,
  toLocation,
} from './geo-database';

describe('GeoDatabase', () => {
  let directory: string;
  let fetched: string[];

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'geo-database-'));
    fetched = [];
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  /**
   * Creates a database whose downloads answer from a list of responses, in order.
   * @param responses The responses.
   * @returns Returns the database.
   */
  function databaseAnswering(responses: Response[]): GeoDatabase {
    return new GeoDatabase(
      directory,
      (url: string): Promise<Response> => {
        fetched.push(url);
        return Promise.resolve(responses.shift() ?? new Response(null, { status: 500 }));
      },
      (): Date => new Date('2026-01-15T00:00:00Z'),
    );
  }

  it('candidateReleases_triesThisMonthThenLast_acrossAYear', () => {
    expect(candidateReleases(new Date('2026-11-15T00:00:00Z'))).toEqual(['2026-11', '2026-10']);
    expect(candidateReleases(new Date('2026-01-01T00:30:00Z'))).toEqual(['2026-01', '2025-12']);
  });

  it('releaseUrl_namesTheGzippedMmdb', () => {
    expect(releaseUrl('2026-11')).toBe(
      'https://download.db-ip.com/free/dbip-city-lite-2026-11.mmdb.gz',
    );
  });

  it('toLocation_readsCityCountryAndCoordinates', () => {
    expect(
      toLocation('1.1.1.1', {
        city: { geoname_id: 0, names: { en: 'Sydney' } },
        country: { geoname_id: 0, iso_code: 'AU', names: { en: 'Australia' } },
        location: { latitude: -33.86, longitude: 151.2, accuracy_radius: 0 },
      }),
    ).toEqual({
      address: '1.1.1.1',
      latitude: -33.86,
      longitude: 151.2,
      city: 'Sydney',
      country: 'Australia',
      countryCode: 'AU',
    });
    expect(toLocation('1.1.1.1', null)).toEqual({ address: '1.1.1.1' });
  });

  it('status_isMissing_beforeAnyDownload', async () => {
    expect(await databaseAnswering([]).status()).toEqual({ state: 'missing' });
  });

  it('download_fallsBackToLastMonth_whenThisMonthIsNotOut', async () => {
    const database: GeoDatabase = databaseAnswering([new Response(null, { status: 404 })]);

    await database.download((): void => undefined);

    expect(fetched).toEqual([releaseUrl('2026-01'), releaseUrl('2025-12')]);
  });

  it('download_ofSomethingThatIsNotADatabase_failsAndLeavesNothingBehind', async () => {
    const progress: GeoDatabaseStatus[] = [];
    const junk: Uint8Array<ArrayBuffer> = Uint8Array.from(gzipSync(Buffer.from('not a database')));
    const database: GeoDatabase = databaseAnswering([
      new Response(junk, { status: 200, headers: { 'content-length': String(junk.length) } }),
    ]);

    const status: GeoDatabaseStatus = await database.download((update: GeoDatabaseStatus): void =>
      void progress.push(update),
    );

    expect(status.state).toBe('failed');
    expect(progress[0]).toEqual({ state: 'downloading', release: '2026-01', progress: 0 });
    expect(await readdir(directory)).toEqual([]);
    expect((await database.status()).state).toBe('failed');
  });

  it('download_saysWhatTheServerAnswered', async () => {
    const database: GeoDatabase = databaseAnswering([
      new Response(null, { status: 503, statusText: 'Service Unavailable' }),
    ]);

    expect(await database.download((): void => undefined)).toEqual({
      state: 'failed',
      message: 'DB-IP answered 503 Service Unavailable',
    });
  });

  it('download_twiceAtOnce_fetchesOnce', async () => {
    const database: GeoDatabase = databaseAnswering([
      new Response(null, { status: 404 }),
      new Response(null, { status: 404 }),
    ]);

    await Promise.all([
      database.download((): void => undefined),
      database.download((): void => undefined),
    ]);

    expect(fetched).toHaveLength(2);
  });

  it('locate_withNoDatabase_marksPrivateAddresses_andPlacesNothing', async () => {
    expect(await databaseAnswering([]).locate(['192.168.1.1', '1.1.1.1'])).toEqual([
      { address: '192.168.1.1', private: true },
      { address: '1.1.1.1' },
    ]);
  });
});
