import { describe, expect, it } from 'vitest';
import type { ConanReference } from './conanfile';
import type { HttpFetch, HttpResponse } from './protocol';
import { cleanQuery, searchReferences } from './registry';
import type { ConanRemote } from './remotes';

/**
 * A remote with a credential.
 */
const REMOTE: ConanRemote = {
  name: 'company',
  url: 'https://conan.example.com',
  headers: { Authorization: 'Bearer t' },
};

/**
 * Builds a fake remote that answers every request with one response.
 * @param status The status.
 * @param body The body.
 * @param asked Where the requests are recorded.
 * @returns Returns the fetch.
 */
function fakeRemote(
  status: number,
  body: unknown,
  asked: { url: string; headers: Record<string, string> | undefined }[],
): HttpFetch {
  return (url: string, init?: { headers?: Record<string, string> }): Promise<HttpResponse> => {
    asked.push({ url, headers: init?.headers });
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: (): Promise<unknown> => Promise.resolve(body),
    });
  };
}

describe('searchReferences', () => {
  it('searchReferences_aPattern_isTheV2SearchWithTheRemotesHeaders', async () => {
    // Arrange
    const asked: { url: string; headers: Record<string, string> | undefined }[] = [];
    const fetchFn: HttpFetch = fakeRemote(
      200,
      { results: ['fmt/10.2.1@_/_', 'fmt/12.2.0@_/_', 'fmtlog/2.3.0@_/_', 42] },
      asked,
    );

    // Act
    const references: readonly ConanReference[] | null = await searchReferences(
      REMOTE,
      '*fmt*',
      fetchFn,
    );

    // Assert
    expect(references).toEqual([
      { name: 'fmt', version: '10.2.1' },
      { name: 'fmt', version: '12.2.0' },
      { name: 'fmtlog', version: '2.3.0' },
    ]);
    expect(asked).toEqual([
      {
        url: 'https://conan.example.com/v2/conans/search?q=*fmt*',
        headers: { Accept: 'application/json', Authorization: 'Bearer t' },
      },
    ]);
  });

  it('searchReferences_notFound_isNoResults', async () => {
    // Arrange
    const fetchFn: HttpFetch = fakeRemote(404, {}, []);

    // Act
    const references: readonly ConanReference[] | null = await searchReferences(
      REMOTE,
      'nothing',
      fetchFn,
    );

    // Assert
    expect(references).toEqual([]);
  });

  it('searchReferences_aServerError_isNull', async () => {
    // Arrange
    const fetchFn: HttpFetch = fakeRemote(500, {}, []);

    // Act
    const references: readonly ConanReference[] | null = await searchReferences(
      REMOTE,
      'fmt',
      fetchFn,
    );

    // Assert
    expect(references).toBeNull();
  });

  it('searchReferences_unreachable_isNull', async () => {
    // Arrange
    const fetchFn: HttpFetch = (): Promise<never> => Promise.reject(new Error('offline'));

    // Act
    const references: readonly ConanReference[] | null = await searchReferences(
      REMOTE,
      'fmt',
      fetchFn,
    );

    // Assert
    expect(references).toBeNull();
  });
});

describe('cleanQuery', () => {
  it('cleanQuery_patternCharacters_areRemoved', () => {
    // Arrange
    const query: string = ' Boost*/1.0?&x ';

    // Act
    const cleaned: string = cleanQuery(query);

    // Assert
    expect(cleaned).toBe('boost1.0x');
  });
});
