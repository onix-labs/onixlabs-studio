import { describe, expect, it } from 'vitest';
import type { HttpFetch, HttpResponse } from './protocol';
import { Baseline, BaselineStore, parseBaseline } from './registry';

/**
 * Builds a fake registry that answers one baseline per ref and records what was asked.
 * @param files The baseline bodies by ref.
 * @param asked Where the requested URLs are recorded.
 * @returns Returns the fetch.
 */
function fakeRegistry(files: Record<string, unknown>, asked: string[]): HttpFetch {
  return (url: string): Promise<HttpResponse> => {
    asked.push(url);
    const ref: string | undefined = /\/([^/]+)\/versions\/baseline\.json$/.exec(url)?.[1];
    const body: unknown = ref === undefined ? undefined : files[ref];
    return Promise.resolve({
      ok: body !== undefined,
      status: body === undefined ? 404 : 200,
      json: (): Promise<unknown> => Promise.resolve(body),
    });
  };
}

describe('parseBaseline', () => {
  it('parseBaseline_aBaselineFile_givesVersionsWithPortVersions', () => {
    // Arrange
    const body: unknown = {
      default: {
        fmt: { baseline: '12.2.0', 'port-version': 1 },
        zlib: { baseline: '1.3.2', 'port-version': 0 },
        odd: { nothing: true },
      },
    };

    // Act
    const baseline: Baseline | null = parseBaseline(body);

    // Assert
    expect([...(baseline ?? [])]).toEqual([
      ['fmt', '12.2.0#1'],
      ['zlib', '1.3.2'],
    ]);
  });

  it('parseBaseline_notABaseline_isNull', () => {
    // Arrange
    const body: unknown = { versions: [] };

    // Act
    const baseline: Baseline | null = parseBaseline(body);

    // Assert
    expect(baseline).toBeNull();
  });
});

describe('BaselineStore', () => {
  it('at_aCommit_isFetchedOnceAndKept', async () => {
    // Arrange
    const asked: string[] = [];
    const sha: string = 'c'.repeat(40);
    const store: BaselineStore = new BaselineStore(
      'https://registry.test/vcpkg/',
      fakeRegistry({ [sha]: { default: { fmt: { baseline: '10.0.0' } } } }, asked),
    );

    // Act
    await store.at(sha);
    const baseline: Baseline | null = await store.at(sha);

    // Assert
    expect(baseline?.get('fmt')).toBe('10.0.0');
    expect(asked).toEqual([`https://registry.test/vcpkg/${sha}/versions/baseline.json`]);
  });

  it('at_aFailure_isNotKept', async () => {
    // Arrange
    const asked: string[] = [];
    const store: BaselineStore = new BaselineStore(
      'https://registry.test',
      fakeRegistry({}, asked),
    );

    // Act
    await store.at('d'.repeat(40));
    const baseline: Baseline | null = await store.at('d'.repeat(40));

    // Assert
    expect(baseline).toBeNull();
    expect(asked).toHaveLength(2);
  });

  it('latest_readsMasterAndKeepsItForSearches', async () => {
    // Arrange
    const asked: string[] = [];
    const store: BaselineStore = new BaselineStore(
      'https://registry.test',
      fakeRegistry({ master: { default: { fmt: { baseline: '12.2.0' } } } }, asked),
    );

    // Act
    await store.latest();
    const baseline: Baseline | null = await store.latest();

    // Assert
    expect(baseline?.get('fmt')).toBe('12.2.0');
    expect(asked).toEqual(['https://registry.test/master/versions/baseline.json']);
  });

  it('latest_aNetworkError_isNull', async () => {
    // Arrange
    const store: BaselineStore = new BaselineStore('https://registry.test', (): Promise<never> =>
      Promise.reject(new Error('offline')),
    );

    // Act
    const baseline: Baseline | null = await store.latest();

    // Assert
    expect(baseline).toBeNull();
  });
});
