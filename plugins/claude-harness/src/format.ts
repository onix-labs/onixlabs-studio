// Rendering a tool's name, input and output for Studio's transcript, and classifying why an action was
// allowed for its audit log.
//
// ⚠️ Reproduced from Studio's `tool-format.ts` and `tool-policy.ts` rather than imported, under the rule
// the whole plugin follows: a harness that shares code with the application is a harness that cannot be
// extracted. Kept behaviourally identical, because these strings reach the same transcript and the same
// audit log whichever provider produced them — a tool call that summarised differently depending on who
// ran it would read as a bug in the transcript.

/**
 * The most characters a raw tool payload (full input or output) carries into the event protocol.
 *
 * Payloads ride the pipe, then Studio's IPC bridge, and then persist with the conversation, so an
 * enormous one is clamped at the source — with an explicit marker, never silently.
 */
const MAX_PAYLOAD_CHARS: number = 16_384;

/**
 * The input keys worth putting in a one-line summary, most specific first.
 *
 * `description` precedes `prompt` so a Task (sub-agent) call summarises as its short description rather
 * than its whole delegated prompt. The trailing keys cover Studio's own tools: terminal input, binary
 * bytes and assembly, and the ask-user question.
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
];

/**
 * Strips the `mcp__<server>__` prefix from a fully-qualified MCP tool name, leaving a display name.
 * @param name The raw tool name.
 * @returns Returns the display name.
 */
export function prettyToolName(name: string): string {
  return name.replace(/^mcp__[^_]+__/, '');
}

/**
 * Produces a one-line summary of a tool's input by surfacing the most descriptive common field, or an
 * empty string when none is present.
 * @param input The tool input.
 * @returns Returns the summary.
 */
export function summarizeToolInput(input: unknown): string {
  if (input === null || typeof input !== 'object') {
    return '';
  }
  const record: Record<string, unknown> = input as Record<string, unknown>;
  for (const key of SUMMARY_KEYS) {
    const value: unknown = record[key];
    if (typeof value === 'string' && value.length > 0) {
      return value.length > 120 ? `${value.slice(0, 117)}...` : value;
    }
  }
  return '';
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
 * Renders a tool's full input for the transcript's raw-detail view: pretty-printed JSON for an object,
 * the text itself for a string, or undefined when the tool takes no input.
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
 * Renders a tool's raw output for the transcript's raw-detail view, handling the shapes the SDK
 * produces: a plain string, an MCP-style content-block array (text blocks joined), or anything else
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
        const record: { type?: unknown; text?: unknown } = block ?? {};
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
 * Computes the coarse audit source for an executed tool from the run's settings.
 *
 * An explicit `allow` policy takes precedence; otherwise an auto-allowing posture is credited (honouring
 * `auto-edits` only for edit tools); everything else — an interactive grant, a remembered rule, or a
 * command the CLI's own classifier ran without asking — collapses to `gated-or-auto`, because the exact
 * grant path is not recoverable at the execution point.
 * @param policy The tool's per-tool policy.
 * @param posture The run's permission posture.
 * @param isEditTool Whether the tool is a file-edit tool, which is what `auto-edits` covers.
 * @returns Returns the coarse audit source, as Studio's `AuditGrantSource` spells it.
 */
export function coarseGrantSource(
  policy: 'allow' | 'ask' | 'deny',
  posture: 'prompt' | 'auto-edits' | 'auto-all',
  isEditTool: boolean,
): string {
  if (policy === 'allow') {
    return 'policy';
  }
  if (posture === 'auto-all' || (posture === 'auto-edits' && isEditTool)) {
    return 'posture';
  }
  return 'gated-or-auto';
}
