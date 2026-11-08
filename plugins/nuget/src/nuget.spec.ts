import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  HttpFetch,
  HttpResponse,
  InstalledPackage,
  PackageManagerModel,
  PackageProject,
  PackageSearchResult,
} from './protocol';

/**
 * The home directory the code under test sees.
 *
 * ⛔ `readNuGetSources` reads `~/.nuget/NuGet/NuGet.Config`, which holds cleartext feed passwords on a
 * real machine, on every load, list and search. The home here is a temp directory or nothing: reading
 * it while unset throws, so a path this spec got wrong fails rather than reaching the real file.
 */
const fakeHome: { path: string | null; tmp: string } = vi.hoisted(() => ({
  path: null,
  tmp: '',
}));

vi.mock('node:os', async (importOriginal: () => Promise<typeof import('node:os')>) => {
  const real: typeof import('node:os') = await importOriginal();
  const homedir: () => string = (): string => {
    if (fakeHome.path === null) {
      throw new Error('The spec has no fake home; refusing to read the real one.');
    }
    return fakeHome.path;
  };
  const tmpdir: () => string = (): string => real.tmpdir();
  return { homedir, tmpdir, default: { homedir, tmpdir } };
});

// Imported only now, behind the mocks above, so nothing of it can bind to the real modules.
const { NuGetPackageManager } = await import('./nuget');
const { tmpdir } = await import('node:os');

/**
 * nuget.org's service index.
 */
const NUGET_ORG: string = 'https://api.nuget.org/v3/index.json';

/**
 * Builds a response.
 * @param body The JSON body.
 * @param status The status.
 * @returns Returns the response.
 */
function json(body: unknown, status: number = 200): HttpResponse {
  return {
    ok: status < 400,
    status,
    json: (): Promise<unknown> => Promise.resolve(body),
  };
}

/**
 * A request a fake registry received.
 */
interface Received {
  readonly url: string;
  readonly authorization: string | undefined;
}

describe('NuGetPackageManager', () => {
  let root: string;
  let manager: InstanceType<typeof NuGetPackageManager>;
  let received: Received[];
  let versions: Record<string, readonly string[]>;
  let serving: number;
  let peak: number;

  /**
   * Writes a file under a directory, making its parents.
   * @param base The directory.
   * @param name The relative path.
   * @param content The content.
   */
  function write(base: string, name: string, content: string): void {
    const file: string = path.join(base, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }

  /**
   * Writes a project declaring packages.
   * @param name The relative project path.
   * @param references The id and version of each package; a null version leaves it to central props.
   */
  function project(name: string, references: readonly [string, string | null][] = []): void {
    const items: string = references
      .map(([id, version]: [string, string | null]): string =>
        version === null
          ? `<PackageReference Include="${id}" />`
          : `<PackageReference Include="${id}" Version="${version}" />`,
      )
      .join('');
    write(root, name, `<Project><ItemGroup>${items}</ItemGroup></Project>`);
  }

  /**
   * Serves a registry: nuget.org's index, and each package's versions on the flat container of the host
   * asked.
   * @param url The URL.
   * @param init The request's options.
   * @returns Returns the response.
   */
  const registry: HttpFetch = async (
    url: string,
    init?: { headers?: Record<string, string> },
  ): Promise<HttpResponse> => {
    received.push({ url, authorization: init?.headers?.['Authorization'] });
    serving += 1;
    peak = Math.max(peak, serving);
    await new Promise<void>((resolve: () => void): void => void setImmediate(resolve));
    serving -= 1;
    if (url.endsWith('/v3/index.json')) {
      const base: string = url.replace('/v3/index.json', '/flat/');
      return json({ resources: [{ '@type': 'PackageBaseAddress/3.0.0', '@id': base }] });
    }
    const id: string | undefined = /\/flat\/([^/]+)\/index\.json$/.exec(url)?.[1];
    const known: readonly string[] | undefined = id === undefined ? undefined : versions[id];
    return known === undefined ? json({}, 404) : json({ versions: known });
  };

  /**
   * Loads the model, requiring there to be one.
   * @returns Returns the model.
   */
  async function load(): Promise<PackageManagerModel> {
    const model: PackageManagerModel | null = await manager.load(root, registry);
    if (model === null) {
      throw new Error('Expected a model.');
    }
    return model;
  }

  /**
   * Loads the one project's packages.
   * @returns Returns them.
   */
  async function packages(): Promise<readonly InstalledPackage[]> {
    const model: PackageManagerModel = await load();
    expect(model.projects).toHaveLength(1);
    return model.projects[0].packages;
  }

  beforeEach(() => {
    const scratch: string = mkdtempSync(path.join(tmpdir(), 'nuget-manager-'));
    fakeHome.tmp = scratch;
    fakeHome.path = path.join(scratch, 'home');
    mkdirSync(fakeHome.path);
    root = path.join(scratch, 'repo');
    mkdirSync(root);
    manager = new NuGetPackageManager();
    received = [];
    versions = {};
    serving = 0;
    peak = 0;
    // ⛔ The registry is always the injected one; this catches a path that forgot.
    vi.stubGlobal('fetch', (): never => {
      throw new Error('A spec must not reach the network.');
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(fakeHome.tmp, { recursive: true, force: true });
    fakeHome.path = null;
  });

  describe('load', () => {
    it('hasNoModel_withNoProjects_andAsksNoRegistry', async () => {
      expect(await manager.load(root, registry)).toBeNull();
      expect(received).toEqual([]);
    });

    it('readsEveryProjectLanguage_withItsName', async () => {
      project('src/A/A.csproj');
      project('src/B/B.fsproj');
      project('src/C/C.vbproj');

      const model: PackageManagerModel = await load();

      expect(model.projects.map((entry: PackageProject): string => entry.name).sort()).toEqual([
        'A',
        'B',
        'C',
      ]);
    });

    it('neverDescendsIntoBuildOutputDependenciesOrHiddenFolders', async () => {
      project('App.csproj');
      project('bin/Debug/Copy.csproj');
      project('obj/Copy.csproj');
      project('node_modules/pkg/Copy.csproj');
      project('.git/Copy.csproj');

      expect((await load()).projects).toHaveLength(1);
    });

    it('stopsDescending_atTheScanDepth', async () => {
      project('1/2/3/4/5/Shallow.csproj');
      project('1/2/3/4/5/6/Deep.csproj');

      const model: PackageManagerModel = await load();

      expect(model.projects.map((entry: PackageProject): string => entry.name)).toEqual([
        'Shallow',
      ]);
    });

    it('survivesAProjectFileThatIsNotXml', async () => {
      write(root, 'Broken.csproj', '\u0000not xml at all <<<');

      expect(await packages()).toEqual([]);
    });

    it('reportsAnOutdatedPackage_againstWhatItDeclares', async () => {
      project('App.csproj', [['Serilog', '3.0.0']]);
      versions['serilog'] = ['3.0.0', '4.1.0'];

      expect(await packages()).toEqual([
        expect.objectContaining({
          name: 'Serilog',
          requested: '3.0.0',
          installed: null,
          latest: '4.1.0',
          status: 'outdated',
        }),
      ]);
    });

    it('takesARangesFloor_asTheBaseline', async () => {
      project('App.csproj', [['Serilog', '[4.1.0,)']]);
      versions['serilog'] = ['4.1.0'];

      expect((await packages())[0].status).toBe('current');
    });

    it('cannotCompare_aVersionWithNoNumberInIt', async () => {
      project('App.csproj', [['Serilog', '$(SerilogVersion)']]);
      versions['serilog'] = ['4.1.0'];

      const [row]: readonly InstalledPackage[] = await packages();

      expect(row.requested).toBe('$(SerilogVersion)');
      expect(row.status).toBe('unknown');
    });

    it('leavesLatestEmpty_whenNoRegistryKnowsThePackage', async () => {
      project('App.csproj', [['Private.Thing', '1.0.0']]);

      const [row]: readonly InstalledPackage[] = await packages();

      expect(row.latest).toBeNull();
      expect(row.status).toBe('unknown');
    });

    it('survivesARegistryThatThrows', async () => {
      project('App.csproj', [['Serilog', '1.0.0']]);

      const model: PackageManagerModel | null = await manager.load(
        root,
        (): Promise<HttpResponse> => Promise.reject(new Error('ETIMEDOUT')),
      );

      expect(model?.projects[0].packages[0].latest).toBeNull();
    });

    it('asksOncePerPackage_acrossProjects', async () => {
      project('A/A.csproj', [['Serilog', '1.0.0']]);
      project('B/B.csproj', [['Serilog', '2.0.0']]);
      versions['serilog'] = ['2.0.0'];

      await load();

      const asked: readonly Received[] = received.filter((request: Received): boolean =>
        request.url.includes('/flat/serilog/'),
      );
      expect(asked).toHaveLength(1);
    });

    it('asksTheRegistryALittleAtATime', async () => {
      const many: [string, string][] = Array.from(
        { length: 40 },
        (_unused: unknown, index: number): [string, string] => [`Package${index}`, '1.0.0'],
      );
      project('App.csproj', many);

      await load();

      expect(peak).toBeGreaterThan(1);
      expect(peak).toBeLessThanOrEqual(8);
    });

    describe('central package management', () => {
      /**
       * Writes a central props file.
       * @param name The relative path.
       * @param id The package.
       * @param version The version.
       */
      function props(name: string, id: string, version: string): void {
        write(
          root,
          name,
          `<Project><ItemGroup><PackageVersion Include="${id}" Version="${version}" /></ItemGroup></Project>`,
        );
      }

      it('fillsInAVersionLessReference', async () => {
        project('src/App/App.csproj', [['Serilog', null]]);
        props('Directory.Packages.props', 'Serilog', '3.1.0');

        expect((await packages())[0].requested).toBe('3.1.0');
      });

      it('prefersTheNearestProps', async () => {
        project('src/App/App.csproj', [['Serilog', null]]);
        props('Directory.Packages.props', 'Serilog', '1.0.0');
        props('src/Directory.Packages.props', 'Serilog', '2.0.0');

        expect((await packages())[0].requested).toBe('2.0.0');
      });

      it('leavesAnExplicitVersionAlone', async () => {
        project('App.csproj', [['Serilog', '9.0.0']]);
        props('Directory.Packages.props', 'Serilog', '1.0.0');

        expect((await packages())[0].requested).toBe('9.0.0');
      });

      it('neverLooksAboveTheWorkspaceRoot', async () => {
        project('App.csproj', [['Serilog', null]]);
        write(
          path.dirname(root),
          'Directory.Packages.props',
          '<Project><ItemGroup><PackageVersion Include="Serilog" Version="1.0.0" /></ItemGroup></Project>',
        );

        expect((await packages())[0].requested).toBe('');
      });

      it('readsAChangedPropsOnTheNextLoad', async () => {
        project('App.csproj', [['Serilog', null]]);
        props('Directory.Packages.props', 'Serilog', '1.0.0');
        await packages();

        props('Directory.Packages.props', 'Serilog', '2.0.0');

        expect((await packages())[0].requested).toBe('2.0.0');
      });
    });

    it('addsLegacyPackagesConfigEntries', async () => {
      project('App.csproj');
      write(
        root,
        'packages.config',
        '<packages><package id="Newtonsoft.Json" version="13.0.1" /></packages>',
      );

      expect((await packages()).map((row: InstalledPackage): string => row.name)).toEqual([
        'Newtonsoft.Json',
      ]);
    });

    describe('installed versions', () => {
      const lock: string = JSON.stringify({
        dependencies: { 'net8.0': { Serilog: { resolved: '3.0.5' } } },
      });
      const assets: string = JSON.stringify({
        libraries: { 'Serilog/3.0.7': { type: 'package' } },
      });

      beforeEach(() => {
        project('App.csproj', [['Serilog', '3.0.0']]);
      });

      it('comeFromTheLockfile', async () => {
        write(root, 'packages.lock.json', lock);

        expect((await packages())[0].installed).toBe('3.0.5');
      });

      it('comeFromTheRestoreOutput_withNoLockfile', async () => {
        write(root, 'obj/project.assets.json', assets);

        expect((await packages())[0].installed).toBe('3.0.7');
      });

      it('preferTheLockfile_overTheRestoreOutput', async () => {
        write(root, 'packages.lock.json', lock);
        write(root, 'obj/project.assets.json', assets);

        expect((await packages())[0].installed).toBe('3.0.5');
      });

      it('fallBackToTheRestoreOutput_pastACorruptLockfile', async () => {
        write(root, 'packages.lock.json', '{ not json');
        write(root, 'obj/project.assets.json', assets);

        expect((await packages())[0].installed).toBe('3.0.7');
      });

      it('fallBackToTheRestoreOutput_pastAnEmptyLockfile', async () => {
        write(root, 'packages.lock.json', '{}');
        write(root, 'obj/project.assets.json', assets);

        expect((await packages())[0].installed).toBe('3.0.7');
      });

      it('areAbsent_whenBothAreCorrupt', async () => {
        write(root, 'packages.lock.json', '{ not json');
        write(root, 'obj/project.assets.json', 'also not json');

        expect((await packages())[0].installed).toBeNull();
      });
    });
  });

  describe('sources and credentials', () => {
    /**
     * Writes a config declaring a feed, optionally with credentials.
     * @param base The directory.
     * @param name The file's relative path.
     * @param url The feed's URL, or null to declare only credentials.
     * @param password The password, or null to declare none.
     */
    function config(base: string, name: string, url: string | null, password: string | null): void {
      const source: string =
        url === null ? '' : `<packageSources><add key="private" value="${url}" /></packageSources>`;
      const credential: string =
        password === null
          ? ''
          : `<packageSourceCredentials><private><add key="Username" value="me" />` +
            `<add key="ClearTextPassword" value="${password}" /></private></packageSourceCredentials>`;
      write(base, name, `<configuration>${source}${credential}</configuration>`);
    }

    /**
     * The fake home's user-level config path.
     * @returns Returns the path, relative to the fake home.
     */
    function userConfig(): string {
      return path.join('.nuget', 'NuGet', 'NuGet.Config');
    }

    /**
     * Says what a password encodes to as a basic header.
     * @param password The password.
     * @returns Returns the header.
     */
    function basic(password: string): string {
      return `Basic ${Buffer.from(`me:${password}`).toString('base64')}`;
    }

    it('readsTheUserConfig_fromTheFakeHome', async () => {
      // The sentinel for this whole spec: what `readNuGetSources` reads really is the temp home.
      config(fakeHome.path ?? '', userConfig(), 'https://feed.example/v3/index.json', null);

      expect(await manager.listSources(root)).toEqual([{ name: 'nuget.org' }, { name: 'private' }]);
    });

    it('listsOnlyNames_neverAUrlOrACredential', async () => {
      config(root, 'nuget.config', 'https://feed.example/v3/index.json', 'secret');

      const listed: string = JSON.stringify(await manager.listSources(root));

      expect(listed).not.toContain('secret');
      expect(listed).not.toContain('feed.example');
    });

    it('sendsAFeedsCredential_toThatFeedAlone', async () => {
      project('App.csproj', [['Serilog', '1.0.0']]);
      config(root, 'nuget.config', 'https://feed.example/v3/index.json', 'secret');

      await load();

      const toFeed: readonly Received[] = received.filter((request: Received): boolean =>
        request.url.startsWith('https://feed.example/'),
      );
      const toPublic: readonly Received[] = received.filter((request: Received): boolean =>
        request.url.startsWith('https://api.nuget.org/'),
      );
      expect(toFeed.length).toBeGreaterThan(0);
      expect(toPublic.length).toBeGreaterThan(0);
      expect(toFeed.every((request) => request.authorization === basic('secret'))).toBe(true);
      expect(toPublic.every((request) => request.authorization === undefined)).toBe(true);
    });

    it('appliesARepositorysFeed_withTheUsersCredentialSavedBesideTheSameUrl', async () => {
      // Arrange
      project('App.csproj', [['Serilog', '1.0.0']]);
      config(root, 'nuget.config', 'https://feed.example/v3/index.json', null);
      config(fakeHome.path ?? '', userConfig(), 'https://feed.example/v3/index.json', 'secret');

      // Act
      await load();

      // Assert
      expect(
        received.find((request: Received): boolean => request.url.includes('feed.example'))
          ?.authorization,
      ).toBe(basic('secret'));
    });

    it('load_userCredentialSavedWithoutItsFeed_isSentToNoFeedARepositoryNames', async () => {
      // Arrange: a credential saved with no URL beside it cannot be told apart from one a repository
      // is fishing for, so it goes nowhere.
      project('App.csproj', [['Serilog', '1.0.0']]);
      config(root, 'nuget.config', 'https://feed.example/v3/index.json', null);
      config(fakeHome.path ?? '', userConfig(), null, 'secret');

      // Act
      await load();

      // Assert
      const toFeed: readonly Received[] = received.filter((request: Received): boolean =>
        request.url.includes('feed.example'),
      );
      expect(toFeed.length).toBeGreaterThan(0);
      expect(
        toFeed.every((request: Received): boolean => request.authorization === undefined),
      ).toBe(true);
    });

    // #1365: a credential is bound to the URL its source had in the config that saved it.
    it('keepsAUsersCredential_fromAFeedARepositoryRepointed', async () => {
      project('App.csproj', [['Serilog', '1.0.0']]);
      config(fakeHome.path ?? '', userConfig(), 'https://feed.example/v3/index.json', 'secret');
      config(root, 'nuget.config', 'https://attacker.example/v3/index.json', null);

      await load();

      expect(
        received.find((request: Received): boolean => request.url.includes('attacker.example'))
          ?.authorization,
      ).toBeUndefined();
    });

    it('goesWithoutThePublicFeed_whenAConfigClearsIt', async () => {
      write(
        root,
        'nuget.config',
        '<configuration><packageSources><clear /><add key="only" value="https://only.example/v3/index.json" /></packageSources></configuration>',
      );

      expect(await manager.listSources(root)).toEqual([{ name: 'only' }]);
    });

    it('fallsBackToThePublicFeed_pastACorruptConfig', async () => {
      write(root, 'nuget.config', '<configuration><packageSources');

      expect(await manager.listSources(root)).toEqual(
        expect.arrayContaining([{ name: 'nuget.org' }]),
      );
    });

    it('triesTheNextSource_whenOneDoesNotHaveThePackage', async () => {
      project('App.csproj', [['Serilog', '1.0.0']]);
      config(root, 'nuget.config', 'https://feed.example/v3/index.json', null);
      versions['serilog'] = ['2.0.0'];

      expect((await packages())[0].latest).toBe('2.0.0');
    });
  });

  describe('search', () => {
    const page: { skip: number; take: number; prerelease: boolean } = {
      skip: 0,
      take: 20,
      prerelease: false,
    };

    it('findsNothing_inASourceThatDoesNotExist', async () => {
      expect(await manager.search(root, 'nowhere', 'x', page, registry)).toEqual({
        items: [],
        total: 0,
        hasMore: false,
      });
      expect(received).toEqual([]);
    });

    it('asksTheServiceTheSourceNames_withTheQueryEscaped', async () => {
      const urls: string[] = [];
      const search: HttpFetch = (url: string): Promise<HttpResponse> => {
        urls.push(url);
        return Promise.resolve(
          url === NUGET_ORG
            ? json({
                resources: [
                  { '@type': 'SearchQueryService', '@id': 'https://search.example/query' },
                ],
              })
            : json({ totalHits: 3, data: [{ id: 'Serilog', version: '4.0.0' }] }),
        );
      };

      const result: PackageSearchResult = await manager.search(
        root,
        'nuget.org',
        'a&b=c',
        page,
        search,
      );

      expect(urls[1]).toContain('q=a%26b%3Dc');
      expect(result.total).toBe(3);
      expect(result.hasMore).toBe(true);
    });

    it('asksForTheServiceOnce_acrossPages', async () => {
      const urls: string[] = [];
      const search: HttpFetch = (url: string): Promise<HttpResponse> => {
        urls.push(url);
        return Promise.resolve(
          url === NUGET_ORG
            ? json({
                resources: [
                  { '@type': 'SearchQueryService', '@id': 'https://search.example/query' },
                ],
              })
            : json({ totalHits: 0, data: [] }),
        );
      };

      await manager.search(root, 'nuget.org', 'x', page, search);
      await manager.search(root, 'nuget.org', 'x', { ...page, skip: 20 }, search);

      expect(urls.filter((url: string): boolean => url === NUGET_ORG)).toHaveLength(1);
    });

    it('comesBackEmpty_whenTheRegistryFails', async () => {
      const failing: HttpFetch = (): Promise<HttpResponse> =>
        Promise.reject(new Error('ETIMEDOUT'));

      expect(await manager.search(root, 'nuget.org', 'x', page, failing)).toEqual({
        items: [],
        total: 0,
        hasMore: false,
      });
    });
  });
});
