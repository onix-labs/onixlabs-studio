import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SourceControlChannel } from '@shared/api/source-control-channels';
import type { Mock } from 'vitest';

/**
 * Describes an IPC handler as the fake `ipcMain` captures it.
 */
type Handler = (event: unknown, ...args: unknown[]) => unknown;

/**
 * Holds the IPC handlers registered.
 */
const handlers: Map<string, Handler> = vi.hoisted(() => new Map<string, Handler>());

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler): void => void handlers.set(channel, handler),
  },
}));

const { VersionControlManager } = await import('./version-control-manager');

/**
 * Builds a plugin descriptor.
 * @param id The plugin.
 * @param available Whether its tool is installed.
 * @returns Returns the descriptor.
 */
function descriptor(id: string, available: boolean = true): Record<string, unknown> {
  return {
    id,
    displayName: id.toUpperCase(),
    executableModes: ['system', 'custom'],
    resolve: (): { available: boolean } => ({ available }),
  };
}

describe('VersionControlManager', () => {
  let host: Record<string, Mock>;
  let settings: Record<string, Mock>;
  let trust: Record<string, Mock>;

  /**
   * Invokes a captured IPC handler.
   * @param channel The channel.
   * @param args The renderer-supplied arguments.
   * @returns Returns what it answered.
   */
  async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
    const handler: Handler | undefined = handlers.get(channel);
    if (handler === undefined) {
      throw new Error(`Nothing registered ${channel}`);
    }
    return (await handler({}, ...args)) as T;
  }

  beforeEach(() => {
    handlers.clear();
    host = {
      openRepository: vi.fn().mockResolvedValue(null),
      closeRepository: vi.fn(),
      request: vi.fn().mockResolvedValue({ id: 1, ok: true }),
      describe: vi.fn().mockResolvedValue({ ok: false, error: 'no' }),
      describePlugin: vi.fn().mockResolvedValue({ ok: false, error: 'broken tool' }),
      detect: vi.fn().mockReturnValue(null),
      descriptor: vi.fn().mockReturnValue(undefined),
      preferredOrder: vi.fn().mockReturnValue([]),
      restartPlugin: vi.fn(),
      isOpen: vi.fn().mockReturnValue(false),
      dispose: vi.fn(),
    };
    settings = {
      setExecutable: vi.fn(),
      executableFor: vi.fn().mockReturnValue(null),
    };
    trust = {
      decide: vi.fn(),
      decisionFor: vi.fn().mockReturnValue('trusted'),
    };
    new VersionControlManager(host as never, settings as never, trust as never).register();
  });

  it.each([
    [7, 'status', {}],
    ['/repo', 7, {}],
    ['/repo', 'rm-rf', {}],
    ['/repo', '__proto__', {}],
    ['/repo', 'status', null],
    ['/repo', 'status', 'params'],
    ['/repo', 'status', undefined],
  ])('request_ofAMalformedShape_neverReachesTheHost %#', async (root, op, params) => {
    expect(await invoke(SourceControlChannel.Request, root, op, params)).toEqual({
      id: 0,
      ok: false,
      error: 'Malformed version-control request.',
      code: 'refused',
    });

    expect(host['request']).not.toHaveBeenCalled();
  });

  it('request_wellFormed_passesThrough', async () => {
    const params: object = { path: 'a' };

    await invoke(SourceControlChannel.Request, '/repo', 'status', params);

    expect(host['request']).toHaveBeenCalledWith('/repo', 'status', params);
  });

  it('resolve_inNoRepository_answersNull', async () => {
    expect(await invoke(SourceControlChannel.ResolveRepository, '/nowhere')).toBeNull();
  });

  it('resolve_carriesTheTrustDecision', async () => {
    host['openRepository']?.mockResolvedValue({ root: '/repo', name: 'repo' });

    expect(await invoke(SourceControlChannel.ResolveRepository, '/does/not/exist')).toEqual({
      root: '/repo',
      name: 'repo',
      trust: 'trusted',
    });
  });

  it('resolve_throughALink_saysWhereItReallyIs', async () => {
    const { mkdtempSync, realpathSync, rmSync, symlinkSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const directory: string = realpathSync(mkdtempSync(join(tmpdir(), 'vc-manager-')));
    const link: string = join(directory, 'link');
    symlinkSync(directory, link);
    host['openRepository']?.mockResolvedValue({ root: directory, name: 'repo' });

    expect(await invoke(SourceControlChannel.ResolveRepository, link)).toMatchObject({
      realDirectory: directory,
    });

    rmSync(directory, { recursive: true, force: true });
  });

  it('setTrust_forARepositoryNotOpen_isRefused', async () => {
    expect(await invoke(SourceControlChannel.SetTrust, '/repo', 'trusted')).toBe('unknown');

    expect(trust['decide']).not.toHaveBeenCalled();
  });

  it.each([['maybe'], [undefined], [true]])(
    'setTrust_withAnUnknownDecision_isRefused %#',
    async (decision: unknown) => {
      host['isOpen']?.mockReturnValue(true);

      expect(await invoke(SourceControlChannel.SetTrust, '/repo', decision)).toBe('unknown');

      expect(trust['decide']).not.toHaveBeenCalled();
    },
  );

  it('setTrust_withANonStringRoot_isRefused', async () => {
    host['isOpen']?.mockReturnValue(true);

    expect(await invoke(SourceControlChannel.SetTrust, 7, 'trusted')).toBe('unknown');
  });

  it('setTrust_onAnOpenRepository_answersTheDecisionInForce', async () => {
    host['isOpen']?.mockReturnValue(true);

    expect(await invoke(SourceControlChannel.SetTrust, '/repo', 'restricted')).toBe('trusted');

    expect(trust['decide']).toHaveBeenCalledWith('/repo', 'restricted');
  });

  it('describe_withANonStringRoot_askNothing', async () => {
    expect(await invoke(SourceControlChannel.Describe, 7)).toBeNull();

    expect(host['describe']).not.toHaveBeenCalled();
  });

  it('describe_thatFails_answersNull', async () => {
    expect(await invoke(SourceControlChannel.Describe, '/repo')).toBeNull();
  });

  it('describe_namesThePlugin_fallingBackToItsId', async () => {
    host['describe']?.mockResolvedValue({ ok: true, pluginId: 'git', capabilities: ['status'] });

    expect(await invoke(SourceControlChannel.Describe, '/repo')).toEqual({
      pluginId: 'git',
      displayName: 'git',
      capabilities: ['status'],
    });
  });

  it('detect_inNoRepository_answersNull', async () => {
    expect(await invoke(SourceControlChannel.Detect, '/nowhere')).toBeNull();
  });

  it('detect_reportsWhetherTheToolIsInstalled', async () => {
    host['detect']?.mockReturnValue(descriptor('git', false));

    expect(await invoke(SourceControlChannel.Detect, '/repo')).toEqual({
      pluginId: 'git',
      displayName: 'GIT',
      installed: false,
    });
  });

  it('listPlugins_reportsAProblem_andStartsOnlyWhatIsInstalled', async () => {
    host['preferredOrder']?.mockReturnValue([descriptor('git'), descriptor('hg', false)]);

    const plugins: readonly Record<string, unknown>[] = await invoke(
      SourceControlChannel.ListPlugins,
    );

    expect(plugins[0]).toMatchObject({
      id: 'git',
      installed: true,
      problem: 'broken tool',
      toolVersion: null,
      capabilities: [],
    });
    expect(plugins[1]).toMatchObject({ id: 'hg', installed: false, capabilities: [] });
    expect(plugins[1]).not.toHaveProperty('problem');
    expect(host['describePlugin']).toHaveBeenCalledTimes(1);
  });

  it('listPlugins_reportsTheToolVersion', async () => {
    host['preferredOrder']?.mockReturnValue([descriptor('git')]);
    host['describePlugin']?.mockResolvedValue({
      ok: true,
      description: { toolVersion: '2.50' },
      capabilities: ['status'],
    });

    expect(await invoke(SourceControlChannel.ListPlugins)).toEqual([
      expect.objectContaining({ toolVersion: '2.50', capabilities: ['status'] }),
    ]);
  });

  it.each([[7], ['unknown']])(
    'setExecutable_ofAnUnknownPlugin_isRefused %#',
    async (id: unknown) => {
      expect(await invoke(SourceControlChannel.SetExecutable, id, null)).toBeNull();

      expect(settings['setExecutable']).not.toHaveBeenCalled();
    },
  );

  it.each([
    [undefined],
    ['system'],
    [{ mode: 'nonsense' }],
    [{ mode: 'bundled' }],
    [{ mode: 'custom' }],
    [{ mode: 'custom', path: 'relative/git' }],
  ])('setExecutable_withAChoiceNotOffered_isRefused %#', async (choice: unknown) => {
    host['descriptor']?.mockReturnValue(descriptor('git'));

    expect(await invoke(SourceControlChannel.SetExecutable, 'git', choice)).toBeNull();

    expect(settings['setExecutable']).not.toHaveBeenCalled();
    expect(host['restartPlugin']).not.toHaveBeenCalled();
  });

  it('setExecutable_withACustomPath_storesItAndRestartsThePlugin', async () => {
    host['descriptor']?.mockReturnValue(descriptor('git'));
    const choice: object = { mode: 'custom', path: '/usr/bin/git' };

    await invoke(SourceControlChannel.SetExecutable, 'git', choice);

    expect(settings['setExecutable']).toHaveBeenCalledWith('git', choice);
    expect(host['restartPlugin']).toHaveBeenCalledWith('git');
  });

  it('setExecutable_withNull_returnsToTheDefault', async () => {
    host['descriptor']?.mockReturnValue(descriptor('git'));

    await invoke(SourceControlChannel.SetExecutable, 'git', null);

    expect(settings['setExecutable']).toHaveBeenCalledWith('git', null);
    expect(host['restartPlugin']).toHaveBeenCalledWith('git');
  });

  it('closeRepository_passesThrough', async () => {
    await invoke(SourceControlChannel.CloseRepository, '/repo');

    expect(host['closeRepository']).toHaveBeenCalledWith('/repo');
  });

  it('dispose_stopsThePlugins', () => {
    new VersionControlManager(host as never, settings as never, trust as never).dispose();

    expect(host['dispose']).toHaveBeenCalledOnce();
  });
});
