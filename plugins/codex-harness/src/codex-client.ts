// The harness's hold on Codex: the app-server process, the loopback server that gives it Studio's
// tools, and the thread the conversation lives in.
//
// ## Why instructions restart the app-server (#955)
//
// Studio's standing instructions — the surface and mode prompt, the user's prompt profiles, the skills
// listing — reach Codex as a thread's `developerInstructions`, which Codex takes only when it loads a
// thread. Studio offers them afresh on every turn, so an edit made between turns would otherwise wait
// for the plugin to restart. When the offered text differs from the text the thread was loaded with,
// the app-server is restarted and the **same** thread resumed with the new text: the conversation is
// kept and the new instructions apply from the message being sent.
//
// A restart, not a second `thread/resume` on the running server: for a thread that is already loaded,
// the app-server rejoins it as it is and does not take new overrides. A fresh process has nothing
// loaded, so it reads the thread from disk with the new instructions.
//
// The loopback tool server outlives the restart. It belongs to this process, not Codex's, and its URL
// and token stay valid, so the new app-server is pointed at the same one and nothing is left listening.

import { homedir } from 'node:os';
import type { AppServerHandlers, AppServerProcess } from './app-server';
import type { ResolvedCodexExecutable } from './codex-executable';
import type { TurnPolicy } from './policy';
import { PROTOCOL_VERSION, type TurnRequest } from './protocol';
import type { StudioMcpServer, StudioToolBridge } from './studio-mcp';

/**
 * The name Studio's tools are registered under in Codex's MCP configuration (#854).
 */
const STUDIO_SERVER: string = 'studio';

/**
 * The environment variable the CLI reads the Studio tool server's bearer token from.
 */
export const STUDIO_TOKEN_VARIABLE: string = 'STUDIO_TOOLS_TOKEN';

/**
 * How long Codex waits on one Studio tool call, in seconds. Generous because a call may sit on the
 * user's permission prompt.
 */
const STUDIO_TOOL_TIMEOUT_SECONDS: number = 900;

/**
 * How this harness names itself to Codex, which records it against each thread.
 */
const ORIGINATOR: string = 'onixlabs_studio';

/**
 * What a {@link CodexClient} is built from: how to start each of its parts, and who hears from Codex.
 */
export interface CodexClientOptions {
  /**
   * Finds the Codex binary the user chose; `resolveCodexExecutable` outside tests.
   * @param choice The `codexExecutable` setting, as Studio sent it with the turn.
   * @returns Returns the binary, or the reason none was found.
   */
  findExecutable(choice: unknown): ResolvedCodexExecutable | { readonly error: string };

  /**
   * Starts an app-server; `spawnAppServer` outside tests.
   * @param executable The Codex binary.
   * @param env The environment the server runs with.
   * @param handlers What the connection tells its owner.
   * @param onStderr Receives the server's diagnostic output, line by line.
   * @returns Returns the process.
   */
  spawn(
    executable: string,
    env: Readonly<Record<string, string>>,
    handlers: AppServerHandlers,
    onStderr: (line: string) => void,
  ): AppServerProcess;

  /**
   * Starts the loopback server that gives Codex Studio's tools; `startStudioMcpServer` outside tests.
   * @param bridge How the server reaches Studio.
   * @returns Returns the server.
   */
  startTools(bridge: StudioToolBridge): Promise<StudioMcpServer>;

  /**
   * Gets how the tool server reaches Studio.
   */
  readonly bridge: StudioToolBridge;

  /**
   * Gets the API key the CLI runs with, asked of Studio for the run that starts the server.
   * @param requestId The run.
   * @returns Returns the key, or null when the CLI has its own login or Studio holds none.
   */
  apiKey(requestId: string): Promise<string | null>;

  /**
   * Receives a notification from the current app-server.
   * @param method The method.
   * @param params The parameters.
   */
  onNotification(method: string, params: unknown): void;

  /**
   * Answers a request from the current app-server.
   * @param method The method.
   * @param params The parameters.
   * @returns Returns the answer.
   */
  onRequest(method: string, params: unknown): Promise<unknown>;

  /**
   * Learns that the current app-server stopped on its own. A server this client stops itself is not
   * reported.
   * @param error The error that stopped it, or null when it simply closed.
   */
  onLost(error: Error | null): void;

  /**
   * Learns the id of a thread this client opened, so Studio can resume it later.
   * @param requestId The run that opened it.
   * @param threadId The thread.
   */
  onSession(requestId: string, threadId: string): void;

  /**
   * Writes a diagnostic line.
   * @param message The line.
   */
  note(message: string): void;
}

/**
 * Reads a record out of an unknown value.
 * @param value The value.
 * @returns Returns the record, empty when the value is not one.
 */
function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * Describes an error for a message.
 * @param error The error.
 * @returns Returns its message.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The app-server, Studio's tool server and the thread, started on the first turn and kept across turns
 * — this harness is a `live-harness`.
 */
export class CodexClient {
  /**
   * The options the client was built with.
   */
  private readonly options: CodexClientOptions;

  /**
   * The running app-server, or null before the first turn and after it stops.
   */
  private process: AppServerProcess | null = null;

  /**
   * The server that gives Codex Studio's tools, started with the first app-server and kept for the
   * life of this process (#854).
   */
  private tools: StudioMcpServer | null = null;

  /**
   * The Codex thread, once one has been started or resumed.
   */
  private thread: string | null = null;

  /**
   * The instruction text the thread was loaded with, compared with Studio's offer on each turn (#955).
   */
  private instructions: string | null = null;

  /**
   * Whether Codex holds anything of the thread on disk: a turn on it has completed, or it was resumed
   * or forked from one that had. Until then a reload has nothing to resume, and nothing to lose.
   */
  private persisted: boolean = false;

  /**
   * The user's Codex choice from the latest turn, so a restart within a turn (a reload for new
   * instructions) starts the same binary rather than falling back to the default.
   */
  private choice: unknown = undefined;

  /**
   * The binary the running app-server was started from, or null when none is running.
   */
  private executable: string | null = null;

  /**
   * Whether the open thread lives on an app-server that has since been replaced (the user chose a
   * different Codex), so the next turn must pick it up on the new one before it runs.
   */
  private stranded: boolean = false;

  /**
   * Initializes a new instance of the {@link CodexClient} class.
   * @param options How to start each part, and who hears from Codex.
   */
  public constructor(options: CodexClientOptions) {
    this.options = options;
  }

  /**
   * Gets the running app-server, or null when none is.
   */
  public get server(): AppServerProcess | null {
    return this.process;
  }

  /**
   * Gets the open thread's id, or null when none is open.
   */
  public get threadId(): string | null {
    return this.thread;
  }

  /**
   * Starts the app-server and Studio's tool server, unless they are running from the binary the user
   * chose. A running server started from a different binary — the user changed Codex CLI since — is
   * replaced, and the open thread is picked up on the new one at the start of the turn (#1079).
   * @param requestId The run that needs them.
   * @param choice The `codexExecutable` setting the turn carried; the latest one when omitted.
   * @returns Returns the server, or the reason it could not start.
   */
  public async ensureServer(
    requestId: string,
    choice: unknown = this.choice,
  ): Promise<AppServerProcess | string> {
    this.choice = choice;
    const executable: ResolvedCodexExecutable | { readonly error: string } =
      this.options.findExecutable(choice);
    if ('error' in executable) {
      return this.process ?? executable.error;
    }
    if (this.process !== null) {
      if (executable.path === this.executable) {
        return this.process;
      }
      this.options.note(
        `Codex CLI changed from ${String(this.executable)} to ${executable.path}; restarting Codex.`,
      );
      this.retire();
      this.stranded = this.thread !== null;
    }
    if (executable.fallback !== undefined) {
      this.options.note(executable.fallback);
    }
    this.tools ??= await this.options.startTools(this.options.bridge);
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        env[key] = value;
      }
    }
    env[STUDIO_TOKEN_VARIABLE] = this.tools.token;
    env['CODEX_INTERNAL_ORIGINATOR_OVERRIDE'] = ORIGINATOR;
    const apiKey: string | null = await this.options.apiKey(requestId);
    if (apiKey !== null) {
      env['CODEX_API_KEY'] = apiKey;
    }
    const started: AppServerProcess = this.options.spawn(
      executable.path,
      env,
      {
        onNotification: (method: string, params: unknown): void =>
          this.options.onNotification(method, params),
        onRequest: (method: string, params: unknown): Promise<unknown> =>
          this.options.onRequest(method, params),
        onClose: (error: Error | null): void => {
          // A server this client has already let go of — restarted for new instructions, or failed
          // to initialize — is not news.
          if (this.process !== started) {
            return;
          }
          this.options.note(`app-server closed${error === null ? '' : `: ${error.message}`}`);
          this.process = null;
          this.thread = null;
          this.instructions = null;
          this.persisted = false;
          this.options.onLost(error);
        },
      },
      (line: string): void => this.options.note(`codex: ${line}`),
    );
    this.process = started;
    this.executable = executable.path;
    try {
      await started.connection.request('initialize', {
        clientInfo: {
          name: 'onixlabs-studio',
          title: 'ONIXLabs Studio',
          version: PROTOCOL_VERSION,
        },
        capabilities: { experimentalApi: true, requestAttestation: false },
      });
    } catch (error: unknown) {
      this.retire();
      // The user's own Codex may simply predate the app-server this harness drives; say which Codex
      // failed and what to do, rather than leave them to guess why a working install does not start.
      return executable.own
        ? `The Codex at ${executable.path} could not start: ${messageOf(error)}. It may be too old to ` +
            "run Studio's app-server — update it, or set Codex CLI to Bundled in Settings › AI."
        : `Codex could not start: ${messageOf(error)}`;
    }
    return started;
  }

  /**
   * Opens the thread on the first turn — a new one, or the persisted one the envelope names, resumed
   * or forked — and on later turns, reloads it when Studio's instructions have changed (#955).
   *
   * ⚠️ Called at the start of a turn, before `turn/start`, so a reload never lands mid-turn.
   * @param turn The turn envelope.
   * @param policy The turn's confinement.
   * @param instructions Studio's instructions as offered for this turn.
   * @returns Returns the thread id.
   */
  public async ensureThread(
    turn: TurnRequest,
    policy: TurnPolicy,
    instructions: string,
  ): Promise<string> {
    if (this.thread !== null && this.stranded) {
      // The server was replaced for a different Codex. A thread with a completed turn is resumed on the
      // new one; one with nothing on disk yet has nothing to resume, so a fresh one replaces it.
      this.stranded = false;
      return this.persisted
        ? this.reload(this.thread, turn, policy, instructions, false)
        : this.open(turn, policy, instructions, 'thread/start');
    }
    if (this.thread !== null) {
      if (this.instructions === instructions) {
        return this.thread;
      }
      if (this.persisted) {
        return this.reload(this.thread, turn, policy, instructions);
      }
      // No turn on this thread has completed, so Codex has nothing of it to resume — and the user has
      // nothing in it to keep. A fresh thread with the new text replaces it.
      this.options.note(
        `Studio's instructions changed before thread ${this.thread} had a completed turn; starting ` +
          'a fresh thread with them.',
      );
      return this.open(turn, policy, instructions, 'thread/start');
    }
    return this.open(
      turn,
      policy,
      instructions,
      turn.resumeSessionId === null
        ? 'thread/start'
        : turn.forkSession
          ? 'thread/fork'
          : 'thread/resume',
    );
  }

  /**
   * Records that a turn on the open thread completed, so Codex now holds it on disk and a reload must
   * resume it rather than replace it.
   */
  public turnCompleted(): void {
    if (this.thread !== null) {
      this.persisted = true;
    }
  }

  /**
   * Stops the app-server and the tool server, for good.
   */
  public close(): void {
    this.retire();
    this.tools?.close();
    this.tools = null;
  }

  /**
   * Opens a thread and reports it to Studio as the session.
   * @param turn The turn envelope.
   * @param policy The turn's confinement.
   * @param instructions Studio's instructions.
   * @param method How to open it: fresh, or from the persisted thread the envelope names.
   * @returns Returns the thread id.
   */
  private async open(
    turn: TurnRequest,
    policy: TurnPolicy,
    instructions: string,
    method: 'thread/start' | 'thread/resume' | 'thread/fork',
  ): Promise<string> {
    const server: AppServerProcess = await this.serverFor(turn.requestId);
    const common: Record<string, unknown> = this.threadParams(turn, policy, instructions);
    const params: Record<string, unknown> =
      method === 'thread/start' ? common : { ...common, threadId: turn.resumeSessionId };
    const response: Record<string, unknown> = record(
      await server.connection.request(method, params),
    );
    const id: unknown = record(response['thread'])['id'];
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('Codex did not name the thread it started.');
    }
    this.thread = id;
    this.instructions = instructions;
    this.persisted = method !== 'thread/start';
    this.options.onSession(turn.requestId, id);
    return id;
  }

  /**
   * Restarts the app-server and resumes the same thread with new instructions (#955).
   *
   * ⛔ Never falls back to a fresh thread: once a turn has completed, that would drop the conversation
   * without a word. A failed resume fails the turn, and the thread is kept so the next turn tries again.
   * @param id The thread.
   * @param turn The turn envelope.
   * @param policy The turn's confinement.
   * @param instructions The new instructions.
   * @param restart Whether to restart the app-server first (new instructions), or resume on the one
   * already running (it was just started from a different Codex).
   * @returns Returns the thread id, unchanged.
   */
  private async reload(
    id: string,
    turn: TurnRequest,
    policy: TurnPolicy,
    instructions: string,
    restart: boolean = true,
  ): Promise<string> {
    if (restart) {
      this.options.note(
        `Studio's instructions changed since thread ${id} was opened; restarting Codex and resuming ` +
          'the thread with them.',
      );
      this.retire();
    }
    const server: AppServerProcess = await this.serverFor(turn.requestId);
    let resumed: unknown;
    try {
      const response: Record<string, unknown> = record(
        await server.connection.request('thread/resume', {
          ...this.threadParams(turn, policy, instructions),
          threadId: id,
        }),
      );
      resumed = record(response['thread'])['id'];
    } catch (error: unknown) {
      throw new Error(
        `Codex could not pick the conversation back up with the updated instructions: ${messageOf(error)}`,
        { cause: error },
      );
    }
    if (resumed !== id) {
      throw new Error(
        `Codex resumed a different conversation (${String(resumed)}) rather than ${id}.`,
      );
    }
    this.instructions = instructions;
    return id;
  }

  /**
   * Starts the app-server if it is not running, throwing when it cannot start.
   * @param requestId The run that needs it.
   * @returns Returns the server.
   */
  private async serverFor(requestId: string): Promise<AppServerProcess> {
    const started: AppServerProcess | string = await this.ensureServer(requestId);
    if (typeof started === 'string') {
      throw new Error(started);
    }
    return started;
  }

  /**
   * Stops the app-server this client holds, without reporting it lost. The thread id is kept: the
   * thread is persisted by Codex, and is what the next server resumes.
   */
  private retire(): void {
    const stopping: AppServerProcess | null = this.process;
    this.process = null;
    this.executable = null;
    stopping?.stop();
  }

  /**
   * Builds the parameters a thread is opened with.
   * @param turn The turn envelope.
   * @param policy The turn's confinement.
   * @param instructions Studio's instructions.
   * @returns Returns the parameters.
   */
  private threadParams(
    turn: TurnRequest,
    policy: TurnPolicy,
    instructions: string,
  ): Record<string, unknown> {
    return {
      ...(turn.model.length > 0 ? { model: turn.model } : {}),
      cwd: turn.workspaceRoot ?? homedir(),
      approvalPolicy: policy.approvalPolicy,
      sandbox: policy.sandbox,
      config: this.threadConfig(policy),
      ...(instructions.length > 0 ? { developerInstructions: instructions } : {}),
    };
  }

  /**
   * Builds the thread configuration Codex is given: Studio's tools, and the notices Studio turns off.
   * @param policy The turn's confinement.
   * @returns Returns the configuration.
   */
  private threadConfig(policy: TurnPolicy): Record<string, unknown> {
    return {
      // Carried over from the SDK days: with an under-development feature enabled in the user's own
      // config, the CLI's warning reached the transcript joined onto the model's reply (#541).
      suppress_unstable_features_warning: true,
      mcp_servers: {
        [STUDIO_SERVER]: {
          url: this.tools!.url,
          bearer_token_env_var: STUDIO_TOKEN_VARIABLE,
          tool_timeout_sec: STUDIO_TOOL_TIMEOUT_SECONDS,
          // Codex's own approval is waived for Studio's tools, because Studio applies the user's
          // per-tool policy and raises the permission prompt itself.
          default_tools_approval_mode: 'approve',
        },
      },
      ...(policy.webSearch === 'disabled' ? { web_search: 'disabled' } : {}),
    };
  }
}
