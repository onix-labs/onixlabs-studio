import { describe, expect, it } from 'vitest';
import { LogRecord } from '@shared/api/log-channels';
import { LogInput, LogStore } from './log-store';

/**
 * Builds a log input with sensible defaults, overridable per test.
 * @param over The fields to override.
 * @returns Returns the input.
 */
function input(over: Partial<LogInput> = {}): LogInput {
  return { origin: 'main', severity: 'info', source: 'test', message: 'hello', ...over };
}

describe('LogStore', () => {
  it('add_stampsSessionMonotonicIdAndTimestamp', () => {
    const store: LogStore = new LogStore('s1', 100, (): string => '2026-08-10T00:00:00.000Z');
    const first: LogRecord = store.add(input({ message: 'a' }));
    const second: LogRecord = store.add(input({ message: 'b' }));
    expect(first).toMatchObject({ id: 1, sessionId: 's1', timestamp: '2026-08-10T00:00:00.000Z' });
    expect(second.id).toBe(2);
  });

  it('add_carriesOriginSeveritySourceMessageAndWindow', () => {
    const store: LogStore = new LogStore('s1');
    const record: LogRecord = store.add(
      input({ origin: 'renderer', severity: 'warning', source: 'Composer', message: 'eek', window: 'main' }),
    );
    expect(record).toMatchObject({
      origin: 'renderer',
      severity: 'warning',
      source: 'Composer',
      message: 'eek',
      window: 'main',
    });
  });

  it('add_capsSourceAndMessageLength', () => {
    const store: LogStore = new LogStore('s1');
    const record: LogRecord = store.add(input({ source: 'x'.repeat(500), message: 'y'.repeat(20000) }));
    expect(record.source).toHaveLength(256);
    expect(record.message).toHaveLength(8192);
  });

  it('add_evictsTheOldestPastTheCap', () => {
    const store: LogStore = new LogStore('s1', 2);
    store.add(input({ message: 'first' }));
    store.add(input({ message: 'second' }));
    store.add(input({ message: 'third' }));
    const messages: string[] = store.current().map((record: LogRecord): string => record.message);
    expect(messages).toEqual(['second', 'third']);
  });

  it('filter_returnsRecordsUnchangedForAnEmptyQuery', () => {
    const store: LogStore = new LogStore('s1');
    store.add(input());
    store.add(input());
    expect(LogStore.filter(store.current(), {})).toHaveLength(2);
  });

  it('filter_keepsOnlyTheRequestedSeverities', () => {
    const store: LogStore = new LogStore('s1');
    store.add(input({ severity: 'info' }));
    store.add(input({ severity: 'error' }));
    store.add(input({ severity: 'trace' }));
    const kept: LogRecord[] = LogStore.filter(store.current(), { severities: ['error', 'trace'] });
    expect(kept.map((record: LogRecord): string => record.severity)).toEqual(['error', 'trace']);
  });

  it('filter_matchesTextAgainstSourceOrMessageCaseInsensitively', () => {
    const store: LogStore = new LogStore('s1');
    store.add(input({ source: 'DockerEngine', message: 'started' }));
    store.add(input({ source: 'Composer', message: 'DOCKED panel' }));
    store.add(input({ source: 'Other', message: 'nothing' }));
    const kept: LogRecord[] = LogStore.filter(store.current(), { text: 'dock' });
    expect(kept).toHaveLength(2);
  });

  it('filter_appliesATrailingLimit', () => {
    const store: LogStore = new LogStore('s1');
    store.add(input({ message: 'a' }));
    store.add(input({ message: 'b' }));
    store.add(input({ message: 'c' }));
    const kept: LogRecord[] = LogStore.filter(store.current(), { limit: 2 });
    expect(kept.map((record: LogRecord): string => record.message)).toEqual(['b', 'c']);
  });
});
