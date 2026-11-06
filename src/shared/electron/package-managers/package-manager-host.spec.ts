import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PackageCommand,
  PackageManagerCapability,
  PackageManagerDescription,
  PackageManagerOp,
  PackageManagerResponse,
} from '@shared/api/package-manager-protocol';
import { RepositoryTrustDecision } from '@shared/api/source-control-channels';
import { WorkspaceContext } from '../workspace-context';
import { PackageManagerCredentialSource } from './package-manager-client';
import { PackageManagerDescriptor } from './package-manager-descriptor';
import { PackageManagerEndpoint } from './package-manager-endpoint';
import {
  PackageManagerDirectoryEntry,
  PackageManagerHost,
  PackageManagerHostOptions,
} from './package-manager-host';

/**
 * The open workspace root every test works inside.
 */
const ROOT: string = path.resolve('/studio-pm-host/repo');

/**
 * A project manifest inside {@link ROOT}.
 */
const PROJECT: string = path.join(ROOT, 'package.json');

/**
 * Records what a fake client was asked.
 */
interface FakeClient {
  readonly client: PackageManagerEndpoint;
  readonly requests: { op: PackageManagerOp; root: string; params: unknown }[];
  readonly starts: { count: number };
  disposed: boolean;
  credentials: PackageManagerCredentialSource | null;
  answer: (op: PackageManagerOp) => unknown;
  release: () => void;
}

/**
 * Builds a fake client that confirms the given capabilities and answers with `answer`. Answers are held
 * until `release` when `hold` is set, to test sharing.
 * @param confirmed The capabilities the handshake confirms.
 * @param hold Whether to hold answers until released.
 * @returns Returns the fake and its records.
 */
function fakeClient(
  confirmed: readonly PackageManagerCapability[],
  hold: boolean = false,
): FakeClient {
  const waiting: (() => void)[] = [];
  const fake: FakeClient = {
    requests: [],
    starts: { count: 0 },
    disposed: false,
    credentials: null,
    answer: (op: PackageManagerOp): unknown => op,
    release: (): void => {
      for (const resume of waiting.splice(0)) {
        resume();
      }
    },
    client: {
      get running(): boolean {
        return fake.starts.count > 0 && !fake.disposed;
      },
      start: (): Promise<PackageManagerDescription> => {
        fake.starts.count += 1;
        return Promise.resolve({ protocol: '1.0', capabilities: confirmed, toolVersion: null });
      },
      request: async <Op extends PackageManagerOp>(
        op: Op,
        root: string,
        params: unknown,
      ): Promise<PackageManagerResponse<Op>> => {
        fake.requests.push({ op, root, params });
        if (hold) {
          await new Promise<void>((resume: () => void): void => {
            waiting.push(resume);
          });
        }
        return { id: 1, ok: true, result: fake.answer(op) } as PackageManagerResponse<Op>;
      },
      dispose: (): void => {
        fake.disposed = true;
      },
    },
  };
  return fake;
}

/**
 * Builds a descriptor for an installed plugin.
 * @param overrides Fields to replace.
 * @returns Returns the descriptor.
 */
function descriptor(overrides: Partial<PackageManagerDescriptor> = {}): PackageManagerDescriptor {
  return {
    id: 'npm',
    displayName: 'npm',
    ecosystem: 'npm',
    priority: 100,
    markers: ['package.json'],
    capabilities: ['sources', 'search', 'install', 'update', 'remove', 'restore'],
    resolve: () => ({ available: true, spec: { command: 'node', args: [] } }),
    ...overrides,
  };
}

/**
 * Builds a host over a fake client, with {@link ROOT} open and trusted.
 * @param fake The client.
 * @param overrides Options to replace.
 * @param plugins The contributed plugins.
 * @returns Returns the host.
 */
function hostFor(
  fake: FakeClient,
  overrides: Partial<PackageManagerHostOptions> = {},
  plugins: readonly PackageManagerDescriptor[] = [descriptor()],
): PackageManagerHost {
  const workspace: WorkspaceContext = new WorkspaceContext();
  workspace.addRoot(ROOT);
  return new PackageManagerHost({
    descriptors: () => plugins,
    roots: workspace,
    trust: { decisionFor: (): RepositoryTrustDecision => 'trusted' },
    credential: () => Promise.resolve(null),
    createClient: (
      _id: string,
      _spec: unknown,
      credentials: PackageManagerCredentialSource,
    ): PackageManagerEndpoint => {
      fake.credentials = credentials;
      return fake.client;
    },
    ...overrides,
  });
}

/**
 * Builds a directory lister over a fixed tree.
 * @param tree The entries of each directory, keyed by path relative to {@link ROOT}.
 * @returns Returns the lister.
 */
function lister(
  tree: Readonly<Record<string, readonly string[]>>,
): (directory: string) => Promise<readonly PackageManagerDirectoryEntry[]> {
  return (directory: string): Promise<readonly PackageManagerDirectoryEntry[]> =>
    Promise.resolve(
      (tree[path.relative(ROOT, directory)] ?? []).map(
        (name: string): PackageManagerDirectoryEntry => ({
          name: name.replace(/\/$/, ''),
          directory: name.endsWith('/'),
        }),
      ),
    );
}

/**
 * Gets the ids of descriptors.
 * @param descriptors The descriptors.
 * @returns Returns the ids.
 */
function ids(descriptors: readonly PackageManagerDescriptor[]): readonly string[] {
  return descriptors.map((entry: PackageManagerDescriptor): string => entry.id);
}

describe('PackageManagerHost', () => {
  describe('detection', () => {
    const npm: PackageManagerDescriptor = descriptor();
    const nuget: PackageManagerDescriptor = descriptor({
      id: 'nuget',
      ecosystem: 'nuget',
      priority: 50,
      markers: ['*.sln', '*.csproj'],
    });

    it('detect_appliesEveryPluginWhoseMarkerTheFolderHolds', async () => {
      const host: PackageManagerHost = hostFor(
        fakeClient([]),
        { listDirectory: lister({ '': ['package.json', 'Shop.sln'] }) },
        [nuget, npm],
      );

      expect(ids(await host.detect(ROOT))).toEqual(['npm', 'nuget']);
    });

    it('detect_findsAMarkerShallowlyUnderTheFolder', async () => {
      const host: PackageManagerHost = hostFor(
        fakeClient([]),
        {
          listDirectory: lister({
            '': ['src/'],
            src: ['Api/'],
            'src/Api': ['Api.csproj'],
          }),
        },
        [npm, nuget],
      );

      expect(ids(await host.detect(ROOT))).toEqual(['nuget']);
    });

    it('detect_ignoresAMarkerDeeperThanTheScanGoes', async () => {
      const host: PackageManagerHost = hostFor(
        fakeClient([]),
        { listDirectory: lister({ '': ['a/'], a: ['b/'], 'a/b': ['c/'], 'a/b/c': ['d/'] }) },
        [npm],
      );

      await expect(host.detect(ROOT)).resolves.toEqual([]);
    });

    it('detect_doesNotEnterGeneratedOrHiddenDirectories', async () => {
      const host: PackageManagerHost = hostFor(
        fakeClient([]),
        {
          listDirectory: lister({
            '': ['node_modules/', '.git/'],
            node_modules: ['package.json'],
            '.git': ['package.json'],
          }),
        },
        [npm],
      );

      await expect(host.detect(ROOT)).resolves.toEqual([]);
    });

    it('detect_wildcardStaysWithinTheName', async () => {
      const host: PackageManagerHost = hostFor(
        fakeClient([]),
        { listDirectory: lister({ '': ['notes.csproj.txt'] }) },
        [nuget],
      );

      await expect(host.detect(ROOT)).resolves.toEqual([]);
    });

    it('detect_answersNothingForAFolderThatIsNotOpen', async () => {
      let listed: boolean = false;
      const host: PackageManagerHost = hostFor(fakeClient([]), {
        listDirectory: () => {
          listed = true;
          return Promise.resolve([{ name: 'package.json', directory: false }]);
        },
      });

      await expect(host.detect(path.resolve('/elsewhere'))).resolves.toEqual([]);
      await expect(host.detect('relative')).resolves.toEqual([]);
      await expect(host.detect(7)).resolves.toEqual([]);
      expect(listed).toBe(false);
    });

    it('detect_listsAnUninstalledPlugin_butPluginsForDoesNot', async () => {
      const uninstalled: PackageManagerDescriptor = descriptor({
        resolve: () => ({ available: false, reason: 'npm is not installed.' }),
      });
      const host: PackageManagerHost = hostFor(
        fakeClient([]),
        { listDirectory: lister({ '': ['package.json'] }) },
        [uninstalled],
      );

      expect(ids(await host.detect(ROOT))).toEqual(['npm']);
      await expect(host.pluginsFor(ROOT)).resolves.toEqual([]);
    });
  });

  describe('confinement', () => {
    it('request_refusesAFolderOutsideEveryOpenRoot', async () => {
      const fake: FakeClient = fakeClient([]);
      const host: PackageManagerHost = hostFor(fake);

      const response: PackageManagerResponse<'load'> = await host.request(
        'npm',
        path.resolve('/elsewhere'),
        'load',
        {},
      );

      expect(response).toMatchObject({ ok: false, code: 'refused' });
      expect(fake.starts.count).toBe(0);
    });

    it('request_refusesARelativeOrNonStringFolder', async () => {
      const fake: FakeClient = fakeClient([]);
      const host: PackageManagerHost = hostFor(fake);

      await expect(host.request('npm', 'repo', 'load', {})).resolves.toMatchObject({ ok: false });
      await expect(host.request('npm', 7, 'load', {})).resolves.toMatchObject({ ok: false });
      expect(fake.starts.count).toBe(0);
    });

    it('request_refusesTraversalOutOfAnOpenRoot', async () => {
      const fake: FakeClient = fakeClient([]);
      const host: PackageManagerHost = hostFor(fake);

      const response: PackageManagerResponse<'load'> = await host.request(
        'npm',
        `${ROOT}${path.sep}..${path.sep}..${path.sep}etc`,
        'load',
        {},
      );

      expect(response).toMatchObject({ ok: false, code: 'refused' });
      expect(fake.requests).toEqual([]);
    });

    it('request_acceptsAFolderInsideAnOpenRoot', async () => {
      const fake: FakeClient = fakeClient([]);
      const host: PackageManagerHost = hostFor(fake);

      await host.request('npm', path.join(ROOT, 'web'), 'load', {});

      expect(fake.requests[0].root).toBe(path.join(ROOT, 'web'));
    });

    it('request_refusesTheHandshake', async () => {
      const fake: FakeClient = fakeClient([]);
      const host: PackageManagerHost = hostFor(fake);

      const response: PackageManagerResponse<'initialize'> = await host.request(
        'npm',
        ROOT,
        'initialize',
        { protocol: '1.0' },
      );

      expect(response).toMatchObject({ ok: false, code: 'refused' });
    });

    it('request_refusesAPluginNobodyContributed', async () => {
      const host: PackageManagerHost = hostFor(fakeClient([]));

      await expect(host.request('cargo', ROOT, 'load', {})).resolves.toMatchObject({
        ok: false,
        code: 'refused',
      });
    });

    it.each<RepositoryTrustDecision>(['unknown', 'restricted'])(
      'request_runsNothingInA%sFolder',
      async (decision: RepositoryTrustDecision) => {
        const fake: FakeClient = fakeClient([]);
        const host: PackageManagerHost = hostFor(fake, {
          trust: { decisionFor: (): RepositoryTrustDecision => decision },
        });

        const response: PackageManagerResponse<'load'> = await host.request(
          'npm',
          ROOT,
          'load',
          {},
        );

        expect(response).toMatchObject({ ok: false, code: 'untrusted' });
        expect(fake.starts.count).toBe(0);
        expect(host.accepts(ROOT)).toBe(false);
      },
    );

    it('accepts_isTrueForAnOpenTrustedFolder_andFalseElsewhere', () => {
      const host: PackageManagerHost = hostFor(fakeClient([]));

      expect(host.accepts(ROOT)).toBe(true);
      expect(host.accepts(path.resolve('/elsewhere'))).toBe(false);
    });

    it('request_refusesAWriteNamingAProjectOutsideTheFolder', async () => {
      const fake: FakeClient = fakeClient(['remove']);
      const host: PackageManagerHost = hostFor(fake);

      const response: PackageManagerResponse<'remove'> = await host.request('npm', ROOT, 'remove', {
        project: path.resolve('/elsewhere/package.json'),
        name: 'left-pad',
      });

      expect(response).toMatchObject({ ok: false, code: 'refused' });
      expect(fake.starts.count).toBe(0);
    });
  });

  describe('capability gating', () => {
    it('request_refusesWhatTheHandshakeDidNotConfirm', async () => {
      const fake: FakeClient = fakeClient(['sources']);
      const host: PackageManagerHost = hostFor(fake);

      const response: PackageManagerResponse<'search'> = await host.request('npm', ROOT, 'search', {
        source: 'npm',
        query: 'x',
        skip: 0,
        take: 10,
        prerelease: false,
      });

      expect(response).toMatchObject({ ok: false, code: 'unsupported' });
      expect(fake.requests).toEqual([]);
    });

    it('request_refusesWhatTheManifestDidNotDeclare', async () => {
      const fake: FakeClient = fakeClient(['sources', 'restore']);
      const host: PackageManagerHost = hostFor(fake, {}, [
        descriptor({ capabilities: ['sources'] }),
      ]);

      const response: PackageManagerResponse<'restore'> = await host.request(
        'npm',
        ROOT,
        'restore',
        { project: PROJECT },
      );

      expect(response).toMatchObject({ ok: false, code: 'unsupported' });
      expect(fake.requests).toEqual([]);
    });

    it('load_needsNoCapability', async () => {
      const fake: FakeClient = fakeClient([]);
      const host: PackageManagerHost = hostFor(fake, {}, [descriptor({ capabilities: [] })]);

      await expect(host.request('npm', ROOT, 'load', {})).resolves.toMatchObject({ ok: true });
    });

    it('describePlugin_reportsWhatBothConfirmed', async () => {
      const fake: FakeClient = fakeClient(['sources', 'search', 'restore']);
      const host: PackageManagerHost = hostFor(fake, {}, [
        descriptor({ capabilities: ['sources', 'install'] }),
      ]);

      await expect(host.describePlugin('npm')).resolves.toMatchObject({
        ok: true,
        capabilities: ['sources'],
      });
    });

    it('describePlugin_saysWhyAnUninstalledPluginCannotBeAsked', async () => {
      const host: PackageManagerHost = hostFor(fakeClient([]), {}, [
        descriptor({ resolve: () => ({ available: false, reason: 'npm is not installed.' }) }),
      ]);

      await expect(host.describePlugin('npm')).resolves.toEqual({
        ok: false,
        error: 'npm is not installed.',
      });
    });
  });

  describe('search', () => {
    it('search_boundsThePageWhateverTheRendererAsked', async () => {
      const fake: FakeClient = fakeClient(['search']);
      const host: PackageManagerHost = hostFor(fake);

      await host.request('npm', ROOT, 'search', {
        source: 'npm',
        query: 'x',
        skip: -3,
        take: 100000,
        prerelease: false,
      });

      expect(fake.requests[0].params).toMatchObject({ skip: 0, take: 100 });
    });

    it('search_dropsPrereleaseForAPluginThatCannotFilterByIt', async () => {
      const fake: FakeClient = fakeClient(['search']);
      const host: PackageManagerHost = hostFor(fake);

      await host.request('npm', ROOT, 'search', {
        source: 'npm',
        query: 'x',
        skip: 0,
        take: 10,
        prerelease: true,
      });

      expect(fake.requests[0].params).toMatchObject({ prerelease: false });
    });

    it('search_keepsPrereleaseForAPluginThatCan', async () => {
      const fake: FakeClient = fakeClient(['search', 'prerelease']);
      const host: PackageManagerHost = hostFor(fake, {}, [
        descriptor({ capabilities: ['search', 'prerelease'] }),
      ]);

      await host.request('npm', ROOT, 'search', {
        source: 'npm',
        query: 'x',
        skip: 0,
        take: 10,
        prerelease: true,
      });

      expect(fake.requests[0].params).toMatchObject({ prerelease: true });
    });

    it('search_doesNotSendAnEmptyQueryToARegistryThatNeedsText', async () => {
      const fake: FakeClient = fakeClient(['search', 'searchRequiresQuery']);
      const host: PackageManagerHost = hostFor(fake, {}, [
        descriptor({ capabilities: ['search', 'searchRequiresQuery'] }),
      ]);

      const response: PackageManagerResponse<'search'> = await host.request('npm', ROOT, 'search', {
        source: 'npm',
        query: '  ',
        skip: 0,
        take: 10,
        prerelease: false,
      });

      expect(response).toMatchObject({
        ok: true,
        result: { items: [], total: 0, hasMore: false },
      });
      expect(fake.requests).toEqual([]);
    });

    it('search_sendsAnEmptyQueryToARegistryThatBrowses', async () => {
      const fake: FakeClient = fakeClient(['search']);
      const host: PackageManagerHost = hostFor(fake);

      await host.request('npm', ROOT, 'search', {
        source: 'nuget.org',
        query: '',
        skip: 0,
        take: 10,
        prerelease: false,
      });

      expect(fake.requests).toHaveLength(1);
    });
  });

  describe('what comes back', () => {
    it('sources_reachesTheRendererAsNamesOnly', async () => {
      const fake: FakeClient = fakeClient(['sources']);
      fake.answer = (): unknown => ({
        sources: [
          { name: 'private', url: 'https://user:secret@feed.example/', token: 'secret' },
          { url: 'https://nameless.example/' },
        ],
      });
      const host: PackageManagerHost = hostFor(fake);

      const response: PackageManagerResponse<'sources'> = await host.request(
        'npm',
        ROOT,
        'sources',
        {},
      );

      expect(response).toMatchObject({ ok: true, result: { sources: [{ name: 'private' }] } });
      expect(JSON.stringify(response)).not.toContain('secret');
    });

    /**
     * Asks for a restore and has the plugin answer with the given command.
     * @param command What the plugin answers.
     * @returns Returns the host's response.
     */
    async function restoreAnsweredWith(
      command: unknown,
    ): Promise<PackageManagerResponse<'restore'>> {
      const fake: FakeClient = fakeClient(['restore']);
      fake.answer = (): unknown => command;
      return hostFor(fake).request('npm', ROOT, 'restore', { project: PROJECT });
    }

    it('write_passesAWellFormedCommandInsideTheFolder', async () => {
      const command: PackageCommand = {
        executable: 'npm',
        args: ['ci'],
        cwd: ROOT,
        title: 'Restore packages',
      };

      await expect(restoreAnsweredWith(command)).resolves.toMatchObject({
        ok: true,
        result: command,
      });
    });

    it.each<[string, unknown]>([
      ['nothing', null],
      ['no executable', { executable: '', args: [], cwd: ROOT, title: 't' }],
      ['arguments as one string', { executable: 'npm', args: 'ci', cwd: ROOT, title: 't' }],
      ['an argument that is not text', { executable: 'npm', args: [1], cwd: ROOT, title: 't' }],
      ['no title', { executable: 'npm', args: [], cwd: ROOT }],
      ['a relative folder', { executable: 'npm', args: [], cwd: 'repo', title: 't' }],
      ['a folder outside', { executable: 'npm', args: [], cwd: path.resolve('/tmp'), title: 't' }],
      [
        'a sibling sharing a prefix',
        { executable: 'npm', args: [], cwd: `${ROOT}-evil`, title: 't' },
      ],
    ])('write_refusesACommandWith_%s', async (_name: string, command: unknown) => {
      await expect(restoreAnsweredWith(command)).resolves.toMatchObject({
        ok: false,
        code: 'refused',
      });
    });
  });

  describe('credentials', () => {
    /**
     * Starts a plugin and returns the credential source its client was given.
     * @param credential Where the host reads saved tokens from.
     * @returns Returns the source.
     */
    async function sourceFor(
      credential: PackageManagerHostOptions['credential'],
    ): Promise<PackageManagerCredentialSource> {
      const fake: FakeClient = fakeClient([]);
      await hostFor(fake, { credential }).describePlugin('npm');
      return fake.credentials!;
    }

    it('credential_isKeyedByThePluginAndTheNormalisedRegistry', async () => {
      const asked: string[] = [];
      const source: PackageManagerCredentialSource = await sourceFor(
        (pluginId: string, registry: string) => {
          asked.push(`${pluginId} ${registry}`);
          return Promise.resolve('token');
        },
      );

      await expect(source('https://Registry.Example/npm/?a=b#c')).resolves.toBe('token');
      expect(asked).toEqual(['npm https://registry.example/npm']);
    });

    it.each<string>([
      'http://registry.example/',
      'https://user:pass@registry.example/',
      'file:///etc/passwd',
      'registry.example',
      '',
    ])('credential_isRefusedFor_%s', async (registry: string) => {
      let read: boolean = false;
      const source: PackageManagerCredentialSource = await sourceFor(() => {
        read = true;
        return Promise.resolve('token');
      });

      await expect(source(registry)).resolves.toBeNull();
      expect(read).toBe(false);
    });
  });

  describe('sharing and lifecycle', () => {
    it('request_sharesIdenticalConcurrentReads', async () => {
      const fake: FakeClient = fakeClient([], true);
      const host: PackageManagerHost = hostFor(fake);

      const first: Promise<PackageManagerResponse<'load'>> = host.request('npm', ROOT, 'load', {});
      const second: Promise<PackageManagerResponse<'load'>> = host.request('npm', ROOT, 'load', {});
      await new Promise<void>((resolve: () => void): void => {
        setTimeout(resolve, 0);
      });
      fake.release();
      await Promise.all([first, second]);

      expect(fake.requests).toHaveLength(1);
    });

    it('request_startsOneProcessForTwoFirstRequests', async () => {
      const fake: FakeClient = fakeClient([]);
      const host: PackageManagerHost = hostFor(fake);

      await Promise.all([host.request('npm', ROOT, 'load', {}), host.describePlugin('npm')]);

      expect(fake.starts.count).toBe(1);
    });

    it('request_doesNotShareWrites', async () => {
      const fake: FakeClient = fakeClient(['restore']);
      fake.answer = (): unknown => ({ executable: 'npm', args: [], cwd: ROOT, title: 't' });
      const host: PackageManagerHost = hostFor(fake);

      await Promise.all([
        host.request('npm', ROOT, 'restore', { project: PROJECT }),
        host.request('npm', ROOT, 'restore', { project: PROJECT }),
      ]);

      expect(fake.requests).toHaveLength(2);
    });

    it('request_stopsAPluginThatIsNoLongerInstalled', async () => {
      const fake: FakeClient = fakeClient([]);
      let available: boolean = true;
      const host: PackageManagerHost = hostFor(fake, {}, [
        descriptor({
          resolve: () =>
            available
              ? { available: true, spec: { command: 'node', args: [] } }
              : { available: false, reason: 'npm is not installed.' },
        }),
      ]);
      await host.request('npm', ROOT, 'load', {});

      available = false;
      const response: PackageManagerResponse<'load'> = await host.request('npm', ROOT, 'load', {});

      expect(fake.disposed).toBe(true);
      expect(response).toMatchObject({ ok: false, error: 'npm is not installed.' });
    });

    it('restartPlugin_stopsItSoTheNextRequestStartsItAfresh', async () => {
      const fake: FakeClient = fakeClient([]);
      const host: PackageManagerHost = hostFor(fake);
      await host.request('npm', ROOT, 'load', {});

      host.restartPlugin('npm');

      expect(fake.disposed).toBe(true);
    });

    it('dispose_stopsEveryRunningPlugin', async () => {
      const fake: FakeClient = fakeClient([]);
      const host: PackageManagerHost = hostFor(fake);
      await host.request('npm', ROOT, 'load', {});

      host.dispose();

      expect(fake.disposed).toBe(true);
    });
  });
});
