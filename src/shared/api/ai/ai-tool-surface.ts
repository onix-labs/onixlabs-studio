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
 * The in-app capability that applies a string-anchored edit to the active editor document: the given
 * text is located (it must match exactly once, unless replacing every occurrence) and replaced.
 */
export const EDIT_ACTIVE_DOCUMENT: string = 'edit_active_document';

/**
 * The in-app capability that inserts text into the active editor document, relative to an anchor
 * string or at the document's start or end.
 */
export const INSERT_ACTIVE_DOCUMENT: string = 'insert_into_active_document';

/**
 * The in-app capability that sets the active editor document's language (syntax), so the editor
 * re-highlights and the language picker reflects it.
 */
export const SET_ACTIVE_DOCUMENT_LANGUAGE: string = 'set_active_document_language';

/**
 * The placements the insert capability accepts: relative to an anchor string, or at a document edge.
 */
export type InsertPlacement = 'before' | 'after' | 'start' | 'end';

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
 * The in-app capability that inserts bytes before an offset in the owning binary document, growing it
 * and shifting every subsequent offset; produces an unsaved, undoable edit.
 */
export const INSERT_BINARY_BYTES: string = 'insert_binary_bytes';

/**
 * The in-app capability that deletes a run of bytes from the owning binary document, shrinking it and
 * shifting every subsequent offset; produces an unsaved, undoable edit.
 */
export const DELETE_BINARY_BYTES: string = 'delete_binary_bytes';

/**
 * The in-app capability that assembles assembly text and writes it over a byte range of the owning
 * binary document, leaving the length unchanged (shorter output is NOP-padded, longer is rejected).
 * Produces an unsaved, undoable edit.
 */
export const WRITE_BINARY_ASSEMBLY: string = 'write_binary_assembly';

/**
 * The in-app tool that asks the user a question (free-form or with suggested choices) and blocks the
 * run until they answer. Exposed on every surface so asking is a deliberate action rather than a
 * heuristic parse of assistant prose.
 */
export const ASK_USER: string = 'ask_user';

/**
 * The in-app capability that stages an editor mutation as a pending preview instead of applying it:
 * the prospective change is computed, shown as a diff in the document well when the target has a
 * diff editor (code; markdown has none), and held until committed or cancelled. Not a model tool —
 * the edit tools call it internally under the `prompt` posture.
 */
export const PREVIEW_ACTIVE_DOCUMENT_EDIT: string = 'preview_active_document_edit';

/**
 * The in-app capability that applies a staged edit preview to its document and closes the diff.
 */
export const COMMIT_EDIT_PREVIEW: string = 'commit_edit_preview';

/**
 * The in-app capability that discards a staged edit preview and closes the diff.
 */
export const CANCEL_EDIT_PREVIEW: string = 'cancel_edit_preview';

/**
 * Identifies what an agent run acts on: the open editor document (`editor`), the owning terminal
 * (`terminal`), the owning binary document (`binary`), or the project as a whole (`project` — the
 * standalone agent tab, which has no owning document and works through the provider's built-in tools
 * alone). It selects the tool set the providers expose for the run.
 */
export type AgentSurface = 'editor' | 'terminal' | 'binary' | 'project';
