import { LanguageSlotEntry } from './language-slot';

// Shared Language Server Protocol contract used between the Electron main process and the renderer.
// Keep this module platform-neutral (no Node or DOM dependencies) so both compilation targets can
// import it. The renderer's LSP clients and the main-process LSP manager name their channels from
// here, over the generic `Bridge` transport (`window.bridge`); the main process owns each server's
// lifecycle, so a hostile renderer can only reference servers by id, never spawn arbitrary processes.

/**
 * Names the Language Server Protocol IPC channels.
 */
export enum LspChannel {
  /**
   * Starts a language-server session, performing the initialize/initialized handshake (invoke).
   */
  Start = 'lsp:start',

  /**
   * Stops a language-server session, shutting the server down (invoke).
   */
  Stop = 'lsp:stop',

  /**
   * Restarts a language-server session in place: the main process tears the server down regardless
   * of how many clients hold the session, respawns it under the same id, and tells every holder
   * through a {@link LspExit} flagged `restarted` so each re-syncs its documents (invoke).
   */
  Restart = 'lsp:restart',

  /**
   * Sends an LSP notification to a session's server (renderer→main, send).
   */
  Notify = 'lsp:notify',

  /**
   * Sends an LSP request to a session's server and awaits its response (invoke).
   */
  Request = 'lsp:request',

  /**
   * Pushes an LSP notification from a session's server to the renderer (main→renderer, send).
   */
  Notification = 'lsp:notification',

  /**
   * Notifies the renderer that a server process exited (main→renderer, send).
   */
  ServerExit = 'lsp:server-exit',

  /**
   * Gets the user's language-server settings (invoke).
   */
  GetSettings = 'lsp:get-settings',

  /**
   * Stores the user's language-server settings (invoke).
   */
  SetSettings = 'lsp:set-settings',

  /**
   * Gets the registered language servers and the languages each serves (invoke).
   */
  GetCatalogue = 'lsp:get-catalogue',

  /**
   * Asks the renderer to apply a server's `workspace/applyEdit` (#1015) — a code action's or a
   * command's edits — through the same applier a rename uses (main→renderer, send). The renderer
   * answers on {@link ApplyEditReply}.
   */
  ApplyEdit = 'lsp:apply-edit',

  /**
   * Answers an {@link ApplyEdit} with what was applied (renderer→main, send).
   */
  ApplyEditReply = 'lsp:apply-edit-reply',
}

/**
 * Identifies a language server known to the main-process registry (for example `typescript`). The
 * renderer references servers by this identifier only; it never supplies an executable command, so a
 * hostile renderer cannot spawn an arbitrary process.
 */
export type LspServerId = string;

/**
 * Describes one registered language server as plain data — the language-server slot's implementation
 * descriptor — for the renderer to resolve which server serves a language and to offer the user the
 * choice when a language has more than one.
 */
export interface LspServerSummary extends LanguageSlotEntry {
  /**
   * Gets the stable identifier the renderer names this server by.
   */
  readonly id: LspServerId;

  /**
   * Gets whether the server is told the brace style when it starts, and only then (#1177): a change to
   * the Brace style setting for a language it serves restarts its sessions, so it takes effect.
   */
  readonly takesBraceStyle?: boolean;

  /**
   * Gets the settings the server declares (#1143), offered on its language's page in Settings.
   */
  readonly settings?: readonly LspServerSettingDescriptor[];
}

/**
 * The standard Language Server Protocol semantic token types the client understands. Advertised to
 * servers as the client's capability and used as the fixed legend the renderer maps each server's own
 * (possibly different) legend onto, so editor colouring is consistent across languages.
 */
export const SEMANTIC_TOKEN_TYPES: readonly string[] = [
  'namespace',
  'type',
  'class',
  'enum',
  'interface',
  'struct',
  'typeParameter',
  'parameter',
  'variable',
  'property',
  'enumMember',
  'event',
  'function',
  'method',
  'macro',
  'keyword',
  'modifier',
  'comment',
  'string',
  'number',
  'regexp',
  'operator',
  'decorator',
];

/**
 * The standard Language Server Protocol semantic token modifiers the client understands.
 */
export const SEMANTIC_TOKEN_MODIFIERS: readonly string[] = [
  'declaration',
  'definition',
  'readonly',
  'static',
  'deprecated',
  'abstract',
  'async',
  'modification',
  'documentation',
  'defaultLibrary',
];

/**
 * Describes a server's semantic token legend: the ordered token-type and token-modifier names the
 * server's packed token data indexes into.
 */
export interface LspSemanticTokensLegend {
  /**
   * Gets the ordered token type names.
   */
  readonly tokenTypes: readonly string[];

  /**
   * Gets the ordered token modifier names.
   */
  readonly tokenModifiers: readonly string[];
}

/**
 * Names the notification the main process sends the renderer with a batch of a server's diagnostics
 * for the whole workspace (#1144): `{ reports }`, each report `{ uri, kind, items?, resultId? }` as
 * `workspace/diagnostic` answers it, files that are not open included — or, with `reset: true`, word
 * that the pull is starting over and every report it sent before is to be dropped.
 */
export const WORKSPACE_DIAGNOSTICS_METHOD: string = 'studio/workspaceDiagnostics';

/**
 * Names the notification the renderer sends the main process, on the Notify channel, to have a
 * session's workspace diagnostics pulled afresh (#1144) — after a document closes, which the server
 * leaves its open request waiting through, though the closed file's diagnostics are now the
 * workspace's to report. Its parameters name the closed document, `{ uri }`. It never reaches the
 * server.
 */
export const REFRESH_WORKSPACE_DIAGNOSTICS_METHOD: string = 'studio/refreshWorkspaceDiagnostics';

/**
 * Describes a request to start a language-server session.
 */
export interface LspStartRequest {
  /**
   * Gets the renderer-minted session identifier the started server is keyed by. The renderer chooses
   * one session per (workspace root, language server).
   */
  readonly sessionId: string;

  /**
   * Gets the identifier of the registered server to start.
   */
  readonly serverId: LspServerId;

  /**
   * Gets the absolute workspace root the server is rooted at. It must be an open workspace root, or —
   * for a standalone file (see {@link standaloneFile}) — the directory containing that file; the main
   * process rejects any other path.
   */
  readonly rootPath: string;

  /**
   * Gets the absolute path of the standalone file this session is started for, when the session is not
   * rooted at an open workspace. The main process accepts {@link rootPath} only when it is the
   * directory of this real, existing file, so a server can be rooted at a single opened file's folder
   * without opening a workspace. Undefined for workspace-rooted sessions.
   */
  readonly standaloneFile?: string;

  /**
   * Gets the brace style the user's settings give the language the session was started for (#1177) —
   * the global Text Editor setting, or the language's override of it — for a server that can only be
   * told it at launch. A project's own `.editorconfig` still wins over it. Undefined when the
   * renderer says nothing, in which case the server keeps its own default.
   */
  readonly braceStyle?: LspBraceStyle;
}

/**
 * Names a brace placement style, as the Text Editor's Brace style setting does: K&R (the brace on the
 * line that opens the block), Allman (on its own line) or GNU (on its own line, indented).
 */
export type LspBraceStyle = 'kr' | 'allman' | 'gnu';

/**
 * Lists every {@link LspBraceStyle}, for validating one from the renderer.
 */
export const LSP_BRACE_STYLES: readonly LspBraceStyle[] = ['kr', 'allman', 'gnu'];

/**
 * Describes the server software backing a session, as reported by the server's `initialize` result.
 */
export interface LspServerInfo {
  /**
   * Gets the server's self-reported name.
   */
  readonly name: string;

  /**
   * Gets the server's self-reported version, when provided.
   */
  readonly version?: string;
}

/**
 * Reports the outcome of starting a language-server session.
 */
export interface LspStartResult {
  /**
   * Gets a value indicating whether the server started and completed its `initialize` handshake.
   */
  readonly success: boolean;

  /**
   * Gets the server software information, when the server started successfully.
   */
  readonly serverInfo?: LspServerInfo;

  /**
   * Gets the server's advertised capabilities (an LSP `ServerCapabilities` object), opaque at this
   * layer and interpreted by the renderer client.
   */
  readonly capabilities?: unknown;

  /**
   * Gets the failure reason, when the server did not start.
   */
  readonly error?: string;
}

/**
 * Carries a single JSON-RPC message (an LSP notification) between the renderer and a session's
 * server, in either direction.
 */
export interface LspMessage {
  /**
   * Gets the identifier of the session the message belongs to.
   */
  readonly sessionId: string;

  /**
   * Gets the LSP method name (for example `textDocument/publishDiagnostics`).
   */
  readonly method: string;

  /**
   * Gets the method parameters, whose shape is defined by the LSP method.
   */
  readonly params?: unknown;
}

/**
 * Carries a server's `workspace/applyEdit` request to the renderer that holds its session (#1015).
 */
export interface LspApplyEditRequest {
  /**
   * Gets the correlation identifier the answer carries back.
   */
  readonly requestId: string;

  /**
   * Gets the identifier of the session whose server asked.
   */
  readonly sessionId: string;

  /**
   * Gets the server's label for the change, when it gave one.
   */
  readonly label?: string;

  /**
   * Gets the edit to apply: an LSP `WorkspaceEdit`, opaque at this layer and read by the renderer.
   */
  readonly edit: unknown;
}

/**
 * Answers an {@link LspApplyEditRequest}: the LSP `ApplyWorkspaceEditResult`, with its correlation
 * identifier.
 */
export interface LspApplyEditReply {
  /**
   * Gets the correlation identifier of the request this answers.
   */
  readonly requestId: string;

  /**
   * Gets whether every part of the edit was applied.
   */
  readonly applied: boolean;

  /**
   * Gets why some or all of the edit was not applied, when it was not.
   */
  readonly failureReason?: string;
}

/**
 * Reports that a session's server process exited (cleanly or by crashing).
 */
export interface LspExit {
  /**
   * Gets the identifier of the session whose server exited.
   */
  readonly sessionId: string;

  /**
   * Gets the process exit code, or null when the process was terminated by a signal.
   */
  readonly code: number | null;

  /**
   * Gets the terminating signal, or null when the process exited normally.
   */
  readonly signal: string | null;

  /**
   * Gets whether the exit was a deliberate restart: a fresh server is already running under the same
   * session id, and the client should re-open its documents against it rather than treat the exit as
   * a crash. Absent or false for a real exit.
   */
  readonly restarted?: boolean;

  /**
   * Gets the server's own account of why it stopped, when it gave one: the last error it logged or
   * wrote to stderr before exiting, as one line. Absent when it exited silently or on request. A
   * server that shuts itself down cleanly (exit code 0) over a protocol error looks identical to a
   * deliberate stop without this.
   */
  readonly reason?: string;
}

/**
 * Describes the user's language-server settings. The settings are owned and persisted by the main
 * process (so the registry can honour them when it resolves a server) and read by the renderer to
 * avoid starting a server the user has disabled.
 */
export interface LspSettings {
  /**
   * Gets the identifiers of the servers the user has turned off.
   */
  readonly disabledServers: readonly string[];

  /**
   * Gets the user's override for the Java runtime executable, or null to auto-detect.
   */
  readonly javaPath: string | null;

  /**
   * Gets the user's override for the .NET executable (used to install and host the C# server), or null
   * to auto-detect.
   */
  readonly dotnetPath: string | null;

  /**
   * Gets the user's own copy of a server's entry point, keyed by server identifier, for a server they
   * would rather run than the one the Plugin Manager installed. A server with no entry runs the
   * installed copy.
   *
   * Keyed rather than one field per server, because the set of servers is open: a contributed server
   * arrives from a manifest core has never heard of, and it can be overridden the same way the
   * first-party ones are. What the path points at follows the server's own shape — an executable for
   * one spawned directly, a JavaScript module for one run under Node.
   */
  readonly serverPaths: Readonly<Record<string, string>>;

  /**
   * Gets extra command-line arguments appended to a server's invocation, keyed by server identifier.
   * A server with no entry (or an empty array) starts with its default arguments only.
   */
  readonly serverArgs: Readonly<Record<string, readonly string[]>>;

  /**
   * Gets the server the user has chosen to serve each language, keyed by Monaco language identifier.
   * A language with no entry uses the highest-priority registered server, so the map holds only
   * genuine preferences and a language served by exactly one server never needs an entry.
   */
  readonly languageServers: Readonly<Record<string, LspServerId>>;

  /**
   * Gets the user's values for the settings servers declare (#1143), keyed by server identifier and
   * then by configuration section — what the server is answered with when it asks through
   * `workspace/configuration`. A setting with no entry is answered with null, the server's default.
   */
  readonly serverSettings: Readonly<
    Record<LspServerId, Readonly<Record<string, LspServerSettingValue>>>
  >;
}

/**
 * The value of a setting a server declares: a switch, or one of a choice's values.
 */
export type LspServerSettingValue = boolean | string;

/**
 * Describes one choice of a {@link LspServerSettingDescriptor} offered as a choice.
 */
export interface LspServerSettingOption {
  /**
   * Gets the value the server is answered with when this choice is made.
   */
  readonly value: LspServerSettingValue;

  /**
   * Gets the choice as the user reads it.
   */
  readonly label: string;
}

/**
 * Describes a setting a language server declares (#1143): what the user sees in Settings › Language
 * Providers, and the `workspace/configuration` section the server is answered from. Plain data, so a
 * server contributed by a plugin declares its own the same way.
 */
export interface LspServerSettingDescriptor {
  /**
   * Gets the configuration section the server asks for, such as
   * `projects.dotnet_enable_automatic_restore`.
   */
  readonly section: string;

  /**
   * Gets the setting's name, as the user reads it.
   */
  readonly label: string;

  /**
   * Gets what the setting does, in a sentence.
   */
  readonly description: string;

  /**
   * Gets the server's own default, shown while the user has set nothing.
   */
  readonly default: LspServerSettingValue;

  /**
   * Gets the choices, for a setting offered as a choice; undefined for a switch.
   */
  readonly options?: readonly LspServerSettingOption[];
}
