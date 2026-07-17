import type { AiEvent, AiModelInfo } from '@shared/api/ai-types';
import type { AgentAuth, AgentRunContext } from './agent-provider';
import { ClaudeAgentProvider } from './claude-agent-provider';

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

  it('describeAvailability_withALocalLogin_isAvailable', () => {
    const auth: AgentAuth = { hasLocalLogin: true, apiKey: null };
    expect(provider.describeAvailability(auth)).toEqual({
      available: true,
      detail: 'Using your local Claude login.',
    });
  });

  it('describeAvailability_withAnApiKeyOnly_isAvailable', () => {
    const auth: AgentAuth = { hasLocalLogin: false, apiKey: 'sk-x' };
    expect(provider.describeAvailability(auth).available).toBe(true);
  });

  it('describeAvailability_withNeither_isUnavailable', () => {
    const auth: AgentAuth = { hasLocalLogin: false, apiKey: null };
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
