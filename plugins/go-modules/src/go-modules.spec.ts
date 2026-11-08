import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GoModulesPackageManager } from './go-modules';
import type {
  HttpFetch,
  HttpResponse,
  InstalledPackage,
  PackageManagerModel,
  PackageSearchResult,
} from './protocol';

/**
 * Builds a fake proxy answering version lists from a table of module path to versions, and 404 for
 * anything else. It records the URLs asked for.
 * @param lists The versions each module lists.
 * @returns Returns the fetch and what it saw.
 */
function fakeProxy(lists: Record<string, string[]>): { fetchFn: HttpFetch; seen: string[] } {
  const seen: string[] = [];
  const fetchFn: HttpFetch = (url: string): Promise<HttpResponse> => {
    seen.push(url);
    const match: RegExpExecArray | null = /^https:\/\/proxy\.golang\.org\/(.+)\/@v\/list$/.exec(
      url,
    );
    const versions: string[] | undefined = match === null ? undefined : lists[match[1]];
    const status: number = versions === undefined ? 404 : 200;
    const body: string = versions === undefined ? '' : versions.join('\n');
    return Promise.resolve({
      ok: status === 200,
      status,
      json: (): Promise<unknown> => Promise.resolve({}),
      text: (): Promise<string> => Promise.resolve(body),
    });
  };
  return { fetchFn, seen };
}

describe('GoModulesPackageManager', () => {
  let root: string = '';
  let home: string = '';
  let manager: GoModulesPackageManager;

  /**
   * Writes a file under the folder, making its directories.
   * @param relative The path under the folder.
   * @param text The contents.
   */
  function write(relative: string, text: string): void {
    const file: string = path.join(root, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  }

  /**
   * Finds a package row in a model.
   * @param model The model.
   * @param project The project's name.
   * @param name The package's name.
   * @returns Returns the row.
   */
  function row(
    model: PackageManagerModel | null,
    project: string,
    name: string,
  ): InstalledPackage | undefined {
    return model?.projects
      .find((candidate: { name: string }): boolean => candidate.name === project)
      ?.packages.find((pkg: InstalledPackage): boolean => pkg.name === name);
  }

  beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), 'studio-go-modules-')));
    home = realpathSync(mkdtempSync(path.join(tmpdir(), 'studio-go-home-')));
    // ⛔ A scratch home, and GOENV off: the user's own go env file has no place in a spec.
    manager = new GoModulesPackageManager(() => Promise.resolve(null), {
      HOME: home,
      GOENV: 'off',
    });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  it('load_folderWithNoModule_isNull', async () => {
    await expect(manager.load(root, fakeProxy({}).fetchFn)).resolves.toBeNull();
  });

  it('load_singleModule_listsDirectRequirementsWithSelectedAndLatest', async () => {
    // Arrange
    write(
      'go.mod',
      [
        'module example.com/app',
        'require (',
        '  golang.org/x/mod v0.20.0',
        '  github.com/BurntSushi/toml v1.3.2',
        '  golang.org/x/sys v0.21.0 // indirect',
        '  example.com/unsummed v1.0.0',
        ')',
      ].join('\n'),
    );
    write(
      'go.sum',
      [
        'golang.org/x/mod v0.20.0 h1:a=',
        'github.com/BurntSushi/toml v1.3.2 h1:b=',
        'golang.org/x/sys v0.21.0 h1:c=',
      ].join('\n'),
    );
    const proxy: { fetchFn: HttpFetch; seen: string[] } = fakeProxy({
      'golang.org/x/mod': ['v0.20.0', 'v0.21.0'],
      'github.com/!burnt!sushi/toml': ['v1.3.2'],
      'example.com/unsummed': ['v1.0.0'],
    });

    // Act
    const model: PackageManagerModel | null = await manager.load(root, proxy.fetchFn);

    // Assert
    expect(model?.ecosystem).toBe('go');
    expect(model?.projects).toHaveLength(1);
    expect(model?.projects[0].name).toBe('example.com/app');
    expect(model?.projects[0].manifestPath).toBe(path.join(root, 'go.mod'));
    expect(model?.projects[0].packages).toEqual([
      {
        name: 'golang.org/x/mod',
        requested: 'v0.20.0',
        installed: 'v0.20.0',
        latest: 'v0.21.0',
        status: 'outdated',
        scope: 'production',
      },
      {
        name: 'github.com/BurntSushi/toml',
        requested: 'v1.3.2',
        installed: 'v1.3.2',
        latest: 'v1.3.2',
        status: 'current',
        scope: 'production',
      },
      {
        name: 'example.com/unsummed',
        requested: 'v1.0.0',
        installed: null,
        latest: 'v1.0.0',
        status: 'unknown',
        scope: 'production',
      },
    ]);
    // The indirect requirement is not listed, so it is not looked up either.
    expect(proxy.seen.some((url: string): boolean => url.includes('x/sys'))).toBe(false);
  });

  it('load_replacements_directoryIsNotLookedUpAndModuleIsLookedUpAsItsReplacement', async () => {
    // Arrange
    write(
      'go.mod',
      [
        'module example.com/app',
        'require (',
        '  example.com/local v1.0.0',
        '  example.com/forked v1.0.0',
        '  example.com/pinned v1.2.0',
        ')',
        'replace example.com/local => ../local',
        'replace example.com/forked => example.com/fork v1.0.5',
        'replace example.com/pinned v1.1.0 => ../never-used',
      ].join('\n'),
    );
    write(
      'go.sum',
      ['example.com/fork v1.0.5 h1:a=', 'example.com/pinned v1.2.0/go.mod h1:b='].join('\n'),
    );
    const proxy: { fetchFn: HttpFetch; seen: string[] } = fakeProxy({
      'example.com/fork': ['v1.0.5', 'v1.1.0'],
      'example.com/pinned': ['v1.2.0'],
    });

    // Act
    const model: PackageManagerModel | null = await manager.load(root, proxy.fetchFn);

    // Assert
    expect(row(model, 'example.com/app', 'example.com/local')).toMatchObject({
      installed: null,
      latest: null,
      status: 'unknown',
    });
    expect(row(model, 'example.com/app', 'example.com/forked')).toMatchObject({
      requested: 'v1.0.0',
      installed: 'v1.0.5',
      latest: 'v1.1.0',
      status: 'outdated',
    });
    // A replacement for another version does not apply.
    expect(row(model, 'example.com/app', 'example.com/pinned')).toMatchObject({
      installed: 'v1.2.0',
      status: 'current',
    });
    expect(proxy.seen.some((url: string): boolean => url.includes('example.com/local'))).toBe(
      false,
    );
  });

  it('load_excludedRequirement_isNotInstalledAndExcludedLatestIsPassedOver', async () => {
    // Arrange
    write(
      'go.mod',
      [
        'module example.com/app',
        'require example.com/a v1.0.0',
        'require example.com/b v1.0.0',
        'exclude example.com/a v1.0.0',
        'exclude example.com/b v1.2.0',
      ].join('\n'),
    );
    write('go.sum', 'example.com/a v1.0.0 h1:a=\nexample.com/b v1.0.0 h1:b=\n');
    const proxy: { fetchFn: HttpFetch; seen: string[] } = fakeProxy({
      'example.com/a': ['v1.0.0', 'v1.0.1'],
      'example.com/b': ['v1.0.0', 'v1.1.0', 'v1.2.0'],
    });

    // Act
    const model: PackageManagerModel | null = await manager.load(root, proxy.fetchFn);

    // Assert
    expect(row(model, 'example.com/app', 'example.com/a')).toMatchObject({
      installed: null,
      status: 'unknown',
    });
    expect(row(model, 'example.com/app', 'example.com/b')).toMatchObject({
      latest: 'v1.1.0',
      status: 'outdated',
    });
  });

  it('load_workspace_selectsTheHighestRequirementAndTreatsItsOwnModulesAsLocal', async () => {
    // Arrange
    write('go.work', 'go 1.22\nuse (\n  ./api\n  ./web\n  ../outside\n)\n');
    write('api/go.mod', 'module example.com/api\nrequire golang.org/x/mod v0.18.0\n');
    write(
      'web/go.mod',
      'module example.com/web\nrequire (\n  golang.org/x/mod v0.20.0\n  example.com/api v0.0.0\n)\n',
    );
    write('go.work.sum', 'golang.org/x/mod v0.20.0 h1:a=\n');
    write('tools/go.mod', 'module example.com/tools\nrequire golang.org/x/mod v0.10.0\n');
    write('tools/go.sum', 'golang.org/x/mod v0.10.0 h1:a=\n');
    write('vendor/go.mod', 'module vendored\n');
    write('.hidden/go.mod', 'module hidden\n');
    const proxy: { fetchFn: HttpFetch; seen: string[] } = fakeProxy({
      'golang.org/x/mod': ['v0.20.0'],
    });

    // Act
    const model: PackageManagerModel | null = await manager.load(root, proxy.fetchFn);

    // Assert
    expect(model?.projects.map((project: { name: string }): string => project.name)).toEqual([
      'example.com/api',
      'example.com/web',
      'example.com/tools',
    ]);
    // The workspace selects v0.20.0 for both of its modules, whatever api requires on its own.
    expect(row(model, 'example.com/api', 'golang.org/x/mod')).toMatchObject({
      requested: 'v0.18.0',
      installed: 'v0.20.0',
      status: 'current',
    });
    expect(row(model, 'example.com/web', 'example.com/api')).toMatchObject({
      installed: null,
      latest: null,
    });
    // A module outside the workspace is selected on its own.
    expect(row(model, 'example.com/tools', 'golang.org/x/mod')).toMatchObject({
      installed: 'v0.10.0',
      status: 'outdated',
    });
  });

  it('load_workspaceReplacement_winsOverTheModules', async () => {
    // Arrange
    write('go.work', 'use ./app\nreplace example.com/a => example.com/a v1.5.0\n');
    write(
      'app/go.mod',
      'module example.com/app\nrequire example.com/a v1.0.0\nreplace example.com/a => ../a\n',
    );
    write('app/go.sum', 'example.com/a v1.5.0 h1:a=\n');

    // Act
    const model: PackageManagerModel | null = await manager.load(
      root,
      fakeProxy({ 'example.com/a': ['v1.5.0'] }).fetchFn,
    );

    // Assert
    expect(row(model, 'example.com/app', 'example.com/a')).toMatchObject({
      installed: 'v1.5.0',
      latest: 'v1.5.0',
      status: 'current',
    });
  });

  it('listSources_default_isTheGoProxyByName', async () => {
    await expect(manager.listSources()).resolves.toEqual([{ name: 'proxy.golang.org' }]);
  });

  it('listSources_proxyOff_isNone', async () => {
    // Arrange
    const off: GoModulesPackageManager = new GoModulesPackageManager(() => Promise.resolve(null), {
      HOME: home,
      GOENV: 'off',
      GOPROXY: 'off',
    });

    // Act, Assert
    await expect(off.listSources()).resolves.toEqual([]);
  });

  it('search_exactPath_answersThatModuleOrNothing', async () => {
    // Arrange
    const proxy: { fetchFn: HttpFetch; seen: string[] } = fakeProxy({
      'golang.org/x/mod': ['v0.20.0'],
    });
    const options: { skip: number; take: number; prerelease: boolean } = {
      skip: 0,
      take: 20,
      prerelease: false,
    };

    // Act
    const found: PackageSearchResult = await manager.search(
      'proxy.golang.org',
      ' golang.org/x/mod ',
      options,
      proxy.fetchFn,
    );
    const missing: PackageSearchResult = await manager.search(
      'proxy.golang.org',
      'mod',
      options,
      proxy.fetchFn,
    );
    const nextPage: PackageSearchResult = await manager.search(
      'proxy.golang.org',
      'golang.org/x/mod',
      { ...options, skip: 20 },
      proxy.fetchFn,
    );

    // Assert
    expect(found).toEqual({
      items: [
        {
          name: 'golang.org/x/mod',
          version: 'v0.20.0',
          description: '',
          downloads: null,
          verified: false,
          sourceName: 'proxy.golang.org',
        },
      ],
      total: 1,
      hasMore: false,
    });
    expect(missing.items).toEqual([]);
    expect(nextPage.items).toEqual([]);
  });
});
