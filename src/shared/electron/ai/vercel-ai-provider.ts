import { type AiModelInfo, type AiProviderId } from '@shared/ai-types';
import type { AgentAuth, AgentProvider, AgentRunContext, ProviderAvailability } from './agent-provider';
import type { ToolSet } from 'ai';
import {
  consumeAgentStream,
  createStudioTools,
  createTerminalTools,
  MAX_STEPS,
  type StreamPart,
} from './ai-sdk-stream';
import { ANTHROPIC_MODELS, DEFAULT_ANTHROPIC_MODEL } from './models';
import { STUDIO_PROMPT_APPENDIX, TERMINAL_PROMPT_APPENDIX } from './studio-tools';

/**
 * The Vercel AI SDK implementation of {@link AgentProvider}. It authenticates with an Anthropic API
 * key (the seam to additional model back-ends later) and parses the SDK's `fullStream` into the shared
 * event protocol via {@link mapStreamPart}. The SDK is dual ESM/CJS but loaded with a dynamic
 * `import()` to match the Claude path. Runtime-exercised only when an API key is available.
 */
export class VercelAiProvider implements AgentProvider {
  /**
   * Gets the provider's stable identifier.
   */
  public readonly id: AiProviderId = 'vercel';

  /**
   * Gets the provider's human-readable label.
   */
  public readonly label: string = 'Vercel AI SDK';

  /**
   * Gets the models the provider can run a turn with (Anthropic models via `@ai-sdk/anthropic`).
   */
  public readonly models: readonly AiModelInfo[] = ANTHROPIC_MODELS;

  /**
   * Gets the identifier of the provider's default model.
   */
  public readonly defaultModelId: string = DEFAULT_ANTHROPIC_MODEL;

  /**
   * Reports whether the provider can run: an API key is required (it cannot use the local login).
   * @param auth The resolved credential material.
   * @returns Returns the availability descriptor.
   */
  public describeAvailability(auth: AgentAuth): ProviderAvailability {
    return auth.apiKey !== null
      ? { available: true, detail: 'Using your Anthropic API key.' }
      : { available: false, detail: 'Add an Anthropic API key to use this provider.' };
  }

  /**
   * Runs a single turn through the Vercel AI SDK, streaming text, reasoning, and tool activity.
   * @param context The run context.
   */
  public async run(context: AgentRunContext): Promise<void> {
    if (context.auth.apiKey === null) {
      context.emit({
        requestId: context.requestId,
        kind: 'text',
        delta: 'No Anthropic API key is available for this provider.',
      });
      return;
    }
    const { streamText, stepCountIs } = await import('ai');
    const { createAnthropic } = await import('@ai-sdk/anthropic');
    const anthropic: ReturnType<typeof createAnthropic> = createAnthropic({
      apiKey: context.auth.apiKey,
    });

    // Expose the terminal-only tools (and prompt) for a terminal-surface run, otherwise the editor
    // tools. The AI SDK has no per-tool prompt hook, so terminal commands run without gating.
    const terminal: boolean = context.surface === 'terminal';
    const system: string = terminal ? TERMINAL_PROMPT_APPENDIX : STUDIO_PROMPT_APPENDIX;
    const tools: ToolSet = terminal
      ? await createTerminalTools(context)
      : await createStudioTools(context);

    const stream: AsyncIterable<StreamPart> = streamText({
      model: anthropic(context.model),
      system,
      prompt: context.prompt,
      abortSignal: context.signal,
      stopWhen: stepCountIs(MAX_STEPS),
      // Cap the output tokens when the user set a per-request budget; 0 leaves the provider default.
      ...(context.tokenCap > 0 ? { maxOutputTokens: context.tokenCap } : {}),
      tools,
    }).fullStream as AsyncIterable<StreamPart>;

    await consumeAgentStream(stream, context);
  }
}
