import type { AiConnection } from './ai-types';

/**
 * Determines whether an AI connection runs on this machine: an Ollama server, or any endpoint at a
 * loopback address. What the user types stays on the machine with one, which is why Pete suggests it.
 * @param connection The connection.
 * @returns Returns true for a local model server.
 */
export function isLocalConnection(connection: AiConnection): boolean {
  if (connection.kind === 'ollama') {
    return true;
  }
  const url: string = connection.baseUrl ?? '';
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(url);
}
