// Translating the Agent SDK's message stream into Studio's transcript events.
//
// 🔑 There is no second vocabulary here. Studio's `AiEvent` is a serialisable union its transcript
// already renders, and a harness emits those events unchanged — so what this file does is *read* the
// SDK, never invent an output format. That is the single biggest reason the protocol was tractable,
// and it is why this file is a translation rather than a design.

import type {
  SDKMessage,
  SDKTaskNotificationMessage,
  SDKTaskProgressMessage,
  SDKTaskStartedMessage,
  SDKTaskUpdatedMessage,
  SlashCommand,
} from '@anthropic-ai/claude-agent-sdk';
import { formatToolInput, formatToolOutput, prettyToolName, summarizeToolInput } from './format';

/**
 * Where translated events go, and what they are attributed to.
 *
 * ⚠️ `requestId` and `agentSessionId` are read per event rather than captured, because a live session
 * runs many turns through one translator and a session-scoped event — a settled background task, a
 * discovered command — must carry the turn that is current when it *arrives*, not the one that was
 * current when the session opened.
 */
export interface EventSink {
  /**
   * Gets the run the event belongs to.
   */
  readonly requestId: () => string;

  /**
   * Gets the conversation the event belongs to, for the session-scoped kinds.
   */
  readonly agentSessionId: () => string | null;

  /**
   * Emits one of Studio's transcript events.
   * @param event The event.
   */
  readonly emit: (event: Record<string, unknown>) => void;
}

/**
 * A loosely-typed content block from an SDK message, covering the fields read here.
 */
interface ContentBlock {
  readonly type: string;
  readonly text?: string;
  readonly thinking?: string;
  readonly id?: string;
  readonly name?: string;
  readonly input?: Record<string, unknown>;
  readonly tool_use_id?: string;
  readonly is_error?: boolean;
  readonly content?: unknown;
}

/**
 * The token counts an SDK message or terminal result carries.
 *
 * A single message's counts are a true snapshot of one model round-trip; the terminal result's are
 * the turn's cumulative billing total, summed across every round-trip. Confusing the two is the whole
 * subject of {@link handleResult}.
 */
interface TokenUsage {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly cache_read_input_tokens?: number;
  readonly cache_creation_input_tokens?: number;
}

/**
 * Per-turn state threaded through the message loop: the last cumulative cost reported, so each result
 * carries only its own turn's delta, and the last top-level assistant usage, which is the true
 * context-occupancy snapshot the meter reads instead of the inflated result aggregate.
 */
export interface UsageState {
  lastCostUsd: number;
  lastAssistantUsage: TokenUsage | null;
}

/**
 * Creates the per-session usage state.
 * @returns Returns a fresh usage state.
 */
export function newUsageState(): UsageState {
  return { lastCostUsd: 0, lastAssistantUsage: null };
}

/**
 * Reads the session id an SDK message carries, or null when it has none.
 * @param message The SDK message.
 * @returns Returns the session id, or null.
 */
export function sessionIdOf(message: SDKMessage): string | null {
  const value: unknown = (message as { session_id?: unknown }).session_id;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Reads the sub-agent attribution an SDK message carries: the id of the Task tool use it belongs to,
 * or null for a top-level message.
 * @param message The SDK message.
 * @returns Returns the parent tool use id, or null.
 */
function parentToolIdOf(message: SDKMessage): string | null {
  const value: unknown = (message as { parent_tool_use_id?: unknown }).parent_tool_use_id;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Reads the token usage an assistant message carries.
 * @param message The SDK message.
 * @returns Returns the usage, or undefined.
 */
function usageOf(message: SDKMessage): TokenUsage | undefined {
  return (message as { message?: { usage?: TokenUsage } }).message?.usage;
}

/**
 * Sums the input side of a usage snapshot: fresh input plus cached and cache-creation tokens — the
 * whole context the model processed at that round-trip, which is the figure that reflects occupancy.
 * @param usage The usage snapshot.
 * @returns Returns the total input tokens.
 */
function contextInputOf(usage: TokenUsage): number {
  return (
    (usage.input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0)
  );
}

/**
 * Emits reasoning, text and tool-start events for an assistant message's content blocks.
 *
 * A Task tool use additionally carries its `subagent_type`, so the renderer can label the sub-agent's
 * lane rather than showing an opaque delegation.
 * @param sink Where the events go.
 * @param blocks The content blocks.
 * @param parent The sub-agent the message belongs to, or null for top-level.
 * @param uuid The SDK message uuid text chunks carry — the branch anchor — or null when absent.
 */
function handleAssistantBlocks(
  sink: EventSink,
  blocks: readonly ContentBlock[],
  parent: string | null,
  uuid: string | null,
): void {
  const requestId: string = sink.requestId();
  const attribution: { parentToolId?: string } = parent === null ? {} : { parentToolId: parent };
  for (const block of blocks) {
    if (block.type === 'text' && typeof block.text === 'string') {
      sink.emit({
        requestId,
        kind: 'text',
        delta: block.text,
        ...(uuid === null ? {} : { messageUuid: uuid }),
        ...attribution,
      });
    } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
      sink.emit({ requestId, kind: 'thinking', delta: block.thinking, ...attribution });
    } else if (block.type === 'tool_use' && typeof block.id === 'string') {
      const agentType: unknown = block.input?.['subagent_type'];
      const input: string | undefined = formatToolInput(block.input);
      sink.emit({
        requestId,
        kind: 'tool-start',
        toolId: block.id,
        name: prettyToolName(block.name ?? 'tool'),
        detail: summarizeToolInput(block.input),
        ...(input === undefined ? {} : { input }),
        ...attribution,
        ...(typeof agentType === 'string' && agentType.length > 0 ? { agentType } : {}),
      });
    }
  }
}

/**
 * Emits tool-end events for the tool-result blocks a user message carries.
 * @param sink Where the events go.
 * @param message The user SDK message.
 * @param parent The sub-agent the message belongs to, or null.
 */
function handleToolResults(sink: EventSink, message: SDKMessage, parent: string | null): void {
  const content: unknown = (message as { message?: { content?: unknown } }).message?.content;
  if (!Array.isArray(content)) {
    return;
  }
  const requestId: string = sink.requestId();
  for (const block of content as readonly ContentBlock[]) {
    if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
      const output: string | undefined = formatToolOutput(block.content);
      sink.emit({
        requestId,
        kind: 'tool-end',
        toolId: block.tool_use_id,
        ok: block.is_error !== true,
        detail: block.is_error === true ? 'failed' : 'done',
        ...(output === undefined ? {} : { output }),
        ...(parent === null ? {} : { parentToolId: parent }),
      });
    }
  }
}

/**
 * Emits the terminal result's usage: this turn's cost delta, and the context-window occupancy.
 *
 * 🔥 The subtlety worth keeping. The result's own `usage` is the turn's **cumulative** billing total,
 * summed across every internal round-trip of the agentic loop — and each round-trip re-reads the
 * growing conversation as cached input, so a tool-heavy turn sums those re-reads into a figure many
 * times the true context size. Feeding it to the meter shows near-full for a small conversation.
 *
 * Cost accumulates the same way, and there accumulation is *correct*. So cost comes from
 * `total_cost_usd`, while the meter is fed the **last top-level assistant message's** usage — a true
 * snapshot of the window at the final round-trip. The result aggregate is the fallback only when the
 * turn produced no assistant message at all, a degenerate case where it is not inflated.
 * @param sink Where the events go.
 * @param message The result SDK message.
 * @param usage The per-session usage state.
 */
function handleResult(sink: EventSink, message: SDKMessage, usage: UsageState): void {
  const result: { usage?: TokenUsage; total_cost_usd?: number } = message as never;
  const occupancy: TokenUsage | undefined = usage.lastAssistantUsage ?? result.usage;
  if (occupancy === undefined) {
    return;
  }
  // The reported cost is cumulative across the session's turns; emit this turn's delta so the
  // renderer's accumulating readout never double-counts a steered turn.
  let costUsd: number | null = null;
  if (typeof result.total_cost_usd === 'number') {
    costUsd =
      result.total_cost_usd >= usage.lastCostUsd
        ? result.total_cost_usd - usage.lastCostUsd
        : result.total_cost_usd;
    usage.lastCostUsd = result.total_cost_usd;
  }
  sink.emit({
    requestId: sink.requestId(),
    kind: 'usage',
    inputTokens: contextInputOf(occupancy),
    outputTokens: occupancy.output_tokens ?? 0,
    costUsd,
  });
}

/**
 * Translates one SDK message into transcript events.
 * @param sink Where the events go.
 * @param message The SDK message.
 * @param usage The per-session usage state.
 */
export function translate(sink: EventSink, message: SDKMessage, usage: UsageState): void {
  const parent: string | null = parentToolIdOf(message);
  if (message.type === 'assistant') {
    const uuid: unknown = (message as { uuid?: unknown }).uuid;
    handleAssistantBlocks(
      sink,
      message.message.content as readonly ContentBlock[],
      parent,
      typeof uuid === 'string' && uuid.length > 0 ? uuid : null,
    );
    // A sub-agent's tokens belong to its own lane, so they are reported separately and never folded
    // into the run's context meter — the sub-agent has a window of its own.
    if (parent !== null) {
      const subagent: TokenUsage | undefined = usageOf(message);
      if (subagent !== undefined) {
        sink.emit({
          requestId: sink.requestId(),
          kind: 'usage',
          parentToolId: parent,
          inputTokens: contextInputOf(subagent),
          outputTokens: subagent.output_tokens ?? 0,
          costUsd: null,
        });
      }
    } else {
      // A top-level assistant message's usage is a true snapshot of the context at that round-trip;
      // keep the latest so the terminal result can report it as the window occupancy.
      const own: TokenUsage | undefined = usageOf(message);
      if (own !== undefined) {
        usage.lastAssistantUsage = own;
      }
    }
  } else if (message.type === 'user') {
    handleToolResults(sink, message, parent);
  } else if (message.type === 'result') {
    handleResult(sink, message, usage);
  }
}

/**
 * Emits a discovered slash-command set.
 *
 * Session-scoped: it carries the conversation id, so the renderer can attribute it even when it
 * arrives between turns.
 * @param sink Where the events go.
 * @param commands The SDK slash commands.
 */
export function emitCommands(sink: EventSink, commands: readonly SlashCommand[]): void {
  sink.emit({
    requestId: sink.requestId(),
    kind: 'commands',
    agentSessionId: sink.agentSessionId(),
    commands: commands.map(
      (command: SlashCommand): { name: string; description: string; argumentHint: string } => ({
        name: command.name,
        description: command.description,
        argumentHint: command.argumentHint,
      }),
    ),
  });
}

/**
 * Emits a started background task.
 * @param sink Where the events go.
 * @param message The SDK task-started message.
 */
export function emitTaskStarted(sink: EventSink, message: SDKTaskStartedMessage): void {
  sink.emit({
    requestId: sink.requestId(),
    kind: 'task-started',
    agentSessionId: sink.agentSessionId(),
    taskId: message.task_id,
    description: message.description,
    ...(message.tool_use_id === undefined ? {} : { toolId: message.tool_use_id }),
    ...(message.subagent_type === undefined ? {} : { agentType: message.subagent_type }),
    ...(message.task_type === undefined ? {} : { taskType: message.task_type }),
    ...(message.workflow_name === undefined ? {} : { workflowName: message.workflow_name }),
    ...(message.skip_transcript === undefined ? {} : { skipTranscript: message.skip_transcript }),
  });
}

/**
 * Emits a running task's progress.
 * @param sink Where the events go.
 * @param message The SDK task-progress message.
 */
export function emitTaskProgress(sink: EventSink, message: SDKTaskProgressMessage): void {
  sink.emit({
    requestId: sink.requestId(),
    kind: 'task-progress',
    agentSessionId: sink.agentSessionId(),
    taskId: message.task_id,
    description: message.description,
    ...(message.last_tool_name === undefined ? {} : { lastToolName: message.last_tool_name }),
    tokens: message.usage.total_tokens,
    toolUses: message.usage.tool_uses,
    durationMs: message.usage.duration_ms,
  });
}

/**
 * Emits a task's state patch.
 *
 * ⚠️ A patch, not a whole task: it carries only the fields that changed, so everything absent from the
 * patch is absent from the event too and consumers merge it into their own task map.
 * @param sink Where the events go.
 * @param message The SDK task-updated message.
 */
export function emitTaskUpdated(sink: EventSink, message: SDKTaskUpdatedMessage): void {
  const patch: SDKTaskUpdatedMessage['patch'] = message.patch;
  sink.emit({
    requestId: sink.requestId(),
    kind: 'task-updated',
    agentSessionId: sink.agentSessionId(),
    taskId: message.task_id,
    ...(patch.status === undefined ? {} : { status: patch.status }),
    ...(patch.description === undefined ? {} : { description: patch.description }),
    ...(patch.error === undefined ? {} : { error: patch.error }),
    ...(patch.is_backgrounded === undefined ? {} : { backgrounded: patch.is_backgrounded }),
    ...(patch.end_time === undefined ? {} : { endTime: patch.end_time }),
  });
}

/**
 * Emits a settled background task.
 * @param sink Where the events go.
 * @param message The SDK task-notification message.
 */
export function emitBackgroundTask(sink: EventSink, message: SDKTaskNotificationMessage): void {
  sink.emit({
    requestId: sink.requestId(),
    kind: 'background-task',
    agentSessionId: sink.agentSessionId(),
    taskId: message.task_id,
    status: message.status,
    summary: message.summary,
    outputFile: message.output_file,
    ...(message.tool_use_id === undefined ? {} : { toolId: message.tool_use_id }),
    ...(message.skip_transcript === undefined ? {} : { skipTranscript: message.skip_transcript }),
  });
}

/**
 * Emits a message a remote peer typed, so it appears in Studio's transcript too.
 *
 * Without this, a turn driven from claude.ai would produce a reply in Studio with nothing to say what
 * prompted it — and, more importantly, nothing for the renderer to adopt, so the permission prompts
 * that turn raises would have no conversation to appear in.
 * @param sink Where the events go.
 * @param text The peer's message.
 */
export function emitRemoteMessage(sink: EventSink, text: string): void {
  sink.emit({
    requestId: sink.requestId(),
    kind: 'remote-message',
    agentSessionId: sink.agentSessionId(),
    text,
  });
}

/**
 * Emits a terminal status for a turn nothing is awaiting.
 *
 * ⚠️ Only for an **unawaited** turn. A turn Studio dispatched settles through `turn.completed` and the
 * manager emits its own status; emitting one here as well would race it.
 * @param sink Where the events go.
 * @param state Whether the turn finished or was cut short.
 */
export function emitStatus(sink: EventSink, state: 'completed' | 'aborted'): void {
  sink.emit({ requestId: sink.requestId(), kind: 'status', state, detail: '' });
}
