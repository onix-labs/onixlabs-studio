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
 * The most characters a one-line summary carries.
 */
const MAX_SUMMARY_CHARS: number = 120;

/**
 * The input keys worth putting in a one-line summary, most specific first.
 *
 * `description` precedes `prompt` so a Task (sub-agent) call summarises as its short description
 * rather than its full delegated prompt. The trailing keys cover Studio's own tools: terminal input,
 * binary bytes and assembly, the ask-user question, and the tool views' targets — an image to pull,
 * a container, volume, model, skill or plugin to remove, a log level to set (#969).
 */
const SUMMARY_KEYS: readonly string[] = [
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
  'image',
  'reference',
  'ref',
  'name',
  'id',
  'level',
];

/**
 * Produces a one-line summary of a tool's input: the most descriptive common field (a path, pattern,
 * command, query, URL, or the thing a tool-view tool acts on), else the whole input as compact JSON,
 * so a permission prompt never asks the user to allow something it does not show.
 * @param input The tool input.
 * @returns Returns the summary, empty only for an input with nothing in it.
 */
export function summarizeToolInput(input: unknown): string {
  if (input === null || typeof input !== 'object') {
    return '';
  }
  const record: Record<string, unknown> = input as Record<string, unknown>;
  for (const key of SUMMARY_KEYS) {
    const value: unknown = record[key];
    if (typeof value === 'string' && value.length > 0) {
      return clampSummary(value);
    }
  }
  // ⛔ Nothing recognisable, so the input itself. A card that read "Allow run_container?" with no
  // detail asked the user to approve a mount of their whole disk blind (audit S3).
  const entries: [string, unknown][] = Object.entries(record).filter(
    ([, value]: [string, unknown]): boolean => value !== undefined,
  );
  if (entries.length === 0) {
    return '';
  }
  try {
    return clampSummary(JSON.stringify(Object.fromEntries(entries)));
  } catch {
    return '';
  }
}

/**
 * Clamps a summary to one line's worth.
 * @param value The summary.
 * @returns Returns the summary, shortened with an ellipsis when over the limit.
 */
function clampSummary(value: string): string {
  return value.length > MAX_SUMMARY_CHARS ? `${value.slice(0, MAX_SUMMARY_CHARS - 3)}...` : value;
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
