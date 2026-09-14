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

    it('add_whenNoPluginIsNamed_doesNotAsk', async () => {
      const connections: AiConnections = withClient();

      connections.add('openai');
      await settle();

      expect(discoveries).toEqual([]);
    });
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
