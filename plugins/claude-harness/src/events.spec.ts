import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import {
  type EventSink,
  newStreamState,
  newUsageState,
  type StreamState,
  translate,
  type UsageState,
} from './events';

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

/**
 * Translates SDK messages through one session's stream state, collecting the text and thinking.
 * @param messages The SDK messages, in order.
 * @returns Returns each text or thinking event as `kind:delta`.
 */
function streamedOf(messages: readonly object[]): string[] {
  const emitted: Record<string, unknown>[] = [];
  const sink: EventSink = {
    requestId: (): string => 'run-1',
    agentSessionId: (): string | null => null,
    emit: (event: Record<string, unknown>): void => void emitted.push(event),
  };
  const usage: UsageState = newUsageState();
  const stream: StreamState = newStreamState();
  for (const message of messages) {
    translate(sink, message as SDKMessage, usage, stream);
  }
  return emitted
    .filter((event: Record<string, unknown>): boolean =>
      ['text', 'thinking'].includes(event['kind'] as string),
    )
    .map(
      (event: Record<string, unknown>): string =>
        `${String(event['kind'])}:${String(event['delta'])}`,
    );
}

/**
 * Builds a partial message.
 * @param event The streaming event it carries.
 * @returns Returns the message.
 */
function partial(event: object): object {
  return { type: 'stream_event', parent_tool_use_id: null, event };
}

/**
 * Builds a text or thinking delta.
 * @param kind Which.
 * @param value The chunk.
 * @returns Returns the partial message.
 */
function delta(kind: 'text' | 'thinking', value: string): object {
  return partial({
    type: 'content_block_delta',
    index: 0,
    delta:
      kind === 'text'
        ? { type: 'text_delta', text: value }
        : { type: 'thinking_delta', thinking: value },
  });
}

/**
 * Builds a whole assistant message for model message `m-1`.
 * @param content Its blocks.
 * @returns Returns the message.
 */
function whole(content: readonly object[]): object {
  return {
    type: 'assistant',
    uuid: 'u-1',
    parent_tool_use_id: null,
    message: { id: 'm-1', content },
  };
}

describe('translate, streaming (#1070)', () => {
  const start: object = partial({ type: 'message_start', message: { id: 'm-1' } });

  it('showsThinkingAsItStreams_andNotAgain', () => {
    expect(
      streamedOf([
        start,
        delta('thinking', 'Weighing '),
        delta('thinking', 'it up.'),
        delta('text', 'Done.'),
        whole([{ type: 'thinking', thinking: 'Weighing it up.' }]),
        whole([{ type: 'text', text: 'Done.' }]),
      ]),
    ).toEqual(['thinking:Weighing ', 'thinking:it up.', 'text:Done.', 'text:']);
  });

  it('addsTheTailOfAStreamThatWasCutShort', () => {
    expect(
      streamedOf([
        start,
        delta('text', 'Half a '),
        whole([{ type: 'text', text: 'Half a sentence.' }]),
      ]),
    ).toEqual(['text:Half a ', 'text:sentence.']);
  });

  it('accountsForEachBlockOfAMessageDeliveredInParts', () => {
    expect(
      streamedOf([
        start,
        delta('text', 'One.'),
        delta('text', 'Two.'),
        whole([{ type: 'text', text: 'One.' }]),
        whole([{ type: 'text', text: 'Two.' }]),
      ]),
    ).toEqual(['text:One.', 'text:Two.', 'text:', 'text:']);
  });

  it('showsAWholeMessageThatNeverStreamed', () => {
    // A sub-agent's messages, or a CLI that streams nothing, still arrive in full.
    expect(streamedOf([whole([{ type: 'text', text: 'Whole.' }])])).toEqual(['text:Whole.']);
  });
});
