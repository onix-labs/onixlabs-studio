import {
  READ_ACTIVE_DOCUMENT,
  REPLACE_ACTIVE_DOCUMENT,
  type AiProviderId,
} from '../../shared/ai-types';
import type { AgentAuth, AgentProvider, AgentRunContext, ProviderAvailability } from './agent-provider';
import { readActiveDocument, replaceActiveDocument, STUDIO_PROMPT_APPENDIX } from './studio-tools';

/**
 * Holds the model agent turns run with.
 */
const MODEL: string = 'claude-opus-4-8';

/**
 * A loosely-typed part from the Vercel AI SDK's `fullStream`, covering the fields read here. The SDK's
 * own part type is a broad union; this captures just what the event mapping needs.
 */
interface StreamPart {
  /**
   * Gets the part discriminator (`text-delta`, `reasoning-delta`, `tool-call`, `tool-result`, …).
   */
  readonly type: string;
  readonly text?: string;
  readonly delta?: string;
  readonly toolName?: string;
  readonly toolCallId?: string;
  readonly input?: unknown;
  readonly errorText?: string;
}

/**
 * The Vercel AI SDK implementation of {@link AgentProvider}. It authenticates with an Anthropic API
 * key (the seam to additional model back-ends later) and parses the SDK's `fullStream` into the shared
 * event protocol. The SDK is dual ESM/CJS but loaded with a dynamic `import()` to match the Claude
 * path. Runtime-exercised only when an API key is available.
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
    const { streamText, stepCountIs, tool } = await import('ai');
    const { createAnthropic } = await import('@ai-sdk/anthropic');
    const { z } = await import('zod');
    const anthropic: ReturnType<typeof createAnthropic> = createAnthropic({
      apiKey: context.auth.apiKey,
    });

    const stream: AsyncIterable<StreamPart> = streamText({
      model: anthropic(MODEL),
      system: STUDIO_PROMPT_APPENDIX,
      prompt: context.prompt,
      abortSignal: context.signal,
      stopWhen: stepCountIs(16),
      tools: {
        [READ_ACTIVE_DOCUMENT]: tool({
          description: "Read the active editor document's full text.",
          inputSchema: z.object({}),
          execute: (): Promise<string> => readActiveDocument(context.bridge),
        }),
        [REPLACE_ACTIVE_DOCUMENT]: tool({
          description: "Replace the active editor document's entire text.",
          inputSchema: z.object({ text: z.string().describe('The new full text of the document.') }),
          execute: (args: { text: string }): Promise<string> =>
            replaceActiveDocument(context.bridge, args.text),
        }),
      },
    }).fullStream as AsyncIterable<StreamPart>;

    for await (const part of stream) {
      if (context.signal.aborted) {
        break;
      }
      this.handlePart(part, context);
    }
  }

  /**
   * Maps a single stream part to the shared event protocol.
   * @param part The stream part.
   * @param context The run context to emit through.
   */
  private handlePart(part: StreamPart, context: AgentRunContext): void {
    const requestId: string = context.requestId;
    switch (part.type) {
      case 'text-delta':
        context.emit({ requestId, kind: 'text', delta: part.text ?? part.delta ?? '' });
        break;
      case 'reasoning-delta':
        context.emit({ requestId, kind: 'thinking', delta: part.text ?? part.delta ?? '' });
        break;
      case 'tool-call':
        context.emit({
          requestId,
          kind: 'tool-start',
          toolId: part.toolCallId ?? '',
          name: part.toolName ?? 'tool',
          detail: typeof part.input === 'string' ? part.input : '',
        });
        break;
      case 'tool-result':
        context.emit({
          requestId,
          kind: 'tool-end',
          toolId: part.toolCallId ?? '',
          ok: true,
          detail: 'done',
        });
        break;
      case 'tool-error':
        context.emit({
          requestId,
          kind: 'tool-end',
          toolId: part.toolCallId ?? '',
          ok: false,
          detail: part.errorText ?? 'failed',
        });
        break;
      default:
        break;
    }
  }
}
