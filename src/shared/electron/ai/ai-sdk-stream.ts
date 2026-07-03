import type { ToolSet } from 'ai';
import {
  READ_ACTIVE_DOCUMENT,
  READ_TERMINAL_OUTPUT,
  REPLACE_ACTIVE_DOCUMENT,
  WRITE_TERMINAL_INPUT,
} from '@shared/api/ai-types';
import type { AgentRunContext } from './agent-provider';
import {
  readActiveDocument,
  readTerminalOutput,
  replaceActiveDocument,
  writeTerminalInput,
} from './studio-tools';

/**
 * The maximum number of steps (model turns plus tool round-trips) a single run may take before the
 * Vercel AI SDK stops the agentic loop.
 */
export const MAX_STEPS: number = 16;

/**
 * A loosely-typed part from the Vercel AI SDK's `fullStream`, covering the fields read here. The SDK's
 * own part type is a broad union; this captures just what the event mapping needs.
 */
export interface StreamPart {
  /**
   * Gets the part discriminator (`text-delta`, `reasoning-delta`, `tool-call`, `tool-result`,
   * `error`, …).
   */
  readonly type: string;
  readonly text?: string;
  readonly delta?: string;
  readonly toolName?: string;
  readonly toolCallId?: string;
  readonly input?: unknown;
  readonly errorText?: string;

  /**
   * Gets the error carried by an `error` part. The SDK surfaces request/stream failures here rather
   * than throwing, so this must be inspected — see {@link consumeAgentStream}.
   */
  readonly error?: unknown;
}

/**
 * Renders a human-readable reason from an error thrown during a run, or carried by a stream `error`
 * part. Pulls a message from AI SDK call errors, Error instances, and plain values, falling back to a
 * generic note so the user is never left with nothing.
 * @param error The error value.
 * @returns Returns a non-empty, displayable message.
 */
export function describeRunError(error: unknown): string {
  if (typeof error === 'string' && error.length > 0) {
    return error;
  }
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  if (error !== null && typeof error === 'object') {
    const record: { message?: unknown } = error;
    if (typeof record.message === 'string' && record.message.length > 0) {
      return record.message;
    }
  }
  return 'The run failed with an unspecified error.';
}

/**
 * Drives an AI-SDK `fullStream` to completion, mapping each part to the shared event protocol and
 * stopping early when the run is aborted. Critically, an `error` part is thrown rather than ignored:
 * the SDK reports request/stream failures (an unreachable server, an unknown model, a refused
 * connection) as a part, not an exception, so swallowing it would end a failed run silently.
 * @param stream The SDK `fullStream`.
 * @param context The run context to emit through.
 */
export async function consumeAgentStream(
  stream: AsyncIterable<StreamPart>,
  context: AgentRunContext,
): Promise<void> {
  for await (const part of stream) {
    if (context.signal.aborted) {
      return;
    }
    if (part.type === 'error') {
      throw new Error(describeRunError(part.error));
    }
    mapStreamPart(part, context);
  }
}

/**
 * Builds the in-app editor tools every AI-SDK-backed provider exposes, bridged to the renderer through
 * the run context. The `ai` and `zod` packages are imported dynamically to match the providers' own
 * dynamic-import (ESM-compatibility) convention.
 * @param context The run context the tools act through.
 * @returns Returns the tool set keyed by tool name, ready to pass to `streamText`.
 */
export async function createStudioTools(context: AgentRunContext): Promise<ToolSet> {
  const { tool } = await import('ai');
  const { z } = await import('zod');
  return {
    [READ_ACTIVE_DOCUMENT]: tool({
      description: "Read the active editor document's full text.",
      inputSchema: z.object({}),
      execute: (): Promise<string> => readActiveDocument(context),
    }),
    [REPLACE_ACTIVE_DOCUMENT]: tool({
      description: "Replace the active editor document's entire text.",
      inputSchema: z.object({ text: z.string().describe('The new full text of the document.') }),
      execute: (args: { text: string }): Promise<string> =>
        replaceActiveDocument(context, args.text),
    }),
  };
}

/**
 * Builds the terminal-surface tools every AI-SDK-backed provider exposes for a terminal-scoped run,
 * bridged to the renderer through the run context. The agent acts only through these two tools: it
 * reads the terminal's recent output and types input/commands into it. The `ai` and `zod` packages are
 * imported dynamically to match the providers' own dynamic-import (ESM-compatibility) convention.
 * @param context The run context the tools act through.
 * @returns Returns the tool set keyed by tool name, ready to pass to `streamText`.
 */
export async function createTerminalTools(context: AgentRunContext): Promise<ToolSet> {
  const { tool } = await import('ai');
  const { z } = await import('zod');
  return {
    [READ_TERMINAL_OUTPUT]: tool({
      description: 'Read the recent output currently shown in the terminal.',
      inputSchema: z.object({}),
      execute: (): Promise<string> => readTerminalOutput(context),
    }),
    [WRITE_TERMINAL_INPUT]: tool({
      description:
        'Type text into the terminal, running it as a command by default, and return the resulting output.',
      inputSchema: z.object({
        text: z.string().describe('The text to type into the terminal.'),
        submit: z
          .boolean()
          .optional()
          .describe('Whether to run the text as a command (append a newline). Defaults to true.'),
      }),
      execute: (args: { text: string; submit?: boolean }): Promise<string> =>
        writeTerminalInput(context, args.text, args.submit ?? true),
    }),
  };
}

/**
 * Maps a single Vercel AI SDK `fullStream` part to the shared event protocol, emitting through the run
 * context. Shared by every AI-SDK-backed provider so the stream-to-event translation lives in one
 * place.
 * @param part The stream part.
 * @param context The run context to emit through.
 */
export function mapStreamPart(part: StreamPart, context: AgentRunContext): void {
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
