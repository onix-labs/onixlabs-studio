import { Signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, Mock, vi } from 'vitest';
import { DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { TableRow } from '@shared/angular/components/table/table';
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
  cpuAppValue: Signal<string | null>;
  memoryValue: Signal<string>;
  memoryTotal: Signal<string | null>;
  memoryAppValue: Signal<string | null>;
  networkRxValue: Signal<string>;
  networkTxValue: Signal<string>;
  diskReadValue: Signal<string>;
  diskWriteValue: Signal<string>;
  gpuValue: Signal<string>;
  cpuHistory: WritableSignal<readonly number[]>;
  memoryHistory: WritableSignal<readonly number[]>;
  appCpuHistory: WritableSignal<readonly number[]>;
  appMemoryHistory: WritableSignal<readonly number[]>;
  networkRxHistory: WritableSignal<readonly number[]>;
  networkTxHistory: WritableSignal<readonly number[]>;
  diskReadHistory: WritableSignal<readonly number[]>;
  diskWriteHistory: WritableSignal<readonly number[]>;
  gpuHistory: WritableSignal<readonly number[]>;
  selectSession(sessionId: string): void;
  toggleSeverity(severity: Severity): void;
  isEnabled(severity: Severity): boolean;
  selected: WritableSignal<ReadonlySet<string>>;
  selectedCount: Signal<number>;
  rows: Signal<readonly TableRow[]>;
  toggleRow(row: TableRow): void;
  clearSelection(): void;
  copy(): Promise<void>;
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

  it('onRecord_ignoresARecordAlreadyPresent', async () => {
    // A record's broadcast and the initial query reply travel on separate IPC channels, so a record
    // already in the loaded snapshot can be broadcast afterwards; re-appending it would duplicate a
    // row id and trip Angular's @for tracking (NG0955).
    await create([record({ id: 1 }), record({ id: 2 })]);
    fake.listener?.(record({ id: 2, sessionId: 'current', message: 'duplicate broadcast' }));
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
      record({
        id: 1,
        severity: 'error',
        source: 'S',
        message: 'boom',
        timestamp: '2026-08-10T10:00:00.000Z',
      }),
    ]);
    TestBed.inject(SystemMonitorCommands).copy();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith('2026-08-10T10:00:00.000Z [error] S: boom');
  });

  it('copy_withRowsSelected_writesOnlyTheSelectedRecords', async () => {
    const writeText: Mock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await create([
      record({
        id: 1,
        severity: 'error',
        source: 'A',
        message: 'first',
        timestamp: '2026-08-10T10:00:00.000Z',
      }),
      record({
        id: 2,
        severity: 'info',
        source: 'B',
        message: 'second',
        timestamp: '2026-08-10T10:00:01.000Z',
      }),
    ]);

    // Select only the second row, then copy.
    view.toggleRow(view.rows()[1]);
    expect(view.selectedCount()).toBe(1);
    await view.copy();
    expect(writeText).toHaveBeenCalledWith('2026-08-10T10:00:01.000Z [info] B: second');
  });

  it('toggleRow_deselectsOnASecondClick_andClearSelectionEmptiesIt', async () => {
    await create([
      record({
        id: 1,
        severity: 'error',
        source: 'A',
        message: 'first',
        timestamp: '2026-08-10T10:00:00.000Z',
      }),
    ]);
    const row: TableRow = view.rows()[0];
    view.toggleRow(row);
    expect(view.selectedCount()).toBe(1);
    view.toggleRow(row);
    expect(view.selectedCount()).toBe(0);
    view.toggleRow(row);
    view.clearSelection();
    expect(view.selectedCount()).toBe(0);
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
    metrics.listener?.(
      sample({
        cpu: 42,
        memory: { usedBytes: 8 * 1024 ** 3, totalBytes: 16 * 1024 ** 3, percent: 50 },
      }),
    );
    expect(view.cpuValue()).toBe('42%');
    expect(view.memoryValue()).toBe('8.0 GB (50%)');
    expect(view.memoryTotal()).toBe('16.0 GB');
    expect(view.cpuHistory()).toEqual([42]);
    expect(view.memoryHistory()).toEqual([50]);
  });

  it('cpuValue_isAPlaceholderBeforeTheFirstSample', async () => {
    await create();
    expect(view.cpuValue()).toBe('—');
  });

  it('sample_splitsCpuAndMemoryIntoSysAndAppWhenAppShareIsPresent', async () => {
    await create();
    metrics.listener?.(
      sample({ app: { cpuPercent: 12, memoryBytes: 512 * 1024 ** 2, memoryPercent: 3 } }),
    );
    expect(view.cpuAppValue()).toBe('12%');
    expect(view.memoryAppValue()).toBe('512.0 MB (3%)');
    expect(view.appCpuHistory()).toEqual([12]);
    expect(view.appMemoryHistory()).toEqual([3]);
  });

  it('sample_omitsTheAppReadingAndKeepsNoAppHistoryWhenNotAttributed', async () => {
    await create();
    metrics.listener?.(sample({ app: undefined }));
    expect(view.cpuAppValue()).toBeNull();
    expect(view.memoryAppValue()).toBeNull();
    expect(view.appCpuHistory()).toEqual([]);
    expect(view.appMemoryHistory()).toEqual([]);
  });

  it('sample_splitsNetworkAndDiskIntoIndependentSeriesAndFormatsGpuPercent', async () => {
    await create();
    metrics.listener?.(sample());
    expect(view.networkRxValue()).toBe('1.0 KB/s');
    expect(view.networkTxValue()).toBe('512 B/s');
    expect(view.diskReadValue()).toBe('2.0 KB/s');
    expect(view.diskWriteValue()).toBe('256 B/s');
    expect(view.gpuValue()).toBe('30%');
    expect(view.networkRxHistory()).toEqual([1024]);
    expect(view.networkTxHistory()).toEqual([512]);
    expect(view.diskReadHistory()).toEqual([2048]);
    expect(view.diskWriteHistory()).toEqual([256]);
    expect(view.gpuHistory()).toEqual([30]);
  });

  it('gpu_showsNotAvailableAndKeepsNoHistoryWhenUnsupported', async () => {
    await create();
    metrics.listener?.(sample({ gpu: { available: false, percent: 0 } }));
    expect(view.gpuValue()).toBe('N/A');
    expect(view.gpuHistory()).toEqual([]);
  });

  it('network_showsPlaceholdersAndKeepsNoHistoryWhenUnavailable', async () => {
    await create();
    metrics.listener?.(sample({ network: undefined }));
    expect(view.networkRxValue()).toBe('—');
    expect(view.networkTxValue()).toBe('—');
    expect(view.networkRxHistory()).toEqual([]);
    expect(view.networkTxHistory()).toEqual([]);
  });
});
