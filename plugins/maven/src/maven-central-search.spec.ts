import { describe, expect, it } from 'vitest';
import { readSearch, searchMavenCentral, searchQuery } from './maven-central-search';
import type { HttpFetch, PackageSearchResult } from './protocol';

/**
 * An answer shaped like the index's.
 */
const ANSWER: unknown = {
  response: {
    numFound: 386,
    start: 0,
    docs: [
      {
        id: 'com.google.guava:guava',
        g: 'com.google.guava',
        a: 'guava',
        latestVersion: '33.4.8-jre',
      },
      { id: 'broken' },
    ],
  },
};

describe('searchQuery', () => {
  it('searchQuery_coordinates_lookUpExactlyThat', () => {
    expect(searchQuery('com.google.guava:guava')).toBe('g:"com.google.guava" AND a:"guava"');
  });

  it('searchQuery_freeText_isPassedThrough', () => {
    expect(searchQuery('  guava ')).toBe('guava');
  });
});

describe('readSearch', () => {
  it('readSearch_anAnswer_readsItemsAndTotal', () => {
    const page: PackageSearchResult = readSearch(ANSWER, 0);

    expect(page).toEqual({
      items: [
        {
          name: 'com.google.guava:guava',
          version: '33.4.8-jre',
          description: '',
          downloads: null,
          verified: false,
          sourceName: 'Maven Central',
        },
      ],
      total: 386,
      hasMore: true,
    });
  });

  it('readSearch_somethingElse_answersEmpty', () => {
    expect(readSearch('nonsense', 0)).toEqual({ items: [], total: 0, hasMore: false });
  });
});

describe('searchMavenCentral', () => {
  it('searchMavenCentral_pagesThroughTheIndex', async () => {
    const asked: string[] = [];
    const fetchFn: HttpFetch = (url: string) => {
      asked.push(url);
      return Promise.resolve({
        ok: true,
        status: 200,
        json: (): Promise<unknown> => Promise.resolve(ANSWER),
        text: (): Promise<string> => Promise.resolve(''),
      });
    };

    await searchMavenCentral('https://search.example/select', 'guava', 20, 10, fetchFn);

    expect(asked).toEqual(['https://search.example/select?q=guava&rows=10&start=20&wt=json']);
  });

  it('searchMavenCentral_emptyQuery_asksNothing', async () => {
    const fetchFn: HttpFetch = () => Promise.reject(new Error('must not be called'));

    await expect(searchMavenCentral('https://s', ' ', 0, 10, fetchFn)).resolves.toEqual({
      items: [],
      total: 0,
      hasMore: false,
    });
  });

  it('searchMavenCentral_unreachable_answersEmpty', async () => {
    const fetchFn: HttpFetch = () => Promise.reject(new Error('offline'));

    await expect(searchMavenCentral('https://s', 'x', 0, 10, fetchFn)).resolves.toMatchObject({
      items: [],
    });
  });
});
