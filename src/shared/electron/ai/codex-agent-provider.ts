import { homedir } from 'node:os';
import type {
  CodexOptions,
  Input,
  ThreadEvent,
  ThreadItem,
  ThreadOptions,
  Usage,
} from '@openai/codex-sdk';
import type { AiModelInfo, AiProviderId } from '@shared/api/ai-types';
import type {
  AgentAuth,
  AgentProvider,
  AgentRunContext,
  AgentSession,
  AgentSessionModel,
  ProviderAvailability,
} from './agent-provider';
import { resolveBundledCodexExecutable } from './codex-executable';
import { buildRunPrompt } from './studio-tools';

/**
 * The completed stream a Codex turn produces: an async iterator of thread events. Declared narrowly
 * (rather than importing the SDK's classes, which carry private members) so a session can be driven by a
 * fake client in tests.
 */
interface CodexTurnStream {
  readonly events: AsyncGenerator<ThreadEvent>;
}

/**
 * A Codex conversation thread — the live session. Each {@link runStreamed} is one turn that resumes the
 * persisted thread; the {@link id} is populated once the thread starts.
 */
interface CodexThread {
  readonly id: string | null;
  runStreamed(input: Input, turnOptions?: { signal?: AbortSignal }): Promise<CodexTurnStream>;
}

/**
 * The Codex client used to start or resume a thread. The real `Codex` instance satisfies this shape.
 */
interface CodexClient {
  startThread(options?: ThreadOptions): CodexThread;
  resumeThread(id: string, options?: ThreadOptions): CodexThread;
}

/**
 * The provider capabilities a {@link CodexAgentSession} borrows, passed as bound callbacks so the
 * session reuses the provider's logic (and tests can substitute a fake Codex client) without depending
 * on its private members.
 */
export interface CodexSessionDeps {
  /**
   * Creates the Codex client for the session's thread, from the options built for its opening context.
   * Async because the SDK is ESM-only and loaded with a dynamic `import()`.
   */
  createClient(options: CodexOptions): Promise<CodexClient>;

  /**
   * Builds the Codex client options (executable override, credential) from the opening context.
   */
  buildClientOptions(context: AgentRunContext): CodexOptions;

  /**
   * Builds the Codex thread options (model, sandbox, working directory, extra roots) from the opening
   * context. Bound once when the thread opens.
   */
  buildThreadOptions(context: AgentRunContext): ThreadOptions;
}

/**
 * The OpenAI Codex implementation of {@link AgentProvider} — the second live-harness (#324/#329),
 * proving the seam is not Claude-specific. It drives the Codex agent through `@openai/codex-sdk`: a
 * {@link CodexAgentSession} holds a Codex `Thread` and runs each turn into it (resuming the persisted
 * thread), translating the SDK's event stream into the shared transcript protocol.
 *
 * Unlike the Claude path, the Codex SDK exposes no per-tool permission callback: confinement is enforced
 * by the harness sandbox (`sandboxMode: 'workspace-write'` scoped to the workspace root plus the user's
 * allowed write paths — Decision 5), not by an interactive gate. So Studio's per-tool prompts, deny
 * list, and audit log do not apply to Codex; the sandbox is the boundary. Reasoning-effort selection and
 * the capability declaration that surfaces it land with the capability epic (#330).
 */
export class CodexAgentProvider implements AgentProvider {
  /**
   * Gets the provider's stable identifier.
   */
  public readonly id: AiProviderId = 'codex';

  /**
   * Gets the provider's human-readable label.
   */
  public readonly label: string = 'OpenAI Codex';

  /**
   * Gets the models Codex can run a turn with, in display order.
   */
  public readonly models: readonly AiModelInfo[];

  /**
   * Gets the identifier of Codex's default model.
   */
  public readonly defaultModelId: string;

  /**
   * Gets a value indicating whether the provider accepts image input. Codex takes images only as local
   * file paths, not the base64 data Studio holds, so image input is not offered in this phase.
   */
  public readonly supportsImages: boolean = false;

  /**
   * Gets the session model: Codex is a live-harness (an external agentic runtime driven as a subprocess),
   * so its turns run in a held-open {@link AgentSession}. Each turn resumes the persisted thread rather
   * than holding one subprocess open, so a Codex session has no process to reap between turns.
   */
  public readonly sessionModel: AgentSessionModel = 'live-harness';

  /**
   * Initialises a new instance of the {@link CodexAgentProvider} class.
   * @param models The models the connection offers, in display order.
   * @param defaultModelId The identifier of the connection's default model.
   */
  public constructor(models: readonly AiModelInfo[], defaultModelId: string) {
    this.models = models;
    this.defaultModelId = defaultModelId;
  }

  /**
   * Reports whether Codex can run: a local Codex login or an API key is enough.
   * @param auth The resolved credential material.
   * @returns Returns the availability descriptor.
   */
  public describeAvailability(auth: AgentAuth): ProviderAvailability {
    if (auth.hasCodexLogin) {
      return { available: true, detail: 'Using your local Codex login.' };
    }
    if (auth.apiKey !== null) {
      return { available: true, detail: 'Using your OpenAI API key.' };
    }
    return { available: false, detail: 'Run `codex login`, or add an OpenAI API key.' };
  }

  /**
   * Runs a single turn through Codex. A transient run: opens a session, runs this one turn into it, then
   * closes it. The persistent path (holding the session across turns, #327) drives the same
   * {@link CodexAgentSession} through {@link openSession}/{@link AgentSession.turn}.
   * @param context The run context.
   */
  public async run(context: AgentRunContext): Promise<void> {
    const session: CodexAgentSession = this.openSession(context);
    try {
      await session.turn(context);
    } finally {
      await session.close();
    }
  }

  /**
   * Opens a live Codex session for one agent (#324/#329): it holds a Codex thread and runs each
   * {@link AgentSession.turn} into it.
   * @param context The context of the turn the session opens for.
   * @returns Returns the live session.
   */
  public openSession(context: AgentRunContext): CodexAgentSession {
    return new CodexAgentSession(
      {
        createClient: async (options: CodexOptions): Promise<CodexClient> => {
          const { Codex } = await import('@openai/codex-sdk');
          return new Codex(options);
        },
        buildClientOptions: (ctx: AgentRunContext): CodexOptions => this.buildClientOptions(ctx),
        buildThreadOptions: (ctx: AgentRunContext): ThreadOptions => this.buildThreadOptions(ctx),
      },
      context,
    );
  }

  /**
   * Builds the Codex client options from a run context: the bundled executable path (packaged builds)
   * and an explicit API key when the run is not using the local Codex login. `baseUrl` is left to the
   * Codex default, and the process environment (hydrated from the login shell at startup) is inherited.
   * @param context The run context.
   * @returns Returns the client options.
   */
  private buildClientOptions(context: AgentRunContext): CodexOptions {
    const options: CodexOptions = {};
    const executable: string | undefined = resolveBundledCodexExecutable();
    if (executable !== undefined) {
      options.codexPathOverride = executable;
    }
    const auth: AgentAuth = context.auth;
    if (!auth.hasCodexLogin && auth.apiKey !== null) {
      options.apiKey = auth.apiKey;
    }
    return options;
  }

  /**
   * Builds the Codex thread options from a run context, enforcing confinement through the sandbox: a
   * chat-mode run is read-only; an agent run may write, but only within the workspace root (the working
   * directory) plus the user's allowed write paths — a fixed boundary the agent cannot widen. The git
   * repo check is skipped because a Studio workspace is not necessarily a git repository.
   * @param context The run context.
   * @returns Returns the thread options.
   */
  private buildThreadOptions(context: AgentRunContext): ThreadOptions {
    const readOnly: boolean = context.mode === 'chat';
    const options: ThreadOptions = {
      model: context.model,
      sandboxMode: readOnly ? 'read-only' : 'workspace-write',
      workingDirectory: context.workspaceRoot ?? homedir(),
      approvalPolicy: 'never',
      skipGitRepoCheck: true,
    };
    if (context.allowedWritePaths.length > 0) {
      options.additionalDirectories = [...context.allowedWritePaths];
    }
    return options;
  }
}

/**
 * A live Codex session for one agent (#324/#329): it holds a Codex `Thread` across turns, so a
 * conversation keeps its context (the SDK resumes the persisted thread each turn). Each {@link turn}
 * pushes the prompt into a new streamed turn on the same thread and settles when that turn completes;
 * {@link interrupt} aborts the current turn but keeps the thread; {@link close} ends the session (there
 * is no persistent subprocess — each turn's `codex exec` ends with the turn).
 *
 * The thread is opened lazily on the first turn. Its options (model, sandbox, working directory) are
 * bound at open; a later turn that changes the model is not applied live (the SDK has no per-thread
 * model swap), so a model change takes effect on the next fresh session — the live-session router reopens
 * the session when a frozen routing field changes.
 */
export class CodexAgentSession implements AgentSession {
  /**
   * The context of the turn currently in flight; swapped on each {@link turn}.
   */
  private currentContext: AgentRunContext;

  /**
   * The Codex client, or null before the first turn opens it.
   */
  private client: CodexClient | null = null;

  /**
   * The open Codex thread, or null before the first turn opens it.
   */
  private thread: CodexThread | null = null;

  /**
   * The thread id last reported to the renderer, so the session event is emitted once (and again if it
   * changes).
   */
  private reportedThreadId: string | null = null;

  /**
   * The current turn's abort controller (aborting it cancels the turn but keeps the thread), or null
   * when no turn is running.
   */
  private activeController: AbortController | null = null;

  /**
   * Whether {@link close} has run (idempotent teardown).
   */
  private closed: boolean = false;

  /**
   * Initialises a new instance of the {@link CodexAgentSession} class.
   * @param deps The provider capabilities the session borrows.
   * @param initialContext The context of the turn the session opens for.
   */
  public constructor(
    private readonly deps: CodexSessionDeps,
    initialContext: AgentRunContext,
  ) {
    this.currentContext = initialContext;
  }

  /**
   * Gets the Codex thread id once a turn has reported it, or null before.
   */
  public get id(): string | null {
    return this.reportedThreadId;
  }

  /**
   * Runs a turn in this session, streaming its events through the context and settling when the turn
   * completes — leaving the thread open for the next turn. Opens the thread lazily on the first turn.
   * @param context The turn's context.
   */
  public async turn(context: AgentRunContext): Promise<void> {
    this.currentContext = context;
    if (this.thread === null) {
      await this.openThread(context);
    }
    const controller: AbortController = new AbortController();
    this.activeController = controller;
    // Aborting the turn's signal (the Stop button, a timeout) cancels this turn but keeps the thread
    // live for the next turn (Decision 4). The session is torn down only by {@link close}.
    const onAbort: () => void = (): void => controller.abort();
    context.signal.addEventListener('abort', onAbort, { once: true });
    // Tracks how much of each streamed text/reasoning item has already been emitted, so updates emit
    // only the new suffix as a delta.
    const emitted: Map<string, number> = new Map<string, number>();
    try {
      const stream: CodexTurnStream = await this.thread!.runStreamed(this.buildInput(context), {
        signal: controller.signal,
      });
      for await (const event of stream.events) {
        this.handleEvent(event, context, emitted);
      }
    } catch (error: unknown) {
      // A cancelled turn (Stop/timeout) settles as a stopped turn — the manager reads the run's aborted
      // signal and lands it as such; any other error rejects so the manager lands it as an error.
      if (!controller.signal.aborted) {
        throw error instanceof Error ? error : new Error(String(error));
      }
    } finally {
      context.signal.removeEventListener('abort', onAbort);
      this.activeController = null;
    }
  }

  /**
   * Interrupts the in-flight turn (cancels its `codex exec`), leaving the thread open for the next turn.
   */
  public interrupt(): void {
    this.activeController?.abort();
  }

  /**
   * Ends the session. There is no held-open subprocess to terminate — each turn's process ends with the
   * turn — so this cancels any in-flight turn and marks the session closed. Idempotent.
   */
  public close(): Promise<void> {
    this.closed = true;
    this.activeController?.abort();
    return Promise.resolve();
  }

  /**
   * Opens the Codex thread lazily on the first turn, building the client and thread options from that
   * turn's context. A turn carrying a `resumeSessionId` resumes the persisted thread (cold-start /
   * post-reap reopen, #328); otherwise a fresh thread is started.
   * @param context The opening turn's context.
   */
  private async openThread(context: AgentRunContext): Promise<void> {
    const client: CodexClient = await this.deps.createClient(this.deps.buildClientOptions(context));
    this.client = client;
    const options: ThreadOptions = this.deps.buildThreadOptions(context);
    this.thread =
      context.resumeSessionId !== null
        ? client.resumeThread(context.resumeSessionId, options)
        : client.startThread(options);
  }

  /**
   * Builds a turn's input: the run prompt (with any attached context references), as text. Images are
   * not sent (the provider does not offer image input on this path).
   * @param context The turn's context.
   * @returns Returns the Codex input.
   */
  private buildInput(context: AgentRunContext): Input {
    return buildRunPrompt(context);
  }

  /**
   * Translates one Codex thread event into transcript events emitted through the turn's context.
   * @param event The thread event.
   * @param context The turn's context to emit through.
   * @param emitted The per-item emitted-text lengths (for streaming deltas).
   */
  private handleEvent(
    event: ThreadEvent,
    context: AgentRunContext,
    emitted: Map<string, number>,
  ): void {
    switch (event.type) {
      case 'thread.started':
        this.reportThread(event.thread_id, context);
        break;
      case 'item.started':
      case 'item.updated':
      case 'item.completed':
        this.handleItem(event.item, event.type === 'item.completed', context, emitted);
        break;
      case 'turn.completed':
        this.emitUsage(event.usage, context);
        break;
      case 'turn.failed':
        throw new Error(event.error.message);
      case 'error':
        throw new Error(event.message);
      // turn.started carries no transcript content.
    }
  }

  /**
   * Emits the session event when the thread id is first known (or changes).
   * @param threadId The thread id.
   * @param context The turn's context.
   */
  private reportThread(threadId: string, context: AgentRunContext): void {
    if (threadId.length === 0 || threadId === this.reportedThreadId) {
      return;
    }
    this.reportedThreadId = threadId;
    context.emit({ requestId: context.requestId, kind: 'session', sessionId: threadId });
  }

  /**
   * Emits transcript events for one thread item: assistant text and reasoning stream as deltas; command,
   * file-change, MCP, and web-search items map to tool start/end events.
   * @param item The thread item.
   * @param completed Whether the item has reached its terminal state.
   * @param context The turn's context to emit through.
   * @param emitted The per-item emitted-text lengths (for streaming deltas).
   */
  private handleItem(
    item: ThreadItem,
    completed: boolean,
    context: AgentRunContext,
    emitted: Map<string, number>,
  ): void {
    switch (item.type) {
      case 'agent_message':
        this.emitTextDelta(item.id, item.text, 'text', context, emitted);
        break;
      case 'reasoning':
        this.emitTextDelta(item.id, item.text, 'thinking', context, emitted);
        break;
      case 'command_execution':
        if (completed) {
          this.emitToolEnd(item.id, item.status === 'completed', item.aggregated_output, context);
        } else {
          this.emitToolStart(item.id, 'Shell', item.command, context);
        }
        break;
      case 'file_change':
        if (completed) {
          this.emitToolEnd(item.id, item.status === 'completed', undefined, context);
        } else {
          const detail: string = item.changes
            .map((change: { path: string; kind: string }): string => `${change.kind} ${change.path}`)
            .join(', ');
          this.emitToolStart(item.id, 'Edit', detail, context);
        }
        break;
      case 'mcp_tool_call':
        if (completed) {
          this.emitToolEnd(item.id, item.error === undefined, undefined, context);
        } else {
          this.emitToolStart(item.id, `${item.server} / ${item.tool}`, item.tool, context);
        }
        break;
      case 'web_search':
        if (completed) {
          this.emitToolEnd(item.id, true, undefined, context);
        } else {
          this.emitToolStart(item.id, 'Web search', item.query, context);
        }
        break;
      case 'error':
        if (completed) {
          context.emit({ requestId: context.requestId, kind: 'text', delta: item.message });
        }
        break;
      // todo_list carries no transcript content in this phase.
    }
  }

  /**
   * Emits the new suffix of a streamed text or reasoning item as a delta.
   * @param itemId The item id (the streaming key).
   * @param text The item's full text so far.
   * @param kind The transcript kind to emit.
   * @param context The turn's context to emit through.
   * @param emitted The per-item emitted-text lengths.
   */
  private emitTextDelta(
    itemId: string,
    text: string,
    kind: 'text' | 'thinking',
    context: AgentRunContext,
    emitted: Map<string, number>,
  ): void {
    const already: number = emitted.get(itemId) ?? 0;
    if (text.length <= already) {
      return;
    }
    const delta: string = text.slice(already);
    emitted.set(itemId, text.length);
    context.emit({ requestId: context.requestId, kind, delta });
  }

  /**
   * Emits a tool-start event.
   * @param toolId The tool use id.
   * @param name The tool display name.
   * @param detail A one-line summary.
   * @param context The turn's context to emit through.
   */
  private emitToolStart(
    toolId: string,
    name: string,
    detail: string,
    context: AgentRunContext,
  ): void {
    context.emit({ requestId: context.requestId, kind: 'tool-start', toolId, name, detail });
  }

  /**
   * Emits a tool-end event.
   * @param toolId The tool use id.
   * @param ok Whether the tool succeeded.
   * @param output The tool output, or undefined when none.
   * @param context The turn's context to emit through.
   */
  private emitToolEnd(
    toolId: string,
    ok: boolean,
    output: string | undefined,
    context: AgentRunContext,
  ): void {
    context.emit({
      requestId: context.requestId,
      kind: 'tool-end',
      toolId,
      ok,
      detail: ok ? 'done' : 'failed',
      ...(output === undefined || output.length === 0 ? {} : { output }),
    });
  }

  /**
   * Emits the turn's token usage as the context-window occupancy (Codex reports no cost).
   * @param usage The turn usage, or null when the turn reported none.
   * @param context The turn's context to emit through.
   */
  private emitUsage(usage: Usage | null, context: AgentRunContext): void {
    if (usage === null) {
      return;
    }
    context.emit({
      requestId: context.requestId,
      kind: 'usage',
      inputTokens: usage.input_tokens + usage.cached_input_tokens,
      outputTokens: usage.output_tokens + usage.reasoning_output_tokens,
      costUsd: null,
    });
  }
}
