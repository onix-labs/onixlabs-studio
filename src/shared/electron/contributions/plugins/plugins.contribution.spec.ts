import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PluginActionResult,
  PluginChannel,
  PluginSummary,
  SideloadingState,
} from '@shared/api/plugin-channels';
import type { ContributionContext, InvokeHandler } from '../main-contribution';
import { PluginActions, PluginsContribution, PluginsHost } from './plugins.contribution';

// Loaded with the module's graph only; everything the machine could answer is behind the host below.
vi.mock('electron', () => ({
  app: {
    getPath: (): string => {
      throw new Error('A spec must not reach userData.');
    },
  },
  shell: {
    openPath: (): never => {
      throw new Error('A spec must not open anything.');
    },
  },
}));

/**
 * A manager recording what it was asked.
 */
class FakeManager implements PluginActions {
  public readonly installs: string[] = [];
  public readonly uninstalls: string[] = [];
  public plugins: readonly PluginSummary[] = [];
  public changed: () => void = (): void => undefined;

  public onChanged(listener: () => void): () => void {
    this.changed = listener;
    return (): void => undefined;
  }

  public list(): Promise<readonly PluginSummary[]> {
    return Promise.resolve(this.plugins);
  }

  public install(id: string): Promise<PluginActionResult> {
    this.installs.push(id);
    return Promise.resolve({ success: true, state: 'installed', error: null });
  }

  public uninstall(id: string): Promise<PluginActionResult> {
    this.uninstalls.push(id);
    return Promise.resolve({ success: true, state: 'available', error: null });
  }
}

describe('PluginsContribution', () => {
  const sideloading: SideloadingState = { enabled: true } as SideloadingState;
  let scratch: string;
  let manager: FakeManager;
  let opened: string[];
  let refreshes: number;
  let refresh: () => Promise<boolean>;
  let written: unknown[];
  let handlers: Map<string, InvokeHandler>;
  let pushed: unknown[][];
  let logged: string[];

  /**
   * Builds a host over the fakes.
   * @returns Returns the host.
   */
  function host(): PluginsHost {
    return {
      createManager: (): PluginActions => manager,
      refreshIndex: (): Promise<boolean> => {
        refreshes += 1;
        return refresh();
      },
      indexRevision: (): number => 61,
      sideloadingState: (): SideloadingState => sideloading,
      setSideloading: (value: unknown): SideloadingState => {
        written.push(value);
        return sideloading;
      },
      sideloadDirectory: (): string => path.join(scratch, 'not', 'yet', 'there'),
      openPath: (directory: string): Promise<string> => {
        opened.push(directory);
        return Promise.resolve('');
      },
      describeCatalogue: (): string => '2 first-party, 1 contributed',
    };
  }

  /**
   * Activates a contribution over the fakes.
   */
  function activate(): void {
    const context: ContributionContext = {
      handle: (channel: string, handler: InvokeHandler): void =>
        void handlers.set(channel, handler),
      on: (): void => undefined,
      send: (channel: string, ...payload: unknown[]): void =>
        void pushed.push([channel, ...payload]),
      permission: <T>(): T => {
        throw new Error('Plugins declares no permissions.');
      },
      mainWindow: () => null,
      log: {
        error: vi.fn(),
        warn: vi.fn(),
        info: (message: string): void => void logged.push(message),
      },
    };
    new PluginsContribution(host()).activate(context);
  }

  /**
   * Calls a channel as the renderer would.
   * @param channel The channel.
   * @param args The arguments.
   * @returns Returns the handler's answer.
   */
  function call(channel: PluginChannel, ...args: unknown[]): unknown {
    const handler: InvokeHandler | undefined = handlers.get(channel);
    if (handler === undefined) {
      throw new Error(`Nothing handles ${channel}.`);
    }
    return handler({} as never, ...args);
  }

  beforeEach(() => {
    scratch = mkdtempSync(path.join(tmpdir(), 'plugins-contribution-'));
    manager = new FakeManager();
    opened = [];
    refreshes = 0;
    refresh = (): Promise<boolean> => Promise.resolve(false);
    written = [];
    handlers = new Map<string, InvokeHandler>();
    pushed = [];
    logged = [];
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it('listsThePlugins', async () => {
    activate();
    manager.plugins = [{ id: 'zls' } as PluginSummary];

    expect(await call(PluginChannel.List)).toBe(manager.plugins);
  });

  it('pushesTheRefreshedList_onEveryChange', async () => {
    activate();
    manager.plugins = [{ id: 'zls' } as PluginSummary];

    manager.changed();
    await vi.waitFor(() => expect(pushed).toHaveLength(1));

    expect(pushed[0]).toEqual([PluginChannel.Changed, manager.plugins]);
  });

  it('installsAndUninstallsWhatTheRendererNames', async () => {
    activate();

    expect(await call(PluginChannel.Install, 'zls')).toEqual({
      success: true,
      state: 'installed',
      error: null,
    });
    await call(PluginChannel.Uninstall, 'taplo');

    expect(manager.installs).toEqual(['zls']);
    expect(manager.uninstalls).toEqual(['taplo']);
  });

  it('refusesAnIdThatIsNotAString_beforeTheManagerHearsOfIt', async () => {
    activate();
    const refused: PluginActionResult = {
      success: false,
      state: 'unavailable',
      error: 'Unknown plugin.',
    };

    for (const id of [undefined, null, 7, {}, ['zls']]) {
      expect(await call(PluginChannel.Install, id)).toEqual(refused);
      expect(await call(PluginChannel.Uninstall, id)).toEqual(refused);
    }

    expect(manager.installs).toEqual([]);
    expect(manager.uninstalls).toEqual([]);
  });

  it('reportsTheRevisionInForce', async () => {
    activate();

    expect(await call(PluginChannel.CatalogueRevision)).toBe(61);
  });

  it('reportsAndPersistsTheSideloadingSwitch', async () => {
    activate();

    expect(await call(PluginChannel.GetSideloading)).toBe(sideloading);
    expect(await call(PluginChannel.SetSideloading, true)).toBe(sideloading);
    expect(written).toEqual([true]);
  });

  it('opensMainsOwnFolder_makingItFirst_whateverTheRendererSent', async () => {
    activate();
    const folder: string = path.join(scratch, 'not', 'yet', 'there');

    await call(PluginChannel.OpenFolder, '/etc');

    expect(existsSync(folder)).toBe(true);
    expect(opened).toEqual([folder]);
  });

  it('refreshesTheIndexInTheBackground_withoutWaitingForIt', () => {
    refresh = (): Promise<boolean> => new Promise<boolean>((): void => undefined);

    activate();

    expect(refreshes).toBe(1);
    expect(handlers.has(PluginChannel.List)).toBe(true);
  });

  it('saysWhenANewerIndexWasFetched', async () => {
    refresh = (): Promise<boolean> => Promise.resolve(true);

    activate();

    await vi.waitFor(() => expect(logged.join()).toContain('takes effect on the next launch'));
  });

  it('saysNothing_whenTheIndexIsCurrent', async () => {
    activate();
    await Promise.resolve();
    await Promise.resolve();

    expect(logged.join()).not.toContain('takes effect');
    expect(logged.join()).toContain('2 first-party, 1 contributed');
  });
});
