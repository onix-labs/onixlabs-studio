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
}

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
   * Gets the user's override for the clangd executable (the C/C++ server), or null to auto-detect.
   */
  readonly clangdPath: string | null;

  /**
   * Gets the user's override for the TypeScript language server's entry point (the path to its
   * JavaScript CLI module, run through the bundled Node runtime), or null to use the bundled server.
   */
  readonly typescriptServerPath: string | null;

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
}
