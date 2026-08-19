/**
 * Where a local Ollama server lives, resolved from the environment. Deliberately its own module with
 * no dependencies: both the AI SDK adapter (which wants the OpenAI-compatible base URL) and the model
 * runtime contribution (which wants the native API origin) need this, and the contribution must not
 * drag the AI SDK into the main process's startup module graph to get it.
 *
 * Ollama's standard env var is `OLLAMA_HOST` (host[:port]); `OLLAMA_BASE_URL` lets the user point at a
 * full URL directly.
 */

/**
 * Ollama's default local address, used when the environment names none.
 */
const DEFAULT_HOST: string = '127.0.0.1:11434';

/**
 * Normalises a host or URL into a bare origin: adds the `http://` scheme when one is missing, and
 * strips any trailing slashes.
 * @param value The host[:port] or full URL.
 * @returns Returns the normalised origin.
 */
function normaliseOrigin(value: string): string {
  const origin: string = /^https?:\/\//.test(value) ? value : `http://${value}`;
  return origin.replace(/\/+$/, '');
}

/**
 * Resolves a local Ollama server's OpenAI-compatible base URL from the environment — the endpoint the
 * AI SDK's OpenAI-compatible client talks to.
 * @param env The environment to read (injected so the resolution is testable).
 * @returns Returns the resolved base URL.
 */
export function resolveOllamaBaseUrl(env: Record<string, string | undefined>): string {
  const explicit: string | undefined = env['OLLAMA_BASE_URL'];
  if (explicit !== undefined && explicit.length > 0) {
    return explicit.replace(/\/+$/, '');
  }
  return `${normaliseOrigin(env['OLLAMA_HOST'] ?? DEFAULT_HOST)}/v1`;
}

/**
 * Resolves a local Ollama server's origin from the environment — the address its *native* REST API
 * (`/api/tags`, `/api/ps`, …) is served from, which is the OpenAI-compatible base URL without the
 * trailing `/v1`. An explicit `OLLAMA_BASE_URL` therefore has any `/v1` suffix stripped back off,
 * because the two APIs live side by side on the same origin.
 * @param env The environment to read (injected so the resolution is testable).
 * @returns Returns the resolved server origin.
 */
export function resolveOllamaOrigin(env: Record<string, string | undefined>): string {
  const explicit: string | undefined = env['OLLAMA_BASE_URL'];
  if (explicit !== undefined && explicit.length > 0) {
    return normaliseOrigin(explicit).replace(/\/v1$/, '');
  }
  return normaliseOrigin(env['OLLAMA_HOST'] ?? DEFAULT_HOST);
}
