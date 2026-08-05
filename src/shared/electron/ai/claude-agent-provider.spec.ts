import { beforeEach, describe, it, expect, vi } from 'vitest';
import type {
  Options,
  PermissionResult,
  Query,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { AiEvent, AiModelInfo } from '@shared/api/ai-types';
import type { AgentAuth, AgentRunContext } from './agent-provider';
import { ClaudeAgentProvider, ClaudeAgentSession, type SessionDeps } from './claude-agent-provider';
import type { ClaudeSdkModel } from './claude-model-discovery';

// The real `buildRunOptions` (exercised below) dynamically imports the node-only Agent SDK for its tool
// builders, which the test runner cannot load; stub them to trivial factories. Only the SDK is mocked —
// it is imported by no other spec, so the mock cannot leak into another file's module graph. Electron is
// deliberately NOT mocked (a global `electron` mock leaks across the shared worker and breaks unrelated
// renderer specs); the bundled-executable resolver reads `app.isPackaged`, which is a benign
// undefined under the test runner, so it returns undefined without touching a packaged path. The
// multi-turn session tests drive a fake query instead, through the `createQuery` seam.
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  tool: (): object => ({}),
  createSdkMcpServer: (): object => ({}),
}));

/**
 * Flushes pending microtasks/timers so the session's background pump and input drain make progress
 * between test steps.
 * @returns Resolves on the next macrotask tick.
 */
function flush(): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 0);
  });
}

/**
 * A stand-in for the SDK `Query`: an async-iterable message stream the test drives (`emit`), plus the
 * control methods the session calls (`interrupt`, `setModel`). It drains the session's streaming input
 * so a pushed turn message clears `pendingMessages` (letting a `result` settle the turn), and ends the
 * stream when the session's master abort controller fires (so `close()` completes).
 */
class FakeQuery {
  public interruptCount: number = 0;
  public readonly setModelCalls: (string | undefined)[] = [];
  private readonly outbox: unknown[] = [];
  private wake: (() => void) | null = null;
  private ended: boolean = false;

  public constructor(prompt: AsyncGenerator<SDKUserMessage>, options: Options) {
    void this.drain(prompt);
    options.abortController?.signal.addEventListener('abort', (): void => this.endStream());
  }

  /**
   * Emits a message to the stream, waking the pump if it is parked.
   * @param message The SDK message to yield.
   */
  public emit(message: unknown): void {
    this.outbox.push(message);
    this.wake?.();
    this.wake = null;
  }

  /**
   * Ends the stream (the async iterator returns), so the pump loop exits.
   */
  public endStream(): void {
    this.ended = true;
    this.wake?.();
    this.wake = null;
  }

  public interrupt(): Promise<void> {
    this.interruptCount += 1;
    return Promise.resolve();
  }

  public setModel(model?: string): Promise<void> {
    this.setModelCalls.push(model);
    return Promise.resolve();
  }

  public commands: { name: string; description: string; argumentHint: string }[] = [];

  public supportedCommands(): Promise<
    { name: string; description: string; argumentHint: string }[]
  > {
    return Promise.resolve(this.commands);
  }

  public async *[Symbol.asyncIterator](): AsyncGenerator<unknown> {
    while (true) {
      const next: unknown = this.outbox.shift();
      if (next !== undefined) {
        yield next;
        continue;
      }
      if (this.ended) {
        return;
      }
      await new Promise<void>((resolve: () => void): void => {
        this.wake = resolve;
      });
    }
  }

  /**
   * Consumes the session's streaming input so each turn's pushed message clears `pendingMessages`.
   * @param prompt The session's input generator.
   */
  private async drain(prompt: AsyncGenerator<SDKUserMessage>): Promise<void> {
    // Pull and discard each input message (the fake stream is driven by `emit`, not by echoing input).
    while (!(await prompt.next()).done) {
      // No body: draining clears the session's pendingMessages so a `result` can settle the turn.
    }
  }
}

/**
 * The harness a session multi-turn test drives: the session under test, the fake query it opened, the
 * count of `createQuery` calls (proving the query is reused across turns), and the events the turns
 * emitted.
 */
interface SessionHarness {
  readonly session: ClaudeAgentSession;
  readonly events: AiEvent[];
  query(): FakeQuery | null;
  createQueryCalls(): number;
}

/**
 * A turn context for the session tests, carrying only the fields the session reads (request id, model,
 * abort signal, prompt, and the emit/steer seams).
 * @param requestId The turn's request id.
 * @param model The turn's model.
 * @param signal The turn's abort signal.
 * @param events The array turn events are pushed to.
 * @returns Returns the turn context.
 */
function turnCtx(
  requestId: string,
  model: string,
  signal: AbortSignal,
  events: AiEvent[],
): AgentRunContext {
  return {
    requestId,
    model,
    signal,
    prompt: 'hello',
    images: [],
    contextPaths: [],
    emit: (event: AiEvent): void => void events.push(event),
    setSteerHandler: (): void => {
      // No-op: the session tests do not steer.
    },
  } as unknown as AgentRunContext;
}

/**
 * Builds a session wired to a {@link FakeQuery}: `buildRunOptions` returns options carrying the master
 * abort controller (so the fake query can end on close); `handleMessage` emits a usage event through
 * the CURRENT turn's context on each `result` (so a test can prove the pump feeds the swapped context);
 * `sessionIdOf` reads `session_id`.
 * @param initial The opening turn context.
 * @returns Returns the harness.
 */
function makeSession(initial: AgentRunContext): SessionHarness {
  const events: AiEvent[] = [];
  let fakeQuery: FakeQuery | null = null;
  let createQueryCalls: number = 0;
  const deps: SessionDeps = {
    buildRunOptions: (
      _getContext: () => AgentRunContext,
      controller: AbortController,
    ): Promise<Options> => Promise.resolve({ abortController: controller }),
    createQuery: (prompt: AsyncGenerator<SDKUserMessage>, options: Options): Promise<Query> => {
      createQueryCalls += 1;
      fakeQuery = new FakeQuery(prompt, options);
      return Promise.resolve(fakeQuery as unknown as Query);
    },
    handleMessage: (message: unknown, context: AgentRunContext): void => {
      if ((message as { type?: string }).type === 'result') {
        context.emit({
          requestId: context.requestId,
          kind: 'usage',
          inputTokens: 0,
          outputTokens: 0,
          costUsd: null,
        });
      }
    },
    sessionIdOf: (message: unknown): string | null => {
      const id: unknown = (message as { session_id?: unknown }).session_id;
      return typeof id === 'string' ? id : null;
    },
  };
  return {
    session: new ClaudeAgentSession(deps, initial),
    events,
    query: (): FakeQuery | null => fakeQuery,
    createQueryCalls: (): number => createQueryCalls,
  };
}

/**
 * A full turn context for exercising the real `buildRunOptions` gate and audit hook. Carries the frozen
 * open-time fields plus the per-turn posture/policies/permission/audit seams; overrides tailor a turn.
 * @param overrides The fields to override.
 * @returns Returns the gate context.
 */
function gateCtx(overrides: Partial<AgentRunContext>): AgentRunContext {
  return {
    requestId: 'run-1',
    workspaceRoot: '/ws',
    model: 'claude-opus-4-8',
    effort: null,
    surface: 'editor',
    mode: 'agent',
    permissionPosture: 'prompt',
    toolPolicies: {},
    allowedWritePaths: [],
    deniedWritePaths: [],
    contextPaths: [],
    tokenCap: 0,
    agentShell: null,
    resumeSessionId: null,
    resumeSessionAt: null,
    forkSession: false,
    auth: { hasLocalLogin: true, hasCodexLogin: false, apiKey: null },
    requestPermission: (): Promise<boolean> => Promise.resolve(false),
    recordAudit: (): void => {
      // No-op default; tests that assert auditing override this.
    },
    ...overrides,
  } as unknown as AgentRunContext;
}

/**
 * The per-run usage state threaded through the message loop (private to the provider; redeclared here
 * so the tests can seed and inspect it).
 */
interface UsageState {
  lastCostUsd: number;
  lastAssistantUsage: unknown;
}

/**
 * The provider internals the tests drive. `handleMessage` is private; it is the entry point the run
 * loop feeds each SDK message to.
 */
interface Internals {
  handleMessage(message: unknown, context: AgentRunContext, state: UsageState): void;
}

const MODELS: readonly AiModelInfo[] = [
  { id: 'claude-opus-4-8', label: 'Opus 4.8', contextWindow: 1_000_000 },
];

describe('ClaudeAgentProvider', () => {
  let provider: ClaudeAgentProvider;
  let internals: Internals;
  let events: AiEvent[];
  let context: AgentRunContext;
  let state: UsageState;

  /**
   * Feeds an SDK message through the private message handler with the shared context and usage state.
   * @param message The SDK message to handle.
   */
  function handle(message: unknown): void {
    internals.handleMessage(message, context, state);
  }

  beforeEach(() => {
    provider = new ClaudeAgentProvider(MODELS, 'claude-opus-4-8');
    internals = provider as unknown as Internals;
    events = [];
    context = {
      requestId: 'run-1',
      emit: (event: AiEvent): void => void events.push(event),
    } as unknown as AgentRunContext;
    state = { lastCostUsd: 0, lastAssistantUsage: null };
  });

  // --- availability ---------------------------------------------------------

  it('reportsALiveHarnessSessionModel', () => {
    expect(provider.sessionModel).toBe('live-harness');
  });

  it('declaresItsEffortLevels_withoutMinimal', () => {
    expect(provider.supportedEfforts).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
  });

  it('describeAvailability_withALocalLogin_isAvailable', () => {
    const auth: AgentAuth = { hasLocalLogin: true, hasCodexLogin: false, apiKey: null };
    expect(provider.describeAvailability(auth)).toEqual({
      available: true,
      detail: 'Using your local Claude login.',
    });
  });

  it('describeAvailability_withAnApiKeyOnly_isAvailable', () => {
    const auth: AgentAuth = { hasLocalLogin: false, hasCodexLogin: false, apiKey: 'sk-x' };
    expect(provider.describeAvailability(auth).available).toBe(true);
  });

  it('describeAvailability_withNeither_isUnavailable', () => {
    const auth: AgentAuth = { hasLocalLogin: false, hasCodexLogin: false, apiKey: null };
    expect(provider.describeAvailability(auth).available).toBe(false);
  });

  // --- message translation --------------------------------------------------

  it('assistant_textBlock_emitsATextEventWithTheBranchAnchor', () => {
    handle({
      type: 'assistant',
      uuid: 'msg-1',
      parent_tool_use_id: null,
      message: { content: [{ type: 'text', text: 'Hello' }] },
    });

    expect(events).toEqual([
      { requestId: 'run-1', kind: 'text', delta: 'Hello', messageUuid: 'msg-1' },
    ]);
  });

  it('assistant_thinkingBlock_emitsAThinkingEvent', () => {
    handle({
      type: 'assistant',
      parent_tool_use_id: null,
      message: { content: [{ type: 'thinking', thinking: 'Let me think' }] },
    });

    expect(events).toEqual([{ requestId: 'run-1', kind: 'thinking', delta: 'Let me think' }]);
  });

  it('assistant_toolUseBlock_emitsAToolStart_carryingTheSubagentType', () => {
    handle({
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        content: [
          { type: 'tool_use', id: 't1', name: 'Task', input: { subagent_type: 'explorer' } },
        ],
      },
    });

    expect(events.length).toBe(1);
    const event: Record<string, unknown> = events[0] as unknown as Record<string, unknown>;
    expect(event['kind']).toBe('tool-start');
    expect(event['toolId']).toBe('t1');
    expect(event['agentType']).toBe('explorer');
  });

  it('user_toolResult_emitsAToolEnd_reflectingSuccessOrFailure', () => {
    handle({
      type: 'user',
      parent_tool_use_id: null,
      message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: false }] },
    });
    handle({
      type: 'user',
      parent_tool_use_id: null,
      message: { content: [{ type: 'tool_result', tool_use_id: 't2', is_error: true }] },
    });

    const ends: Record<string, unknown>[] = events as unknown as Record<string, unknown>[];
    expect(ends.map((e: Record<string, unknown>): unknown => e['ok'])).toEqual([true, false]);
    expect(ends[1]['detail']).toBe('failed');
  });

  // --- usage / occupancy (df8d0d3) -----------------------------------------

  it('result_reportsTheAssistantSnapshotAsOccupancy_notTheInflatedResultAggregate', () => {
    // A top-level assistant round-trip: the true window is input (1000) + cached (5000) = 6000.
    handle({
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        content: [{ type: 'text', text: 'hi' }],
        usage: { input_tokens: 1000, cache_read_input_tokens: 5000, output_tokens: 200 },
      },
    });
    events = [];

    // The result's own usage is the cumulative cross-round-trip total (millions); it must be ignored.
    handle({
      type: 'result',
      usage: { input_tokens: 900_000, output_tokens: 40_000 },
      total_cost_usd: 0.5,
    });

    expect(events.length).toBe(1);
    const usage: Record<string, unknown> = events[0] as unknown as Record<string, unknown>;
    expect(usage['kind']).toBe('usage');
    expect(usage['inputTokens']).toBe(6000);
    expect(usage['outputTokens']).toBe(200);
    expect(usage['costUsd']).toBe(0.5);
  });

  it('result_cost_isEmittedAsTheDeltaAcrossSteeredTurns', () => {
    const assistant: unknown = {
      type: 'assistant',
      parent_tool_use_id: null,
      message: { content: [{ type: 'text', text: 'x' }], usage: { input_tokens: 100 } },
    };

    handle(assistant);
    handle({ type: 'result', usage: { input_tokens: 1 }, total_cost_usd: 0.3 });
    handle(assistant);
    handle({ type: 'result', usage: { input_tokens: 1 }, total_cost_usd: 0.5 });

    const costs: unknown[] = (events as unknown as Record<string, unknown>[])
      .filter((e: Record<string, unknown>): boolean => e['kind'] === 'usage')
      .map((e: Record<string, unknown>): unknown => e['costUsd']);
    // First turn bills the full 0.3; the second bills only the 0.2 delta.
    expect(costs).toEqual([0.3, 0.2]);
  });

  it('subagentUsage_isReportedOnItsLane_andNeverTouchesTheTopLevelOccupancy', () => {
    // A sub-agent (parent set) message: its usage lands on the Task lane, not the context meter.
    handle({
      type: 'assistant',
      parent_tool_use_id: 'task-1',
      message: {
        content: [{ type: 'text', text: 'sub' }],
        usage: { input_tokens: 700, output_tokens: 30 },
      },
    });

    const usage: Record<string, unknown> | undefined = (
      events as unknown as Record<string, unknown>[]
    ).find((e: Record<string, unknown>): boolean => e['kind'] === 'usage');
    expect(usage).toBeDefined();
    expect(usage?.['parentToolId']).toBe('task-1');
    expect(usage?.['inputTokens']).toBe(700);

    // The sub-agent must not have set the top-level occupancy: a following result with no top-level
    // assistant falls back to the result's own usage, proving lastAssistantUsage was untouched.
    events = [];
    handle({ type: 'result', usage: { input_tokens: 42 }, total_cost_usd: 0 });
    const resultUsage: Record<string, unknown> = events[0] as unknown as Record<string, unknown>;
    expect(resultUsage['inputTokens']).toBe(42);
  });

  it('result_withNoPriorAssistantUsage_fallsBackToItsOwnAggregate', () => {
    handle({
      type: 'result',
      usage: { input_tokens: 10, cache_creation_input_tokens: 5, output_tokens: 3 },
      total_cost_usd: 0.1,
    });

    const usage: Record<string, unknown> = events[0] as unknown as Record<string, unknown>;
    expect(usage['inputTokens']).toBe(15);
    expect(usage['outputTokens']).toBe(3);
  });
});

describe('ClaudeAgentSession (live multi-turn)', () => {
  it('turn_opensTheQueryOnce_andReusesItAcrossTurns_withNoResume', async () => {
    const events: AiEvent[] = [];
    const c1: AbortController = new AbortController();
    const harness: SessionHarness = makeSession(
      turnCtx('run-1', 'claude-opus-4-8', c1.signal, events),
    );

    const turn1: Promise<void> = harness.session.turn(
      turnCtx('run-1', 'claude-opus-4-8', c1.signal, events),
    );
    await flush();
    harness.query()?.emit({ type: 'result', session_id: 'sess-a' });
    await turn1;

    const c2: AbortController = new AbortController();
    const turn2: Promise<void> = harness.session.turn(
      turnCtx('run-2', 'claude-opus-4-8', c2.signal, events),
    );
    await flush();
    harness.query()?.emit({ type: 'result', session_id: 'sess-a' });
    await turn2;

    // One query opened for the whole conversation (the session is held open, not resumed per turn).
    expect(harness.createQueryCalls()).toBe(1);
    // The pump fed each turn's result to the CURRENT turn's context: turn 1 emitted through run-1,
    // turn 2 through run-2 (the per-turn context indirection on the stream side).
    const usageRequestIds: unknown[] = (events as unknown as Record<string, unknown>[])
      .filter((event: Record<string, unknown>): boolean => event['kind'] === 'usage')
      .map((event: Record<string, unknown>): unknown => event['requestId']);
    expect(usageRequestIds).toEqual(['run-1', 'run-2']);

    await harness.session.close();
  });

  it('turn_appliesAModelChangeLive_butNotWhenTheModelIsUnchanged', async () => {
    const events: AiEvent[] = [];
    const signal: AbortSignal = new AbortController().signal;
    const harness: SessionHarness = makeSession(
      turnCtx('run-1', 'claude-opus-4-8', signal, events),
    );

    const turn1: Promise<void> = harness.session.turn(
      turnCtx('run-1', 'claude-opus-4-8', signal, events),
    );
    await flush();
    harness.query()?.emit({ type: 'result' });
    await turn1;

    // Turn 2 changes the model: applied live (the options' model was bound at open).
    const turn2: Promise<void> = harness.session.turn(
      turnCtx('run-2', 'claude-sonnet-5', signal, events),
    );
    await flush();
    harness.query()?.emit({ type: 'result' });
    await turn2;

    // Turn 3 keeps the same model: no redundant setModel.
    const turn3: Promise<void> = harness.session.turn(
      turnCtx('run-3', 'claude-sonnet-5', signal, events),
    );
    await flush();
    harness.query()?.emit({ type: 'result' });
    await turn3;

    expect(harness.query()?.setModelCalls).toEqual(['claude-sonnet-5']);

    await harness.session.close();
  });

  it('turn_abort_interruptsTheTurn_keepsTheSessionLive_andAFollowUpTurnRuns', async () => {
    const events: AiEvent[] = [];
    const c1: AbortController = new AbortController();
    const harness: SessionHarness = makeSession(
      turnCtx('run-1', 'claude-opus-4-8', c1.signal, events),
    );

    const turn1: Promise<void> = harness.session.turn(
      turnCtx('run-1', 'claude-opus-4-8', c1.signal, events),
    );
    await flush();
    // Stop the turn: the session interrupts it and settles the turn, without ending the stream.
    c1.abort();
    await turn1;

    expect(harness.query()?.interruptCount).toBe(1);

    // The session survived the Stop: a follow-up turn runs into the SAME query (no reopen).
    const c2: AbortController = new AbortController();
    const turn2: Promise<void> = harness.session.turn(
      turnCtx('run-2', 'claude-opus-4-8', c2.signal, events),
    );
    await flush();
    harness.query()?.emit({ type: 'result' });
    await turn2;

    expect(harness.createQueryCalls()).toBe(1);

    await harness.session.close();
  });

  it('alive_isTrueWhileHeldOpen_andFalseOnceTheStreamEndsBetweenTurns', async () => {
    const events: AiEvent[] = [];
    const c1: AbortController = new AbortController();
    const harness: SessionHarness = makeSession(
      turnCtx('run-1', 'claude-opus-4-8', c1.signal, events),
    );

    const turn1: Promise<void> = harness.session.turn(
      turnCtx('run-1', 'claude-opus-4-8', c1.signal, events),
    );
    await flush();
    harness.query()?.emit({ type: 'result', session_id: 'sess-a' });
    await turn1;

    // Idle between turns, the held-open session is still alive and can take another turn.
    expect(harness.session.alive).toBe(true);

    // The harness ends underneath the session with no turn in flight (the subprocess exited / the
    // stream closed): the pump exits and marks the session dead. The manager reads this so it reopens
    // rather than dispatching a turn that would never settle (the indefinite "Working" bug).
    harness.query()?.endStream();
    await flush();
    expect(harness.session.alive).toBe(false);

    await harness.session.close();
  });

  it('close_endsTheStream_andAbortsTheMasterController', async () => {
    const events: AiEvent[] = [];
    const signal: AbortSignal = new AbortController().signal;
    const harness: SessionHarness = makeSession(
      turnCtx('run-1', 'claude-opus-4-8', signal, events),
    );

    const turn1: Promise<void> = harness.session.turn(
      turnCtx('run-1', 'claude-opus-4-8', signal, events),
    );
    await flush();
    harness.query()?.emit({ type: 'result' });
    await turn1;

    // close() must complete (it awaits the pump, which only exits once the fake stream ends on the
    // master controller's abort) — a hang here would fail the test by timeout.
    await harness.session.close();
    expect(harness.createQueryCalls()).toBe(1);
  });

  it('publishesSlashCommands_onOpen_andRefreshesOnCommandsChanged', async () => {
    const events: AiEvent[] = [];
    const c1: AbortController = new AbortController();
    const harness: SessionHarness = makeSession(
      turnCtx('run-1', 'claude-opus-4-8', c1.signal, events),
    );

    const turn1: Promise<void> = harness.session.turn(
      turnCtx('run-1', 'claude-opus-4-8', c1.signal, events),
    );
    await flush();
    // A mid-session commands_changed push replaces the discovered set.
    harness.query()?.emit({
      type: 'system',
      subtype: 'commands_changed',
      commands: [{ name: 'review', description: 'Review the diff', argumentHint: '' }],
    });
    harness.query()?.emit({ type: 'result' });
    await turn1;

    const commandEvents: Record<string, unknown>[] = (
      events as unknown as Record<string, unknown>[]
    ).filter((event: Record<string, unknown>): boolean => event['kind'] === 'commands');
    // At least the open discovery and the push; the latest carries the pushed set.
    expect(commandEvents.length).toBeGreaterThanOrEqual(1);
    const latest: { commands: { name: string }[] } = commandEvents[
      commandEvents.length - 1
    ] as unknown as { commands: { name: string }[] };
    expect(latest.commands.map((command: { name: string }): string => command.name)).toEqual([
      'review',
    ]);

    await harness.session.close();
  });
});

describe('ClaudeAgentProvider.buildRunOptions (per-turn indirection)', () => {
  let provider: ClaudeAgentProvider;

  beforeEach(() => {
    provider = new ClaudeAgentProvider(MODELS, 'claude-opus-4-8');
    // The bundled-executable lookup reads Electron's `app`, undefined under the test runner; stub the
    // provider's own resolver so `buildRunOptions` never touches it (spying the instance method avoids a
    // leaky global `electron` mock).
    vi.spyOn(
      provider as unknown as { executableOption(): Record<string, never> },
      'executableOption',
    ).mockReturnValue({});
  });

  /**
   * Builds the options through the real `buildRunOptions` with a mutable current-context accessor.
   * @param initial The opening context.
   * @returns Returns the assembled options and a setter to swap the current context.
   */
  async function build(
    initial: AgentRunContext,
  ): Promise<{ options: Options; setCurrent: (context: AgentRunContext) => void }> {
    let current: AgentRunContext = initial;
    const options: Options = await (
      provider as unknown as {
        buildRunOptions(
          getContext: () => AgentRunContext,
          controller: AbortController,
        ): Promise<Options>;
      }
    ).buildRunOptions((): AgentRunContext => current, new AbortController());
    return {
      options,
      setCurrent: (context: AgentRunContext): void => {
        current = context;
      },
    };
  }

  it('canUseTool_routesThePermissionPromptToTheCurrentTurnsContext', async () => {
    const grantsA: string[] = [];
    const grantsB: string[] = [];
    const turnA: AgentRunContext = gateCtx({
      requestPermission: (name: string): Promise<boolean> => {
        grantsA.push(name);
        return Promise.resolve(true);
      },
    });
    const { options, setCurrent } = await build(turnA);
    const gate: NonNullable<Options['canUseTool']> = options.canUseTool!;

    const first: PermissionResult = await gate(
      'Bash',
      { command: 'ls' },
      {
        signal: new AbortController().signal,
        toolUseID: 'tool-1',
      },
    );
    expect(first.behavior).toBe('allow');
    expect(grantsA).toEqual(['Bash']);

    // Swap to a later turn whose gate denies: the prompt must go to THIS turn's requestPermission.
    setCurrent(
      gateCtx({
        requestPermission: (name: string): Promise<boolean> => {
          grantsB.push(name);
          return Promise.resolve(false);
        },
      }),
    );
    const second: PermissionResult = await gate(
      'Bash',
      { command: 'ls' },
      {
        signal: new AbortController().signal,
        toolUseID: 'tool-1',
      },
    );
    expect(second.behavior).toBe('deny');
    expect(grantsB).toEqual(['Bash']);
    // The first turn's gate was not consulted again.
    expect(grantsA).toEqual(['Bash']);
  });

  it('canUseTool_appliesTheCurrentTurnsPosture', async () => {
    const { options, setCurrent } = await build(gateCtx({ permissionPosture: 'prompt' }));
    const gate: NonNullable<Options['canUseTool']> = options.canUseTool!;

    // A later turn raises the posture to auto-all: the same tool is now auto-allowed with no prompt.
    let prompted: boolean = false;
    setCurrent(
      gateCtx({
        permissionPosture: 'auto-all',
        requestPermission: (): Promise<boolean> => {
          prompted = true;
          return Promise.resolve(false);
        },
      }),
    );
    const result: PermissionResult = await gate(
      'Bash',
      { command: 'ls' },
      {
        signal: new AbortController().signal,
        toolUseID: 'tool-1',
      },
    );
    expect(result.behavior).toBe('allow');
    expect(prompted).toBe(false);
  });

  it('auditHook_recordsThroughTheCurrentTurnsContext', async () => {
    const auditsA: string[] = [];
    const auditsB: string[] = [];
    const { options, setCurrent } = await build(
      gateCtx({ recordAudit: (name: string): void => void auditsA.push(name) }),
    );
    const hook: (input: unknown) => Promise<unknown> = options.hooks!.PostToolUse![0].hooks[0] as (
      input: unknown,
    ) => Promise<unknown>;

    await hook({ tool_name: 'Bash', tool_input: { command: 'ls' } });
    expect(auditsA).toEqual(['Bash']);

    setCurrent(gateCtx({ recordAudit: (name: string): void => void auditsB.push(name) }));
    await hook({ tool_name: 'Bash', tool_input: { command: 'ls' } });
    expect(auditsB).toEqual(['Bash']);
    // The opening turn's audit sink was not used for the later turn's action.
    expect(auditsA).toEqual(['Bash']);
  });

  it('bindsTheOpeningEffort_andOmitsItWhenNullOrMinimal', async () => {
    const withHigh: { options: Options } = await build(gateCtx({ effort: 'high' }));
    expect((withHigh.options as { effort?: string }).effort).toBe('high');

    // `minimal` is not an SDK effort level, and a null effort means the provider default — neither is
    // passed to the SDK.
    const withMinimal: { options: Options } = await build(gateCtx({ effort: 'minimal' }));
    expect('effort' in withMinimal.options).toBe(false);
    const withNull: { options: Options } = await build(gateCtx({ effort: null }));
    expect('effort' in withNull.options).toBe(false);
  });
});

describe('ClaudeAgentProvider.listSupportedModels', () => {
  let provider: ClaudeAgentProvider;

  beforeEach(() => {
    provider = new ClaudeAgentProvider([], 'default');
    // The bundled-executable lookup reads Electron's `app`, undefined under the test runner; stub the
    // provider's own resolver so discovery never touches it (mirrors the buildRunOptions tests above).
    vi.spyOn(
      provider as unknown as { executableOption(): Record<string, never> },
      'executableOption',
    ).mockReturnValue({});
  });

  /**
   * Builds a fake SDK query exposing only what discovery uses — `supportedModels` and `interrupt` —
   * and records whether it was torn down.
   * @param models The models the fake reports.
   * @returns Returns the fake query and a teardown flag.
   */
  function fakeQuery(models: readonly unknown[]): { query: Query; interrupted: () => boolean } {
    let interrupted: boolean = false;
    const query: Query = {
      supportedModels: (): Promise<readonly unknown[]> => Promise.resolve(models),
      interrupt: (): Promise<void> => {
        interrupted = true;
        return Promise.resolve();
      },
    } as unknown as Query;
    return { query, interrupted: (): boolean => interrupted };
  }

  it('listSupportedModels_mapsSdkModelsAndTearsDownTheQuery', async () => {
    const fake: { query: Query; interrupted: () => boolean } = fakeQuery([
      { value: 'sonnet', displayName: 'Sonnet', resolvedModel: 'claude-sonnet-5', description: '' },
      {
        value: 'opus[1m]',
        displayName: 'Opus (1M)',
        resolvedModel: 'claude-opus-5[1m]',
        description: '',
      },
    ]);

    const models: readonly ClaudeSdkModel[] = await provider.listSupportedModels(
      undefined,
      (): Promise<Query> => Promise.resolve(fake.query),
    );

    expect(models).toEqual([
      { value: 'sonnet', displayName: 'Sonnet', resolvedModel: 'claude-sonnet-5', description: '' },
      {
        value: 'opus[1m]',
        displayName: 'Opus (1M)',
        resolvedModel: 'claude-opus-5[1m]',
        description: '',
      },
    ]);
    expect(fake.interrupted()).toBe(true);
  });

  it('listSupportedModels_tearsDownEvenWhenSupportedModelsRejects', async () => {
    let interrupted: boolean = false;
    const query: Query = {
      supportedModels: (): Promise<readonly unknown[]> => Promise.reject(new Error('boom')),
      interrupt: (): Promise<void> => {
        interrupted = true;
        return Promise.resolve();
      },
    } as unknown as Query;

    await expect(
      provider.listSupportedModels(undefined, (): Promise<Query> => Promise.resolve(query)),
    ).rejects.toThrow('boom');
    expect(interrupted).toBe(true);
  });
});
