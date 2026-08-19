import { afterEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { AiConnections } from '@shared/angular/services/ai-connections/ai-connections';
import { AiConnection } from '@shared/api/ai/ai-connection-types';
import { AiModelInfo } from '@shared/api/ai/ai-provider-types';
import { Bridge } from '@shared/api/bridge';
import { ModelRuntimeChannel } from '@shared/api/model-runtime-channels';
import { ModelDetails } from '@shared/api/model-runtime-types';
import { ModelConnections } from './model-connections';

/**
 * Builds a connection with just the fields this link reads.
 */
function connection(
  id: string,
  kind: string,
  models: readonly string[] = [],
  baseUrl?: string,
): AiConnection {
  return {
    id,
    kind,
    models: models.map((m: string): AiModelInfo => ({ id: m, label: m, contextWindow: 1 })),
    baseUrl,
  } as unknown as AiConnection;
}

/**
 * A stand-in registry recording the updates the link makes.
 */
class FakeConnections {
  public readonly updates: { id: string; patch: Partial<AiConnection> }[] = [];
  public readonly removals: { id: string; modelId: string }[] = [];
  public list: readonly AiConnection[] = [];

  public connections(): readonly AiConnection[] {
    return this.list;
  }

  public update(id: string, patch: Partial<AiConnection>): void {
    this.updates.push({ id, patch });
  }

  public removeModel(target: AiConnection, modelId: string): void {
    this.removals.push({ id: target.id, modelId });
  }
}

describe('ModelConnections', () => {
  let fake: FakeConnections;

  /**
   * Installs a bridge answering `show` with the given details, and builds the link.
   */
  function build(details: ModelDetails | null): ModelConnections {
    (window as unknown as { bridge: Bridge }).bridge = {
      invoke: <T>(channel: string): Promise<T> =>
        (channel as ModelRuntimeChannel) === ModelRuntimeChannel.Show
          ? Promise.resolve(details as T)
          : Promise.resolve(null as T),
      send: (): void => undefined,
      on: (): (() => void) => (): void => undefined,
    };
    fake = new FakeConnections();
    TestBed.configureTestingModule({
      providers: [{ provide: AiConnections, useValue: fake }],
    });
    return TestBed.inject(ModelConnections);
  }

  afterEach((): void => {
    delete (window as unknown as { bridge?: Bridge }).bridge;
    TestBed.resetTestingModule();
  });

  it('adds a pulled model to the local Ollama connection', async () => {
    const link: ModelConnections = build({
      name: 'llama3.2:3b',
      family: 'llama',
      parameterSize: '3.2B',
      quantization: 'Q4_K_M',
      format: 'gguf',
      contextLength: 131_072,
      capabilities: [],
    });
    fake.list = [connection('ollama', 'ollama')];

    await link.linkInstalled('llama3.2:3b');

    expect(fake.updates).toHaveLength(1);
    const added: readonly AiModelInfo[] = fake.updates[0]?.patch.models ?? [];
    expect(added.at(-1)).toEqual({
      id: 'llama3.2:3b',
      label: 'llama3.2:3b',
      contextWindow: 131_072,
    });
  });

  it("carries the runtime's real context window across, not a guess", async () => {
    const link: ModelConnections = build({
      name: 'qwen2.5:7b',
      family: 'qwen2',
      parameterSize: '7.6B',
      quantization: 'Q4_K_M',
      format: 'gguf',
      contextLength: 32_768,
      capabilities: [],
    });
    fake.list = [connection('ollama', 'ollama')];

    await link.linkInstalled('qwen2.5:7b');

    expect((fake.updates[0]?.patch.models ?? []).at(-1)?.contextWindow).toBe(32_768);
  });

  it('falls back to a conservative context window when the runtime reports none', async () => {
    const link: ModelConnections = build(null);
    fake.list = [connection('ollama', 'ollama')];

    await link.linkInstalled('mystery:latest');

    // Too small merely overstates how full the context is; too large would understate it.
    expect((fake.updates[0]?.patch.models ?? []).at(-1)?.contextWindow).toBe(8_192);
  });

  it('leaves other providers alone', async () => {
    const link: ModelConnections = build(null);
    fake.list = [connection('anthropic', 'anthropic'), connection('openai', 'openai')];

    await link.linkInstalled('llama3.2:3b');

    expect(fake.updates).toEqual([]);
  });

  it('skips an Ollama connection pointed at another host', async () => {
    const link: ModelConnections = build(null);
    fake.list = [connection('remote', 'ollama', [], 'http://gpu-box:11434/v1')];

    await link.linkInstalled('llama3.2:3b');

    // A model that only exists on this machine must not be offered against a remote server.
    expect(fake.updates).toEqual([]);
  });

  it('does not add a model the connection already lists', async () => {
    const link: ModelConnections = build(null);
    fake.list = [connection('ollama', 'ollama', ['llama3.2:3b'])];

    await link.linkInstalled('llama3.2:3b');

    expect(fake.updates).toEqual([]);
  });

  it('adds to every local Ollama connection', async () => {
    const link: ModelConnections = build(null);
    fake.list = [connection('ollama', 'ollama'), connection('ollama-2', 'ollama')];

    await link.linkInstalled('llama3.2:3b');

    expect(fake.updates.map((u) => u.id)).toEqual(['ollama', 'ollama-2']);
  });

  it('removes a deleted model from the connection', () => {
    const link: ModelConnections = build(null);
    fake.list = [connection('ollama', 'ollama', ['llama3.2:3b'])];

    link.unlinkRemoved('llama3.2:3b');

    expect(fake.removals).toEqual([{ id: 'ollama', modelId: 'llama3.2:3b' }]);
  });

  it('does nothing when removing a model the connection never listed', () => {
    const link: ModelConnections = build(null);
    fake.list = [connection('ollama', 'ollama', ['other:latest'])];

    link.unlinkRemoved('llama3.2:3b');

    expect(fake.removals).toEqual([]);
  });

  it('is a no-op when there is no local Ollama connection at all', async () => {
    const link: ModelConnections = build(null);
    fake.list = [];

    await link.linkInstalled('llama3.2:3b');
    link.unlinkRemoved('llama3.2:3b');

    expect(fake.updates).toEqual([]);
    expect(fake.removals).toEqual([]);
  });
});
