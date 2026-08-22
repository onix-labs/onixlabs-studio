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
 * The in-app capability that runs the active editor document in the code view's docked run terminal
 * (using the file's language runner), captures the output, and reports the exit result so the agent
 * can tell whether the program ran successfully.
 */
export const RUN_ACTIVE_DOCUMENT: string = 'run_active_document';

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
 * The in-app capability that lists the open workspace's `.studio` run configurations, so the agent can
 * see what already exists before authoring more.
 */
export const LIST_RUN_CONFIGURATIONS: string = 'list_run_configurations';

/**
 * The in-app capability that creates or updates run configurations in the open workspace's
 * `.studio/workspace.json`. Configurations are matched by id: a known id is replaced, an unknown one is
 * added.
 */
export const SAVE_RUN_CONFIGURATIONS: string = 'save_run_configurations';

/**
 * The in-app capability that deletes run configurations from the open workspace's
 * `.studio/workspace.json` by id.
 */
export const DELETE_RUN_CONFIGURATIONS: string = 'delete_run_configurations';

/**
 * The in-app capability that lists the API Explorer's collections, saved requests and environments,
 * so the agent can see what already exists before adding to it.
 */
export const LIST_API_REQUESTS: string = 'list_api_requests';

/**
 * The in-app capability that creates a saved request in the API Explorer and opens it in the API well.
 * The agent's way of setting an endpoint up for the user rather than describing it in prose.
 */
export const CREATE_API_REQUEST: string = 'create_api_request';

/**
 * The in-app capability that applies changes to a saved request — a header, a body, a URL — leaving
 * everything it does not name untouched.
 */
export const UPDATE_API_REQUEST: string = 'update_api_request';

/**
 * The in-app capability that sends a saved request and returns its outcome. An execution, so it is
 * gated by the permission posture exactly as running a file is: an agent probing an API is making a
 * real call to a real service.
 */
export const SEND_API_REQUEST: string = 'send_api_request';

/**
 * The in-app capability that sets a variable in the API Explorer's active environment, so an agent
 * that discovers a base URL or a token can put it where every request resolves it from.
 */
export const SET_API_VARIABLE: string = 'set_api_variable';

/**
 * The in-app capability that opens a new, unsaved top-level document tab — markdown or code — and
 * fills it with content for the user to review in the editor.
 *
 * A **workbench** capability rather than a surface-bound one: it acts on the global tab registry, not
 * on whatever the agent is docked to, so every surface offers it. That is what lets an agent spin a
 * report, a draft, or a scratch file out of a conversation into its own tab instead of burying it in
 * the transcript.
 */
export const OPEN_DOCUMENT: string = 'open_document';

/**
 * The in-app capability that offers to save a document opened by {@link OPEN_DOCUMENT}, through the
 * operating system's save dialog. The agent never picks the path: the dialog is the user's decision.
 */
export const SAVE_DOCUMENT: string = 'save_document';

/**
 * The in-app capability that opens a new terminal tab.
 */
export const OPEN_TERMINAL: string = 'open_terminal';

/**
 * The in-app capability that opens an existing file from the open workspace into that workspace's
 * document well, and brings its tab to the front.
 *
 * The counterpart to {@link OPEN_DOCUMENT}: that one hands the user something the agent wrote, this
 * one puts the user's own code in front of them. It opens rather than edits — a way to say "look at
 * this file" that leaves the user reading it in their editor rather than in a transcript.
 */
export const OPEN_FILE: string = 'open_file';

/**
 * The formats {@link OPEN_DOCUMENT} can open a document in: the markdown editor (rendered prose) or
 * the code editor (syntax-highlighted text).
 */
export type OpenDocumentFormat = 'markdown' | 'code';

/**
 * Identifies what an agent run acts on: the open editor document (`editor`), the owning terminal
 * (`terminal`), the owning binary document (`binary`), the API Explorer's collections (`api`), or the
 * project as a whole (`project` — the standalone agent tab, which has no owning document and works
 * through the provider's built-in tools alone). It selects the tool set the providers expose for the
 * run.
 */
export type AgentSurface = 'editor' | 'terminal' | 'binary' | 'api' | 'project';
