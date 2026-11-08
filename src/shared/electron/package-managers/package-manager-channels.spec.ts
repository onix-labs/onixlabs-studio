import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { PackageChannel } from '@shared/api/package-channels';
import type { PackageRegistryToken, PackageWorkspaceStatus } from '@shared/api/package-channels';
import type { PackageManagerDescriptor } from './package-manager-descriptor';
import { PackageRegistryTokenStore } from './package-registry-token-store';

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

const { PackageManagerChannels } = await import('./package-manager-channels');

/**
 * The open workspace root.
 */
const ROOT: string = '/work/shop';

/**
 * Builds a contributed package-manager plugin.
 * @param id The plugin.
 * @param available Whether it is installed.
 * @returns Returns the descriptor.
 */
function descriptor(id: string, available: boolean): PackageManagerDescriptor {
  return {
    id,
    displayName: id.toUpperCase(),
    ecosystem: id,
    priority: 100,
    markers: ['package.json'],
    capabilities: ['sources', 'search'],
    resolve: () =>
      available
        ? { available: true, spec: { command: 'node', args: [] } }
        : { available: false, reason: 'Not installed.' },
  };
}

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

describe('PackageManagerChannels', () => {
  let host: { detect: Mock; descriptor: Mock; request: Mock };
  let trust: { decisionFor: Mock; decide: Mock };
  let tokens: PackageRegistryTokenStore;

  beforeEach(() => {
    handlers.clear();
    const plugins: readonly PackageManagerDescriptor[] = [
      descriptor('npm', true),
      descriptor('nuget', false),
    ];
    host = {
      detect: vi.fn().mockResolvedValue(plugins),
      descriptor: vi.fn((id: string) => plugins.find((plugin) => plugin.id === id)),
      request: vi.fn().mockResolvedValue({ id: 1, ok: true, result: null }),
    };
    trust = { decisionFor: vi.fn().mockReturnValue('trusted'), decide: vi.fn() };
    let blob: string | null = null;
    tokens = new PackageRegistryTokenStore({
      load: (): string | null => blob,
      save: (plaintext: string | null): void => {
        blob = plaintext;
      },
    });
    new PackageManagerChannels(
      host,
      { isRoot: (target: string): boolean => target === ROOT },
      trust,
      tokens,
    ).register();
  });

  it('managers_listsEveryPluginThatApplies_installedOrOffered_withTheTrustInForce', async () => {
    trust.decisionFor.mockReturnValue('unknown');

    const status: PackageWorkspaceStatus = await invoke(PackageChannel.Managers, ROOT);

    expect(status.trust).toBe('unknown');
    expect(status.managers).toEqual([
      expect.objectContaining({ pluginId: 'npm', installed: true }),
      expect.objectContaining({ pluginId: 'nuget', installed: false }),
    ]);
  });

  it.each([['/elsewhere'], [`${ROOT}/sub`], [42], [undefined]])(
    'managers_forAnythingButAnOpenRoot_answerNothingAndScanNothing %#',
    async (root: unknown) => {
      const status: PackageWorkspaceStatus = await invoke(PackageChannel.Managers, root);

      expect(status).toEqual({ managers: [], trust: 'unknown' });
      expect(host.detect).not.toHaveBeenCalled();
    },
  );

  it('modelLoad_asksThePluginNamed', async () => {
    host.request.mockResolvedValue({ id: 1, ok: true, result: { ecosystem: 'npm' } });

    const answer: unknown = await invoke(PackageChannel.ModelLoad, ROOT, 'npm');

    expect(host.request).toHaveBeenCalledWith('npm', ROOT, 'load', {});
    expect(answer).toEqual({ ok: true, result: { ecosystem: 'npm' } });
  });

  it('modelLoad_passesTheHostsRefusalOn', async () => {
    host.request.mockResolvedValue({ id: 0, ok: false, error: 'Not trusted.', code: 'untrusted' });

    const answer: unknown = await invoke(PackageChannel.ModelLoad, ROOT, 'npm');

    expect(answer).toEqual({ ok: false, error: 'Not trusted.', code: 'untrusted' });
  });

  it.each([
    ['/elsewhere', 'npm'],
    [ROOT, 'nobody'],
    [ROOT, 7],
  ])('modelLoad_forAClosedRootOrAnUnknownPlugin_asksNobody %#', async (root, pluginId) => {
    const answer: { ok: boolean } = await invoke(PackageChannel.ModelLoad, root, pluginId);

    expect(answer.ok).toBe(false);
    expect(host.request).not.toHaveBeenCalled();
  });

  it('sources_answersTheNames', async () => {
    host.request.mockResolvedValue({ id: 1, ok: true, result: { sources: [{ name: 'npm' }] } });

    expect(await invoke(PackageChannel.Sources, ROOT, 'npm')).toEqual({
      ok: true,
      result: [{ name: 'npm' }],
    });
  });

  it('search_sendsTheSearchToThePlugin_withWhatItCanRead', async () => {
    await invoke(PackageChannel.Search, ROOT, 'npm', 'npm', 'left-pad', {
      skip: 50,
      take: 'lots',
      prerelease: 'yes',
    });

    expect(host.request).toHaveBeenCalledWith('npm', ROOT, 'search', {
      source: 'npm',
      query: 'left-pad',
      skip: 50,
      take: 0,
      prerelease: false,
    });
  });

  it('search_withoutASourceOrQuery_isRefused', async () => {
    const answer: { ok: boolean } = await invoke(PackageChannel.Search, ROOT, 'npm', 1, null);

    expect(answer.ok).toBe(false);
    expect(host.request).not.toHaveBeenCalled();
  });

  it('trustFolder_recordsTrustForAnOpenRoot', async () => {
    expect(await invoke(PackageChannel.TrustFolder, ROOT)).toBe('trusted');

    expect(trust.decide).toHaveBeenCalledWith(ROOT, 'trusted');
  });

  it('trustFolder_forAFolderThatIsNotOpen_decidesNothing', async () => {
    expect(await invoke(PackageChannel.TrustFolder, '/elsewhere')).toBe('unknown');

    expect(trust.decide).not.toHaveBeenCalled();
  });

  it('saveToken_forAContributedPlugin_savesAndListsWithoutTheToken', async () => {
    const result: { ok: boolean; tokens: readonly PackageRegistryToken[] } = await invoke(
      PackageChannel.SaveToken,
      'npm',
      'https://npm.pkg.github.com/',
      'secret',
    );

    expect(result).toEqual({
      ok: true,
      tokens: [{ pluginId: 'npm', registry: 'https://npm.pkg.github.com' }],
    });
    expect(tokens.token('npm', 'https://npm.pkg.github.com')).toBe('secret');
    expect(await invoke(PackageChannel.Tokens)).toEqual(result.tokens);
  });

  it.each([
    ['nobody', 'https://a.example', 'x'],
    ['npm', 'http://a.example', 'x'],
    ['npm', 42, 'x'],
  ])(
    'saveToken_refusesAnUnknownPluginOrARegistryThatIsNotHttps %#',
    async (id, registry, token) => {
      const result: { ok: boolean } = await invoke(PackageChannel.SaveToken, id, registry, token);

      expect(result.ok).toBe(false);
      expect(tokens.list()).toEqual([]);
    },
  );

  it('clearToken_forgetsIt', async () => {
    tokens.save('npm', 'https://a.example', 'x');

    const result: unknown = await invoke(PackageChannel.ClearToken, 'npm', 'https://a.example');

    expect(result).toEqual({ ok: true, tokens: [] });
  });
});
