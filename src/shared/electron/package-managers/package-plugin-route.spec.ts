import { describe, expect, it } from 'vitest';
import type {
  PackageManagerModel,
  PackageSearchOptions,
  PackageSearchResult,
} from '@shared/api/package-management';
import type {
  PackageManagerOp,
  PackageManagerResponse,
} from '@shared/api/package-manager-protocol';
import { PackageManagerDescriptor } from './package-manager-descriptor';
import { PackageManagerHost } from './package-manager-host';
import { PackagePluginRoute } from './package-plugin-route';

/**
 * The folder every test asks about.
 */
const ROOT: string = '/workspace';

/**
 * Paging for a search.
 */
const OPTIONS: PackageSearchOptions = { skip: 0, take: 10, prerelease: false };

/**
 * A model a plugin answers with.
 */
const MODEL: PackageManagerModel = { ecosystem: 'npm', root: ROOT, projects: [] };

/**
 * Builds a descriptor.
 * @param id The plugin.
 * @returns Returns the descriptor.
 */
function plugin(id: string): PackageManagerDescriptor {
  return {
    id,
    displayName: id,
    ecosystem: id,
    priority: 100,
    markers: [],
    capabilities: [],
    resolve: () => ({ available: true, spec: { command: 'node', args: [] } }),
  };
}

/**
 * Records what a fake host was asked.
 */
interface FakeHost {
  readonly host: PackageManagerHost;
  readonly asked: string[];
}

/**
 * Builds a fake host.
 * @param answers The answer of each plugin's operation, keyed `plugin op`.
 * @param plugins The plugins that apply, in priority order.
 * @param accepts Whether the folder may be asked about.
 * @returns Returns the fake and its record.
 */
function fakeHost(
  answers: Readonly<Record<string, PackageManagerResponse>>,
  plugins: readonly string[],
  accepts: boolean = true,
): FakeHost {
  const asked: string[] = [];
  const host: Partial<PackageManagerHost> = {
    accepts: (): boolean => accepts,
    pluginsFor: (): Promise<readonly PackageManagerDescriptor[]> =>
      Promise.resolve(plugins.map(plugin)),
    request: (pluginId: string, _root: unknown, op: PackageManagerOp): Promise<never> => {
      asked.push(`${pluginId} ${op}`);
      return Promise.resolve(answers[`${pluginId} ${op}`] as never);
    },
  };
  return { host: host as PackageManagerHost, asked };
}

describe('PackagePluginRoute', () => {
  it('load_declinesWhenNoPluginApplies', async () => {
    const fake: FakeHost = fakeHost({}, []);

    await expect(new PackagePluginRoute(fake.host).load(ROOT)).resolves.toBeNull();
  });

  it('load_askedNothingOfAFolderTheHostWillNotAccept', async () => {
    const fake: FakeHost = fakeHost({}, ['npm'], false);

    await expect(new PackagePluginRoute(fake.host).load(ROOT)).resolves.toBeNull();
    expect(fake.asked).toEqual([]);
  });

  it('load_takesTheFirstPluginWithSomethingToSay', async () => {
    const fake: FakeHost = fakeHost(
      {
        'nuget load': { id: 1, ok: true, result: null },
        'npm load': { id: 2, ok: true, result: MODEL },
      },
      ['nuget', 'npm'],
    );

    await expect(new PackagePluginRoute(fake.host).load(ROOT)).resolves.toEqual(MODEL);
    expect(fake.asked).toEqual(['nuget load', 'npm load']);
  });

  it('load_declinesWhenThePluginFails_soCoreStillAnswers', async () => {
    const fake: FakeHost = fakeHost({ 'npm load': { id: 1, ok: false, error: 'it broke' } }, [
      'npm',
    ]);

    await expect(new PackagePluginRoute(fake.host).load(ROOT)).resolves.toBeNull();
  });

  it('sources_goToThePluginThatLoadedTheFolder', async () => {
    const fake: FakeHost = fakeHost(
      {
        'nuget load': { id: 1, ok: true, result: null },
        'npm load': { id: 2, ok: true, result: MODEL },
        'npm sources': { id: 3, ok: true, result: { sources: [{ name: 'npm' }] } },
      },
      ['nuget', 'npm'],
    );
    const route: PackagePluginRoute = new PackagePluginRoute(fake.host);

    await route.load(ROOT);

    await expect(route.sources(ROOT)).resolves.toEqual([{ name: 'npm' }]);
  });

  it('sources_goToTheFirstPluginThatAppliesBeforeAnythingHasLoaded', async () => {
    const fake: FakeHost = fakeHost(
      { 'npm sources': { id: 1, ok: true, result: { sources: [] } } },
      ['npm'],
    );

    await expect(new PackagePluginRoute(fake.host).sources(ROOT)).resolves.toEqual([]);
    expect(fake.asked).toEqual(['npm sources']);
  });

  it('sources_declineWhenNoPluginServesTheFolder', async () => {
    const fake: FakeHost = fakeHost({}, []);

    await expect(new PackagePluginRoute(fake.host).sources(ROOT)).resolves.toBeNull();
  });

  it('sources_areEmptyForAPluginThatHasNone_ratherThanFallingToCore', async () => {
    const fake: FakeHost = fakeHost(
      { 'npm sources': { id: 1, ok: false, error: 'no', code: 'unsupported' } },
      ['npm'],
    );

    await expect(new PackagePluginRoute(fake.host).sources(ROOT)).resolves.toEqual([]);
  });

  it('sources_declineWhenThePluginFails', async () => {
    const fake: FakeHost = fakeHost({ 'npm sources': { id: 1, ok: false, error: 'it broke' } }, [
      'npm',
    ]);

    await expect(new PackagePluginRoute(fake.host).sources(ROOT)).resolves.toBeNull();
  });

  it('search_goesToThePluginServingTheFolder', async () => {
    const page: PackageSearchResult = { items: [], total: 7, hasMore: true };
    const fake: FakeHost = fakeHost({ 'npm search': { id: 1, ok: true, result: page } }, ['npm']);

    await expect(new PackagePluginRoute(fake.host).search(ROOT, 'npm', 'x', OPTIONS)).resolves.toBe(
      page,
    );
  });

  it('search_declinesInAFolderTheHostWillNotAccept', async () => {
    const fake: FakeHost = fakeHost({}, ['npm'], false);

    await expect(
      new PackagePluginRoute(fake.host).search(ROOT, 'npm', 'x', OPTIONS),
    ).resolves.toBeNull();
    expect(fake.asked).toEqual([]);
  });

  it('search_isAnEmptyPageForAPluginThatCannotSearch', async () => {
    const fake: FakeHost = fakeHost(
      { 'npm search': { id: 1, ok: false, error: 'no', code: 'unsupported' } },
      ['npm'],
    );

    await expect(
      new PackagePluginRoute(fake.host).search(ROOT, 'npm', 'x', OPTIONS),
    ).resolves.toEqual({ items: [], total: 0, hasMore: false });
  });

  it('search_declinesWhenThePluginFails_andForgetsIt', async () => {
    const fake: FakeHost = fakeHost(
      {
        'npm load': { id: 1, ok: true, result: MODEL },
        'npm search': { id: 2, ok: false, error: 'it broke' },
      },
      ['npm'],
    );
    const route: PackagePluginRoute = new PackagePluginRoute(fake.host);
    await route.load(ROOT);

    await expect(route.search(ROOT, 'npm', 'x', OPTIONS)).resolves.toBeNull();
  });
});
