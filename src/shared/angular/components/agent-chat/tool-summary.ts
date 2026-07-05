import {
  READ_ACTIVE_DOCUMENT,
  READ_TERMINAL_OUTPUT,
  REPLACE_ACTIVE_DOCUMENT,
  WRITE_TERMINAL_INPUT,
} from '@shared/api/ai-types';

/**
 * The label shown for a tool call whose name has no friendlier mapping — the agent did something we
 * cannot describe specifically, so it reads as a generic action the user can expand for details.
 */
const GENERIC_LABEL: string = 'Performed an action';

/**
 * Maps a tool's name (as the providers surface it, with any `mcp__<server>__` prefix already stripped)
 * to a short, human-friendly description of what the agent did. Covers the built-in Claude Code tools
 * and Studio's own in-app capabilities; anything unmapped falls back to {@link GENERIC_LABEL}.
 */
const TOOL_LABELS: Readonly<Record<string, string>> = {
  Bash: 'Running a command',
  BashOutput: 'Reading command output',
  Glob: 'Finding files',
  Grep: 'Searching the code',
  Read: 'Reading a file',
  Write: 'Writing a file',
  Edit: 'Editing a file',
  MultiEdit: 'Editing a file',
  NotebookEdit: 'Editing a notebook',
  WebFetch: 'Fetching a web page',
  WebSearch: 'Searching the web',
  Task: 'Running a task',
  TodoWrite: 'Updating the plan',
  [READ_ACTIVE_DOCUMENT]: 'Reading the current document',
  [REPLACE_ACTIVE_DOCUMENT]: 'Updating the current document',
  [READ_TERMINAL_OUTPUT]: 'Reading the terminal',
  [WRITE_TERMINAL_INPUT]: 'Running a terminal command',
};

/**
 * Studio's own in-app capabilities, shown in their `mcp:` form when a tool row is expanded so the
 * technical detail reflects that they are the app's MCP tools rather than model built-ins.
 */
const STUDIO_TOOLS: ReadonlySet<string> = new Set<string>([
  READ_ACTIVE_DOCUMENT,
  REPLACE_ACTIVE_DOCUMENT,
  READ_TERMINAL_OUTPUT,
  WRITE_TERMINAL_INPUT,
]);

/**
 * Gets a short, human-friendly description of a tool call for the transcript's timeline summary.
 * @param toolName The tool's name as surfaced by the provider, or undefined.
 * @returns Returns the friendly label, or a generic one when the tool is unknown.
 */
export function friendlyToolLabel(toolName: string | undefined): string {
  if (toolName === undefined) {
    return GENERIC_LABEL;
  }
  return TOOL_LABELS[toolName] ?? GENERIC_LABEL;
}

/**
 * Gets the technical identifier revealed when a tool row is expanded: Studio's own capabilities are
 * shown in their `mcp:` form, everything else as the raw tool name the model invoked.
 * @param toolName The tool's name as surfaced by the provider, or undefined.
 * @returns Returns the technical tool identifier.
 */
export function technicalToolName(toolName: string | undefined): string {
  if (toolName === undefined || toolName.length === 0) {
    return 'unknown tool';
  }
  return STUDIO_TOOLS.has(toolName) ? `mcp:${toolName}` : toolName;
}
