// Shared AI-agent contract between the Electron (back-end) and Angular (front-end) processes.
// Keep this module platform-neutral (types and constants only — no Node or DOM dependencies) so both
// compilation targets can import it.

/**
 * The in-app capability that returns the active editor document's text.
 */
export const READ_ACTIVE_DOCUMENT: string = 'read_active_document';

/**
 * The in-app capability that replaces the active editor document's text.
 */
export const REPLACE_ACTIVE_DOCUMENT: string = 'replace_active_document';

/**
 * The in-app capability that returns the recent output of the owning terminal.
 */
export const READ_TERMINAL_OUTPUT: string = 'read_terminal_output';

/**
 * The in-app capability that sends input/commands to the owning terminal.
 */
export const WRITE_TERMINAL_INPUT: string = 'write_terminal_input';

/**
 * Identifies what an agent run acts on: the open editor document (`editor`) or the owning terminal
 * (`terminal`). It selects the tool set the providers expose for the run.
 */
export type AgentSurface = 'editor' | 'terminal';
