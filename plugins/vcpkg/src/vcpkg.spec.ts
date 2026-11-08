import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HttpFetch, HttpResponse, PackageManagerModel, PackageSearchResult } from './protocol';
import { BaselineStore } from './registry';
import { VcpkgPackageManager } from './vcpkg';

/**
 * The baseline a fixture manifest pins.
 */
const PINNED: string = '1'.repeat(40);

/**
 * The baselines the fake registry serves.
 */
const BASELINES: Record<string, unknown> = {
  [PINNED]: {
    default: {
      fmt: { baseline: '10.1.1', 'port-version': 0 },
      zlib: { baseline: '1.3', 'port-version': 1 },
      protobuf: { baseline: '4.25.1', 'port-version': 0 },
    },
  },
  master: {
    default: {
      fmt: { baseline: '12.2.0', 'port-version': 0 },
      fmtlog: { baseline: '2.3.0', 'port-version': 0 },
      'libfmt-extra': { baseline: '0.1', 'port-version': 0 },
      zlib: { baseline: '1.3.2', 'port-version': 3 },
      protobuf: { baseline: '4.25.1', 'port-version': 0 },
    },
  },
};

/**
 * Builds a fake registry over {@link BASELINES}.
 * @param asked Where the requested URLs are recorded.
 * @returns Returns the fetch.
 */
function fakeRegistry(asked: string[]): HttpFetch {
  return (url: string): Promise<HttpResponse> => {
    asked.push(url);
    const ref: string | undefined = /\/([^/]+)\/versions\/baseline\.json$/.exec(url)?.[1];
    const body: unknown = ref === undefined ? undefined : BASELINES[ref];
    return Promise.resolve({
      ok: body !== undefined,
      status: body === undefined ? 404 : 200,
      json: (): Promise<unknown> => Promise.resolve(body),
    });
  };
}

describe('VcpkgPackageManager', () => {
  let root: string = '';
  let asked: string[] = [];
  let manager: VcpkgPackageManager;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), 'studio-vcpkg-')));
    asked = [];
    manager = new VcpkgPackageManager(
      new BaselineStore('https://registry.test', fakeRegistry(asked)),
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('load_aFolderWithNoManifest_isNull', async () => {
    // Arrange
    writeFileSync(path.join(root, 'CMakeLists.txt'), 'project(x)');

    // Act
    const model: PackageManagerModel | null = await manager.load(root);

    // Assert
    expect(model).toBeNull();
    expect(asked).toEqual([]);
  });

  it('load_aManifest_resolvesBaselineOverrideAndMinimumAgainstLatest', async () => {
    // Arrange
    writeFileSync(
      path.join(root, 'vcpkg.json'),
      JSON.stringify({
        name: 'app',
        'builtin-baseline': PINNED,
        dependencies: [
          'fmt',
          { name: 'zlib', 'version>=': '1.3.1' },
          { name: 'protobuf', host: true },
          'unknown-port',
        ],
        overrides: [{ name: 'fmt', version: '11.0.2' }],
      }),
    );

    // Act
    const model: PackageManagerModel | null = await manager.load(root);

    // Assert
    expect(model).toEqual({
      ecosystem: 'vcpkg',
      root,
      projects: [
        {
          name: 'app',
          manifestPath: path.join(root, 'vcpkg.json'),
          packages: [
            {
              name: 'fmt',
              requested: '11.0.2',
              installed: '11.0.2',
              latest: '12.2.0',
              status: 'outdated',
              scope: 'production',
            },
            {
              name: 'zlib',
              requested: '>= 1.3.1',
              installed: '1.3.1',
              latest: '1.3.2#3',
              status: 'outdated',
              scope: 'production',
            },
            {
              name: 'protobuf',
              requested: 'baseline',
              installed: '4.25.1',
              latest: '4.25.1',
              status: 'current',
              scope: 'development',
            },
            {
              name: 'unknown-port',
              requested: 'baseline',
              installed: null,
              latest: null,
              status: 'unknown',
              scope: 'production',
            },
          ],
        },
      ],
    });
  });

  it('load_aPortFromAnotherRegistry_hasNoVersionsItCannotRead', async () => {
    // Arrange
    writeFileSync(
      path.join(root, 'vcpkg.json'),
      JSON.stringify({ 'builtin-baseline': PINNED, dependencies: ['fmt', 'zlib'] }),
    );
    writeFileSync(
      path.join(root, 'vcpkg-configuration.json'),
      JSON.stringify({
        registries: [
          {
            kind: 'git',
            repository: 'https://example.com/ports.git',
            baseline: PINNED,
            packages: ['zlib'],
          },
        ],
      }),
    );

    // Act
    const model: PackageManagerModel | null = await manager.load(root);

    // Assert
    expect(model?.projects[0].packages).toMatchObject([
      { name: 'fmt', installed: '10.1.1', latest: '12.2.0', status: 'outdated' },
      { name: 'zlib', installed: null, latest: null, status: 'unknown' },
    ]);
  });

  it('load_noBaseline_hasLatestButNoResolvedVersion', async () => {
    // Arrange
    writeFileSync(path.join(root, 'vcpkg.json'), JSON.stringify({ dependencies: ['fmt'] }));

    // Act
    const model: PackageManagerModel | null = await manager.load(root);

    // Assert
    expect(model?.projects[0]).toMatchObject({
      name: path.basename(root),
      packages: [{ name: 'fmt', installed: null, latest: '12.2.0', status: 'unknown' }],
    });
    expect(asked).toEqual(['https://registry.test/master/versions/baseline.json']);
  });

  it('load_aVcpkgCheckoutAndBuildOutput_areNotScanned', async () => {
    // Arrange
    mkdirSync(path.join(root, 'external', 'vcpkg', 'ports', 'fmt'), { recursive: true });
    writeFileSync(path.join(root, 'external', 'vcpkg', '.vcpkg-root'), '');
    writeFileSync(path.join(root, 'external', 'vcpkg', 'ports', 'fmt', 'vcpkg.json'), '{}');
    mkdirSync(path.join(root, 'vcpkg_installed', 'x'), { recursive: true });
    writeFileSync(path.join(root, 'vcpkg_installed', 'x', 'vcpkg.json'), '{}');
    mkdirSync(path.join(root, 'lib'));
    writeFileSync(path.join(root, 'lib', 'vcpkg.json'), 'not json');

    // Act
    const model: PackageManagerModel | null = await manager.load(root);

    // Assert
    expect(model?.projects).toEqual([
      { name: 'lib', manifestPath: path.join(root, 'lib', 'vcpkg.json'), packages: [] },
    ]);
  });

  it('search_aQuery_filtersThePortListExactThenPrefixThenRest', async () => {
    // Arrange
    const query: string = 'FMT';

    // Act
    const page: PackageSearchResult = await manager.search('vcpkg', query, {
      skip: 0,
      take: 2,
      prerelease: false,
    });

    // Assert
    expect(page).toEqual({
      items: [
        {
          name: 'fmt',
          version: '12.2.0',
          description: '',
          downloads: null,
          verified: false,
          sourceName: 'vcpkg',
        },
        {
          name: 'fmtlog',
          version: '2.3.0',
          description: '',
          downloads: null,
          verified: false,
          sourceName: 'vcpkg',
        },
      ],
      total: 3,
      hasMore: true,
    });
  });

  it('search_anEmptyQuery_browsesEveryPort', async () => {
    // Arrange
    const query: string = '';

    // Act
    const page: PackageSearchResult = await manager.search('vcpkg', query, {
      skip: 0,
      take: 50,
      prerelease: false,
    });

    // Assert
    expect(page.total).toBe(5);
    expect(page.hasMore).toBe(false);
  });

  it('search_anUnknownSource_isEmpty', async () => {
    // Arrange
    const source: string = 'my-registry';

    // Act
    const page: PackageSearchResult = await manager.search(source, 'fmt', {
      skip: 0,
      take: 50,
      prerelease: false,
    });

    // Assert
    expect(page).toEqual({ items: [], total: 0, hasMore: false });
    expect(asked).toEqual([]);
  });

  it('search_theRegistryUnreachable_fails', async () => {
    // Arrange
    const offline: VcpkgPackageManager = new VcpkgPackageManager(
      new BaselineStore('https://registry.test', (): Promise<never> =>
        Promise.reject(new Error('x')),
      ),
    );

    // Act
    const searching: Promise<PackageSearchResult> = offline.search('vcpkg', 'fmt', {
      skip: 0,
      take: 50,
      prerelease: false,
    });

    // Assert
    await expect(searching).rejects.toThrow(/could not be reached/);
  });
});
