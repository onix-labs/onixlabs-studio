import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  VersionControlCapability,
  VersionControlDescription,
  VersionControlExecutableChoice,
  VersionControlOp,
  VersionControlResponse,
} from '@shared/api/version-control-protocol';
import { WorkspaceContext } from '../workspace-context';
import { VersionControlClient } from './version-control-client';
import { VersionControlDescriptor } from './version-control-descriptor';
import { VersionControlHost } from './version-control-host';

/**
 * The open workspace root every test works inside.
 */
const ROOT: string = path.resolve('/studio-vcs-host/repo');

/**
 * Records what a fake client was asked.
 */
interface FakeClient {
  readonly client: VersionControlClient;
  readonly starts: (VersionControlExecutableChoice | null)[];
  readonly requests: { op: VersionControlOp; root: string | undefined; params: unknown }[];
  release: () => void;
}

/**
 * Builds a fake client that confirms the given capabilities and answers every request with its
 * operation's name. Requests are held until `release` when `hold` is set, to test sharing.
 * @param confirmed The capabilities the handshake confirms.
 * @param hold Whether to hold answers until released.
 * @returns Returns the fake and its records.
 */
function fakeClient(
  confirmed: readonly VersionControlCapability[],
  hold: boolean = false,
): FakeClient {
  let running: boolean = false;
  const waiting: (() => void)[] = [];
  const record: FakeClient = {
    starts: [],
    requests: [],
    release: (): void => {
      for (const resolve of waiting.splice(0)) {
        resolve();
      }
    },
    client: {
      get running(): boolean {
        return running;
      },
      start: (
        executable: VersionControlExecutableChoice | null,
      ): Promise<VersionControlDescription> => {
        record.starts.push(executable);
        running = true;
        return Promise.resolve({
          protocol: '1.0',
          capabilities: confirmed,
          toolVersion: 'fake 1.0',
        });
      },
      request: async (
        op: VersionControlOp,
        root: string | undefined,
        params: unknown,
      ): Promise<VersionControlResponse> => {
        record.requests.push({ op, root, params });
        if (hold) {
          await new Promise<void>((resolve: () => void): void => {
            waiting.push(resolve);
          });
        }
        return { id: 1, ok: true, result: { op } as never };
      },
      dispose: (): void => {
        running = false;
      },
    } as unknown as VersionControlClient,
  };
  return record;
}

/**
 * Builds a descriptor for a plugin claiming a marker.
 * @param id The plugin id.
 * @param marker The marker it claims.
 * @param priority Its priority.
 * @param capabilities The capabilities its manifest declares.
 * @param available Whether it is installed.
 * @returns Returns the descriptor.
 */
function plugin(
  id: string,
  marker: string,
  priority: number = 100,
  capabilities: readonly VersionControlCapability[] = ['stash', 'remotes'],
  available: boolean = true,
): VersionControlDescriptor {
  return {
    id,
    displayName: id.toUpperCase(),
    priority,
    markers: [marker],
    metadataDirectories: [marker],
    capabilities,
    executableModes: ['installed', 'custom'],
    resolve: () =>
      available
        ? { available: true, spec: { command: id, args: [] } }
        : { available: false, reason: `${id} is not installed — install it in Plugins.` },
  };
}

/**
 * Builds a host over descriptors, with the repository at {@link ROOT} holding the given entries.
 * @param descriptors The contributed plugins.
 * @param present The entry names present at the root.
 * @param fake The client every plugin gets.
 * @returns Returns the host.
 */
function host(
  descriptors: readonly VersionControlDescriptor[],
  present: readonly string[],
  fake: FakeClient,
): VersionControlHost {
  const roots: WorkspaceContext = new WorkspaceContext();
  roots.addRoot(ROOT);
  return new VersionControlHost({
    descriptors: () => descriptors,
    roots,
    executableFor: (id: string): VersionControlExecutableChoice | null =>
      id === 'git' ? { mode: 'custom', path: '/opt/git' } : null,
    exists: (target: string): boolean =>
      present.some((name: string): boolean => target === path.join(ROOT, name)),
    createClient: (): VersionControlClient => fake.client,
  });
}

describe('VersionControlHost', () => {
  it('pluginFor_picksTheHighestPriorityPluginWhoseMarkerIsPresent', () => {
    const vcs: VersionControlHost = host(
      [plugin('svn', '.svn'), plugin('git', '.git', 50), plugin('git-pro', '.git', 200)],
      ['.git'],
      fakeClient([]),
    );

    expect(vcs.pluginFor(ROOT)?.id).toBe('git-pro');
  });

  it('pluginFor_whenNoMarkerIsPresent_isNull', () => {
    expect(host([plugin('git', '.git')], [], fakeClient([])).pluginFor(ROOT)).toBeNull();
  });

  it('request_startsThePluginOnceWithTheUsersExecutableChoice', async () => {
    const fake: FakeClient = fakeClient(['stash']);
    const vcs: VersionControlHost = host([plugin('git', '.git')], ['.git'], fake);

    await vcs.request(ROOT, 'status', {});
    await vcs.request(ROOT, 'log', { limit: 10 });

    expect(fake.starts).toEqual([{ mode: 'custom', path: '/opt/git' }]);
    expect(fake.requests.map((request) => [request.op, request.root])).toEqual([
      ['status', ROOT],
      ['log', ROOT],
    ]);
  });

  it('request_whenTheRootIsNotOpen_refusesWithoutStartingAnything', async () => {
    const fake: FakeClient = fakeClient([]);
    const vcs: VersionControlHost = host([plugin('git', '.git')], ['.git'], fake);

    const outside: VersionControlResponse<'status'> = await vcs.request(
      path.resolve('/elsewhere'),
      'status',
      {},
    );
    const escaping: VersionControlResponse<'status'> = await vcs.request(
      path.join(ROOT, '..', '..', 'etc'),
      'status',
      {},
    );
    const relative: VersionControlResponse<'status'> = await vcs.request('repo', 'status', {});

    for (const response of [outside, escaping, relative]) {
      expect(response).toMatchObject({ ok: false, code: 'refused' });
    }
    expect(fake.starts).toEqual([]);
  });

  it('request_whenTheCapabilityIsDeclaredButNotConfirmed_isUnsupported', async () => {
    // The manifest declares stash and remotes; the running plugin confirms only stash.
    const fake: FakeClient = fakeClient(['stash']);
    const vcs: VersionControlHost = host([plugin('git', '.git')], ['.git'], fake);

    const push: VersionControlResponse<'push'> = await vcs.request(ROOT, 'push', { target: null });
    const stash: VersionControlResponse<'stash'> = await vcs.request(ROOT, 'stash', {});

    expect(push).toMatchObject({ ok: false, code: 'unsupported' });
    expect(stash.ok).toBe(true);
    expect(fake.requests.map((request) => request.op)).toEqual(['stash']);
  });

  it('request_whenConfirmedButNotDeclared_isUnsupported', async () => {
    const fake: FakeClient = fakeClient(['stash', 'tags']);
    const vcs: VersionControlHost = host([plugin('git', '.git', 100, ['stash'])], ['.git'], fake);

    expect(await vcs.request(ROOT, 'createTag', { name: 'v1', commit: 'abc' })).toMatchObject({
      ok: false,
      code: 'unsupported',
    });
  });

  it('request_sharesIdenticalConcurrentReadsButNotWrites', async () => {
    const fake: FakeClient = fakeClient(['stash'], true);
    const vcs: VersionControlHost = host([plugin('git', '.git')], ['.git'], fake);

    const reads: Promise<VersionControlResponse<'status'>>[] = [
      vcs.request(ROOT, 'status', {}),
      vcs.request(ROOT, 'status', {}),
    ];
    const writes: Promise<VersionControlResponse<'stash'>>[] = [
      vcs.request(ROOT, 'stash', {}),
      vcs.request(ROOT, 'stash', {}),
    ];
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
    fake.release();
    await Promise.all([...reads, ...writes]);

    expect(fake.requests.map((request) => request.op)).toEqual(['status', 'stash', 'stash']);
  });

  it('request_whenThePluginIsNotInstalled_returnsTheInstallReason', async () => {
    const vcs: VersionControlHost = host(
      [plugin('git', '.git', 100, [], false)],
      ['.git'],
      fakeClient([]),
    );

    expect(await vcs.request(ROOT, 'status', {})).toMatchObject({
      ok: false,
      error: 'git is not installed — install it in Plugins.',
    });
  });

  it('request_refusesAGlobalOperation', async () => {
    const vcs: VersionControlHost = host([plugin('git', '.git')], ['.git'], fakeClient([]));

    expect(await vcs.request(ROOT, 'getIdentity', {})).toMatchObject({
      ok: false,
      code: 'refused',
    });
  });

  it('requestGlobal_whenACloneTargetsAnOpenRoot_sendsItWithoutARoot', async () => {
    const fake: FakeClient = fakeClient(['clone']);
    const vcs: VersionControlHost = host([plugin('git', '.git', 100, ['clone'])], [], fake);

    const response: VersionControlResponse<'clone'> = await vcs.requestGlobal('git', 'clone', {
      url: 'https://example.com/repo.git',
      directory: path.join(ROOT, 'feature'),
    });

    expect(response.ok).toBe(true);
    expect(fake.requests).toEqual([
      {
        op: 'clone',
        root: undefined,
        params: { url: 'https://example.com/repo.git', directory: path.join(ROOT, 'feature') },
      },
    ]);
  });

  it('requestGlobal_whenACloneTargetsOutsideTheOpenRoots_isRefused', async () => {
    const fake: FakeClient = fakeClient(['clone']);
    const vcs: VersionControlHost = host([plugin('git', '.git', 100, ['clone'])], [], fake);

    expect(
      await vcs.requestGlobal('git', 'clone', {
        url: 'https://example.com/repo.git',
        directory: path.resolve('/tmp/anywhere'),
      }),
    ).toMatchObject({ ok: false, code: 'refused' });
    expect(fake.requests).toEqual([]);
  });

  it('requestGlobal_refusesInitializeAndRepositoryOperations', async () => {
    const vcs: VersionControlHost = host([plugin('git', '.git')], ['.git'], fakeClient([]));

    expect(
      await vcs.requestGlobal('git', 'initialize', { protocol: '1.0', executable: null }),
    ).toMatchObject({ ok: false, code: 'refused' });
    expect(await vcs.requestGlobal('git', 'status', {})).toMatchObject({
      ok: false,
      code: 'refused',
    });
  });

  it('describe_reportsTheConfirmedCapabilities', async () => {
    const vcs: VersionControlHost = host([plugin('git', '.git')], ['.git'], fakeClient(['stash']));

    expect(await vcs.describe(ROOT)).toMatchObject({
      ok: true,
      pluginId: 'git',
      capabilities: ['stash'],
      description: { toolVersion: 'fake 1.0' },
    });
  });

  it('metadataDirectories_isTheDistinctUnionAcrossPlugins', () => {
    const vcs: VersionControlHost = host(
      [plugin('git', '.git'), plugin('git-pro', '.git'), plugin('hg', '.hg')],
      [],
      fakeClient([]),
    );

    expect(vcs.metadataDirectories()).toEqual(['.git', '.hg']);
  });
});
