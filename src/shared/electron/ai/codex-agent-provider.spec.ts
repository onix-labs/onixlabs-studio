import { beforeEach, describe, it, expect } from 'vitest';
import type { CodexOptions, ThreadEvent, ThreadOptions, Usage } from '@openai/codex-sdk';
import type { AiEvent, AiModelInfo } from '@shared/api/ai-types';
import type { AgentAuth, AgentRunContext } from './agent-provider';
import {
  CodexAgentProvider,
  CodexAgentSession,
  type CodexSessionDeps,
} from './codex-agent-provider';

const MODELS: readonly AiModelInfo[] = [
  { id: 'gpt-5-codex', label: 'GPT-5 Codex', contextWindow: 400_000 },
];

const ZERO_USAGE: Usage = {
  input_tokens: 0,
  cached_input_tokens: 0,
  output_tokens: 0,
  reasoning_output_tokens: 0,
};

/**
 * A completed stream over a fixed list of events; parks (awaiting the signal) after them when asked, so
 * an abort test can cancel a turn mid-flight.
 * @param events The events to yield.
 * @param park Whether to park after the events until the signal aborts.
 * @param signal The turn's abort signal.
 * @returns Yields the events.
 */
async function* streamOf(
  events: readonly ThreadEvent[],
  park: boolean,
  signal: AbortSignal | undefined,
): AsyncGenerator<ThreadEvent> {
  for (const event of events) {
    yield event;
  }
  if (park) {
    await new Promise<void>((resolve: () => void, reject: (reason: unknown) => void): void => {
      if (signal?.aborted === true) {
        reject(new Error('aborted'));
        return;
      }
      signal?.addEventListener('abort', (): void => reject(new Error('aborted')), { once: true });
    });
  }
}

/**
 * A fake Codex thread: records its run calls and yields the queued events (optionally parking after).
 */
class FakeCodexThread {
  public readonly id: string | null = null;
  public runCalls: number = 0;
  public queued: ThreadEvent[] = [];
  public park: boolean = false;

  public runStreamed(
    _input: unknown,
    turnOptions?: { signal?: AbortSignal },
  ): Promise<{ events: AsyncGenerator<ThreadEvent> }> {
    this.runCalls += 1;
    const events: readonly ThreadEvent[] = this.queued;
    this.queued = [];
    return Promise.resolve({ events: streamOf(events, this.park, turnOptions?.signal) });
  }
}

/**
 * A fake Codex client: records whether a thread was started fresh or resumed.
 */
class FakeCodexClient {
  public startCalls: number = 0;
  public resumeCalls: number = 0;
  public resumeId: string | null = null;

  public constructor(public readonly thread: FakeCodexThread) {}

  public startThread(): FakeCodexThread {
    this.startCalls += 1;
    return this.thread;
  }

  public resumeThread(id: string): FakeCodexThread {
    this.resumeCalls += 1;
    this.resumeId = id;
    return this.thread;
  }
}

/**
 * Builds a session driven by a fake client, with the executable/thread-option builders stubbed so no
 * real SDK or Electron is touched.
 * @param initial The opening turn context.
 * @param client The fake client.
 * @returns Returns the session.
 */
function makeSession(initial: AgentRunContext, client: FakeCodexClient): CodexAgentSession {
  const deps: CodexSessionDeps = {
    createClient: (): Promise<FakeCodexClient> => Promise.resolve(client),
    buildClientOptions: (): CodexOptions => ({}),
    buildThreadOptions: (): ThreadOptions => ({}),
  };
  return new CodexAgentSession(deps, initial);
}

/**
 * A turn context carrying the fields the session reads.
 * @param requestId The request id.
 * @param signal The abort signal.
 * @param events The array turn events are pushed to.
 * @param resumeSessionId The session to resume, or null for a fresh thread.
 * @returns Returns the context.
 */
function codexCtx(
  requestId: string,
  signal: AbortSignal,
  events: AiEvent[],
  resumeSessionId: string | null = null,
): AgentRunContext {
  return {
    requestId,
    prompt: 'do the thing',
    contextPaths: [],
    mode: 'agent',
    model: 'gpt-5-codex',
    workspaceRoot: '/ws',
    allowedWritePaths: [],
    resumeSessionId,
    signal,
    emit: (event: AiEvent): void => void events.push(event),
  } as unknown as AgentRunContext;
}

/**
 * Flushes the microtask/timer queue so the session's async turn makes progress.
 * @returns Resolves on the next macrotask tick.
 */
function flush(): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 0);
  });
}

describe('CodexAgentProvider', () => {
  let provider: CodexAgentProvider;

  beforeEach(() => {
    provider = new CodexAgentProvider(MODELS, 'gpt-5-codex');
  });

  it('reportsALiveHarnessSessionModel_andNoImageSupport', () => {
    expect(provider.sessionModel).toBe('live-harness');
    expect(provider.supportsImages).toBe(false);
  });

  it('declaresItsEffortLevels_withoutMax', () => {
    expect(provider.supportedEfforts).toEqual(['minimal', 'low', 'medium', 'high', 'xhigh']);
  });

  it('buildThreadOptions_appliesTheEffort_butOmitsMax_andReadOnlyForChat', () => {
    const build: (context: AgentRunContext) => ThreadOptions = (
      provider as unknown as { buildThreadOptions(context: AgentRunContext): ThreadOptions }
    ).buildThreadOptions.bind(provider);
    const base: Partial<AgentRunContext> = {
      model: 'gpt-5-codex',
      workspaceRoot: '/ws',
      allowedWritePaths: [],
    };

    const high: ThreadOptions = build({ ...base, mode: 'agent', effort: 'high' } as AgentRunContext);
    expect(high.modelReasoningEffort).toBe('high');
    expect(high.sandboxMode).toBe('workspace-write');

    // `max` is beyond Codex's range, and a chat run is read-only.
    const maxChat: ThreadOptions = build({
      ...base,
      mode: 'chat',
      effort: 'max',
    } as AgentRunContext);
    expect(maxChat.modelReasoningEffort).toBeUndefined();
    expect(maxChat.sandboxMode).toBe('read-only');
  });

  it('describeAvailability_prefersLocalCodexLoginThenApiKeyThenNeither', () => {
    const login: AgentAuth = { hasLocalLogin: false, hasCodexLogin: true, apiKey: null };
    const keyed: AgentAuth = { hasLocalLogin: false, hasCodexLogin: false, apiKey: 'sk-o' };
    const none: AgentAuth = { hasLocalLogin: false, hasCodexLogin: false, apiKey: null };
    expect(provider.describeAvailability(login)).toEqual({
      available: true,
      detail: 'Using your local Codex login.',
    });
    expect(provider.describeAvailability(keyed).available).toBe(true);
    expect(provider.describeAvailability(none).available).toBe(false);
  });
});

describe('CodexAgentSession', () => {
  it('turn_startsAThread_mapsEvents_andSettlesOnTurnCompleted', async () => {
    const events: AiEvent[] = [];
    const client: FakeCodexClient = new FakeCodexClient(new FakeCodexThread());
    client.thread.queued = [
      { type: 'thread.started', thread_id: 'th-1' },
      { type: 'item.completed', item: { id: 'm1', type: 'agent_message', text: 'Hello' } },
      {
        type: 'item.started',
        item: {
          id: 'c1',
          type: 'command_execution',
          command: 'ls',
          aggregated_output: '',
          status: 'in_progress',
        },
      },
      {
        type: 'item.completed',
        item: {
          id: 'c1',
          type: 'command_execution',
          command: 'ls',
          aggregated_output: 'file.txt',
          status: 'completed',
        },
      },
      {
        type: 'turn.completed',
        usage: {
          input_tokens: 100,
          cached_input_tokens: 20,
          output_tokens: 30,
          reasoning_output_tokens: 5,
        },
      },
    ];
    const controller: AbortController = new AbortController();

    await makeSession(
      codexCtx('run-1', controller.signal, events),
      client,
    ).turn(codexCtx('run-1', controller.signal, events));

    expect(client.startCalls).toBe(1);
    expect(client.resumeCalls).toBe(0);
    const kinds: unknown[] = (events as unknown as Record<string, unknown>[]).map(
      (event: Record<string, unknown>): unknown => event['kind'],
    );
    expect(kinds).toEqual(['session', 'text', 'tool-start', 'tool-end', 'usage']);
    const session: Record<string, unknown> = events[0] as unknown as Record<string, unknown>;
    expect(session['sessionId']).toBe('th-1');
    const text: Record<string, unknown> = events[1] as unknown as Record<string, unknown>;
    expect(text['delta']).toBe('Hello');
    const usage: Record<string, unknown> = events[4] as unknown as Record<string, unknown>;
    expect(usage['inputTokens']).toBe(120);
    expect(usage['outputTokens']).toBe(35);
    expect(usage['costUsd']).toBeNull();
  });

  it('turn_withAResumeSessionId_resumesTheThreadInsteadOfStarting', async () => {
    const events: AiEvent[] = [];
    const client: FakeCodexClient = new FakeCodexClient(new FakeCodexThread());
    client.thread.queued = [{ type: 'turn.completed', usage: ZERO_USAGE }];
    const controller: AbortController = new AbortController();

    await makeSession(
      codexCtx('run-1', controller.signal, events, 'th-existing'),
      client,
    ).turn(codexCtx('run-1', controller.signal, events, 'th-existing'));

    expect(client.startCalls).toBe(0);
    expect(client.resumeCalls).toBe(1);
    expect(client.resumeId).toBe('th-existing');
  });

  it('turn_streamsAgentTextAsDeltas', async () => {
    const events: AiEvent[] = [];
    const client: FakeCodexClient = new FakeCodexClient(new FakeCodexThread());
    client.thread.queued = [
      { type: 'item.started', item: { id: 'm1', type: 'agent_message', text: 'Hel' } },
      { type: 'item.updated', item: { id: 'm1', type: 'agent_message', text: 'Hello wor' } },
      { type: 'item.completed', item: { id: 'm1', type: 'agent_message', text: 'Hello world' } },
      { type: 'turn.completed', usage: ZERO_USAGE },
    ];
    const controller: AbortController = new AbortController();

    await makeSession(
      codexCtx('run-1', controller.signal, events),
      client,
    ).turn(codexCtx('run-1', controller.signal, events));

    const deltas: unknown[] = (events as unknown as Record<string, unknown>[])
      .filter((event: Record<string, unknown>): boolean => event['kind'] === 'text')
      .map((event: Record<string, unknown>): unknown => event['delta']);
    expect(deltas).toEqual(['Hel', 'lo wor', 'ld']);
  });

  it('turn_reusesTheThreadAcrossTurns_carryingEachTurnsRequestId', async () => {
    const events: AiEvent[] = [];
    const thread: FakeCodexThread = new FakeCodexThread();
    const client: FakeCodexClient = new FakeCodexClient(thread);
    const session: CodexAgentSession = makeSession(
      codexCtx('run-1', new AbortController().signal, events),
      client,
    );

    thread.queued = [{ type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 } }];
    await session.turn(codexCtx('run-1', new AbortController().signal, events));
    thread.queued = [{ type: 'turn.completed', usage: { input_tokens: 2, cached_input_tokens: 0, output_tokens: 2, reasoning_output_tokens: 0 } }];
    await session.turn(codexCtx('run-2', new AbortController().signal, events));

    expect(client.startCalls).toBe(1);
    expect(thread.runCalls).toBe(2);
    const usageRequestIds: unknown[] = (events as unknown as Record<string, unknown>[])
      .filter((event: Record<string, unknown>): boolean => event['kind'] === 'usage')
      .map((event: Record<string, unknown>): unknown => event['requestId']);
    expect(usageRequestIds).toEqual(['run-1', 'run-2']);
  });

  it('turn_rejectsWhenTheTurnFails', async () => {
    const events: AiEvent[] = [];
    const client: FakeCodexClient = new FakeCodexClient(new FakeCodexThread());
    client.thread.queued = [{ type: 'turn.failed', error: { message: 'model exploded' } }];
    const controller: AbortController = new AbortController();

    await expect(
      makeSession(codexCtx('run-1', controller.signal, events), client).turn(
        codexCtx('run-1', controller.signal, events),
      ),
    ).rejects.toThrow('model exploded');
  });

  it('turn_abort_settlesTheTurn_keepsTheSessionLive_andAFollowUpRuns', async () => {
    const events: AiEvent[] = [];
    const thread: FakeCodexThread = new FakeCodexThread();
    thread.park = true;
    const client: FakeCodexClient = new FakeCodexClient(thread);
    const session: CodexAgentSession = makeSession(
      codexCtx('run-1', new AbortController().signal, events),
      client,
    );

    const c1: AbortController = new AbortController();
    thread.queued = [{ type: 'thread.started', thread_id: 'th-1' }];
    const turn1: Promise<void> = session.turn(codexCtx('run-1', c1.signal, events));
    await flush();
    c1.abort();
    await turn1;

    // The session survived the Stop: a second turn runs into the same thread (no new start).
    thread.park = false;
    thread.queued = [{ type: 'turn.completed', usage: ZERO_USAGE }];
    await session.turn(codexCtx('run-2', new AbortController().signal, events));

    expect(client.startCalls).toBe(1);
    expect(thread.runCalls).toBe(2);
  });
});
