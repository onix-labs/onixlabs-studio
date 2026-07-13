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
  // rather than its full delegated prompt.
  for (const key of [
    'file_path',
    'path',
    'pattern',
    'command',
    'query',
    'url',
    'description',
    'prompt',
  ]) {
    const value: unknown = record[key];
    if (typeof value === 'string' && value.length > 0) {
      return value.length > 120 ? `${value.slice(0, 117)}...` : value;
    }
  }
  return '';
}
