import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  INSTALL_PLUGIN,
  LIST_PLUGINS,
  READ_WORKSPACE_LANGUAGES,
  UNINSTALL_PLUGIN,
  type AiBridgeScope,
} from '@shared/api/ai-types';
import type { PluginSummary } from '@shared/api/plugin-channels';
import { ProjectChannel } from '@shared/api/project-channels';
import { AiCapability, AiRuntime } from '@shared/angular/services/ai-runtime/ai-runtime';
import { Log } from '@shared/angular/services/log/log';
import { Plugins } from '@shared/angular/services/plugins/plugins';
import { Tab } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { PluginManagerAgentCapabilities } from './plugin-manager-agent-capabilities';

const PLUGINS: AiBridgeScope = { owningTabId: 'tab', surface: 'plugins', workspaceRoot: null };
const MODELS: AiBridgeScope = { owningTabId: 'tab', surface: 'models', workspaceRoot: null };

/**
 * Builds a plugin summary.
 * @param id The id.
 * @param overrides Fields to replace.
 * @returns Returns the summary.
 */
function plugin(id: string, overrides: Partial<PluginSummary> = {}): PluginSummary {
  return {
    id,
    name: id,
    description: `${id} plugin`,
    state: 'available',
    contributions: [
      { slot: 'language-server', id, displayName: id, priority: 0, languages: ['rust'] },
    ],
    version: '1.0.0',
    detail: null,
    installedVersion: null,
    origin: null,
    ...overrides,
  };
}

describe('PluginManagerAgentCapabilities', () => {
  let capabilities: Map<string, AiCapability>;
  let known: WritableSignal<readonly PluginSummary[]>;
  let outcome: 'installed' | 'declined' | 'failed';
  let error: WritableSignal<string | null>;
  let installs: string[];
  let uninstalls: string[];
  let savedBridge: unknown;

  beforeEach(() => {
    capabilities = new Map<string, AiCapability>();
    installs = [];
    uninstalls = [];
    outcome = 'installed';
    error = signal<string | null>(null);
    known = signal<readonly PluginSummary[]>([
      plugin('rust-analyzer'),
      plugin('gopls', { state: 'installed', installedVersion: '1.0.0' }),
      plugin('roslyn', { state: 'installed', installedVersion: '0.9.0' }),
    ]);
    savedBridge = (window as unknown as { bridge?: unknown }).bridge;
    (window as unknown as { bridge: unknown }).bridge = {
      invoke: (channel: string, root: string): Promise<unknown> =>
        Promise.resolve(
          channel === (ProjectChannel.ModelLoad as string) && root === '/ws/app'
            ? { kind: 'rust', root }
            : null,
        ),
    };
    TestBed.configureTestingModule({
      providers: [
        PluginManagerAgentCapabilities,
        {
          provide: AiRuntime,
          useValue: {
            registerCapability: (name: string, handler: AiCapability): (() => void) => {
              capabilities.set(name, handler);
              return (): void => void capabilities.delete(name);
            },
          },
        },
        {
          provide: Plugins,
          useValue: {
            plugins: known,
            error,
            installWithConsent: (id: string): Promise<'installed' | 'declined' | 'failed'> => {
              installs.push(id);
              return Promise.resolve(outcome);
            },
            uninstall: (id: string): Promise<void> => {
              uninstalls.push(id);
              return Promise.resolve();
            },
          },
        },
        {
          provide: Tabs,
          useValue: {
            tabs: signal<readonly Tab[]>([
              { id: 't1', type: 'directory', resourceKey: '/ws/app' } as Tab,
              { id: 't2', type: 'directory', resourceKey: '/ws/notes' } as Tab,
              { id: 't3', type: 'code', resourceKey: '/ws/app/main.rs' } as Tab,
            ]),
          },
        },
        { provide: Log, useValue: { info: (): void => undefined } },
      ],
    });
    TestBed.inject(PluginManagerAgentCapabilities);
  });

  afterEach(() => {
    (window as unknown as { bridge: unknown }).bridge = savedBridge;
  });

  /**
   * Calls a registered capability.
   * @param name The capability.
   * @param input What the model sent.
   * @param scope The run's scope.
   * @returns Returns the answer.
   */
  function call(name: string, input: unknown, scope: AiBridgeScope = PLUGINS): Promise<unknown> {
    return Promise.resolve(capabilities.get(name)!(input, scope));
  }

  it('answersOnlyThePluginManagersOwnAgent', async () => {
    expect(await call(INSTALL_PLUGIN, { id: 'rust-analyzer' }, MODELS)).toEqual({
      available: false,
    });
    expect(installs).toEqual([]);
  });

  it('listsPlugins_withWhatTheyServe_filteredWhenAsked', async () => {
    const all: { result: { id: string; contributes: unknown[] }[] } = (await call(LIST_PLUGINS, {
      filter: 'all',
    })) as { result: { id: string; contributes: unknown[] }[] };
    const installed: { result: { id: string }[] } = (await call(LIST_PLUGINS, {
      filter: 'installed',
    })) as { result: { id: string }[] };

    expect(all.result.map((each: { id: string }) => each.id)).toEqual([
      'rust-analyzer',
      'gopls',
      'roslyn',
    ]);
    expect(all.result[0].contributes).toEqual([{ slot: 'language-server', languages: ['rust'] }]);
    expect(installed.result.map((each: { id: string }) => each.id)).toEqual(['gopls', 'roslyn']);
  });

  it('readsEachOpenWorkspacesEcosystem_andTheLanguagesItImplies', async () => {
    expect(await call(READ_WORKSPACE_LANGUAGES, {})).toEqual({
      available: true,
      result: [
        { folder: '/ws/app', ecosystem: 'rust', languages: ['rust'] },
        { folder: '/ws/notes', ecosystem: null, languages: [] },
      ],
    });
  });

  it('installsThroughTheConsentWindow_andSaysWhatHappened', async () => {
    expect(await call(INSTALL_PLUGIN, { id: 'rust-analyzer' })).toEqual({
      available: true,
      outcome: 'installed',
      version: '1.0.0',
    });

    outcome = 'declined';
    expect(await call(INSTALL_PLUGIN, { id: 'rust-analyzer' })).toEqual({
      available: true,
      outcome: 'declined',
    });

    outcome = 'failed';
    error.set('offline');
    expect(await call(INSTALL_PLUGIN, { id: 'rust-analyzer' })).toEqual({
      available: true,
      outcome: 'failed',
      reason: 'offline',
    });
    expect(installs).toEqual(['rust-analyzer', 'rust-analyzer', 'rust-analyzer']);
  });

  it('refusesToInstallWhatIsUnknownOrAlreadyCurrent', async () => {
    expect(await call(INSTALL_PLUGIN, { id: 'nope' })).toMatchObject({
      error: 'There is no plugin with the id "nope".',
    });
    expect(await call(INSTALL_PLUGIN, { id: 'gopls' })).toMatchObject({
      error: 'gopls is installed and up to date.',
    });
    expect(installs).toEqual([]);
  });

  it('uninstallsOnlyWhatIsInstalled', async () => {
    expect(await call(UNINSTALL_PLUGIN, { id: 'gopls' })).toEqual({
      available: true,
      uninstalled: true,
    });
    expect(await call(UNINSTALL_PLUGIN, { id: 'rust-analyzer' })).toMatchObject({
      error: '"rust-analyzer" is not installed.',
    });
    expect(uninstalls).toEqual(['gopls']);
  });
});
