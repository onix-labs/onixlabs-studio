import { describe, expect, it } from 'vitest';
import type { HttpFetch, HttpResponse } from './protocol';
import {
  fetchVersionLists,
  isPublicRepository,
  mayCarryCredential,
  metadataUrl,
  normaliseRepositoryUrl,
  parseMetadataVersions,
} from './repositories';

/**
 * Builds a response holding text.
 * @param status The status.
 * @param body The body.
 * @returns Returns the response.
 */
function response(status: number, body: string): HttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: (): Promise<unknown> => Promise.resolve(JSON.parse(body)),
    text: (): Promise<string> => Promise.resolve(body),
  };
}

/**
 * Metadata listing two versions.
 */
const METADATA: string =
  '<metadata><versioning><release>2.0</release><versions><version>1.0</version><version>2.0</version></versions></versioning></metadata>';

describe('repository helpers', () => {
  it('normaliseRepositoryUrl_dropsUserInformationAndTrailingSlashes', () => {
    expect(normaliseRepositoryUrl('https://me:secret@repo.example.com/maven/')).toBe(
      'https://repo.example.com/maven',
    );
    expect(normaliseRepositoryUrl('file:///home/me/.m2')).toBeNull();
    expect(normaliseRepositoryUrl('not a url')).toBeNull();
  });

  it('isPublicRepository_knowsThePublicHosts', () => {
    expect(isPublicRepository('https://repo1.maven.org/maven2')).toBe(true);
    expect(isPublicRepository('https://dl.google.com/dl/android/maven2')).toBe(true);
    expect(isPublicRepository('https://repo.example.com')).toBe(false);
  });

  it('mayCarryCredential_onlyHttpsOrLoopbackHttp', () => {
    expect(mayCarryCredential('https://repo.example.com')).toBe(true);
    expect(mayCarryCredential('http://127.0.0.1:8081/repo')).toBe(true);
    expect(mayCarryCredential('http://repo.example.com')).toBe(false);
  });

  it('metadataUrl_turnsTheGroupIntoAPath', () => {
    expect(metadataUrl('https://r', 'com.google.guava', 'guava')).toBe(
      'https://r/com/google/guava/guava/maven-metadata.xml',
    );
  });

  it('parseMetadataVersions_readsEveryVersion', () => {
    expect(parseMetadataVersions(METADATA)).toEqual(['1.0', '2.0']);
  });
});

describe('fetchVersionLists', () => {
  it('fetchVersionLists_triesRepositoriesInOrder_withTheirHeaders', async () => {
    const asked: { url: string; headers: Record<string, string> }[] = [];
    const fetchFn: HttpFetch = (url: string, init?: { headers?: Record<string, string> }) => {
      asked.push({ url, headers: init?.headers ?? {} });
      return Promise.resolve(
        url.startsWith('https://second') ? response(200, METADATA) : response(404, ''),
      );
    };

    const lists: ReadonlyMap<string, readonly string[] | null> = await fetchVersionLists(
      new Set<string>(['g:a']),
      [
        { name: 'first', url: 'https://first', headers: { Authorization: 'Basic x' } },
        { name: 'second', url: 'https://second', headers: {} },
      ],
      fetchFn,
    );

    expect(lists.get('g:a')).toEqual(['1.0', '2.0']);
    expect(asked).toEqual([
      { url: 'https://first/g/a/maven-metadata.xml', headers: { Authorization: 'Basic x' } },
      { url: 'https://second/g/a/maven-metadata.xml', headers: {} },
    ]);
  });

  it('fetchVersionLists_anUnreachableRepository_isNotAskedAgainOnceKnownDead', async () => {
    let deadAsks: number = 0;
    const fetchFn: HttpFetch = (url: string) => {
      if (url.startsWith('https://dead')) {
        deadAsks += 1;
        return Promise.reject(new Error('timeout'));
      }
      return Promise.resolve(response(200, METADATA));
    };
    const names: Set<string> = new Set<string>(
      Array.from({ length: 40 }, (_: unknown, index: number): string => `g:a${index}`),
    );

    const lists: ReadonlyMap<string, readonly string[] | null> = await fetchVersionLists(
      names,
      [
        { name: 'dead', url: 'https://dead', headers: {} },
        { name: 'live', url: 'https://live', headers: {} },
      ],
      (url: string) => fetchFn(url),
    );

    // At most one ask per worker in flight before the first failure is seen: 8 at once.
    expect(deadAsks).toBeLessThanOrEqual(8);
    expect(lists.get('g:a39')).toEqual(['1.0', '2.0']);
  });

  it('fetchVersionLists_noRepositoryHasIt_answersNull', async () => {
    const lists: ReadonlyMap<string, readonly string[] | null> = await fetchVersionLists(
      new Set<string>(['g:a']),
      [{ name: 'r', url: 'https://r', headers: {} }],
      () => Promise.resolve(response(404, '')),
    );

    expect(lists.get('g:a')).toBeNull();
  });
});
