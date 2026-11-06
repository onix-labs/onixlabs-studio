// The catalogue of gateable agent tools a per-tool default policy (#309) can be set for. Shared so
// the Settings UI renders the same set the main-process gate keys on, and both agree on display names.

import { AiToolPolicy } from './ai-run-types';

/**
 * Describes one tool a user can set a default {@link AiToolPolicy} for.
 */
export interface GateableTool {
  /**
   * Gets the tool's display name — the key the policy map and the permission prompt use.
   */
  readonly name: string;

  /**
   * Gets a short human label for the Settings row.
   */
  readonly label: string;

  /**
   * Gets a one-line description of what the tool does, for the Settings row.
   */
  readonly description: string;
}

/**
 * The permission to run a shell command outside the OS sandbox (#1159). Not a tool of its own: a
 * shell call that asks to leave the sandbox is decided under this name rather than `Bash`, so nothing
 * that covers the shell covers it. The harness that gates it keeps its own copy of the name, because
 * a harness shares no code with the application.
 */
export const RUN_UNSANDBOXED: string = 'Run outside the sandbox';

/**
 * The mutating/exec tools that flow through the permission gate and can therefore carry a default
 * policy. Read-only tools (Read/Glob/Grep) are always allowed and never gated, so they are excluded —
 * a policy on them would not be enforced. Keyed by display name to match `prettyToolName`, the
 * permission prompt, and the remembered-rule store.
 */
export const GATEABLE_TOOLS: readonly GateableTool[] = [
  { name: 'Write', label: 'Write File', description: 'Create or overwrite a file.' },
  { name: 'Edit', label: 'Edit File', description: 'Modify part of an existing file.' },
  {
    name: 'MultiEdit',
    label: 'Multi-Edit File',
    description: 'Apply several edits to a file at once.',
  },
  {
    name: 'NotebookEdit',
    label: 'Edit Notebook',
    description: 'Modify a Jupyter notebook cell.',
  },
  { name: 'Bash', label: 'Run Shell Command', description: 'Execute a shell command.' },
  {
    name: RUN_UNSANDBOXED,
    label: 'Run Outside the Sandbox',
    description:
      'Run a shell command without the OS sandbox, so it can reach any file and any host. Deny runs it sandboxed instead, and Prompt All always asks.',
  },
  { name: 'WebFetch', label: 'Fetch a URL', description: 'Retrieve the contents of a web page.' },
  { name: 'WebSearch', label: 'Web Search', description: 'Search the web.' },
];

/**
 * The default policy for any tool with no explicit user setting: preserve today's posture-driven
 * behaviour.
 */
export const DEFAULT_TOOL_POLICY: AiToolPolicy = 'ask';
