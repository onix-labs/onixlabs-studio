import { type AiModelInfo, type AiProviderId } from '../../shared/ai-types';
import type { AgentProvider, AgentRunContext, ProviderAvailability } from './agent-provider';
import type { ToolSet } from 'ai';
import {
  consumeAgentStream,
  createStudioTools,
  createTerminalTools,
  describeRunError,
  MAX_STEPS,
  type StreamPart,
} from './ai-sdk-stream';
import { DEFAULT_OLLAMA_MODEL, OLLAMA_MODELS } from './models';
import { STUDIO_PROMPT_APPENDIX, TERMINAL_PROMPT_APPENDIX } from './studio-tools';

/**
 * The base URL of a local Ollama server's OpenAI-compatible API. Ollama's standard env var is
 * `OLLAMA_HOST` (host[:port]); `OLLAMA_BASE_URL` lets the user point at a full URL directly.
 */
function resolveBaseUrl(): string {
  const explicit: string | undefined = process.env['OLLAMA_BASE_URL'];
  if (explicit !== undefined && explicit.length > 0) {
    return explicit.replace(/\/+$/, '');
  }
  const host: string = process.env['OLLAMA_HOST'] ?? '127.0.0.1:11434';
  const origin: string = /^https?:\/\//.test(host) ? host : `http://${host}`;
  return `${origin.replace(/\/+$/, '')}/v1`;
}

/**
 * A local-model implementation of {@link AgentProvider} backed by an Ollama server. It runs open models
 * (e.g. Qwen) entirely on the user's machine through Ollama's OpenAI-compatible API, reusing the same
 * Vercel AI SDK streaming pathway as {@link VercelAiProvider} — so the stream-to-event mapping and the
 * in-app editor tools are shared. No credentials are required.
 *
 * Availability is reported optimistically (the server may be down or the model not pulled); a run that
 * cannot reach Ollama surfaces a clear message rather than a raw fetch error.
 */
export class OllamaProvider implements AgentProvider {
  /**
   * Gets the provider's stable identifier.
   */
  public readonly id: AiProviderId = 'ollama';

  /**
   * Gets the provider's human-readable label.
   */
  public readonly label: string = 'Ollama (local)';

  /**
   * Gets the local models the provider can run a turn with.
   */
  public readonly models: readonly AiModelInfo[] = OLLAMA_MODELS;

  /**
   * Gets the identifier of the provider's default model.
   */
  public readonly defaultModelId: string = DEFAULT_OLLAMA_MODEL;

  /**
   * Reports availability. Ollama needs no credentials, so the provider is offered whenever it is
   * registered; whether the local server is actually running is discovered when a run starts.
   * @returns Returns the availability descriptor.
   */
  public describeAvailability(): ProviderAvailability {
    return { available: true, detail: 'Runs models locally via Ollama — no API key needed.' };
  }

  /**
   * Runs a single turn against the local Ollama server, streaming text, reasoning, and tool activity.
   * A failure to reach the server (the common case when Ollama is not running) is reported as a clear
   * message before the run ends in error.
   * @param context The run context.
   */
  public async run(context: AgentRunContext): Promise<void> {
    const { streamText, stepCountIs } = await import('ai');
    const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');
    // Ollama ignores the key but the OpenAI-compatible client expects a non-empty value.
    const ollama: ReturnType<typeof createOpenAICompatible> = createOpenAICompatible({
      name: 'ollama',
      baseURL: resolveBaseUrl(),
      apiKey: 'ollama',
    });

    // Expose the terminal-only tools (and prompt) for a terminal-surface run, otherwise the editor
    // tools. The AI SDK has no per-tool prompt hook, so terminal commands run without gating.
    const terminal: boolean = context.surface === 'terminal';
    const system: string = terminal ? TERMINAL_PROMPT_APPENDIX : STUDIO_PROMPT_APPENDIX;
    const tools: ToolSet = terminal
      ? await createTerminalTools(context)
      : await createStudioTools(context);

    try {
      const stream: AsyncIterable<StreamPart> = streamText({
        model: ollama(context.model),
        system,
        prompt: context.prompt,
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
      // Re-throw with a local-model-specific hint so the failure (server down, model not pulled, bad
      // endpoint) reaches the user as something actionable rather than a raw fetch error. The manager
      // turns this message into the run's terminal error detail.
      throw new Error(
        `Could not run "${context.model}" on your local Ollama server at ${resolveBaseUrl()}. ` +
          `${describeRunError(error)}. Check that Ollama is running and that the model has been ` +
          `pulled — run: ollama pull ${context.model}`,
        { cause: error },
      );
    }
  }
}
