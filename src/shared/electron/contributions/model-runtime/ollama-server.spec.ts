import { describe, expect, it } from 'vitest';
import { OllamaServer } from './ollama-server';

/**
 * A probe reporting a fixed reachability.
 */
function probe(reachable: boolean): () => Promise<boolean> {
  return (): Promise<boolean> => Promise.resolve(reachable);
}

describe('OllamaServer ownership', () => {
  it('owns nothing before it starts anything', () => {
    expect(new OllamaServer('127.0.0.1:11434', probe(false)).isOwned()).toBe(false);
  });

  it('refuses to stop a server it did not start', async () => {
    const server: OllamaServer = new OllamaServer('127.0.0.1:11434', probe(true));

    // The user's own Ollama — a menubar app, a systemd unit — is reachable but not ours to kill.
    expect(await server.stop()).toBe(false);
  });

  it('reports a start as successful when the server is already reachable, spawning nothing', async () => {
    const server: OllamaServer = new OllamaServer('127.0.0.1:11434', probe(true));

    expect(await server.start('/nonexistent/ollama')).toBe(true);
    expect(server.isOwned()).toBe(false);
  });

  it('is safe to dispose when it owns nothing', () => {
    expect((): void => new OllamaServer('127.0.0.1:11434', probe(false)).dispose()).not.toThrow();
  });
});
