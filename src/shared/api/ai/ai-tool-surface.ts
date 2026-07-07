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
 * The in-app capability that returns an overview of the owning binary document (path, size, format,
 * architecture, whether disassembly is available, and the current cursor/selection).
 */
export const READ_BINARY_OVERVIEW: string = 'read_binary_overview';

/**
 * The in-app capability that returns a hex + ASCII dump of a byte range of the owning binary document.
 */
export const READ_BINARY_BYTES: string = 'read_binary_bytes';

/**
 * The in-app capability that returns a hex + ASCII dump of the owning binary document's current
 * selection.
 */
export const READ_BINARY_SELECTION: string = 'read_binary_selection';

/**
 * The in-app capability that returns the disassembly (assembly listing) of a byte range of the owning
 * binary document, when its format is natively disassemblable.
 */
export const READ_BINARY_DISASSEMBLY: string = 'read_binary_disassembly';

/**
 * The in-app capability that overwrites bytes at an offset in the owning binary document (leaving its
 * length unchanged), producing an unsaved, undoable edit.
 */
export const PATCH_BINARY_BYTES: string = 'patch_binary_bytes';

/**
 * Identifies what an agent run acts on: the open editor document (`editor`), the owning terminal
 * (`terminal`), or the owning binary document (`binary`). It selects the tool set the providers expose
 * for the run.
 */
export type AgentSurface = 'editor' | 'terminal' | 'binary';
