import { describe, expect, it } from 'vitest';
import { OllamaServer, stopsOnShutdown } from './ollama-server';

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

describe('stopsOnShutdown', () => {
  it("leaves the user's own install running when Studio closes", () => {
    // Studio only started it on their behalf; it stays up as if they had run `ollama serve` themselves.
    expect(stopsOnShutdown('system')).toBe(false);
  });

  it('stops Studio-managed copy when Studio closes', () => {
    // Nothing else uses that copy, so leaving it would hold a port and VRAM for nothing.
    expect(stopsOnShutdown('managed')).toBe(true);
  });

  it('treats an absent install as nothing to stop', () => {
    expect(stopsOnShutdown('absent')).toBe(false);
  });
});
