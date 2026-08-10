import type {
  AiConnection,
  AiEffort,
  AiImageRef,
  AiModelInfo,
  AiProviderKind,
} from '@shared/api/ai-types';
import type {
  AgentAuth,
  AgentProvider,
  AgentRunContext,
  AgentSessionModel,
  ProviderAvailability,
} from './agent-provider';
import type { ImagePart, LanguageModel, ModelMessage, ToolSet } from 'ai';
import {
  consumeAgentStream,
  describeRunError,
  MAX_STEPS,
  promptForSurface,
  toolsForSurface,
  type StreamPart,
} from './ai-sdk-stream';
import { logger } from '../logger';
import { buildRunPrompt } from './studio-tools';

/**
 * Appended to the system prompt for local, open-weight models (Ollama and self-hosted
 * OpenAI-compatible endpoints). Small local models reliably narrate what they "would" do instead of
 * calling their function tools, so this spells the contract out bluntly; the hosted providers do not
 * need it — the shared surface appendices already name the tools.
 */
const LOCAL_TOOL_USE_APPENDIX: string = [
  'IMPORTANT: You have real function-calling tools, and they are your ONLY way to act. Never',
  'describe, promise, or print a command, edit, or answer that a tool should produce — CALL THE',
  'TOOL instead, immediately, without asking for permission first (the app handles permissions and',
  'will ask the user for you). For terminal work: call write_terminal_input with the command, then',
  'call read_terminal_output to see the result. For document or binary work: call the matching',
  'read tool before answering and the matching write tool to change anything. Replying in prose',
  'when a tool applies is a failure. Act first, then summarise briefly what happened.',
].join('\n');

/**
 * The client family a kind is served by: the dedicated `@ai-sdk/*` package for the hosted providers
 * that have one, and the OpenAI-compatible client for everything else (xAI, DeepSeek, Ollama, and any
 * `openai-compatible` or `custom` endpoint the user points at by URL).
 */
export type ClientFamily = 'anthropic' | 'openai' | 'google' | 'openai-compatible';

/**
 * The default API endpoints for OpenAI-compatible kinds that have a well-known hosted URL. A connection
 * with its own {@link AiConnection.baseUrl} overrides these; `openai-compatible` and `custom` have no
 * default and must supply one.
 */
export const DEFAULT_BASE_URLS: Readonly<Partial<Record<AiProviderKind, string>>> = {
  xai: 'https://api.x.ai/v1',
  deepseek: 'https://api.deepseek.com/v1',
};

/**
 * Maps a provider kind to the client family that serves it.
 * @param kind The provider kind.
 * @returns Returns the client family.
 */
export function clientFamily(kind: AiProviderKind): ClientFamily {
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
 * providers are marked as supporting images; local and text-only back-ends reject them at compose time.
 * @param kind The provider kind.
 * @returns Returns true when the kind supports images.
 */
export function kindSupportsImages(kind: AiProviderKind): boolean {
  return kind === 'anthropic' || kind === 'openai' || kind === 'google';
}

/**
 * Reports whether a kind is a local/open-weight back-end that needs the blunt tool-use appendix.
 * @param kind The provider kind.
 * @returns Returns true when the local appendix should be added.
 */
export function usesLocalToolAppendix(kind: AiProviderKind): boolean {
  return kind === 'ollama' || kind === 'openai-compatible' || kind === 'custom';
}

/**
 * Reads the current process environment without depending on Node's `process` global type (this module
 * is also compiled under the renderer's browser type config for its unit tests). At runtime in the main
 * process this returns `process.env`; under the tests it returns an empty environment (the run paths
 * that read it are not exercised there).
 * @returns Returns the environment map.
 */
function currentEnv(): Record<string, string | undefined> {
  return (
    (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}
  );
}

/**
 * Resolves a local Ollama server's OpenAI-compatible base URL from the environment. Ollama's standard
 * env var is `OLLAMA_HOST` (host[:port]); `OLLAMA_BASE_URL` lets the user point at a full URL directly.
 * @param env The environment to read (injected so the resolution is testable).
 * @returns Returns the resolved base URL.
 */
export function resolveOllamaBaseUrl(env: Record<string, string | undefined>): string {
  const explicit: string | undefined = env['OLLAMA_BASE_URL'];
  if (explicit !== undefined && explicit.length > 0) {
    return explicit.replace(/\/+$/, '');
  }
  const host: string = env['OLLAMA_HOST'] ?? '127.0.0.1:11434';
  const origin: string = /^https?:\/\//.test(host) ? host : `http://${host}`;
  return `${origin.replace(/\/+$/, '')}/v1`;
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
   * Gets the short client name (used to label the OpenAI-compatible client).
   */
  readonly name: string;
}

/**
 * Resolves the endpoint for a connection: its own base URL when set, otherwise the kind's default (the
 * Ollama local server, a well-known hosted URL, or none for the hosted SDKs that carry their own).
 * @param connection The connection.
 * @param env The environment to read for the Ollama default.
 * @returns Returns the resolved endpoint.
 */
export function resolveEndpoint(
  connection: AiConnection,
  env: Record<string, string | undefined>,
): ResolvedEndpoint {
  if (connection.baseUrl !== undefined && connection.baseUrl.length > 0) {
    return { baseUrl: connection.baseUrl.replace(/\/+$/, ''), name: connection.kind };
  }
  if (connection.kind === 'ollama') {
    return { baseUrl: resolveOllamaBaseUrl(env), name: 'ollama' };
  }
  return { baseUrl: DEFAULT_BASE_URLS[connection.kind], name: connection.kind };
}

/**
 * The generic AI-SDK implementation of {@link AgentProvider}. One instance serves one {@link
 * AiConnection}: it selects the `@ai-sdk/*` client for the connection's kind (a dedicated package for
 * the hosted providers that have one, the OpenAI-compatible client for the rest), authenticates with
 * the connection's resolved credential, and parses the SDK's `fullStream` into the shared event
 * protocol via the shared {@link consumeAgentStream} pathway. This one adapter replaces the former
 * per-vendor Vercel and Ollama providers.
 */
export class AiSdkAdapter implements AgentProvider {
  /**
   * Holds the connection this adapter serves.
   */
  private readonly connection: AiConnection;

  /**
   * Initialises a new instance of the {@link AiSdkAdapter} class.
   * @param connection The connection this adapter serves.
   */
  public constructor(connection: AiConnection) {
    this.connection = connection;
  }

  /**
   * Gets the connection's stable identifier.
   */
  public get id(): string {
    return this.connection.id;
  }

  /**
   * Gets the connection's human-readable label.
   */
  public get label(): string {
    return this.connection.label;
  }

  /**
   * Gets the models the connection can run a turn with.
   */
  public get models(): readonly AiModelInfo[] {
    return this.connection.models;
  }

  /**
   * Gets the identifier of the connection's default model.
   */
  public get defaultModelId(): string {
    return this.connection.defaultModelId;
  }

  /**
   * Gets a value indicating whether the connection's models accept image input.
   */
  public get supportsImages(): boolean {
    return kindSupportsImages(this.connection.kind);
  }

  /**
   * Gets the reasoning-effort levels offered: none. The generic AI-SDK path does not expose a reasoning
   * effort control, so the `/effort` command is hidden for these providers.
   */
  public readonly supportedEfforts: readonly AiEffort[] = [];

  /**
   * Gets the session model: the generic AI-SDK path is stateless — Studio owns the loop and each turn is
   * a fresh call, so there is no live session to hold open (#324).
   */
  public readonly sessionModel: AgentSessionModel = 'stateless';

  /**
   * Reports whether the connection can run: a `none`-auth connection always can; a keyed connection
   * needs its API key.
   * @param auth The resolved credential material.
   * @returns Returns the availability descriptor.
   */
  public describeAvailability(auth: AgentAuth): ProviderAvailability {
    if (this.connection.auth === 'none') {
      return { available: true, detail: 'Runs locally — no API key needed.' };
    }
    return auth.apiKey !== null
      ? { available: true, detail: 'Using your stored API key.' }
      : { available: false, detail: 'Add an API key to use this connection.' };
  }

  /**
   * Runs a single turn through the connection's AI-SDK client, streaming text, reasoning, and tool
   * activity. A failure to reach a local server (the common case when Ollama is not running) is
   * reported as a clear, actionable message.
   * @param context The run context.
   */
  public async run(context: AgentRunContext): Promise<void> {
    logger.trace(
      'AiSdkAdapter.run',
      `Starting turn ${context.requestId} on ${this.connection.label} (${context.model})`,
    );
    const { streamText, stepCountIs } = await import('ai');
    const model: LanguageModel = await this.createModel(context);

    // Expose the tool set (and prompt) for the run's surface and mode: chat runs read-only, and the
    // mutating tools' executors ask through the shared permission round-trip per the posture, so the
    // safety rails match the Claude path despite the AI SDK having no per-tool permission hook. Local
    // models additionally get the blunt tool-use appendix.
    const system: string = usesLocalToolAppendix(this.connection.kind)
      ? `${promptForSurface(context)}\n\n${LOCAL_TOOL_USE_APPENDIX}`
      : promptForSurface(context);
    const tools: ToolSet = await toolsForSurface(context);

    // Attached context (paths and inlined selections) rides the prompt; attached images require
    // message parts, while a plain prompt string suffices otherwise.
    const prompt: string = buildRunPrompt(context);
    const input: { prompt: string } | { messages: ModelMessage[] } =
      context.images.length === 0
        ? { prompt }
        : {
            messages: [
              {
                role: 'user',
                content: [
                  ...context.images.map(
                    (image: AiImageRef): ImagePart => ({
                      type: 'image',
                      image: image.data,
                      mediaType: image.mediaType,
                    }),
                  ),
                  { type: 'text', text: prompt },
                ],
              },
            ],
          };

    try {
      const stream: AsyncIterable<StreamPart> = streamText({
        model,
        system,
        ...input,
        abortSignal: context.signal,
        stopWhen: stepCountIs(MAX_STEPS),
        // Cap the output tokens when the user set a per-request budget; 0 leaves the model default.
        ...(context.tokenCap > 0 ? { maxOutputTokens: context.tokenCap } : {}),
        tools,
      }).fullStream as AsyncIterable<StreamPart>;

      await consumeAgentStream(stream, context);
    } catch (error: unknown) {
      // A user-initiated abort surfaces as a throw; let it end the run quietly via the abort path.
      if (context.signal.aborted) {
        return;
      }
      logger.error('ai-sdk', 'Agent run failed', error);
      throw new Error(this.describeFailure(context, error), { cause: error });
    }
  }

  /**
   * Builds the AI-SDK language model for this connection and run, selecting the client family for the
   * connection's kind and authenticating with the run's resolved key.
   * @param context The run context (carries the resolved credential and the model id).
   * @returns Returns the language model.
   */
  private async createModel(context: AgentRunContext): Promise<LanguageModel> {
    const endpoint: ResolvedEndpoint = resolveEndpoint(this.connection, currentEnv());
    const apiKey: string = context.auth.apiKey ?? '';
    const modelId: string = context.model;
    const baseUrlOption: { baseURL: string } | Record<string, never> =
      endpoint.baseUrl !== undefined ? { baseURL: endpoint.baseUrl } : {};
    logger.debug(
      'AiSdkAdapter.createModel',
      `Building ${clientFamily(this.connection.kind)} model ${modelId} at ${endpoint.baseUrl ?? 'SDK default endpoint'}`,
    );

    switch (clientFamily(this.connection.kind)) {
      case 'anthropic': {
        const { createAnthropic } = await import('@ai-sdk/anthropic');
        return createAnthropic({ apiKey, ...baseUrlOption })(modelId);
      }
      case 'openai': {
        const { createOpenAI } = await import('@ai-sdk/openai');
        return createOpenAI({ apiKey, ...baseUrlOption })(modelId);
      }
      case 'google': {
        const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
        return createGoogleGenerativeAI({ apiKey, ...baseUrlOption })(modelId);
      }
      default: {
        if (endpoint.baseUrl === undefined) {
          logger.warn(
            'AiSdkAdapter.createModel',
            `Connection "${this.connection.label}" has no base URL; cannot build a client`,
          );
          throw new Error(
            `The connection "${this.connection.label}" needs a base URL before it can run.`,
          );
        }
        const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');
        return createOpenAICompatible({
          name: endpoint.name,
          baseURL: endpoint.baseUrl,
          // The OpenAI-compatible client expects a non-empty key even when the server ignores it.
          apiKey: apiKey.length > 0 ? apiKey : 'unused',
          ...(this.connection.headers !== undefined ? { headers: this.connection.headers } : {}),
        })(modelId);
      }
    }
  }

  /**
   * Builds an actionable failure message for a run error, with a local-server hint for Ollama.
   * @param context The run context.
   * @param error The error thrown by the run.
   * @returns Returns the failure message.
   */
  private describeFailure(context: AgentRunContext, error: unknown): string {
    if (this.connection.kind === 'ollama') {
      const endpoint: ResolvedEndpoint = resolveEndpoint(this.connection, currentEnv());
      return (
        `Could not run "${context.model}" on your local Ollama server at ${endpoint.baseUrl}. ` +
        `${describeRunError(error)}. Check that Ollama is running and that the model has been ` +
        `pulled — run: ollama pull ${context.model}`
      );
    }
    return `The connection "${this.connection.label}" could not run "${context.model}". ${describeRunError(error)}.`;
  }
}
