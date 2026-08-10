import { Signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, Mock, vi } from 'vitest';
import { DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { Log } from '@shared/angular/services/log/log';
import { LogQuery, LogRecord, LogSession, Severity } from '@shared/api/log-channels';
import { MetricsSample } from '@shared/api/system-monitor-channels';
import { SystemMonitorCommands } from '../system-monitor-commands/system-monitor-commands';
import { SystemMonitorMetrics } from '../metrics/system-monitor-metrics';
import { SystemMonitorView } from './system-monitor-view';

/**
 * A fake metrics client that records start/stop and lets a test drive the sample push.
 */
class FakeMetrics {
  public started: number = 0;
  public stopped: number = 0;
  public listener: ((sample: MetricsSample) => void) | null = null;

  public start(): void {
    this.started += 1;
  }

  public stop(): void {
    this.stopped += 1;
  }

  public onSample(listener: (sample: MetricsSample) => void): () => void {
    this.listener = listener;
    return (): void => {
      this.listener = null;
    };
  }
}

/**
 * Builds a metrics sample with sensible defaults, overridable per test.
 * @param over The fields to override.
 * @returns Returns the sample.
 */
function sample(over: Partial<MetricsSample> = {}): MetricsSample {
  return {
    timestamp: '2026-08-10T10:00:00.000Z',
    cpu: 42,
    memory: { usedBytes: 8 * 1024 ** 3, totalBytes: 16 * 1024 ** 3, percent: 50 },
    network: { rxBytesPerSec: 1024, txBytesPerSec: 512 },
    disk: { readBytesPerSec: 2048, writeBytesPerSec: 256 },
    gpu: { available: true, percent: 30 },
    ...over,
  };
}

/**
 * Builds a record with sensible defaults, overridable per test.
 * @param over The fields to override.
 * @returns Returns the record.
 */
function record(over: Partial<LogRecord> = {}): LogRecord {
  return {
    id: 1,
    sessionId: 'current',
    timestamp: '2026-08-10T10:00:00.000Z',
    severity: 'info',
    origin: 'main',
    source: 'test',
    message: 'hello',
    ...over,
  };
}

/**
 * A fake logging client that records its calls and lets a test drive the record push.
 */
class FakeLog {
  public records: LogRecord[] = [];
  public sessionList: LogSession[] = [
    { id: 'current', startedAt: '2026-08-10T09:00:00.000Z', current: true },
    { id: 'past', startedAt: '2026-08-09T09:00:00.000Z', current: false },
  ];
  public queries: LogQuery[] = [];
  public listener: ((record: LogRecord) => void) | null = null;

  public query(query: LogQuery = {}): Promise<LogRecord[]> {
    this.queries.push(query);
    return Promise.resolve(this.records);
  }

  public sessions(): Promise<LogSession[]> {
    return Promise.resolve(this.sessionList);
  }

  public onRecord(listener: (record: LogRecord) => void): () => void {
    this.listener = listener;
    return (): void => {
      this.listener = null;
    };
  }
}

/**
 * Exposes the view's protected surface for assertions.
 */
interface Testable {
  filtered: Signal<readonly LogRecord[]>;
  records: WritableSignal<readonly LogRecord[]>;
  text: WritableSignal<string>;
  sessionOptions: Signal<readonly DropdownOption[]>;
  selectedSessionValue: Signal<string>;
  cpuValue: Signal<string>;
  memoryValue: Signal<string>;
  networkValue: Signal<string>;
  diskValue: Signal<string>;
  gpuValue: Signal<string>;
  cpuHistory: WritableSignal<readonly number[]>;
  memoryHistory: WritableSignal<readonly number[]>;
  networkHistory: WritableSignal<readonly number[]>;
  diskHistory: WritableSignal<readonly number[]>;
  gpuHistory: WritableSignal<readonly number[]>;
  selectSession(sessionId: string): void;
  toggleSeverity(severity: Severity): void;
  isEnabled(severity: Severity): boolean;
}

describe('SystemMonitorView', () => {
  let fixture: ComponentFixture<SystemMonitorView>;
  let view: Testable;
  let fake: FakeLog;
  let metrics: FakeMetrics;

  /**
   * Creates the view with the fake log and metrics and the given seeded records, and settles the
   * initial load.
   * @param records The records the fake returns from a query.
   * @returns Returns a promise that resolves once the view has loaded.
   */
  async function create(records: LogRecord[] = []): Promise<void> {
    fake = new FakeLog();
    fake.records = records;
    metrics = new FakeMetrics();
    await TestBed.configureTestingModule({
      imports: [SystemMonitorView],
      providers: [
        { provide: Log, useValue: fake },
        { provide: SystemMonitorMetrics, useValue: metrics },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(SystemMonitorView);
    fixture.componentRef.setInput('tabId', 'tab-1');
    fixture.componentRef.setInput('isActive', true);
    view = fixture.componentInstance as unknown as Testable;
    fixture.detectChanges();
    await fixture.whenStable();
  }

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('load_populatesTheRecordsFromTheLiveSession', async () => {
    await create([record({ id: 1 }), record({ id: 2 })]);
    expect(view.records()).toHaveLength(2);
    expect(view.filtered()).toHaveLength(2);
  });

  it('toggleSeverity_hidesThatSeverity', async () => {
    await create([record({ id: 1, severity: 'info' }), record({ id: 2, severity: 'error' })]);
    view.toggleSeverity('info');
    expect(view.isEnabled('info')).toBe(false);
    expect(view.filtered().map((r: LogRecord): number => r.id)).toEqual([2]);
  });

  it('text_filtersOnSourceOrMessageCaseInsensitively', async () => {
    await create([
      record({ id: 1, source: 'DockerEngine', message: 'up' }),
      record({ id: 2, source: 'Composer', message: 'DOCKED' }),
      record({ id: 3, source: 'Other', message: 'nope' }),
    ]);
    view.text.set('dock');
    expect(view.filtered().map((r: LogRecord): number => r.id)).toEqual([1, 2]);
  });

  it('onRecord_appendsLiveRecordsForTheCurrentSession', async () => {
    await create([record({ id: 1 })]);
    fake.listener?.(record({ id: 2, sessionId: 'current', message: 'live' }));
    expect(view.records().map((r: LogRecord): number => r.id)).toEqual([1, 2]);
  });

  it('onRecord_ignoresRecordsFromAnotherSession', async () => {
    await create([record({ id: 1 })]);
    fake.listener?.(record({ id: 9, sessionId: 'past' }));
    expect(view.records()).toHaveLength(1);
  });

  it('selectSession_queriesThatSessionAndStopsLiveAppends', async () => {
    await create([record({ id: 1 })]);
    view.selectSession('past');
    await fixture.whenStable();
    expect(fake.queries.at(-1)).toEqual({ sessionId: 'past' });
    fake.listener?.(record({ id: 2, sessionId: 'current' }));
    expect(view.records().every((r: LogRecord): boolean => r.id !== 2)).toBe(true);
  });

  it('sessionOptions_marksTheLiveSessionAndDefaultsToIt', async () => {
    await create([]);
    expect(view.sessionOptions()[0].label).toContain('Current session');
    expect(view.selectedSessionValue()).toBe('current');
  });

  it('whenActive_registersWithTheRibbonCommandsAndReportsRecords', async () => {
    await create([record({ id: 1 })]);
    expect(TestBed.inject(SystemMonitorCommands).hasRecords()).toBe(true);
  });

  it('clearFilters_command_resetsSeverityAndText', async () => {
    await create([record({ id: 1 })]);
    view.toggleSeverity('info');
    view.text.set('needle');
    TestBed.inject(SystemMonitorCommands).clearFilters();
    expect(view.isEnabled('info')).toBe(true);
    expect(view.text()).toBe('');
  });

  it('refresh_command_reloadsTheRecords', async () => {
    await create([record({ id: 1 })]);
    const before: number = fake.queries.length;
    TestBed.inject(SystemMonitorCommands).refresh();
    await fixture.whenStable();
    expect(fake.queries.length).toBeGreaterThan(before);
  });

  it('copy_command_writesTheShownRecordsToTheClipboard', async () => {
    const writeText: Mock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await create([
      record({ id: 1, severity: 'error', source: 'S', message: 'boom', timestamp: '2026-08-10T10:00:00.000Z' }),
    ]);
    TestBed.inject(SystemMonitorCommands).copy();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith('2026-08-10T10:00:00.000Z [error] S: boom');
  });

  it('whenActive_startsSamplingAndStopsWhenHidden', async () => {
    await create();
    expect(metrics.started).toBeGreaterThan(0);
    const startedWhileActive: number = metrics.stopped;
    fixture.componentRef.setInput('isActive', false);
    fixture.detectChanges();
    expect(metrics.stopped).toBeGreaterThan(startedWhileActive);
  });

  it('sample_updatesTheTileValuesAndHistories', async () => {
    await create();
    metrics.listener?.(sample({ cpu: 42, memory: { usedBytes: 8 * 1024 ** 3, totalBytes: 16 * 1024 ** 3, percent: 50 } }));
    expect(view.cpuValue()).toBe('42%');
    expect(view.memoryValue()).toBe('8.0 GB / 16.0 GB (50%)');
    expect(view.cpuHistory()).toEqual([42]);
    expect(view.memoryHistory()).toEqual([50]);
  });

  it('cpuValue_isAPlaceholderBeforeTheFirstSample', async () => {
    await create();
    expect(view.cpuValue()).toBe('—');
  });

  it('sample_formatsNetworkAndDiskThroughputAndGpuPercent', async () => {
    await create();
    metrics.listener?.(sample());
    expect(view.networkValue()).toBe('↓ 1.0 KB/s · ↑ 512 B/s');
    expect(view.diskValue()).toBe('R 2.0 KB/s · W 256 B/s');
    expect(view.gpuValue()).toBe('30%');
    expect(view.networkHistory()).toEqual([1536]);
    expect(view.diskHistory()).toEqual([2304]);
    expect(view.gpuHistory()).toEqual([30]);
  });

  it('gpu_showsNotAvailableAndKeepsNoHistoryWhenUnsupported', async () => {
    await create();
    metrics.listener?.(sample({ gpu: { available: false, percent: 0 } }));
    expect(view.gpuValue()).toBe('N/A');
    expect(view.gpuHistory()).toEqual([]);
  });

  it('network_showsAPlaceholderAndKeepsNoHistoryWhenUnavailable', async () => {
    await create();
    metrics.listener?.(sample({ network: undefined }));
    expect(view.networkValue()).toBe('—');
    expect(view.networkHistory()).toEqual([]);
  });
});
