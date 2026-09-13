// One Claude conversation, held open across turns.
//
// This is the port of `ClaudeAgentSession`, and it is where `live-harness` stops being a label. The
// SDK query is opened once with a streaming input, and every turn pushes a message into that stream
// rather than starting a new query — which is what lets turn two know about turn one without Studio
// replaying anything, and what lets a backgrounded task report back long after the turn that launched
// it has ended.
//
// Three things follow from holding it open, and each one is a hazard the in-core session learned the
// hard way:
//
//   - **a turn's `result` settles that turn and leaves the stream open.** The pump does not break on
//     it. The stream ends only when the input closes.
//   - **not every turn is one Studio asked for.** A peer on claude.ai can drive one, and the CLI
//     starts one of its own when a backgrounded task settles. Those have no run awaiting them, so if
//     their completion is not emitted explicitly the renderer that adopted them spins forever.
//   - **the stream can end underneath an adopted turn.** Then no `result` is ever coming, and the
//     same spinner problem appears with nothing at all to settle it.

import { basename } from 'node:path';
import { homedir } from 'node:os';
import type {
  Options,
  Query,
  SDKMessage,
  SDKTaskNotificationMessage,
  SDKTaskProgressMessage,
  SDKTaskStartedMessage,
  SDKTaskUpdatedMessage,
  SDKUserMessage,
  SlashCommand,
} from '@anthropic-ai/claude-agent-sdk';
import {
  emitBackgroundTask,
  emitCommands,
  emitRemoteMessage,
  emitStatus,
  emitTaskProgress,
  emitTaskStarted,
  emitTaskUpdated,
  newUsageState,
  sessionIdOf,
  translate,
  type EventSink,
  type UsageState,
} from './events';
import { hasLocalLogin } from './environment';
import { note } from './log';
import { buildOptions, type GateContext } from './options';
import type { Answer, HarnessMessage, Request, StudioTool, TurnRequest } from './protocol';
import { RemoteControlBridge, type AttachMode } from './remote-control';
import { createStudioToolServer, type ToolBridge } from './tools';

/**
 * A task the session has seen start and not yet seen settle, so a panic stop knows what to stop.
 */
interface LiveTask {
  description: string;
  readonly toolId?: string;
}

/**
 * What the session needs from the process's message loop.
 */
export interface Host {
  /**
   * Sends one protocol message to Studio.
   * @param message The message.
   */
  send(message: HarnessMessage): void;

  /**
   * Asks Studio a blocking question.
   * @param requestId The run the question belongs to.
   * @param request The question.
   * @returns Returns the answer, and a way to withdraw the question when something else answers it.
   */
  ask(
    requestId: string,
    request: Request,
  ): { readonly answer: Promise<Answer>; readonly withdraw: () => void };
}

/**
 * Builds a plain-text user message for the streaming input.
 * @param value The message text.
 * @returns Returns the SDK user message.
 */
function userMessage(value: string): SDKUserMessage {
  return { type: 'user', message: { role: 'user', content: value }, parent_tool_use_id: null };
}

/**
 * Assembles the prompt from the envelope's attachments and the user's text.
 *
 * ⚠️ Reproduced from Studio's `buildRunPrompt` rather than imported: it is string assembly over fields
 * the envelope already carries, and a harness that shares code with Studio is a harness that cannot be
 * extracted. Kept identical so an attached file reads the same whichever provider runs it.
 * @param turn The turn envelope.
 * @returns Returns the assembled prompt.
 */
export function promptFor(turn: TurnRequest): string {
  const sections: string[] = [];
  const paths: readonly { path: string; kind: string }[] = turn.contextPaths.filter(
    (reference: { kind: string }): boolean => reference.kind !== 'selection',
  );
  if (paths.length > 0) {
    const lines: string = paths
      .map(
        (reference: { path: string; kind: string }): string =>
          ` - ${reference.path} (${reference.kind})`,
      )
      .join('\n');
    sections.push(
      'The user attached the following context. Read the files and explore the folders with your ' +
        `file tools (Read, Glob, Grep) as needed to answer:\n${lines}`,
    );
  }
  for (const reference of turn.contextPaths) {
    if (
      reference.kind === 'selection' &&
      typeof reference.content === 'string' &&
      reference.content.length > 0
    ) {
      sections.push(
        `The user attached this editor selection (${reference.path}):\n"""\n${reference.content}\n"""`,
      );
    }
  }
  sections.push(turn.prompt);
  return sections.join('\n\n');
}

/**
 * A Claude conversation held open across turns.
 */
export class Session {
  /**
   * Holds the turn currently running, which the gate, the audit hook and the event sink all read.
   */
  private current: TurnRequest;

  /**
   * Holds the model bound at open, so a later turn that changes it applies the change live.
   */
  private appliedModel: string | null = null;

  /**
   * Holds the SDK query once opened.
   */
  private query: Query | null = null;

  /**
   * Holds the master abort controller, which teardown trips.
   */
  private controller: AbortController | null = null;

  /**
   * Holds the messages queued for the streaming input.
   */
  private readonly pending: SDKUserMessage[] = [];

  /**
   * Wakes the prompt generator when a message is queued.
   */
  private wake: (() => void) | null = null;

  /**
   * Holds whether the input has closed, after which no turn can be dispatched.
   */
  private inputClosed: boolean = false;

  /**
   * Holds the session id the SDK reported, so it is announced once.
   */
  private reportedSessionId: string | null = null;

  /**
   * Holds the cost and occupancy state threaded through the message loop.
   */
  private readonly usage: UsageState = newUsageState();

  /**
   * Holds the tasks seen to start and not yet seen to settle.
   */
  private readonly liveTasks: Map<string, LiveTask> = new Map<string, LiveTask>();

  /**
   * Holds the pump, so teardown can wait for it.
   */
  private pumpDone: Promise<void> | null = null;

  /**
   * Settles the turn Studio is awaiting, or null when nothing is.
   */
  private settle: (() => void) | null = null;

  /**
   * Fails the turn Studio is awaiting, or null when nothing is.
   */
  private fail: ((error: string) => void) | null = null;

  /**
   * Holds whether the session has been closed.
   */
  private closed: boolean = false;

  /**
   * Holds the open claude.ai bridge, or null.
   */
  private bridge: RemoteControlBridge | null = null;

  /**
   * Holds the mode the bridge is aimed at, so a repeat aim is a no-op.
   */
  private bridgeMode: 'off' | 'mirror' | 'control' = 'off';

  /**
   * Counts bridge opens, so one that finishes opening after the aim moved on is discarded.
   */
  private bridgeSeq: number = 0;

  /**
   * Holds whether the renderer has adopted a turn no Studio run is awaiting — one a peer drove, or
   * one the CLI started when a background task settled. It decides whether the pump owes that turn a
   * terminal status.
   */
  private adopted: boolean = false;

  /**
   * Nudges the CLI to re-list Studio's tools, because the offer is per-turn.
   */
  private readonly refreshTools: () => void;

  /**
   * Holds the SDK options, built once from the opening turn.
   */
  private options: Options | null = null;

  /**
   * Holds the MCP server exposing Studio's tools.
   */
  private readonly studio: ReturnType<typeof createStudioToolServer>;

  /**
   * Holds where translated events go.
   */
  private readonly sink: EventSink;

  /**
   * Initialises a new instance of the {@link Session} class.
   * @param host How to reach Studio.
   * @param opening The turn the session opens for.
   */
  public constructor(
    private readonly host: Host,
    opening: TurnRequest,
  ) {
    this.current = opening;
    this.sink = {
      requestId: (): string => this.current.requestId,
      agentSessionId: (): string | null => this.current.agentSessionId,
      emit: (event: Record<string, unknown>): void => host.send({ type: 'event', event }),
    };
    const bridge: ToolBridge = {
      describe: async (): Promise<{ tools: readonly StudioTool[]; systemPrompt: string }> => {
        const answer: Answer = await this.askStudio({
          kind: 'tools',
          // ⛔ This harness has its own clarifying-question tool — the model's built-in
          // `AskUserQuestion` — so Studio's is left out. Two ways to ask, described differently, is
          // worse than one.
          omit: ['ask_user'],
        });
        return answer.kind === 'tools'
          ? { tools: answer.tools, systemPrompt: answer.systemPrompt }
          : { tools: [], systemPrompt: '' };
      },
      invoke: async (
        name: string,
        input: unknown,
      ): Promise<{ result: string | null; error: string | null }> => {
        const answer: Answer = await this.askStudio({ kind: 'tool', name, input });
        return answer.kind === 'tool'
          ? { result: answer.result, error: answer.error }
          : { result: null, error: 'Studio refused to run the tool.' };
      },
    };
    this.studio = createStudioToolServer(bridge);
    this.refreshTools = this.studio.refresh;
  }

  /**
   * Gets the session id the SDK reported, or null before it has.
   */
  public get sessionId(): string | null {
    return this.reportedSessionId;
  }

  /**
   * Runs one turn, settling when the SDK reports its result.
   * @param turn The turn envelope.
   */
  public async run(turn: TurnRequest): Promise<void> {
    this.current = turn;
    // A Studio run is awaiting this turn, so it owns the terminal status from here: whatever the
    // renderer had adopted before is no longer what its spinner is waiting on.
    this.adopted = false;
    if (this.inputClosed) {
      this.host.send({
        type: 'turn.failed',
        requestId: turn.requestId,
        error: 'The Claude session has ended.',
      });
      return;
    }
    try {
      if (this.query === null) {
        await this.open(turn);
        this.appliedModel = turn.model;
      } else {
        if (turn.model !== this.appliedModel) {
          // The query's model was bound at open, so a later turn applies the change live rather than
          // forcing a reopen that would lose the conversation.
          this.appliedModel = turn.model;
          void this.query.setModel(turn.model);
        }
        // The offer depends on the turn, so ask the CLI to re-read it.
        this.refreshTools();
      }
    } catch (error: unknown) {
      this.host.send({
        type: 'turn.failed',
        requestId: turn.requestId,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    // Aim remote control at this turn's mode, like the live model change above: the bridge attaches
    // claude.ai-side, so a toggle lands on the held-open session rather than waiting for a reopen
    // that never comes.
    this.setRemoteControl(turn.remoteControl);
    this.pending.push(this.turnMessage(turn));
    this.wake?.();
    return new Promise<void>((resolve: () => void): void => {
      this.settle = (): void => {
        this.settle = null;
        this.fail = null;
        this.host.send({
          type: 'turn.completed',
          requestId: turn.requestId,
          sessionId: this.reportedSessionId,
        });
        resolve();
      };
      this.fail = (error: string): void => {
        this.settle = null;
        this.fail = null;
        this.host.send({ type: 'turn.failed', requestId: turn.requestId, error });
        resolve();
      };
    });
  }

  /**
   * Injects a message into the running turn, as a follow-up input.
   * @param text The message to inject.
   */
  public steer(text: string): void {
    if (this.inputClosed) {
      return;
    }
    this.pending.push(userMessage(text));
    this.wake?.();
  }

  /**
   * Interrupts the in-flight turn, leaving the session open for the next one.
   *
   * The SDK ends the turn and emits a `result`, which the pump uses to settle it. The `.then`/`.catch`
   * is a safety net for an interrupt that produces no result — at which point the query is idle
   * awaiting the next input, so settling cannot interleave with a live turn.
   */
  public interrupt(): void {
    const query: Query | null = this.query;
    if (query === null) {
      return;
    }
    void query
      .interrupt()
      .then((): void => this.settleTurn())
      .catch((): void => this.settleTurn());
  }

  /**
   * Stops a task running in the background.
   *
   * Best-effort: the query may have ended, or the task may have settled between the user pressing
   * Stop and this arriving. Nothing is emitted — the task settles through the ordinary lifecycle
   * events, which is the only account of it that can be right.
   * @param taskId The task to stop.
   */
  public stopTask(taskId: string): void {
    const query: Query | null = this.query;
    if (query === null) {
      return;
    }
    void query.stopTask(taskId).catch((error: unknown): void => {
      note(`session: stopping task ${taskId} failed: ${String(error)}`);
    });
  }

  /**
   * Stops everything at once: every live background task, then the turn in flight.
   *
   * ⚠️ Studio escalates past this. If the turns have not settled within its grace period it closes the
   * transport, which kills this process and with it whatever was wedged — so this does not need to
   * guarantee anything, only to try the graceful path first.
   */
  public panic(): void {
    note(`session: panic stop, ${this.liveTasks.size} live task(s)`);
    for (const taskId of [...this.liveTasks.keys()]) {
      this.stopTask(taskId);
    }
    this.interrupt();
  }

  /**
   * Aims the session's remote-control exposure at a mode, in place.
   *
   * Landing on the live session — even mid-turn — is the point: a held-open harness never reopens
   * between turns, so a binding that only took effect at open would leave the toggle dangling
   * forever. A repeat of the current aim is a no-op; anything unrecognised aims off.
   * @param mode The mode to aim at.
   */
  public setRemoteControl(mode: 'off' | 'mirror' | 'control'): void {
    const target: 'off' | 'mirror' | 'control' =
      mode === 'mirror' || mode === 'control' ? mode : 'off';
    if (this.closed || target === this.bridgeMode) {
      return;
    }
    note(`session: re-aiming remote control '${this.bridgeMode}' -> '${target}'`);
    // A mode change needs a fresh attach, so any existing exposure ends first either way.
    this.bridge?.close();
    this.bridge = null;
    this.bridgeMode = target;
    if (target !== 'off') {
      this.openBridge(target);
    }
  }

  /**
   * Ends the session and the query behind it. Idempotent.
   * @returns Returns a promise that resolves once the pump has finished.
   */
  public async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.inputClosed = true;
    this.bridge?.close();
    this.bridge = null;
    this.bridgeMode = 'off';
    this.controller?.abort();
    this.wake?.();
    await this.pumpDone?.catch((): undefined => undefined);
  }

  /**
   * Asks Studio a question and waits for the answer, discarding the withdrawal handle.
   *
   * Used for the questions nothing races — the tool round-trips and the credential — where there is
   * no second answerer to withdraw for.
   * @param request The question.
   * @returns Returns the answer.
   */
  private askStudio(request: Request): Promise<Answer> {
    return this.host.ask(this.current.requestId, request).answer;
  }

  /**
   * Opens the SDK query and starts the pump.
   * @param turn The opening turn.
   */
  private async open(turn: TurnRequest): Promise<void> {
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    this.controller = new AbortController();
    // Asked before the query opens because the system prompt is a structural option: the instructions
    // describe the tools, and both are settled for the session at this point.
    const offer: { tools: readonly StudioTool[]; systemPrompt: string } =
      await this.describeOffer();
    const gate: GateContext = {
      getTurn: (): TurnRequest => this.current,
      getBridge: (): RemoteControlBridge | null => this.bridge,
      askPermission: (
        requestId: string,
        name: string,
        detail: string,
      ): { granted: Promise<boolean>; withdraw: () => void } => {
        const asked: { answer: Promise<Answer>; withdraw: () => void } = this.host.ask(requestId, {
          kind: 'permission',
          name,
          detail,
        });
        return {
          granted: asked.answer.then(
            (answer: Answer): boolean => answer.kind === 'permission' && answer.granted,
          ),
          withdraw: asked.withdraw,
        };
      },
      askInput: (
        requestId: string,
        question: string,
        choices: readonly { label: string; description?: string }[],
      ): { answer: Promise<string | null>; withdraw: () => void } => {
        const asked: { answer: Promise<Answer>; withdraw: () => void } = this.host.ask(requestId, {
          kind: 'input',
          question,
          choices,
        });
        return {
          answer: asked.answer.then((answer: Answer): string | null =>
            answer.kind === 'input' ? answer.answer : null,
          ),
          withdraw: asked.withdraw,
        };
      },
      audit: (requestId: string, name: string, detail: string, source: string): void =>
        this.host.send({ type: 'audit', requestId, name, detail, source }),
    };
    this.options = buildOptions(
      gate,
      turn,
      this.studio.config,
      offer.systemPrompt,
      await this.credential(turn),
      this.controller,
    );
    this.query = query({ prompt: this.promptStream(), options: this.options });
    this.pumpDone = this.pump();
    // Discover the session's slash commands once it is open; refreshed later by the
    // `commands_changed` push the pump handles. Best-effort — a failure never disturbs the session.
    void this.discoverCommands();
  }

  /**
   * Asks Studio for its tools and instructions for the opening turn.
   * @returns Returns the offer.
   */
  private async describeOffer(): Promise<{
    tools: readonly StudioTool[];
    systemPrompt: string;
  }> {
    const answer: Answer = await this.askStudio({ kind: 'tools', omit: ['ask_user'] });
    return answer.kind === 'tools'
      ? { tools: answer.tools, systemPrompt: answer.systemPrompt }
      : { tools: [], systemPrompt: '' };
  }

  /**
   * Obtains the API key for a run that needs one, or null when the local login authenticates it.
   *
   * ⛔ Asked only when there is no local login, which is the credential round-trip working as
   * designed: a secret never rides the turn envelope, and a harness that did not need one never
   * receives one. Studio's own `authFor` can return a key even for a local-login connection, and this
   * harness has no business being handed it.
   * @param turn The opening turn.
   * @returns Returns the key, or null.
   */
  private async credential(turn: TurnRequest): Promise<string | null> {
    if (hasLocalLogin(homedir())) {
      return null;
    }
    const answer: Answer = await this.host.ask(turn.requestId, { kind: 'credential' }).answer;
    return answer.kind === 'credential' ? answer.apiKey : null;
  }

  /**
   * Builds a turn's initial user message: the prompt, with any attached images ahead of the text.
   *
   * Steered follow-ups are text-only, which is why this is separate from {@link userMessage}.
   * @param turn The turn envelope.
   * @returns Returns the SDK user message.
   */
  private turnMessage(turn: TurnRequest): SDKUserMessage {
    const prompt: string = promptFor(turn);
    if (turn.images.length === 0) {
      return userMessage(prompt);
    }
    return {
      type: 'user',
      message: {
        role: 'user',
        content: [
          ...turn.images.map(
            (image: {
              mediaType: string;
              data: string;
            }): {
              type: 'image';
              source: { type: 'base64'; media_type: string; data: string };
            } => ({
              type: 'image',
              source: { type: 'base64', media_type: image.mediaType, data: image.data },
            }),
          ),
          { type: 'text', text: prompt },
        ],
      } as SDKUserMessage['message'],
      parent_tool_use_id: null,
    };
  }

  /**
   * The streaming-input generator: yields queued messages, then parks until the next one arrives or
   * the input closes.
   * @returns Yields the session's user messages.
   */
  private async *promptStream(): AsyncGenerator<SDKUserMessage> {
    while (true) {
      const next: SDKUserMessage | undefined = this.pending.shift();
      if (next !== undefined) {
        yield next;
        continue;
      }
      if (this.inputClosed) {
        return;
      }
      await new Promise<void>((resolve: () => void): void => {
        this.wake = resolve;
      });
      this.wake = null;
    }
  }

  /**
   * Fetches the session's slash commands and publishes them.
   */
  private async discoverCommands(): Promise<void> {
    const query: Query | null = this.query;
    if (query === null) {
      return;
    }
    try {
      const commands: readonly SlashCommand[] = await query.supportedCommands();
      emitCommands(this.sink, commands);
    } catch (error: unknown) {
      note(`session: slash command discovery failed: ${String(error)}`);
    }
  }

  /**
   * Opens the claude.ai bridge, asynchronously.
   *
   * Best-effort: any failure leaves the turn untouched and the session simply unbridged.
   * @param mode How the session is exposed.
   */
  private openBridge(mode: AttachMode): void {
    const seq: number = (this.bridgeSeq += 1);
    const cwd: string = this.current.workspaceRoot ?? homedir();
    void RemoteControlBridge.open({
      mode,
      title: `ONIXLabs Studio — ${basename(cwd)}`,
      cwd,
      model: this.current.model,
      onInbound: (text: string): void => {
        if (this.inputClosed) {
          return;
        }
        // Echo the peer's message into Studio's transcript and let the renderer adopt the turn, so the
        // response — and any prompts it raises — render in Studio too, not only on the remote device.
        emitRemoteMessage(this.sink, text);
        this.adopted = true;
        this.pending.push(userMessage(text));
        this.wake?.();
      },
    }).then((bridge: RemoteControlBridge | null): void => {
      if (bridge === null) {
        return;
      }
      // The session may have closed, or the aim may have moved on, while this was opening. A stale
      // bridge is discarded rather than installed.
      if (this.closed || seq !== this.bridgeSeq || this.bridgeMode !== mode) {
        bridge.close();
        return;
      }
      this.bridge = bridge;
    });
  }

  /**
   * Handles the SDK's system messages about background tasks, keeping the live registry in step.
   * @param message The SDK message.
   * @param subtype Its subtype.
   */
  private handleTaskMessage(message: SDKMessage, subtype: string): void {
    switch (subtype) {
      case 'task_started': {
        const started: SDKTaskStartedMessage = message as SDKTaskStartedMessage;
        this.liveTasks.set(started.task_id, {
          description: started.description,
          ...(started.tool_use_id === undefined ? {} : { toolId: started.tool_use_id }),
        });
        emitTaskStarted(this.sink, started);
        break;
      }
      case 'task_progress': {
        const progress: SDKTaskProgressMessage = message as SDKTaskProgressMessage;
        const entry: LiveTask | undefined = this.liveTasks.get(progress.task_id);
        if (entry !== undefined) {
          entry.description = progress.description;
        }
        emitTaskProgress(this.sink, progress);
        break;
      }
      case 'task_updated': {
        const updated: SDKTaskUpdatedMessage = message as SDKTaskUpdatedMessage;
        // A backgrounded task also settles via `task_notification`, but one that ends in the
        // foreground is only ever reported here — so terminal states must prune from this path too.
        const status: string | undefined = updated.patch.status;
        if (status === 'completed' || status === 'failed' || status === 'killed') {
          this.liveTasks.delete(updated.task_id);
        }
        emitTaskUpdated(this.sink, updated);
        break;
      }
      case 'task_notification': {
        const settled: SDKTaskNotificationMessage = message as SDKTaskNotificationMessage;
        // Pruned before emitting, so a consumer reacting to the settle never observes a stale live
        // entry for a task that has just finished.
        this.liveTasks.delete(settled.task_id);
        emitBackgroundTask(this.sink, settled);
        // The CLI answers a settled task with a report-back turn of its own, which the renderer
        // adopts; nothing in Studio awaits it, so the pump owes it a terminal status.
        this.adopted = true;
        break;
      }
      default:
        break;
    }
  }

  /**
   * Consumes the SDK message stream for the session's life.
   *
   * ⛔ It does **not** break on `result`. A result settles the in-flight turn and leaves the stream
   * open for the next one; the stream ends only when the input closes.
   */
  private async pump(): Promise<void> {
    const query: Query | null = this.query;
    if (query === null) {
      return;
    }
    // Whether a Studio run was awaiting the in-flight turn when the stream ended; null until known.
    let unawaitedAtEnd: boolean | null = null;
    try {
      for await (const message of query) {
        const sessionId: string | null = sessionIdOf(message);
        if (sessionId !== null && sessionId !== this.reportedSessionId) {
          this.reportedSessionId = sessionId;
          this.sink.emit({ requestId: this.current.requestId, kind: 'session', sessionId });
        }
        const system: { type?: string; subtype?: string; commands?: SlashCommand[] } = message;
        if (system.type === 'system') {
          // A mid-session command-list change — skills discovered as the agent works.
          // `supportedCommands()` is captured once at init and never reflects these, so the push is
          // the only live signal.
          if (system.subtype === 'commands_changed' && Array.isArray(system.commands)) {
            emitCommands(this.sink, system.commands);
          }
          if (system.subtype !== undefined) {
            this.handleTaskMessage(message, system.subtype);
          }
        }
        translate(this.sink, message, this.usage);
        // Mirror to claude.ai when bridged. Best-effort.
        this.bridge?.forward(message);
        if (message.type === 'result' && this.pending.length === 0) {
          // A Studio-initiated turn is awaited by a run, which emits the terminal status that clears
          // the renderer's spinner. A turn nothing is awaiting has no run behind it, so unless its
          // completion is emitted here the renderer that adopted it spins forever. Two kinds reach
          // this branch: a turn a peer drove, and a turn the CLI started when a background task
          // settled. A stray unawaited result with nothing adopted is harmless — the renderer's
          // per-turn filter drops a status it is not expecting.
          const unawaited: boolean = this.settle === null;
          this.settleTurn();
          this.adopted = false;
          if (unawaited) {
            emitStatus(this.sink, 'completed');
          }
        }
      }
    } catch (error: unknown) {
      // Read BEFORE settling: the settle below clears it, and the finally block needs the answer.
      unawaitedAtEnd = this.settle === null;
      if (this.closed) {
        // A deliberate teardown: end any in-flight turn as settled rather than failed.
        this.settleTurn();
      } else {
        note(`session: the turn stream failed: ${String(error)}`);
        this.failTurn(error instanceof Error ? error.message : String(error));
      }
    } finally {
      // The stream has ended, so the session cannot take another turn. Marking the input closed stops
      // a stray later turn parking forever on a pump that has exited.
      this.inputClosed = true;
      unawaitedAtEnd ??= this.settle === null;
      this.settleTurn();
      // The stream ended under a turn the renderer had adopted that no run is awaiting: no result
      // will ever emit its terminal status now, so without this it spins "Working" forever.
      //
      // ⚠️ Both conditions are load-bearing. Unawaited alone is not enough: a transient session closes
      // the moment its own awaited turn settles, so the stream always ends unawaited there — and this
      // abort would reach the renderer ahead of the run's own completion, claiming a stop that never
      // happened.
      if (unawaitedAtEnd && this.adopted) {
        emitStatus(this.sink, 'aborted');
      }
    }
  }

  /**
   * Settles the turn Studio is awaiting, if any.
   */
  private settleTurn(): void {
    const settle: (() => void) | null = this.settle;
    this.settle = null;
    this.fail = null;
    settle?.();
  }

  /**
   * Fails the turn Studio is awaiting, if any.
   * @param error Why it failed.
   */
  private failTurn(error: string): void {
    const fail: ((error: string) => void) | null = this.fail;
    this.settle = null;
    this.fail = null;
    fail?.(error);
  }
}
