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
 * The mutating/exec tools that flow through the permission gate and can therefore carry a default
 * policy. Read-only tools (Read/Glob/Grep) are always allowed and never gated, so they are excluded —
 * a policy on them would not be enforced. Keyed by display name to match `prettyToolName`, the
 * permission prompt, and the remembered-rule store.
 */
export const GATEABLE_TOOLS: readonly GateableTool[] = [
  { name: 'Write', label: 'Write file', description: 'Create or overwrite a file.' },
  { name: 'Edit', label: 'Edit file', description: 'Modify part of an existing file.' },
  { name: 'MultiEdit', label: 'Multi-edit file', description: 'Apply several edits to a file at once.' },
  {
    name: 'NotebookEdit',
    label: 'Edit notebook',
    description: 'Modify a Jupyter notebook cell.',
  },
  { name: 'Bash', label: 'Run shell command', description: 'Execute a shell command.' },
  { name: 'WebFetch', label: 'Fetch a URL', description: 'Retrieve the contents of a web page.' },
  { name: 'WebSearch', label: 'Web search', description: 'Search the web.' },
];

/**
 * The default policy for any tool with no explicit user setting: preserve today's posture-driven
 * behaviour.
 */
export const DEFAULT_TOOL_POLICY: AiToolPolicy = 'ask';
