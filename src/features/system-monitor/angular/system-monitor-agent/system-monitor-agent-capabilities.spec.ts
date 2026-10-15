import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import {
  LIST_LOG_SESSIONS,
  QUERY_LOGS,
  READ_SYSTEM_METRICS,
  SET_LOG_LEVEL,
  type AiBridgeScope,
} from '@shared/api/ai-types';
import type { LogQuery, LogRecord, LogSession } from '@shared/api/log-channels';
import type { MetricsSample } from '@shared/api/system-monitor-channels';
import { AiCapability, AiRuntime } from '@shared/angular/services/ai-runtime/ai-runtime';
import { Log } from '@shared/angular/services/log/log';
import { Settings } from '@shared/angular/services/settings/settings';
import { SystemMonitorMetrics } from '../metrics/system-monitor-metrics';
import {
  statsOf,
  SystemMonitorAgentCapabilities,
  withinWindow,
} from './system-monitor-agent-capabilities';

/**
 * Builds a log record.
 * @param id The record id.
 * @param timestamp When it was written.
 * @param message What it says.
 * @returns Returns the record.
 */
function record(id: number, timestamp: string, message: string): LogRecord {
  return {
    id,
    sessionId: 's2',
    timestamp,
    severity: 'info',
    origin: 'main',
    source: 'test',
    message,
  };
}

const MONITOR: AiBridgeScope = { owningTabId: 'tab', surface: 'monitor', workspaceRoot: null };
const EDITOR: AiBridgeScope = { owningTabId: 'tab', surface: 'editor', workspaceRoot: null };

describe('statsOf', () => {
  it('summarisesASeries_orNothingWhenEmpty', () => {
    expect(statsOf([])).toBeNull();
    expect(statsOf([10, 20, 30.04])).toEqual({ latest: 30, low: 10, average: 20, high: 30 });
  });
});

describe('withinWindow', () => {
  const records: readonly LogRecord[] = [
    record(1, '2026-10-15T10:00:00Z', 'a'),
    record(2, '2026-10-15T11:00:00Z', 'b'),
    record(3, '2026-10-15T12:00:00Z', 'c'),
  ];

  it('keepsTheRecordsInsideTheWindow_bothEndsInclusive', () => {
    const kept: readonly LogRecord[] | string = withinWindow(
      records,
      '2026-10-15T11:00:00Z',
      '2026-10-15T12:00:00Z',
    );
    expect((kept as readonly LogRecord[]).map((each: LogRecord): number => each.id)).toEqual([
      2, 3,
    ]);
    expect(withinWindow(records, undefined, undefined)).toEqual(records);
  });

  it('refusesABoundThatIsNotATime', () => {
    expect(withinWindow(records, 'yesterday', undefined)).toContain('ISO-8601');
  });
});

describe('SystemMonitorAgentCapabilities', () => {
  let capabilities: Map<string, AiCapability>;
  let queries: LogQuery[];
  let level: string;
  let sampleListener: ((sample: MetricsSample) => void) | null;

  beforeEach(() => {
    capabilities = new Map<string, AiCapability>();
    queries = [];
    level = 'auto';
    sampleListener = null;
    const sessions: LogSession[] = [
      { id: 's2', startedAt: '2026-10-15T09:00:00Z', current: true },
      { id: 's1', startedAt: '2026-10-14T09:00:00Z', current: false },
    ];
    TestBed.configureTestingModule({
      providers: [
        SystemMonitorAgentCapabilities,
        {
          provide: AiRuntime,
          useValue: {
            registerCapability: (name: string, handler: AiCapability): (() => void) => {
              capabilities.set(name, handler);
              return (): void => void capabilities.delete(name);
            },
          },
        },
        {
          provide: Log,
          useValue: {
            sessions: (): Promise<LogSession[]> => Promise.resolve(sessions),
            query: (query: LogQuery): Promise<LogRecord[]> => {
              queries.push(query);
              return Promise.resolve([
                record(1, '2026-10-15T10:00:00Z', 'oldest'),
                record(2, '2026-10-15T11:00:00Z', 'middle'),
                record(3, '2026-10-15T12:00:00Z', 'newest'),
              ]);
            },
          },
        },
        {
          provide: Settings,
          useValue: {
            value: (): ReturnType<typeof signal<string>> => signal<string>(level),
            set: (_key: string, value: string): void => {
              level = value;
            },
          },
        },
        {
          provide: SystemMonitorMetrics,
          useValue: {
            onSample: (listener: (sample: MetricsSample) => void): (() => void) => {
              sampleListener = listener;
              return (): void => undefined;
            },
          },
        },
      ],
    });
    TestBed.inject(SystemMonitorAgentCapabilities);
  });

  /**
   * Calls a registered capability.
   * @param name The capability.
   * @param input What the model sent.
   * @param scope The run's scope.
   * @returns Returns the answer.
   */
  function call(name: string, input: unknown, scope: AiBridgeScope = MONITOR): Promise<unknown> {
    return Promise.resolve(capabilities.get(name)!(input, scope));
  }

  it('answersOnlyTheSystemMonitorsOwnAgent', async () => {
    for (const name of [LIST_LOG_SESSIONS, QUERY_LOGS, READ_SYSTEM_METRICS, SET_LOG_LEVEL]) {
      expect(await call(name, {}, EDITOR)).toEqual({ available: false });
    }
    expect(level).toBe('auto');
  });

  it('readsTheCurrentSessionNewestFirst_bounded', async () => {
    const answer: { session: string; records: LogRecord[]; more: boolean } = (await call(
      QUERY_LOGS,
      { severities: ['info', 'bogus'], text: ' plugin ', limit: 2 },
    )) as { session: string; records: LogRecord[]; more: boolean };

    expect(queries[0]).toMatchObject({ sessionId: 's2', severities: ['info'], text: 'plugin' });
    expect(answer.session).toBe('s2');
    expect(answer.records.map((each: LogRecord): string => each.message)).toEqual([
      'newest',
      'middle',
    ]);
    expect(answer.more).toBe(true);
  });

  it('saysSoWhenTheNamedSessionIsNotKept', async () => {
    expect(await call(QUERY_LOGS, { session: 'gone' })).toEqual({
      available: true,
      error: 'There is no log session "gone". List the sessions to see which are kept.',
    });
  });

  it('summarisesTheReadingsItHasSampled', async () => {
    expect(await call(READ_SYSTEM_METRICS, {})).toMatchObject({
      summary: { note: expect.stringContaining('No readings yet') as unknown },
    });
    sampleListener!({
      timestamp: '2026-10-15T12:00:00Z',
      cpu: 40,
      memory: { usedBytes: 1, totalBytes: 2, percent: 50 },
    });
    sampleListener!({
      timestamp: '2026-10-15T12:00:01Z',
      cpu: 60,
      memory: { usedBytes: 1, totalBytes: 2, percent: 50 },
    });

    expect(await call(READ_SYSTEM_METRICS, {})).toMatchObject({
      summary: {
        window: { samples: 2 },
        cpuPercent: { latest: 60, low: 40, average: 50, high: 60 },
        gpuPercent: null,
      },
    });
  });

  it('changesTheLogLevelThroughItsSetting_andRefusesALevelThatIsNotOne', async () => {
    expect(await call(SET_LOG_LEVEL, { level: 'debug' })).toEqual({ ok: true, previous: 'auto' });
    expect(level).toBe('debug');
    expect(await call(SET_LOG_LEVEL, { level: 'loud' })).toEqual({
      ok: false,
      error: '"loud" is not a log level.',
    });
  });
});
