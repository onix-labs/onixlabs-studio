import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LocalModel,
  ModelDetails,
  ModelPullProgress,
  RunningModel,
} from '@shared/api/model-runtime-types';
import {
  hostFromOrigin,
  ollamaModelStore,
  OllamaRuntime,
  parsePullLine,
  readContextLength,
} from './ollama-runtime';
import { OllamaResponse, OllamaTransport } from './ollama-transport';

/**
 * A fake transport recording requests, so the runtime's mapping and server-absent handling can be
 * driven without a running Ollama.
 */
class FakeTransport implements OllamaTransport {
  public readonly requests: { method: string; path: string; body?: unknown }[] = [];
  public responder: (method: string, path: string) => Promise<OllamaResponse> =
    (): Promise<OllamaResponse> => Promise.reject(new Error('ECONNREFUSED'));

  /**
   * The lines a streaming request emits before ending.
   */
  public streamLines: readonly string[] = [];

  /**
   * When set, the streaming request rejects with this error instead of ending normally.
   */
  public streamError: Error | null = null;

  /**
   * Aborts partway: emits this many lines, then honours the signal by rejecting.
   */
  public abortAfter: number | null = null;

  public request(method: string, path: string, body?: unknown): Promise<OllamaResponse> {
    this.requests.push({ method, path, body });
    return this.responder(method, path);
  }

  public stream(
    method: string,
    path: string,
    body: unknown,
    onLine: (line: string) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    this.requests.push({ method, path, body });
    let emitted: number = 0;
    for (const line of this.streamLines) {
      if (this.abortAfter !== null && emitted >= this.abortAfter) {
        // Stand in for the real transport's reaction to an abort: tear down and reject.
        return Promise.reject(new Error('aborted'));
      }
      if (signal?.aborted === true) {
        return Promise.reject(new Error('aborted'));
      }
      onLine(line);
      emitted += 1;
    }
    return this.streamError === null ? Promise.resolve() : Promise.reject(this.streamError);
  }
}

/**
 * Builds a runtime over a fresh fake transport.
 */
function runtimeWith(): { runtime: OllamaRuntime; transport: FakeTransport } {
  const transport: FakeTransport = new FakeTransport();
  return { runtime: new OllamaRuntime('http://127.0.0.1:11434', transport), transport };
}

/**
 * A responder answering a single path with a 200 JSON body and rejecting everything else.
 */
function respondJson(
  path: string,
  body: unknown,
): (method: string, path: string) => Promise<OllamaResponse> {
  return (_method: string, requested: string): Promise<OllamaResponse> =>
    requested === path
      ? Promise.resolve({ statusCode: 200, body: JSON.stringify(body) })
      : Promise.reject(new Error('unexpected path'));
}

describe('OllamaRuntime.status', () => {
  it('reports the version when the server answers', async () => {
    const { runtime, transport } = runtimeWith();
    transport.responder = respondJson('/api/version', { version: '0.5.7' });

    expect(await runtime.status()).toEqual({
      available: true,
      version: '0.5.7',
      startedByStudio: false,
    });
  });

  it('reports unavailable rather than throwing when the server is absent', async () => {
    const { runtime } = runtimeWith();

    expect(await runtime.status()).toEqual({ available: false });
  });
});

describe('OllamaRuntime.list', () => {
  it('maps the tags response onto normalised local models', async () => {
    const { runtime, transport } = runtimeWith();
    transport.responder = respondJson('/api/tags', {
      models: [
        {
          name: 'llama3.2:3b',
          size: 2_019_393_189,
          digest: 'abc123',
          modified_at: '2026-08-01T10:00:00Z',
          details: { family: 'llama', parameter_size: '3.2B', quantization_level: 'Q4_K_M' },
        },
      ],
    });

    const models: LocalModel[] = await runtime.list();

    expect(models).toEqual([
      {
        name: 'llama3.2:3b',
        size: 2_019_393_189,
        digest: 'abc123',
        modifiedAt: '2026-08-01T10:00:00Z',
        family: 'llama',
        parameterSize: '3.2B',
        quantization: 'Q4_K_M',
      },
    ]);
  });

  it('defaults every unreported field rather than emitting undefined', async () => {
    const { runtime, transport } = runtimeWith();
    transport.responder = respondJson('/api/tags', { models: [{ model: 'bare:latest' }] });

    expect(await runtime.list()).toEqual([
      {
        name: 'bare:latest',
        size: 0,
        digest: '',
        modifiedAt: '',
        family: '',
        parameterSize: '',
        quantization: '',
      },
    ]);
  });

  it('returns an empty list when the server is absent', async () => {
    const { runtime } = runtimeWith();

    expect(await runtime.list()).toEqual([]);
  });

  it('returns an empty list when the server answers with a non-2xx status', async () => {
    const { runtime, transport } = runtimeWith();
    transport.responder = (): Promise<OllamaResponse> =>
      Promise.resolve({ statusCode: 500, body: 'boom' });

    expect(await runtime.list()).toEqual([]);
  });

  it('returns an empty list when the body is not valid JSON', async () => {
    const { runtime, transport } = runtimeWith();
    transport.responder = (): Promise<OllamaResponse> =>
      Promise.resolve({ statusCode: 200, body: '<html>not json</html>' });

    expect(await runtime.list()).toEqual([]);
  });
});

describe('OllamaRuntime.running', () => {
  it('maps the ps response, carrying the VRAM split through', async () => {
    const { runtime, transport } = runtimeWith();
    transport.responder = respondJson('/api/ps', {
      models: [
        {
          name: 'llama3.2:3b',
          size: 4_000_000,
          size_vram: 4_000_000,
          expires_at: '2026-08-19T12:05:00Z',
        },
        { name: 'cpu-bound:latest', size: 4_000_000, size_vram: 0 },
      ],
    });

    const running: RunningModel[] = await runtime.running();

    expect(running).toEqual([
      {
        name: 'llama3.2:3b',
        size: 4_000_000,
        sizeVram: 4_000_000,
        expiresAt: '2026-08-19T12:05:00Z',
      },
      { name: 'cpu-bound:latest', size: 4_000_000, sizeVram: 0, expiresAt: '' },
    ]);
  });

  it('returns an empty list when the server is absent', async () => {
    const { runtime } = runtimeWith();

    expect(await runtime.running()).toEqual([]);
  });
});

describe('OllamaRuntime.show', () => {
  it('maps the show response and extracts the context length', async () => {
    const { runtime, transport } = runtimeWith();
    transport.responder = respondJson('/api/show', {
      details: {
        format: 'gguf',
        family: 'llama',
        parameter_size: '3.2B',
        quantization_level: 'Q4_K_M',
      },
      capabilities: ['completion', 'tools'],
      model_info: { 'general.architecture': 'llama', 'llama.context_length': 131_072 },
    });

    const details: ModelDetails | null = await runtime.show('llama3.2:3b');

    expect(details).toEqual({
      name: 'llama3.2:3b',
      family: 'llama',
      parameterSize: '3.2B',
      quantization: 'Q4_K_M',
      format: 'gguf',
      contextLength: 131_072,
      capabilities: ['completion', 'tools'],
    });
  });

  it('names the model in the body under both the new and legacy fields', async () => {
    const { runtime, transport } = runtimeWith();
    transport.responder = respondJson('/api/show', {});

    await runtime.show('llama3.2:3b');

    expect(transport.requests[0]?.body).toEqual({ model: 'llama3.2:3b', name: 'llama3.2:3b' });
  });

  it('resolves null when the model is unknown', async () => {
    const { runtime, transport } = runtimeWith();
    transport.responder = (): Promise<OllamaResponse> =>
      Promise.resolve({ statusCode: 404, body: '{"error":"model not found"}' });

    expect(await runtime.show('ghost:latest')).toBeNull();
  });
});

describe('OllamaRuntime.remove', () => {
  it('reports success on a 2xx', async () => {
    const { runtime, transport } = runtimeWith();
    transport.responder = (): Promise<OllamaResponse> =>
      Promise.resolve({ statusCode: 200, body: '' });

    expect(await runtime.remove('llama3.2:3b')).toBe(true);
    expect(transport.requests[0]).toMatchObject({ method: 'DELETE', path: '/api/delete' });
  });

  it('reports failure on a non-2xx', async () => {
    const { runtime, transport } = runtimeWith();
    transport.responder = (): Promise<OllamaResponse> =>
      Promise.resolve({ statusCode: 404, body: '' });

    expect(await runtime.remove('ghost:latest')).toBe(false);
  });

  it('reports failure rather than throwing when the server is absent', async () => {
    const { runtime } = runtimeWith();

    expect(await runtime.remove('llama3.2:3b')).toBe(false);
  });
});

describe('OllamaRuntime lifecycle without a provisioner', () => {
  it('reports no installation, so a runtime built for API tests never claims a binary', async () => {
    const { runtime } = runtimeWith();

    expect(await runtime.installation()).toEqual({ kind: 'absent', executable: '', version: '' });
  });

  it('refuses to start when there is no binary to start', async () => {
    const { runtime } = runtimeWith();

    expect(await runtime.start()).toBe(false);
  });

  it('refuses to stop a server it does not own', async () => {
    const { runtime } = runtimeWith();

    expect(await runtime.stop()).toBe(false);
  });

  it('reports the server as not started by Studio when it did not start it', async () => {
    const { runtime, transport } = runtimeWith();
    transport.responder = respondJson('/api/version', { version: '0.5.7' });

    expect(await runtime.status()).toEqual({
      available: true,
      version: '0.5.7',
      startedByStudio: false,
    });
  });
});

describe('OllamaRuntime.pull', () => {
  /**
   * A realistic `/api/pull` stream: manifest, two download updates, the finishing steps, then success.
   */
  const HAPPY: readonly string[] = [
    '{"status":"pulling manifest"}',
    '{"status":"pulling aabbcc","digest":"sha256:aabbcc","total":1000,"completed":250}',
    '{"status":"pulling aabbcc","digest":"sha256:aabbcc","total":1000,"completed":1000}',
    '{"status":"verifying sha256 digest"}',
    '{"status":"writing manifest"}',
    '{"status":"success"}',
  ];

  it('reports queued immediately, so a click is acknowledged before the server speaks', async () => {
    const { runtime, transport } = runtimeWith();
    transport.streamLines = HAPPY;
    const seen: ModelPullProgress[] = [];

    await runtime.pull('llama3.2:3b', (p: ModelPullProgress): void => void seen.push(p));

    expect(seen[0]).toEqual({
      model: 'llama3.2:3b',
      stage: 'queued',
      status: 'queued',
      received: 0,
      total: 0,
    });
  });

  it('succeeds and walks the stages through to done', async () => {
    const { runtime, transport } = runtimeWith();
    transport.streamLines = HAPPY;
    const seen: ModelPullProgress[] = [];

    const ok: boolean = await runtime.pull(
      'llama3.2:3b',
      (p: ModelPullProgress): void => void seen.push(p),
    );

    expect(ok).toBe(true);
    expect(seen.map((p: ModelPullProgress): string => p.stage)).toEqual([
      'queued',
      'downloading',
      'downloading',
      'downloading',
      'verifying',
      'verifying',
      'done',
    ]);
  });

  it('carries the byte counts through so a progress bar can be drawn', async () => {
    const { runtime, transport } = runtimeWith();
    transport.streamLines = HAPPY;
    const seen: ModelPullProgress[] = [];

    await runtime.pull('llama3.2:3b', (p: ModelPullProgress): void => void seen.push(p));

    const downloading: ModelPullProgress[] = seen.filter(
      (p: ModelPullProgress): boolean => p.received > 0,
    );
    expect(downloading[0]).toMatchObject({ received: 250, total: 1000 });
    expect(downloading.at(-1)).toMatchObject({ received: 1000, total: 1000 });
  });

  it('requests the pull as a stream, naming the model under both fields', async () => {
    const { runtime, transport } = runtimeWith();
    transport.streamLines = HAPPY;

    await runtime.pull('llama3.2:3b', (): void => undefined);

    expect(transport.requests[0]).toMatchObject({ method: 'POST', path: '/api/pull' });
    expect(transport.requests[0]?.body).toEqual({
      model: 'llama3.2:3b',
      name: 'llama3.2:3b',
      stream: true,
    });
  });

  it('fails on an in-band error, which is how Ollama reports a bad model reference', async () => {
    const { runtime, transport } = runtimeWith();
    // The request itself succeeds; the failure only appears inside the stream.
    transport.streamLines = ['{"error":"model \\"ghost\\" not found"}'];
    const seen: ModelPullProgress[] = [];

    const ok: boolean = await runtime.pull(
      'ghost:latest',
      (p: ModelPullProgress): void => void seen.push(p),
    );

    expect(ok).toBe(false);
    expect(seen.at(-1)?.stage).toBe('failed');
    expect(seen.at(-1)?.error).toContain('not found');
  });

  it('fails when the stream ends without reporting success', async () => {
    const { runtime, transport } = runtimeWith();
    transport.streamLines = ['{"status":"pulling manifest"}'];
    const seen: ModelPullProgress[] = [];

    const ok: boolean = await runtime.pull(
      'llama3.2:3b',
      (p: ModelPullProgress): void => void seen.push(p),
    );

    expect(ok).toBe(false);
    expect(seen.at(-1)?.stage).toBe('failed');
    expect(seen.at(-1)?.error).toContain('without reporting success');
  });

  it('fails, rather than throwing, when the connection drops', async () => {
    const { runtime, transport } = runtimeWith();
    transport.streamError = new Error('ECONNRESET');
    const seen: ModelPullProgress[] = [];

    const ok: boolean = await runtime.pull(
      'llama3.2:3b',
      (p: ModelPullProgress): void => void seen.push(p),
    );

    expect(ok).toBe(false);
    expect(seen.at(-1)).toMatchObject({ stage: 'failed', error: 'ECONNRESET' });
  });

  it('reports a cancel as cancelled rather than failed', async () => {
    const { runtime, transport } = runtimeWith();
    transport.streamLines = HAPPY;
    transport.abortAfter = 2;
    const controller: AbortController = new AbortController();
    controller.abort();
    const seen: ModelPullProgress[] = [];

    const ok: boolean = await runtime.pull(
      'llama3.2:3b',
      (p: ModelPullProgress): void => void seen.push(p),
      controller.signal,
    );

    expect(ok).toBe(false);
    // The user asking to stop is a decision, not an error, and must not surface as one.
    expect(seen.at(-1)?.stage).toBe('cancelled');
    expect(seen.some((p: ModelPullProgress): boolean => p.stage === 'failed')).toBe(false);
  });
});

describe('parsePullLine', () => {
  it('classifies the finishing steps as verifying', () => {
    for (const status of [
      'verifying sha256 digest',
      'writing manifest',
      'removing any unused layers',
    ]) {
      expect(parsePullLine('m', JSON.stringify({ status }))?.stage).toBe('verifying');
    }
  });

  it('treats an unrecognised status as downloading rather than dropping it', () => {
    expect(parsePullLine('m', '{"status":"something new"}')?.stage).toBe('downloading');
  });

  it('stamps the model onto every update, so concurrent pulls stay attributable', () => {
    expect(parsePullLine('llama3.2:3b', '{"status":"success"}')?.model).toBe('llama3.2:3b');
  });

  it('returns null for a line that is not valid JSON', () => {
    expect(parsePullLine('m', 'not json')).toBeNull();
  });

  it('defaults missing byte counts to zero', () => {
    expect(parsePullLine('m', '{"status":"pulling manifest"}')).toMatchObject({
      received: 0,
      total: 0,
    });
  });
});

describe('hostFromOrigin', () => {
  it('reduces an origin to the host:port form OLLAMA_HOST takes', () => {
    expect(hostFromOrigin('http://127.0.0.1:11434')).toBe('127.0.0.1:11434');
    expect(hostFromOrigin('https://box:1234')).toBe('box:1234');
  });

  it('drops the port when the origin carries none', () => {
    expect(hostFromOrigin('http://box')).toBe('box');
  });

  it('passes a value it cannot parse straight through', () => {
    expect(hostFromOrigin('not a url')).toBe('not a url');
  });
});

describe('ollamaModelStore', () => {
  it('prefers an explicit OLLAMA_MODELS', () => {
    expect(ollamaModelStore({ OLLAMA_MODELS: '/data/models' }, '/home/m')).toBe('/data/models');
  });

  it('falls back to the store under the home directory', () => {
    expect(ollamaModelStore({}, '/home/m')).toBe(path.join('/home/m', '.ollama', 'models'));
  });
});

describe('readContextLength', () => {
  it('finds the key whatever the architecture prefix is', () => {
    expect(readContextLength({ 'qwen2.context_length': 32_768 })).toBe(32_768);
    expect(readContextLength({ 'gemma3.context_length': 8_192 })).toBe(8_192);
  });

  it('returns undefined when there is no context length, or it is not a number', () => {
    expect(readContextLength(undefined)).toBeUndefined();
    expect(readContextLength({ 'general.architecture': 'llama' })).toBeUndefined();
    expect(readContextLength({ 'llama.context_length': 'lots' })).toBeUndefined();
  });
});
