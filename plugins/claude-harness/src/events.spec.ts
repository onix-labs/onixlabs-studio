import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import { type EventSink, newUsageState, translate, type UsageState } from './events';

/**
 * Translates SDK messages through one session's usage state, collecting what is emitted.
 * @param messages The SDK messages, in order.
 * @returns Returns the emitted usage events.
 */
function usageEventsOf(messages: readonly object[]): Record<string, unknown>[] {
  const emitted: Record<string, unknown>[] = [];
  const sink: EventSink = {
    requestId: (): string => 'run-1',
    agentSessionId: (): string | null => null,
    emit: (event: Record<string, unknown>): void => void emitted.push(event),
  };
  const usage: UsageState = newUsageState();
  for (const message of messages) {
    translate(sink, message as SDKMessage, usage);
  }
  return emitted.filter((event: Record<string, unknown>): boolean => event['kind'] === 'usage');
}

/**
 * Builds a top-level assistant message from a model, with a usage snapshot.
 * @param model The model the message came from.
 * @returns Returns the message.
 */
function assistant(model: string): object {
  return {
    type: 'assistant',
    parent_tool_use_id: null,
    message: { model, content: [], usage: { input_tokens: 1000, output_tokens: 50 } },
  };
}

/**
 * Builds a terminal result reporting each model's context window.
 * @param windows The context window each model ran with.
 * @returns Returns the message.
 */
function result(windows: Record<string, number>): object {
  return {
    type: 'result',
    total_cost_usd: 0,
    modelUsage: Object.fromEntries(
      Object.entries(windows).map(([model, contextWindow]: [string, number]) => [
        model,
        { contextWindow },
      ]),
    ),
  };
}

describe('translate', () => {
  it('reportsTheWindowTheTurnsModelRanWith', () => {
    const events: Record<string, unknown>[] = usageEventsOf([
      assistant('claude-opus-5-5'),
      result({ 'claude-haiku-4-5': 200_000, 'claude-opus-5-5': 1_000_000 }),
    ]);

    expect(events).toHaveLength(1);
    expect(events[0]['inputTokens']).toBe(1000);
    expect(events[0]['contextWindow']).toBe(1_000_000);
  });

  it('readsTheOnlyModel_whenTheTurnsModelIsUnknown', () => {
    const events: Record<string, unknown>[] = usageEventsOf([
      { type: 'assistant', parent_tool_use_id: null, message: { content: [], usage: {} } },
      result({ 'claude-opus-5-5': 1_000_000 }),
    ]);

    expect(events[0]['contextWindow']).toBe(1_000_000);
  });

  it('reportsNoWindow_whenItCannotTellWhichModelIsTheTurns', () => {
    const events: Record<string, unknown>[] = usageEventsOf([
      { type: 'assistant', parent_tool_use_id: null, message: { content: [], usage: {} } },
      result({ 'claude-haiku-4-5': 200_000, 'claude-opus-5-5': 1_000_000 }),
    ]);

    expect(events[0]).not.toHaveProperty('contextWindow');
  });

  it('reportsNoWindow_whenTheResultCarriesNone', () => {
    const events: Record<string, unknown>[] = usageEventsOf([
      assistant('claude-opus-5-5'),
      { type: 'result', total_cost_usd: 0 },
    ]);

    expect(events[0]).not.toHaveProperty('contextWindow');
  });
});
