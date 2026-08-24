import { logger } from '@shared/electron/logger';

/**
 * Strips the `mcp__<server>__` prefix from a fully-qualified MCP tool name, leaving a clean display
 * name.
 * @param name The raw tool name.
 * @returns Returns the display name.
 */
export function prettyToolName(name: string): string {
  return name.replace(/^mcp__[^_]+__/, '');
}

/**
 * Produces a one-line summary of a tool's input by surfacing the most descriptive common field
 * (a path, pattern, command, query, or URL), or an empty string when none is present.
 * @param input The tool input.
 * @returns Returns the summary.
 */
export function summarizeToolInput(input: unknown): string {
  if (input === null || typeof input !== 'object') {
    return '';
  }
  const record: Record<string, unknown> = input as Record<string, unknown>;
  // `description` precedes `prompt` so a Task (sub-agent) call summarises as its short description
  // rather than its full delegated prompt. The trailing keys cover the studio tools: terminal input,
  // binary bytes/assembly, and the ask-user question.
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
 * The most characters a raw tool payload (full input or output) carries into the event protocol.
 * Payloads ride the IPC bridge and persist with the conversation, so an enormous one is clamped here
 * at the source — with an explicit marker, never silently.
 */
const MAX_PAYLOAD_CHARS: number = 16_384;

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
  logger.debug(
    'ToolFormat',
    `Clamped tool payload, omitting ${omitted.toLocaleString()} characters`,
  );
  return `${text.slice(0, MAX_PAYLOAD_CHARS)}\n… [truncated: ${omitted.toLocaleString()} more characters]`;
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
  } catch (error: unknown) {
    logger.error('ToolFormat', 'Failed to render tool input', error);
    return undefined;
  }
}

/**
 * Renders a tool's raw output for the transcript's raw-detail view. Handles the shapes the providers
 * produce: a plain string, an MCP-style content-block array (text blocks joined), or any other value
 * pretty-printed as JSON. Returns undefined when there is nothing to show.
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
  } catch (error: unknown) {
    logger.error('ToolFormat', 'Failed to render tool output', error);
    return undefined;
  }
}
