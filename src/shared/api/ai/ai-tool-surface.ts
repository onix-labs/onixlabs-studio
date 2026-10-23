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
 * The in-app tool a standalone agent tab's agent offers the user a workspace with (#876), once the plan
 * it made with them is settled: a card to name and place the project, and the handoff its workspace's
 * agent starts from. Exposed on the project surface only — anywhere else the project already has one.
 */
export const PROPOSE_WORKSPACE: string = 'propose_workspace';

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
 * The in-app capability that reads the live text of a document opened by {@link OPEN_DOCUMENT},
 * including any edits the user has made to it since.
 */
export const READ_DOCUMENT: string = 'read_document';

/**
 * The in-app capability that applies a string-anchored edit to a document opened by
 * {@link OPEN_DOCUMENT}, so a revision lands in the tab the user is already reading rather than in a
 * second one.
 */
export const EDIT_DOCUMENT: string = 'edit_document';

/**
 * The in-app capability that replaces the whole text of a document opened by {@link OPEN_DOCUMENT}.
 */
export const REPLACE_DOCUMENT: string = 'replace_document';

/**
 * The in-app capability that opens a new terminal tab.
 */
export const OPEN_TERMINAL: string = 'open_terminal';

/**
 * The in-app capability that opens an existing file from the open workspace into that workspace's
 * document well, as a tab behind the document the user is reading — an agent never brings anything
 * forward (see `OpenOptions`).
 *
 * The counterpart to {@link OPEN_DOCUMENT}: that one hands the user something the agent wrote, this
 * one hands them their own code. It opens rather than edits — a way to say "look at
 * this file" that leaves the user reading it in their editor rather than in a transcript.
 */
export const OPEN_FILE: string = 'open_file';

/**
 * The workspace-surface capability that lists the documents open in the workspace's well: what the
 * user has in front of them, which one is active, and which are unsaved (#713).
 */
export const LIST_OPEN_DOCUMENTS: string = 'list_open_documents';

/**
 * The workspace-surface capability that opens a changed file's diff — working tree against HEAD —
 * into the workspace's well (#713). The "show me what you changed" tool: a diff in the well rather
 * than a paste in the transcript.
 */
export const OPEN_DIFF: string = 'open_diff';

/**
 * The workspace-surface capability that reads the workspace's source-control state: branch,
 * ahead/behind, and the changed files, as the source-control sidebar shows them (#713). Worktree-
 * aware, and available to a harness that has no shell to run `git status` with.
 */
export const READ_SOURCE_CONTROL_STATUS: string = 'read_source_control_status';

/**
 * The workspace-surface capability that lists the terminals in the workspace's dock, so an agent that
 * did not open one itself can still find one to drive (#713).
 */
export const LIST_TERMINALS: string = 'list_terminals';

/**
 * The workspace-surface capability that creates a file in the workspace, optionally with content,
 * and opens it in the well behind what the user is reading (#713). The tree's own New File, with the Explorer reflecting it —
 * and, for a harness with no file tools of its own, the one way to write a file at all.
 */
export const CREATE_FILE: string = 'create_file';

/**
 * The workspace-surface capability that creates a folder in the workspace (#713).
 */
export const CREATE_FOLDER: string = 'create_folder';

/**
 * The workspace-surface capability that renames a file or folder in place (#713).
 */
export const RENAME_PATH: string = 'rename_path';

/**
 * The workspace-surface capability that deletes a file or folder, to the operating system's trash
 * where the platform allows it (#713).
 */
export const DELETE_PATH: string = 'delete_path';

/**
 * The workspace-surface capability that reveals a file or folder in the Explorer (#713): expands
 * the tree down to it and selects it, so the user is looking at what the agent is talking about.
 */
export const REVEAL_IN_EXPLORER: string = 'reveal_in_explorer';

/**
 * The tool that loads a skill from the user's skill library (#301): the second half of progressive
 * disclosure. Every in-scope skill's name and description are listed in the system prompt; a model
 * that decides one applies calls this to receive its full instructions, so the cost of a skill is
 * paid only on the turns that use it.
 */
export const LOAD_SKILL: string = 'load_skill';

/**
 * The System Monitor capability that lists the app's log sessions (#966): the current one and the
 * earlier ones still on disk, so the agent can say which run it is reading.
 */
export const LIST_LOG_SESSIONS: string = 'list_log_sessions';

/**
 * The System Monitor capability that reads log records (#966), filtered by session, severity, text and
 * time, newest first and bounded, so a long session cannot flood the context window.
 */
export const QUERY_LOGS: string = 'query_logs';

/**
 * The System Monitor capability that summarises the recent resource readings (#966) — CPU, memory, GPU,
 * network and disk — over the window the view has sampled.
 */
export const READ_SYSTEM_METRICS: string = 'read_system_metrics';

/**
 * The System Monitor capability that changes how much the app logs (#966). Gated: it changes a setting
 * that outlives the conversation.
 */
export const SET_LOG_LEVEL: string = 'set_log_level';

/**
 * The AI Manager capability that lists the local model runtime, its installed and running models and their disk use (#967).
 */
export const LIST_LOCAL_MODELS: string = 'list_local_models';

/**
 * The AI Manager capability that searches the model catalogue (#967).
 */
export const SEARCH_MODEL_CATALOG: string = 'search_model_catalog';

/**
 * The AI Manager capability that reports what the machine can run: its memory, processor and architecture (#967).
 */
export const READ_MACHINE_FACTS: string = 'read_machine_facts';

/**
 * The AI Manager capability that starts downloading a model. Gated: a model can run to gigabytes (#967).
 */
export const DOWNLOAD_MODEL: string = 'download_model';

/**
 * The AI Manager capability that deletes an installed model's weights. Gated (#967).
 */
export const DELETE_MODEL: string = 'delete_model';

/**
 * The AI Manager capability that lists the prompt profiles (#967).
 */
export const LIST_PROMPT_PROFILES: string = 'list_prompt_profiles';

/**
 * The AI Manager capability that creates or changes a prompt profile (#967). Gated: a profile is a
 * standing instruction every later agent obeys.
 */
export const SAVE_PROMPT_PROFILE: string = 'save_prompt_profile';

/**
 * The AI Manager capability that deletes a prompt profile. Gated (#967).
 */
export const DELETE_PROMPT_PROFILE: string = 'delete_prompt_profile';

/**
 * The AI Manager capability that lists the skill library (#967).
 */
export const LIST_SKILLS: string = 'list_skills';

/**
 * The AI Manager capability that reads one skill's instructions (#967).
 */
export const READ_SKILL: string = 'read_skill';

/**
 * The AI Manager capability that lists what a skill may be scoped and tagged with: the surfaces, and the languages and technologies by category (#967).
 */
export const LIST_SKILL_TAGS: string = 'list_skill_tags';

/**
 * The AI Manager capability that creates or changes a skill (#967). Gated: a skill is an instruction
 * a later agent loads on its own judgement.
 */
export const SAVE_SKILL: string = 'save_skill';

/**
 * The AI Manager capability that deletes a skill. Gated (#967).
 */
export const DELETE_SKILL: string = 'delete_skill';

/**
 * The Plugin Manager capability that lists the plugins: installed, available and waiting updates, with what each contributes (#968).
 */
export const LIST_PLUGINS: string = 'list_plugins';

/**
 * The Plugin Manager capability that reports the open workspaces' ecosystems and the languages they imply, to recommend plugins from (#968).
 */
export const READ_WORKSPACE_LANGUAGES: string = 'read_workspace_languages';

/**
 * The Plugin Manager capability that installs or updates a plugin through the consent window, which is its only gate (#968).
 */
export const INSTALL_PLUGIN: string = 'install_plugin';

/**
 * The Plugin Manager capability that uninstalls a plugin. Gated (#968).
 */
export const UNINSTALL_PLUGIN: string = 'uninstall_plugin';

/**
 * The Containers capability that lists the containers, with each one's state, ports, mounts and, while it runs, its CPU and memory (#969).
 */
export const LIST_CONTAINERS: string = 'list_containers';

/**
 * The Containers capability that lists the images on this machine (#969).
 */
export const LIST_CONTAINER_IMAGES: string = 'list_container_images';

/**
 * The Containers capability that lists the volumes, and which containers mount each (#969).
 */
export const LIST_CONTAINER_VOLUMES: string = 'list_container_volumes';

/**
 * The Containers capability that reads a container's most recent log lines, to explain why it stopped (#969).
 */
export const READ_CONTAINER_LOGS: string = 'read_container_logs';

/**
 * The Containers capability that starts, stops, restarts, pauses or resumes a container. Not gated: each is undone by another (#969).
 */
export const CONTROL_CONTAINER: string = 'control_container';

/**
 * The Containers capability that removes a container. Gated (#969).
 */
export const REMOVE_CONTAINER: string = 'remove_container';

/**
 * The Containers capability that downloads an image. Gated (#969).
 */
export const PULL_IMAGE: string = 'pull_image';

/**
 * The Containers capability that removes an image. Gated (#969).
 */
export const REMOVE_IMAGE: string = 'remove_image';

/**
 * The Containers capability that removes a volume and the data in it. Gated (#969).
 */
export const REMOVE_VOLUME: string = 'remove_volume';

/**
 * The Containers capability that runs a new container from an image, with its ports, environment and mounts. Gated (#969).
 */
export const RUN_CONTAINER: string = 'run_container';

/**
 * The formats {@link OPEN_DOCUMENT} can open a document in: the markdown editor (rendered prose) or
 * the code editor (syntax-highlighted text).
 */
export type OpenDocumentFormat = 'markdown' | 'code';

/**
 * Identifies what an agent run acts on: the open editor document (`editor`), the owning terminal
 * (`terminal`), the owning binary document (`binary`), the API Explorer's collections (`api`), a
 * workspace tab and its document well (`workspace` — the agent panel docked in a workspace or
 * repository tab, #713), or the project as a whole (`project` — the standalone agent tab, which has no
 * owning document and works through the provider's built-in tools alone), or one of the tool views
 * (`monitor` — the System Monitor; `models` — the AI Manager; `plugins` — the Plugin Manager; `containers` — the Containers view, #964). It selects the tool set the providers expose for the run.
 */
export type AgentSurface =
  | 'editor'
  | 'terminal'
  | 'binary'
  | 'api'
  | 'workspace'
  | 'project'
  | 'monitor'
  | 'models'
  | 'plugins'
  | 'containers';

/**
 * Every surface, in the order they are presented to a user choosing among them. The one list the
 * request validator and any picker read, so a surface added to the type cannot be forgotten by
 * either — which is how `api` went unlisted by the validator for a while.
 */
export const AGENT_SURFACES: readonly AgentSurface[] = [
  'editor',
  'terminal',
  'binary',
  'api',
  'workspace',
  'project',
  'monitor',
  'models',
  'plugins',
  'containers',
];

/**
 * The tool views' surfaces (#964). An agent docked in a tool view is kept to that view: it is offered
 * its view's own tools, the clarifying question and the skills, and nothing else — no workbench, file,
 * terminal, run-configuration or hosting tools — so it cannot drift into work the view is not for.
 */
export const TOOL_VIEW_SURFACES: readonly AgentSurface[] = [
  'monitor',
  'models',
  'plugins',
  'containers',
];

/**
 * Determines whether a surface belongs to a tool view.
 * @param surface The surface.
 * @returns Returns true when it is one of {@link TOOL_VIEW_SURFACES}.
 */
export function isToolViewSurface(surface: AgentSurface): boolean {
  return TOOL_VIEW_SURFACES.includes(surface);
}

/**
 * Determines whether a surface's agent is denied the harness's own built-in tools — its file, shell and
 * web tools — and so works through Studio's tools alone. A terminal agent acts on its terminal, and a
 * tool view's agent on its view; neither has any business with the file system.
 * @param surface The surface.
 * @returns Returns true when the harness's built-in tools are withheld.
 */
export function withholdsBuiltInTools(surface: AgentSurface): boolean {
  return surface === 'terminal' || isToolViewSurface(surface);
}

/**
 * Determines whether a value names a surface.
 * @param value The value to test.
 * @returns Returns true when it is one of {@link AGENT_SURFACES}.
 */
export function isAgentSurface(value: unknown): value is AgentSurface {
  return typeof value === 'string' && AGENT_SURFACES.includes(value as AgentSurface);
}
