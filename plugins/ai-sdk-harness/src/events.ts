// Turning the AI SDK's `fullStream` into the events Studio's transcript already renders.
//
// The reason a harness needs no output vocabulary of its own: `AiEvent` is a serialisable union Studio
// has rendered since long before this protocol existed, so the whole of this file is a translation into
// something that was already there.
//
// ⚠️ Reproduced from `ai-sdk-stream.ts` and `tool-format.ts` rather than imported — the plugin's rule.
// Kept behaviourally identical, because the transcript is the one place where a difference between the
// in-core provider and this one would be visible to a user as a change rather than as a move.

/**
 * A loosely-typed part from the AI SDK's `fullStream`, covering the fields read here. The SDK's own part
 * type is a broad union; this captures just what the event mapping needs.
 */
export interface StreamPart {
  /**
   * Gets the part discriminator (`text-delta`, `reasoning-delta`, `tool-call`, `tool-result`, `error`,
   * …).
   */
  readonly type: string;
  readonly text?: string;
  readonly delta?: string;
  readonly toolName?: string;
  readonly toolCallId?: string;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly errorText?: string;

  /**
   * Gets the cumulative token usage carried by a `finish` part. Fields are optional because a model
   * back-end may not report every count.
   */
  readonly totalUsage?: {
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly totalTokens?: number;
  };

  /**
   * Gets the error carried by an `error` part. The SDK surfaces request and stream failures here rather
   * than throwing, so this must be inspected.
   */
  readonly error?: unknown;
}

/**
 * The most characters a raw tool payload (full input or output) carries into the event protocol.
 * Payloads ride Studio's IPC bridge and persist with the conversation, so an enormous one is clamped at
 * the source — with an explicit marker, never silently.
 */
const MAX_PAYLOAD_CHARS: number = 16_384;

/**
 * Renders a human-readable reason from an error thrown during a run, or carried by a stream `error`
 * part.
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
 * Clamps a raw payload to {@link MAX_PAYLOAD_CHARS}, appending an explicit truncation marker so a cut
 * is always visible.
 * @param text The payload text.
 * @returns Returns the payload, clamped when over the cap.
 */
function clampPayload(text: string): string {
  if (text.length <= MAX_PAYLOAD_CHARS) {
    return text;
  }
  const omitted: number = text.length - MAX_PAYLOAD_CHARS;
  return `${text.slice(0, MAX_PAYLOAD_CHARS)}\n… [truncated: ${omitted.toLocaleString()} more characters]`;
}

/**
 * Produces a one-line summary of a tool's input by surfacing the most descriptive common field (a path,
 * pattern, command, query, or URL), or an empty string when none is present.
 * @param input The tool input.
 * @returns Returns the summary.
 */
export function summarizeToolInput(input: unknown): string {
  if (input === null || typeof input !== 'object') {
    return '';
  }
  const record: Record<string, unknown> = input as Record<string, unknown>;
  for (const key of [
    'file_path',
    'path',
    'pattern',
    'command',
    'query',
    'url',
    'description',
    'prompt',
    'text',
    'bytes',
    'assembly',
    'question',
  ]) {
    const value: unknown = record[key];
    if (typeof value === 'string' && value.length > 0) {
      return value.length > 120 ? `${value.slice(0, 117)}...` : value;
    }
  }
  return '';
}

/**
 * Renders a tool's full input for the transcript's raw-detail view: pretty-printed JSON for an object
 * input, the text itself for a string, or undefined when the tool takes no input.
 * @param input The tool input.
 * @returns Returns the rendered input, or undefined for none.
 */
export function formatToolInput(input: unknown): string | undefined {
  if (input === null || input === undefined) {
    return undefined;
  }
  if (typeof input === 'string') {
    return input.length > 0 ? clampPayload(input) : undefined;
  }
  if (typeof input === 'object' && Object.keys(input).length === 0) {
    return undefined;
  }
  try {
    return clampPayload(JSON.stringify(input, null, 2));
  } catch {
    return undefined;
  }
}

/**
 * Renders a tool's raw output for the transcript's raw-detail view. Handles the shapes the providers
 * produce: a plain string, an MCP-style content-block array (text blocks joined), or any other value
 * pretty-printed as JSON.
 * @param output The tool output value.
 * @returns Returns the rendered output, or undefined for none.
 */
export function formatToolOutput(output: unknown): string | undefined {
  if (output === null || output === undefined) {
    return undefined;
  }
  if (typeof output === 'string') {
    return output.length > 0 ? clampPayload(output) : undefined;
  }
  if (Array.isArray(output)) {
    const texts: string[] = output
      .map((block: unknown): string => {
        const record: { type?: unknown; text?: unknown } = block as never;
        return record.type === 'text' && typeof record.text === 'string' ? record.text : '';
      })
      .filter((text: string): boolean => text.length > 0);
    if (texts.length > 0) {
      return clampPayload(texts.join('\n'));
    }
  }
  try {
    // JSON.stringify yields undefined for unserialisable values (functions, symbols).
    const rendered: string | undefined = JSON.stringify(output, null, 2);
    return rendered === undefined || rendered === '{}' ? undefined : clampPayload(rendered);
  } catch {
    return undefined;
  }
}

/**
 * Maps a single AI SDK `fullStream` part to Studio's event protocol.
 * @param part The stream part.
 * @param requestId The run the part belongs to.
 * @param emit Sends one of Studio's own transcript events.
 */
export function mapStreamPart(
  part: StreamPart,
  requestId: string,
  emit: (event: Record<string, unknown>) => void,
): void {
  switch (part.type) {
    case 'text-delta':
      emit({ requestId, kind: 'text', delta: part.text ?? part.delta ?? '' });
      break;
    case 'reasoning-delta':
      emit({ requestId, kind: 'thinking', delta: part.text ?? part.delta ?? '' });
      break;
    case 'tool-call': {
      const input: string | undefined = formatToolInput(part.input);
      emit({
        requestId,
        kind: 'tool-start',
        toolId: part.toolCallId ?? '',
        name: part.toolName ?? 'tool',
        detail: typeof part.input === 'string' ? part.input : summarizeToolInput(part.input),
        ...(input === undefined ? {} : { input }),
      });
      break;
    }
    case 'tool-result': {
      const output: string | undefined = formatToolOutput(part.output);
      emit({
        requestId,
        kind: 'tool-end',
        toolId: part.toolCallId ?? '',
        ok: true,
        detail: 'done',
        ...(output === undefined ? {} : { output }),
      });
      break;
    }
    case 'tool-error':
      emit({
        requestId,
        kind: 'tool-end',
        toolId: part.toolCallId ?? '',
        ok: false,
        detail: part.errorText ?? 'failed',
        ...(part.errorText === undefined || part.errorText.length === 0
          ? {}
          : { output: part.errorText }),
      });
      break;
    case 'finish': {
      // The terminal `finish` part carries the run's cumulative usage; this path does not report a cost,
      // so it is left unknown rather than guessed at from a price list that would go stale.
      const usage: StreamPart['totalUsage'] = part.totalUsage;
      if (usage !== undefined) {
        emit({
          requestId,
          kind: 'usage',
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
          costUsd: null,
        });
      }
      break;
    }
    default:
      break;
  }
}
