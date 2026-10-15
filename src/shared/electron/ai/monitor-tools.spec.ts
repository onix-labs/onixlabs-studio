import { describe, expect, it, vi } from 'vitest';
import type { AgentRunContext } from './agent-provider';

vi.mock('electron', () => ({ app: { isPackaged: false } }));

const { clampLogLimit, formatLogRecord, listLogSessions, MAX_LOG_RECORDS, queryLogs, setLogLevel } =
  await import('./monitor-tools');

/**
 * Builds a run context whose bridge answers with the given value.
 * @param answer What the renderer answers.
 * @returns Returns the context and the bridge's spy.
 */
function contextAnswering(answer: unknown): {
  context: AgentRunContext;
  request: ReturnType<typeof vi.fn>;
} {
  const request: ReturnType<typeof vi.fn> = vi.fn((): Promise<unknown> => Promise.resolve(answer));
  return { context: { bridge: { request } } as unknown as AgentRunContext, request };
}

describe('monitor tools', () => {
  it('clampLogLimit_keepsAQueryBetweenOneAndTheCap_defaultingTo100', () => {
    expect(clampLogLimit(undefined)).toBe(100);
    expect(clampLogLimit(0)).toBe(1);
    expect(clampLogLimit(12.7)).toBe(12);
    expect(clampLogLimit(10_000)).toBe(MAX_LOG_RECORDS);
  });

  it('formatLogRecord_putsEachRecordOnOneLine_andShortensALongMessage', () => {
    const line: string = formatLogRecord({
      timestamp: '2026-10-15T13:00:00.000Z',
      severity: 'error',
      origin: 'renderer',
      window: 'main',
      source: 'Plugins',
      message: `Failed\n${'x'.repeat(600)}`,
    });

    expect(
      line.startsWith('2026-10-15T13:00:00.000Z ERROR [renderer/main] Plugins: Failed x'),
    ).toBe(true);
    expect(line.endsWith('…')).toBe(true);
    expect(line).not.toContain('\n');
  });

  it('queryLogs_sendsTheClampedQuery_andListsTheRecordsNewestFirst', async () => {
    const { context, request } = contextAnswering({
      available: true,
      session: 's2',
      more: true,
      records: [
        { timestamp: 't2', severity: 'warning', origin: 'main', source: 'b', message: 'second' },
        { timestamp: 't1', severity: 'info', origin: 'main', source: 'a', message: 'first' },
      ],
    });

    const result: string = await queryLogs(context, { severities: ['warning'], limit: 9999 });

    expect(request).toHaveBeenCalledWith('query_logs', {
      severities: ['warning'],
      limit: MAX_LOG_RECORDS,
    });
    expect(result.split('\n')).toEqual([
      '2 record(s) from session s2, newest first (more match; narrow the query or raise the limit):',
      't2 WARNING [main] b: second',
      't1 INFO [main] a: first',
    ]);
  });

  it('queryLogs_saysWhyWhenThereIsNothingToRead', async () => {
    expect(await queryLogs(contextAnswering({ available: false }).context, {})).toContain(
      'not open',
    );
    expect(
      await queryLogs(contextAnswering({ available: true, error: 'No such session.' }).context, {}),
    ).toBe('No such session.');
    expect(
      await queryLogs(
        contextAnswering({ available: true, session: 's1', records: [] }).context,
        {},
      ),
    ).toBe('No records in session s1 match.');
  });

  it('listLogSessions_marksThisRun', async () => {
    const result: string = await listLogSessions(
      contextAnswering({
        available: true,
        sessions: [
          { id: 's2', startedAt: 't2', current: true },
          { id: 's1', startedAt: 't1' },
        ],
      }).context,
    );

    expect(result).toBe('s2 — started t2 (this run)\ns1 — started t1');
  });

  it('setLogLevel_saysWhatItWas_orWhyItWasRefused', async () => {
    expect(
      await setLogLevel(contextAnswering({ ok: true, previous: 'auto' }).context, 'debug'),
    ).toContain('now "debug" (it was "auto")');
    expect(await setLogLevel(contextAnswering({ ok: false, error: 'Nope.' }).context, 'loud')).toBe(
      'Nope.',
    );
  });
});
