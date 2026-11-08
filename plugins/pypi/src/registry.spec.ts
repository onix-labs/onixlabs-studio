import { describe, expect, it } from 'vitest';
import { indexFrom, PipIndex } from './pip-config';
import type { HttpFetch, HttpResponse } from './protocol';
import { factsFromPypiJson, factsFromSimpleJson, lookUpPackage, PackageFacts } from './registry';

/**
 * Builds a response.
 * @param body The JSON body.
 * @param ok Whether it succeeded.
 * @returns Returns the response.
 */
function json(body: unknown, ok: boolean = true): HttpResponse {
  return { ok, status: ok ? 200 : 404, json: (): Promise<unknown> => Promise.resolve(body) };
}

describe('factsFromPypiJson', () => {
  it('factsFromPypiJson_releases_skipsPrereleasesAndFullyYankedVersions', () => {
    // Arrange
    const body: unknown = {
      info: { name: 'Demo', version: '1.9', summary: 'A demo' },
      releases: {
        '1.9': [{ yanked: false }],
        '1.10': [{ yanked: false }, { yanked: true }],
        '2.0': [{ yanked: true }],
        '3.0b1': [{ yanked: false }],
        '4.0': [],
      },
    };

    // Act
    const facts: PackageFacts | null = factsFromPypiJson(body);

    // Assert
    expect(facts).toEqual({ name: 'Demo', latest: '1.10', summary: 'A demo' });
  });

  it('factsFromPypiJson_noUsableReleases_fallsBackToInfoVersion', () => {
    // Act
    const facts: PackageFacts | null = factsFromPypiJson({ info: { name: 'x', version: '1.0' } });

    // Assert
    expect(facts?.latest).toBe('1.0');
  });

  it.each<[string, unknown]>([
    ['null', null],
    ['noInfo', {}],
    ['noName', { info: { version: '1.0' } }],
  ])('factsFromPypiJson_%s_isNoAnswer', (_name: string, body: unknown) => {
    // Act
    const facts: PackageFacts | null = factsFromPypiJson(body);

    // Assert
    expect(facts).toBeNull();
  });
});

describe('factsFromSimpleJson', () => {
  it('factsFromSimpleJson_filesOnly_readsVersionsFromTheirNames', () => {
    // Arrange
    const body: unknown = {
      meta: { 'api-version': '1.0' },
      name: 'my-lib',
      files: [
        { filename: 'my_lib-1.0-py3-none-any.whl', yanked: false },
        { filename: 'my-lib-1.2.tar.gz', yanked: false },
        { filename: 'my_lib-2.0-py3-none-any.whl', yanked: 'broken' },
        { filename: 'my_lib-3.0a1-py3-none-any.whl' },
      ],
    };

    // Act
    const facts: PackageFacts | null = factsFromSimpleJson(body);

    // Assert
    expect(facts).toEqual({ name: 'my-lib', latest: '1.2', summary: '' });
  });

  it('factsFromSimpleJson_listedVersions_areUsed_lessTheYankedOnes', () => {
    // Arrange
    const body: unknown = {
      name: 'my-lib',
      versions: ['1.0', '1.1', '1.2'],
      files: [
        { filename: 'my_lib-1.0-py3-none-any.whl', yanked: false },
        { filename: 'my_lib-1.1-py3-none-any.whl', yanked: false },
        { filename: 'my_lib-1.2-py3-none-any.whl', yanked: true },
      ],
    };

    // Act
    const facts: PackageFacts | null = factsFromSimpleJson(body);

    // Assert
    expect(facts?.latest).toBe('1.1');
  });
});

describe('lookUpPackage', () => {
  it('lookUpPackage_pypi_usesTheJsonApiByNormalisedName_withNoCredential', async () => {
    // Arrange
    const calls: { url: string; headers: Record<string, string> | undefined }[] = [];
    const fetchFn: HttpFetch = (
      url: string,
      init?: { headers?: Record<string, string> },
    ): Promise<HttpResponse> => {
      calls.push({ url, headers: init?.headers });
      return Promise.resolve(
        json({ info: { name: 'Typing_Extensions', version: '4.12.2', summary: '' }, releases: {} }),
      );
    };

    // Act
    const facts: PackageFacts | null = await lookUpPackage(
      'Typing_Extensions',
      indexFrom('https://pypi.org/simple')!,
      fetchFn,
    );

    // Assert
    expect(facts?.latest).toBe('4.12.2');
    expect(calls[0].url).toBe('https://pypi.org/pypi/typing-extensions/json');
    expect(calls[0].headers?.['Authorization']).toBeUndefined();
    expect(calls[0].headers?.['User-Agent']).toContain('onixlabs-studio');
  });

  it('lookUpPackage_aPrivateIndex_asksForThePep691FormWithItsCredential', async () => {
    // Arrange
    const index: PipIndex = indexFrom('https://me:pw@pkgs.example.com/simple')!;
    const calls: { url: string; headers: Record<string, string> | undefined }[] = [];
    const fetchFn: HttpFetch = (
      url: string,
      init?: { headers?: Record<string, string> },
    ): Promise<HttpResponse> => {
      calls.push({ url, headers: init?.headers });
      return Promise.resolve(json({ name: 'demo', files: [{ filename: 'demo-1.0.tar.gz' }] }));
    };

    // Act
    const facts: PackageFacts | null = await lookUpPackage('Demo', index, fetchFn);

    // Assert
    expect(facts?.latest).toBe('1.0');
    expect(calls[0].url).toBe('https://pkgs.example.com/simple/demo/');
    expect(calls[0].headers?.['Accept']).toBe('application/vnd.pypi.simple.v1+json');
    expect(calls[0].headers?.['Authorization']).toMatch(/^Basic /);
  });

  it('lookUpPackage_aFailureOrAnHtmlOnlyIndex_isNoAnswer', async () => {
    // Arrange
    const index: PipIndex = indexFrom('https://pkgs.example.com/simple')!;
    const missing: HttpFetch = (): Promise<HttpResponse> => Promise.resolve(json(null, false));
    const html: HttpFetch = (): Promise<HttpResponse> =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: (): Promise<unknown> => Promise.reject(new SyntaxError('html')),
      });
    const offline: HttpFetch = (): Promise<HttpResponse> => Promise.reject(new Error('offline'));

    // Act
    const answers: readonly (PackageFacts | null)[] = await Promise.all(
      [missing, html, offline].map((fetchFn: HttpFetch): Promise<PackageFacts | null> =>
        lookUpPackage('demo', index, fetchFn),
      ),
    );

    // Assert
    expect(answers).toEqual([null, null, null]);
  });
});
