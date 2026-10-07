import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type {
  AiAuthStatus,
  AiConnection,
  AiDiscoverModelsResult,
  AiModelInfo,
} from '@shared/api/ai-types';
import type { AiClient } from '@shared/api/ai-channels';
import type { PluginSummary } from '@shared/api/plugin-channels';
import { Ai } from '@shared/angular/services/ai/ai';
import { Notification, Notifications } from '@shared/angular/services/notifications/notifications';
import { Plugins } from '@shared/angular/services/plugins/plugins';
import { AiConnections } from './ai-connections';
import { ModelUpdates } from './model-updates';

/**
 * Builds the installed Codex plugin at a version, offering the given manifest models.
 * @param version The installed version.
 * @param models The manifest's models.
 * @returns Returns the plugin summary.
 */
function codex(version: string, models: readonly AiModelInfo[]): PluginSummary {
  return {
    id: 'test.codex',
    name: 'Codex',
    description: 'Test harness.',
    state: 'installed',
    version,
    installedVersion: version,
    installedPath: '/installed/codex',
    detail: null,
    origin: null,
    contributions: [
      {
        slot: 'agent-harness',
        id: 'test.codex',
        displayName: 'Codex',
        priority: 100,
        providers: [
          {
            kind: 'openai',
            company: 'OpenAI',
            description: 'OpenAI models.',
            authMethods: [{ auth: 'codex-login', buttonLabel: 'Subscription' }],
            models,
          },
        ],
      },
    ],
  } as unknown as PluginSummary;
}

/**
 * Builds a model.
 * @param id The model id.
 * @returns Returns the model.
 */
function model(id: string): AiModelInfo {
  return { id, label: id.toUpperCase(), contextWindow: 1 };
}

describe('ModelUpdates', () => {
  let installed: WritableSignal<readonly PluginSummary[]>;
  let discovered: readonly AiModelInfo[] | null;
  let asked: number;
  let connections: AiConnections;
  let updates: ModelUpdates;
  let notifications: Notifications;

  beforeEach(() => {
    localStorage.clear();
    installed = signal<readonly PluginSummary[]>([codex('0.3.0', [model('sol')])]);
    discovered = null;
    asked = 0;
    const client: Partial<AiClient> = {
      // Asked by `add`, which every test's configuration is created through.
      getConnectionAuthStatus: (): Promise<AiAuthStatus> =>
        Promise.resolve({ available: true, detail: 'Signed in.' } as AiAuthStatus),
      discoverModels: (): Promise<AiDiscoverModelsResult> => {
        asked += 1;
        return Promise.resolve(
          discovered === null
            ? { ok: false, models: [], added: 0, detail: 'Could not be asked.' }
            : { ok: true, models: discovered, added: discovered.length, detail: '' },
        );
      },
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: Ai, useValue: { client } },
        { provide: Plugins, useValue: { plugins: installed } },
      ],
    });
    connections = TestBed.inject(AiConnections);
    notifications = TestBed.inject(Notifications);
    connections.update(connections.add('openai').id, {});
    connections.update('openai-1', {
      label: 'Codex',
      harnessId: 'test.codex',
      models: [model('sol')],
      defaultModelId: 'sol',
    });
    updates = TestBed.inject(ModelUpdates);
  });

  /**
   * Reads the configuration.
   * @returns Returns it.
   */
  function codexConnection(): AiConnection {
    return connections.connections()[0];
  }

  /**
   * Gets the new-model toast, if one is up.
   * @returns Returns it, or undefined.
   */
  function offer(): Notification | undefined {
    return notifications
      .toasts()
      .find((toast: Notification): boolean => toast.title.startsWith('Codex has'));
  }

  it('offersNewModels_andAddsThemOnlyWhenTheUserSaysSo', async () => {
    discovered = [model('sol'), model('terra')];

    await updates.check(codexConnection());

    // ⛔ Offered, not applied (#866): the list is the user's to change.
    expect(codexConnection().models.map((m: AiModelInfo): string => m.id)).toEqual(['sol']);
    expect(offer()?.title).toBe('Codex has a new model');
    expect(offer()?.detail).toBe('TERRA. Add it to the model picker?');

    offer()!
      .actions.find((a: { label: string }): boolean => a.label === 'Add')!
      .run();

    expect(codexConnection().models.map((m: AiModelInfo): string => m.id)).toEqual([
      'sol',
      'terra',
    ]);
  });

  it('remembersNotNow_soTheSameModelsAreNotOfferedAgain', async () => {
    discovered = [model('sol'), model('terra')];
    await updates.check(codexConnection());

    offer()!
      .actions.find((a: { label: string }): boolean => a.label === 'Not now')!
      .run();
    notifications.dismissAll();
    connections.update('openai-1', { modelCheck: undefined });
    await updates.check(codexConnection());

    expect(codexConnection().dismissedModelIds).toEqual(['terra']);
    expect(offer()).toBeUndefined();
  });

  it('marksAModelDiscoveryNoLongerLists_withoutAsking', async () => {
    // Marking is not a change to the list: the picker disables it, and removing it is the user's.
    discovered = [model('terra')];

    await updates.check(codexConnection());

    expect(codexConnection().models).toEqual([{ ...model('sol'), retired: true }]);
  });

  it('asksDiscoveryAtMostOnceADay', async () => {
    discovered = [model('sol')];

    await updates.check(codexConnection());
    await updates.check(codexConnection());

    expect(asked).toBe(1);
    expect(codexConnection().modelCheck).toEqual(
      expect.objectContaining({ plugin: 'test.codex@0.3.0', discovered: true }),
    );
  });

  it('asksAgainAtOnce_whenThePluginIsUpdated', async () => {
    discovered = [model('sol')];
    await updates.check(codexConnection());

    installed.set([codex('0.4.0', [model('sol')])]);
    discovered = [model('sol'), model('terra')];
    await updates.check(codexConnection());

    expect(asked).toBe(2);
    expect(offer()?.detail).toBe('TERRA. Add it to the model picker?');
  });

  it('readsTheManifest_whenThePluginCannotDiscover', async () => {
    // Codex before it answered `discover`: the manifest is all there is, so an updated plugin's
    // manifest is how its new models reach a configuration made before the update.
    installed.set([codex('0.3.0', [model('terra'), model('luna')])]);

    await updates.check(codexConnection());

    expect(offer()?.title).toBe('Codex has 2 new models');
    expect(offer()?.detail).toBe('TERRA and LUNA. Add them to the model picker?');
    // Nothing discovered, so nothing is retired on the manifest's word.
    expect(codexConnection().models).toEqual([model('sol')]);
  });

  it('ignoresAConfigurationWhosePluginIsNotInstalled', async () => {
    installed.set([]);
    discovered = [model('terra')];

    await updates.check(codexConnection());

    expect(asked).toBe(0);
    expect(offer()).toBeUndefined();
  });

  it('checksAtStartUp_onceThePluginsAreKnown', async () => {
    discovered = [model('sol'), model('terra')];

    TestBed.tick();
    for (let i: number = 0; i < 6; i += 1) {
      await Promise.resolve();
    }

    expect(asked).toBe(1);
    expect(offer()).toBeDefined();
  });
});
