import { TestBed } from '@angular/core/testing';

import type {
  AiAuthStatus,
  AiConnection,
  AiDiscoverModelsResult,
  AiModelInfo,
} from '@shared/api/ai-types';
import type { AiClient } from '@shared/api/ai-channels';
import { Ai } from '@shared/angular/services/ai/ai';
import { Settings } from '@shared/angular/services/settings/settings';
import { AiConnections } from './ai-connections';

describe('AiConnections', () => {
  let service: AiConnections;
  let settings: Settings;

  beforeEach(() => {
    localStorage.clear();
    delete (window as unknown as { bridge?: unknown }).bridge;
    service = TestBed.inject(AiConnections);
    settings = TestBed.inject(Settings);
  });

  it('connections_whenUnconfigured_isEmpty', () => {
    // ⛔ A fresh install seeds nothing (#653). Core used to ship four configurations — Claude, Codex, an
    // Anthropic key and Ollama — so a binary carrying no way to run any of them still listed them all.
    // A configuration exists because the user created one from a page an installed plugin contributed.
    expect(service.connections()).toEqual(settings.aiConnections());
    expect(service.connections()).toEqual([]);
  });

  it('isAvailable_whenBridgeAbsent_isFalse', () => {
    expect(service.isAvailable).toBe(false);
  });

  it('add_whenCalled_appendsWithAUniqueIdAndGenericDefaults', () => {
    // ⛔ The defaults name no provider (#653). `add` used to label a connection from a `KIND_LABELS`
    // table and default `ollama` to `none` and everything else to an API key — core knowing two named
    // providers in the one place a configuration is created. The method supplied by a contributed page
    // carries that now, and the kind is the only honest fallback when none is.
    const before: number = service.connections().length;

    const openai: AiConnection = service.add('openai');
    const ollama: AiConnection = service.add('ollama');
    const openaiTwo: AiConnection = service.add('openai');

    expect(service.connections().length).toBe(before + 3);
    expect(openai.auth).toBe('api-key');
    expect(ollama.auth).toBe('api-key');
    expect(ollama.label).toBe('ollama');
    expect(openai.id).not.toBe(openaiTwo.id);
  });

  it('add_whenGivenAMethod_takesItsAuthLabelAndBaseUrl', () => {
    const cloud: AiConnection = service.add('ollama', {
      harnessId: 'test.harness',
      auth: 'api-key',
      buttonLabel: 'Cloud',
      defaultDisplayName: 'Cloud',
      baseUrl: 'https://ollama.com',
      hint: 'Ollama Cloud.',
    });

    expect(cloud.auth).toBe('api-key');
    expect(cloud.label).toBe('Cloud');
    expect(cloud.baseUrl).toBe('https://ollama.com');
    // 🔑 A configuration names the plugin that will run it from the moment it exists — the page it was
    // created from came from that plugin, so there is nothing for the user to choose afterwards (#697).
    expect(cloud.harnessId).toBe('test.harness');
  });

  it('connectionsForKinds_whenCalled_filtersByKind', () => {
    service.add('anthropic');
    service.add('anthropic');
    service.add('ollama');

    const anthropic: readonly AiConnection[] = service.connectionsForKinds(['anthropic']);
    expect(anthropic.length).toBe(2);
    expect(anthropic.every((c: AiConnection): boolean => c.kind === 'anthropic')).toBe(true);

    expect(service.connectionsForKinds(['openai-compatible', 'custom'])).toEqual([]);
  });

  it('update_whenCalled_patchesTheConnection', () => {
    const created: AiConnection = service.add('openai');

    service.update(created.id, { label: 'My OpenAI', baseUrl: 'https://example/v1' });

    const updated: AiConnection | undefined = service
      .connections()
      .find((connection: AiConnection): boolean => connection.id === created.id);
    expect(updated?.label).toBe('My OpenAI');
    expect(updated?.baseUrl).toBe('https://example/v1');
  });

  it('remove_whenUserConnection_dropsIt', () => {
    const created: AiConnection = service.add('openai');

    service.remove(created.id);

    expect(
      service
        .connections()
        .some((connection: AiConnection): boolean => connection.id === created.id),
    ).toBe(false);
  });

  it('move_whenCalled_reordersTheConnection', () => {
    service.add('ollama');
    const created: AiConnection = service.add('openai');
    const lastIndex: number = service.connections().length - 1;
    expect(service.connections()[lastIndex].id).toBe(created.id);

    service.move(created.id, -1);

    expect(service.connections()[lastIndex - 1].id).toBe(created.id);
  });

  it('addModel_whenCalled_appendsAModelOnce', () => {
    const created: AiConnection = service.add('openai');

    service.addModel(current(created.id), 'gpt-4o');
    service.addModel(current(created.id), 'gpt-4o');
    service.addModel(current(created.id), '   ');

    expect(current(created.id).models.map((model): string => model.id)).toEqual(['gpt-4o']);
  });

  it('removeModel_whenDefault_clearsOrReassignsTheDefault', () => {
    const created: AiConnection = service.add('openai');
    service.addModel(current(created.id), 'a');
    service.addModel(current(created.id), 'b');
    service.setDefaultModel(current(created.id), 'a');

    service.removeModel(current(created.id), 'a');

    expect(current(created.id).defaultModelId).toBe('b');
  });

  it('togglePinnedAndHidden_whenCalled_flipTheFlags', () => {
    const created: AiConnection = service.add('openai');
    service.addModel(current(created.id), 'a');

    service.togglePinned(current(created.id), 'a');
    service.toggleHidden(current(created.id), 'a');

    expect(current(created.id).models[0].pinned).toBe(true);
    expect(current(created.id).models[0].hidden).toBe(true);
  });

  describe('background discovery', () => {
    let discoveries: AiConnection[];
    let discovered: readonly AiModelInfo[];

    /**
     * Builds the service over a stub client that answers discovery with {@link discovered}.
     * @returns Returns the service.
     */
    function withClient(): AiConnections {
      discoveries = [];
      const client: Partial<AiClient> = {
        discoverModels: (request: {
          connection: AiConnection;
        }): Promise<AiDiscoverModelsResult> => {
          discoveries.push(request.connection);
          return Promise.resolve({
            ok: true,
            models: discovered,
            added: discovered.length,
            detail: '',
          });
        },
        setConnectionKey: (): Promise<AiAuthStatus> =>
          Promise.resolve({ available: true, detail: 'ready' } as AiAuthStatus),
        getConnectionAuthStatus: (): Promise<AiAuthStatus> =>
          Promise.resolve({ available: true, detail: 'Signed in.' } as AiAuthStatus),
      };
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [{ provide: Ai, useValue: { client } }] });
      return TestBed.inject(AiConnections);
    }

    /**
     * Lets queued promises settle.
     */
    async function settle(): Promise<void> {
      for (let i: number = 0; i < 4; i += 1) {
        await Promise.resolve();
      }
    }

    it('add_whenTheMethodNeedsNoKey_asksThePluginForModelsAtOnce', async () => {
      // 🔑 The seeded list is a snapshot frozen at the plugin's release; the harness knows what the
      // provider offers today. Asking on creation is what stops a fresh install showing last
      // generation's models until the user thinks to press Refresh.
      discovered = [{ id: 'claude-opus-5', label: 'Opus 5', contextWindow: 1_000_000 }];
      const connections: AiConnections = withClient();

      const created: AiConnection = connections.add('anthropic', {
        harnessId: 'test.harness',
        auth: 'claude-login',
        buttonLabel: 'Sign in',
        defaultDisplayName: 'Claude',
        hint: '',
      });
      await settle();

      expect(discoveries.map((c: AiConnection): string => c.id)).toEqual([created.id]);
      expect(
        connections
          .connections()
          .find((c: AiConnection): boolean => c.id === created.id)
          ?.models.map((m: AiModelInfo): string => m.id),
      ).toEqual(['claude-opus-5']);
    });

    it('add_whenTheMethodNeedsAKey_waitsUntilOneIsStored', async () => {
      discovered = [{ id: 'gpt-5', label: 'GPT-5', contextWindow: 400_000 }];
      const connections: AiConnections = withClient();

      const created: AiConnection = connections.add('openai', {
        harnessId: 'test.harness',
        auth: 'api-key',
        buttonLabel: 'API key',
        defaultDisplayName: 'OpenAI',
        hint: '',
      });
      await settle();
      expect(discoveries).toEqual([]);

      await connections.setKey(created, 'sk-test');
      await settle();

      expect(discoveries.map((c: AiConnection): string => c.id)).toEqual([created.id]);
    });

    it('add_asksAtOnceWhetherTheConfigurationCanBeUsed', async () => {
      // A subscription already signed in must not sit behind a pending "unavailable" status until
      // the page is reopened.
      const connections: AiConnections = withClient();

      const created: AiConnection = connections.add('anthropic', {
        harnessId: 'test.harness',
        auth: 'claude-login',
        buttonLabel: 'Subscription',
        defaultDisplayName: 'Claude',
        hint: '',
      });
      await settle();

      expect(connections.authStatus(created.id).available).toBe(true);
    });

    it('add_whenNoPluginIsNamed_doesNotAsk', async () => {
      const connections: AiConnections = withClient();

      connections.add('openai');
      await settle();

      expect(discoveries).toEqual([]);
    });

    it('discover_addsWhatIsNew_andRemovesNothing_markingWhatIsNoLongerOffered', async () => {
      // ⛔ #866: a model list only ever gains. Discover used to replace the list with whatever the
      // provider said, throwing away the user's own curation; now a model the provider stopped
      // offering stays — marked, so the picker can disable it — until the user removes it.
      discovered = [
        { id: 'terra', label: 'Terra', contextWindow: 272_000 },
        { id: 'luna', label: 'Luna', contextWindow: 272_000 },
      ];
      const connections: AiConnections = withClient();
      const created: AiConnection = connections.add('openai');
      connections.update(created.id, {
        harnessId: 'test.harness',
        models: [
          { id: 'sol', label: 'Sol', contextWindow: 1_050_000 },
          { id: 'terra', label: 'Terra', contextWindow: 272_000, pinned: true },
        ],
        defaultModelId: 'sol',
      });

      const outcome: { ok: boolean; detail: string } | null = await connections.discover(
        find(connections, created.id),
      );

      const after: AiConnection = find(connections, created.id);
      expect(after.models.map((m: AiModelInfo): string => m.id)).toEqual(['sol', 'terra', 'luna']);
      expect(after.models[0].retired).toBe(true);
      expect(after.models[1]).toEqual({
        id: 'terra',
        label: 'Terra',
        contextWindow: 272_000,
        pinned: true,
      });
      // The default is the user's: a retired one is shown as retired, not quietly swapped.
      expect(after.defaultModelId).toBe('sol');
      expect(outcome).toEqual({
        ok: true,
        detail: 'Added Luna. No longer offered: Sol — remove it here if you no longer want it.',
      });
    });

    it('discover_neverRetiresAModelTheUserAddedByHand', async () => {
      // A model added by hand was added because discovery does not list it.
      discovered = [{ id: 'terra', label: 'Terra', contextWindow: 272_000 }];
      const connections: AiConnections = withClient();
      const created: AiConnection = connections.add('openai');
      connections.update(created.id, { harnessId: 'test.harness' });
      connections.addModel(find(connections, created.id), 'gpt-5.5');

      await connections.discover(find(connections, created.id));

      expect(find(connections, created.id).models[0]).toEqual({
        id: 'gpt-5.5',
        label: 'gpt-5.5',
        contextWindow: 32_768,
        manual: true,
      });
    });

    it('discover_offersModelsTheUserTurnedDown', async () => {
      // "Not now" is remembered for the notification; pressing Discover is asking.
      discovered = [{ id: 'luna', label: 'Luna', contextWindow: 272_000 }];
      const connections: AiConnections = withClient();
      const created: AiConnection = connections.add('openai');
      connections.update(created.id, { harnessId: 'test.harness' });
      connections.dismissModels(created.id, ['luna']);

      await connections.discover(find(connections, created.id));

      const after: AiConnection = find(connections, created.id);
      expect(after.models.map((m: AiModelInfo): string => m.id)).toEqual(['luna']);
      expect(after.dismissedModelIds).toEqual([]);
    });

    it('discover_whenTheProviderCannotAnswer_changesNothing', async () => {
      const connections: AiConnections = withClient();
      const created: AiConnection = connections.add('openai');
      connections.update(created.id, {
        models: [{ id: 'sol', label: 'Sol', contextWindow: 1 }],
      });
      TestBed.inject(Ai).client!.discoverModels = (): Promise<AiDiscoverModelsResult> =>
        Promise.resolve({ ok: false, models: [], added: 0, detail: 'Could not be asked.' });

      const outcome: { ok: boolean; detail: string } | null = await connections.discover(
        find(connections, created.id),
      );

      expect(outcome).toEqual({ ok: false, detail: 'Could not be asked.' });
      expect(find(connections, created.id).models).toEqual([
        { id: 'sol', label: 'Sol', contextWindow: 1 },
      ]);
    });

    it('setKey_onACuratedConfiguration_onlyAdds', async () => {
      // Re-entering a key must not undo the user's curation; only a configuration still holding
      // its untouched seeds takes the discovered list outright.
      discovered = [{ id: 'gpt-5', label: 'GPT-5', contextWindow: 400_000 }];
      const connections: AiConnections = withClient();
      const created: AiConnection = connections.add('openai');
      connections.update(created.id, { harnessId: 'test.harness' });
      connections.addModel(find(connections, created.id), 'my-model');

      await connections.setKey(find(connections, created.id), 'sk-test');
      await settle();

      expect(find(connections, created.id).models.map((m: AiModelInfo): string => m.id)).toEqual([
        'my-model',
        'gpt-5',
      ]);
    });

    it('addModels_appendsAndForgetsTheyWereTurnedDown', () => {
      const connections: AiConnections = withClient();
      const created: AiConnection = connections.add('openai');
      connections.dismissModels(created.id, ['luna', 'terra']);

      connections.addModels(created.id, [{ id: 'luna', label: 'Luna', contextWindow: 1 }]);

      const after: AiConnection = find(connections, created.id);
      expect(after.models.map((m: AiModelInfo): string => m.id)).toEqual(['luna']);
      expect(after.defaultModelId).toBe('luna');
      expect(after.dismissedModelIds).toEqual(['terra']);
    });

    /**
     * Reads a connection by id from the given service.
     * @param connections The service.
     * @param id The connection id.
     * @returns Returns the connection.
     */
    function find(connections: AiConnections, id: string): AiConnection {
      const connection: AiConnection | undefined = connections
        .connections()
        .find((candidate: AiConnection): boolean => candidate.id === id);
      if (connection === undefined) {
        throw new Error(`No connection "${id}"`);
      }
      return connection;
    }
  });

  it('removeModel_remembersItAsTurnedDown', () => {
    // So a background check does not offer straight back what the user just removed (#866).
    const created: AiConnection = service.add('openai');
    service.addModel(current(created.id), 'a');

    service.removeModel(current(created.id), 'a');

    expect(current(created.id).dismissedModelIds).toEqual(['a']);
  });

  it('authStatus_whenUnresolved_isPending', () => {
    const created: AiConnection = service.add('openai');

    expect(service.authStatus(created.id).available).toBe(false);
    expect(service.authStatus(created.id).detail).toBe('Checking…');
  });

  /**
   * Reads the current persisted connection for the given id.
   * @param id The connection id.
   * @returns Returns the connection.
   */
  function current(id: string): AiConnection {
    const connection: AiConnection | undefined = service
      .connections()
      .find((candidate: AiConnection): boolean => candidate.id === id);
    if (connection === undefined) {
      throw new Error(`No connection "${id}"`);
    }
    return connection;
  }
});
