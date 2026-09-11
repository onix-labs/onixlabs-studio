// Which client talks to a connection, and where it points.
//
// ⚠️ Reproduced from `ai-sdk-adapter.ts` rather than imported, on the rule the whole plugin follows: a
// harness that shares code with Studio is a harness that cannot be extracted. Kept behaviourally
// identical so a connection configured before the cut-over runs against the same endpoint after it.

/**
 * The client family a provider kind is served by: the dedicated `@ai-sdk/*` package for the hosted
 * providers that have one, and the OpenAI-compatible client for everything else (xAI, DeepSeek, Ollama,
 * and any `openai-compatible` or `custom` endpoint the user points at by URL).
 */
export type ClientFamily = 'anthropic' | 'openai' | 'google' | 'openai-compatible';

/**
 * Ollama's default local address, used when the environment names none.
 */
const DEFAULT_OLLAMA_HOST: string = '127.0.0.1:11434';

/**
 * The default API endpoints for OpenAI-compatible kinds that have a well-known hosted URL. A connection
 * with its own base URL overrides these; `openai-compatible` and `custom` have no default and must
 * supply one.
 */
export const DEFAULT_BASE_URLS: Readonly<Record<string, string>> = {
  xai: 'https://api.x.ai/v1',
  deepseek: 'https://api.deepseek.com/v1',
};

/**
 * The concrete API bases a discovery request is made against when a connection has no explicit base
 * URL. Extends the run-time defaults with the hosted OpenAI and Anthropic endpoints, which the adapter
 * leaves to the SDK but which discovery must address directly.
 */
export const DISCOVERY_BASE_URLS: Readonly<Record<string, string>> = {
  ...DEFAULT_BASE_URLS,
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
};

/**
 * Maps a provider kind to the client family that serves it.
 * @param kind The provider kind.
 * @returns Returns the client family.
 */
export function clientFamily(kind: string): ClientFamily {
  switch (kind) {
    case 'anthropic':
      return 'anthropic';
    case 'openai':
      return 'openai';
    case 'google':
      return 'google';
    default:
      // xai, deepseek, ollama, openai-compatible, custom — all OpenAI-compatible HTTP APIs.
      return 'openai-compatible';
  }
}

/**
 * Reports whether a kind's models accept image input. Conservative: only the multimodal hosted
 * providers are marked as supporting images, so Studio does not offer an attachment a local text-only
 * back-end would reject.
 * @param kind The provider kind.
 * @returns Returns true when the kind supports images.
 */
export function kindSupportsImages(kind: string): boolean {
  return kind === 'anthropic' || kind === 'openai' || kind === 'google';
}

/**
 * Reports whether a kind is a local or open-weight back-end that needs the blunt tool-use appendix.
 * @param kind The provider kind.
 * @returns Returns true when the local appendix should be added.
 */
export function usesLocalToolAppendix(kind: string): boolean {
  return kind === 'ollama' || kind === 'openai-compatible' || kind === 'custom';
}

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
 * Resolves a local Ollama server's OpenAI-compatible base URL from the environment.
 *
 * 🔑 Read from **this** process's environment, which is the right one: a harness inherits Studio's, so
 * a user who exported `OLLAMA_HOST` before launching Studio gets the server they meant either way.
 * @param env The environment to read.
 * @returns Returns the resolved base URL.
 */
export function resolveOllamaBaseUrl(env: Record<string, string | undefined>): string {
  const explicit: string | undefined = env['OLLAMA_BASE_URL'];
  if (explicit !== undefined && explicit.length > 0) {
    return explicit.replace(/\/+$/, '');
  }
  return `${normaliseOrigin(env['OLLAMA_HOST'] ?? DEFAULT_OLLAMA_HOST)}/v1`;
}

/**
 * The endpoint a connection's client talks to: the resolved base URL (or undefined to use the hosted
 * SDK's default) and a short name for the OpenAI-compatible client.
 */
export interface ResolvedEndpoint {
  /**
   * Gets the base URL, or undefined to use the hosted SDK's built-in default.
   */
  readonly baseUrl: string | undefined;

  /**
   * Gets the short client name, used to label the OpenAI-compatible client.
   */
  readonly name: string;
}

/**
 * Resolves the endpoint for a connection: its own base URL when set, otherwise the kind's default (the
 * Ollama local server, a well-known hosted URL, or none for the hosted SDKs that carry their own).
 * @param kind The provider kind.
 * @param baseUrl The connection's configured base URL, or null.
 * @param env The environment to read for the Ollama default.
 * @returns Returns the resolved endpoint.
 */
export function resolveEndpoint(
  kind: string,
  baseUrl: string | null,
  env: Record<string, string | undefined>,
): ResolvedEndpoint {
  if (baseUrl !== null && baseUrl.length > 0) {
    return { baseUrl: baseUrl.replace(/\/+$/, ''), name: kind };
  }
  if (kind === 'ollama') {
    return { baseUrl: resolveOllamaBaseUrl(env), name: 'ollama' };
  }
  return { baseUrl: DEFAULT_BASE_URLS[kind], name: kind };
}
