import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import {
  LIST_LOG_SESSIONS,
  LIST_PROCESSES,
  QUERY_LOGS,
  READ_RESOURCE,
  READ_SYSTEM_METRICS,
  SET_LOG_LEVEL,
  type AiBridgeScope,
} from '@shared/api/ai-types';
import type { LogQuery, LogRecord, LogSession } from '@shared/api/log-channels';
import type {
  MetricsSample,
  ProcessesSnapshot,
  StorageSnapshot,
} from '@shared/api/system-monitor-channels';
import { AiCapability, AiRuntime } from '@shared/angular/services/ai-runtime/ai-runtime';
import { Log } from '@shared/angular/services/log/log';
import { Settings } from '@shared/angular/services/settings/settings';
import { SystemMonitorMetrics } from '../metrics/system-monitor-metrics';
import { SystemMonitorReadings } from '../readings/system-monitor-readings';
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

/**
 * A listing of four processes: Studio's main process, a shell it started, the window server, and a
 * busy build.
 */
const SNAPSHOT: ProcessesSnapshot = {
  timestamp: '2026-11-15T10:00:00Z',
  total: 600,
  user: 'me',
  processes: [
    {
      pid: 100,
      parentPid: 1,
      name: 'Studio',
      command: '/Applications/Studio',
      user: 'me',
      cpuPercent: 4,
      memoryBytes: 900,
      memoryPercent: 3,
      studio: 'main',
    },
    {
      pid: 200,
      parentPid: 100,
      name: 'zsh',
      command: '/bin/zsh',
      user: 'me',
      cpuPercent: 0,
      memoryBytes: 10,
      memoryPercent: 0,
      studio: 'child',
    },
    {
      pid: 300,
      parentPid: 1,
      name: 'WindowServer',
      command: '/System/WindowServer',
      user: '_windowserver',
      cpuPercent: 12,
      memoryBytes: 700,
      memoryPercent: 2,
    },
    {
      pid: 400,
      parentPid: 1,
      name: 'esbuild',
      command: 'esbuild --watch',
      user: 'me',
      cpuPercent: 60,
      memoryBytes: 300,
      memoryPercent: 1,
      threads: 18,
      startedAt: Date.parse('2026-11-15T09:59:00Z'),
    },
  ],
};

/**
 * One drive with a volume on it, and a network share on none.
 */
const STORAGE: StorageSnapshot = {
  info: {
    devices: [{ id: 'disk1', name: 'SSD', kind: 'nvme', sizeBytes: 2000, health: 'ok' }],
    volumes: [{ mount: '/', deviceId: 'disk1', name: 'Macintosh HD' }, { mount: '/Volumes/Share' }],
  },
  reading: {
    timestamp: 't',
    devices: [
      {
        id: 'disk1',
        readBytesPerSecond: 5,
        writeBytesPerSecond: 6,
        readOpsPerSecond: 1,
        writeOpsPerSecond: 2,
        utilisationPercent: 3,
        totalReadBytes: 100,
        totalWriteBytes: 200,
        totalReadOps: 10,
        totalWriteOps: 20,
      },
    ],
  },
};

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
            readProcessesNow: (): Promise<ProcessesSnapshot> => Promise.resolve(SNAPSHOT),
            readGpuNow: (): Promise<null> => Promise.resolve(null),
            readStorageNow: (): Promise<StorageSnapshot> => Promise.resolve(STORAGE),
            readNetworkNow: (): Promise<null> => Promise.resolve(null),
          },
        },
        {
          provide: SystemMonitorReadings,
          useValue: {
            info: signal(null),
            latest: signal(null),
            intervalMs: signal(1000),
            cpuHistory: signal([10, 30]),
            appCpuHistory: signal([1, 2]),
            memoryHistory: signal([40]),
            swapHistory: signal([]),
            appMemoryHistory: signal([]),
            gpuHistory: signal([]),
            cores: signal([20, 40]),
            memoryDetail: signal(null),
            volumes: signal([
              { mount: '/', type: 'apfs', sizeBytes: 1000, usedBytes: 250 },
              { mount: '/Volumes/Share', type: 'smbfs', sizeBytes: 4000, usedBytes: 1000 },
            ]),
            health: signal({ healthy: true, label: 'Healthy', reasons: [] }),
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

  it('listsTheBusiestProcesses_inScope_andOrdered', async () => {
    const all: { result: { processes: { pid: number }[]; runningOnMachine: number } } = (await call(
      LIST_PROCESSES,
      {},
    )) as {
      result: { processes: { pid: number }[]; runningOnMachine: number };
    };
    expect(all.result.processes.map((process: { pid: number }): number => process.pid)).toEqual([
      400, 300, 100, 200,
    ]);
    expect(all.result.runningOnMachine).toBe(600);

    const studio: { result: { processes: { pid: number; studio?: string }[] } } = (await call(
      LIST_PROCESSES,
      { scope: 'studio', sort: 'memory' },
    )) as { result: { processes: { pid: number; studio?: string }[] } };
    expect(studio.result.processes.map((process: { pid: number }): number => process.pid)).toEqual([
      100, 200,
    ]);
    expect(studio.result.processes[0].studio).toBe('main');

    const system: { result: { processes: { pid: number }[] } } = (await call(LIST_PROCESSES, {
      scope: 'system',
    })) as { result: { processes: { pid: number }[] } };
    expect(system.result.processes.map((process: { pid: number }): number => process.pid)).toEqual([
      300,
    ]);

    const found: { result: { processes: { uptimeSeconds?: number; threads?: number }[] } } =
      (await call(LIST_PROCESSES, { text: 'watch', limit: 1 })) as {
        result: { processes: { uptimeSeconds?: number; threads?: number }[] };
      };
    expect(found.result.processes).toEqual([
      expect.objectContaining({ threads: 18, uptimeSeconds: 60 }),
    ]);
  });

  it('readsTheCpu_withItsHistoryCoresAndBusiestProcesses', async () => {
    const answer: { result: Record<string, unknown> } = (await call(READ_RESOURCE, {
      resource: 'cpu',
    })) as { result: Record<string, unknown> };

    expect(answer.result['utilisationPercent']).toEqual({
      latest: 30,
      low: 10,
      average: 20,
      high: 30,
    });
    expect(answer.result['perCorePercentNow']).toEqual([20, 40]);
    expect(
      (answer.result['busiestProcesses'] as { processes: { pid: number }[] }).processes[0].pid,
    ).toBe(400);
  });

  it('readsTheStorage_eachDriveWithItsVolumes_andSharesApart', async () => {
    const answer: {
      result: {
        devices: {
          id: string;
          activity: unknown;
          volumes: { mount: string; usedPercent: number }[];
        }[];
        otherVolumes: { mount: string }[];
      };
    } = (await call(READ_RESOURCE, { resource: 'storage' })) as {
      result: {
        devices: {
          id: string;
          activity: unknown;
          volumes: { mount: string; usedPercent: number }[];
        }[];
        otherVolumes: { mount: string }[];
      };
    };

    expect(answer.result.devices[0].volumes).toEqual([
      expect.objectContaining({ mount: '/', name: 'Macintosh HD', usedPercent: 25 }),
    ]);
    expect(answer.result.devices[0].activity).toEqual(
      expect.objectContaining({ utilisationPercent: 3 }),
    );
    expect(
      answer.result.otherVolumes.map((volume: { mount: string }): string => volume.mount),
    ).toEqual(['/Volumes/Share']);
  });

  it('saysWhichResourcesThereAre_whenAskedForAnother', async () => {
    const answer: { error: string } = (await call(READ_RESOURCE, { resource: 'printer' })) as {
      error: string;
    };
    expect(answer.error).toContain('system, cpu, memory, gpu, storage, network');
  });

  it('answersTheNewToolsOnlyForTheSystemMonitorsOwnAgent', async () => {
    expect(await call(LIST_PROCESSES, {}, EDITOR)).toEqual({ available: false });
    expect(await call(READ_RESOURCE, { resource: 'cpu' }, EDITOR)).toEqual({ available: false });
  });
});
