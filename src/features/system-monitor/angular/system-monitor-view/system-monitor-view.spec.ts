import { Signal, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, Mock, vi } from 'vitest';
import { DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { TableRow } from '@shared/angular/components/table/table';
import { DocumentVisibility } from '@shared/angular/services/document-visibility/document-visibility';
import { Log } from '@shared/angular/services/log/log';
import { Settings } from '@shared/angular/services/settings/settings';
import { LogQuery, LogRecord, LogSession, Severity } from '@shared/api/log-channels';
import { MetricsSample, ProcessesSnapshot, SystemInfo } from '@shared/api/system-monitor-channels';
import { SystemMonitorReadings } from '../readings/system-monitor-readings';
import { SystemMonitorProcesses } from '../readings/system-monitor-processes';
import { SystemMonitorCommands } from '../system-monitor-commands/system-monitor-commands';
import { SystemMonitorMetrics } from '../metrics/system-monitor-metrics';
import { SystemMonitorView } from './system-monitor-view';

/**
 * A fake metrics client that records start/stop and lets a test drive the sample push.
 */
class FakeMetrics {
  public started: number = 0;
  public stopped: number = 0;
  public rates: number[] = [];
  public listener: ((sample: MetricsSample) => void) | null = null;

  public start(): void {
    this.started += 1;
  }

  public setRate(intervalMs: number): void {
    this.rates.push(intervalMs);
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

  public processesStarted: number = 0;
  public processesStopped: number = 0;
  public processListener: ((snapshot: ProcessesSnapshot) => void) | null = null;
  public machine: SystemInfo | null = null;

  public startProcesses(): void {
    this.processesStarted += 1;
  }

  public stopProcesses(): void {
    this.processesStopped += 1;
  }

  public onProcesses(listener: (snapshot: ProcessesSnapshot) => void): () => void {
    this.processListener = listener;
    return (): void => {
      this.processListener = null;
    };
  }

  public info(): Promise<SystemInfo | null> {
    return Promise.resolve(this.machine);
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

  // The view provides the agent and its conversation (#966), which log through this service too.
  public debug(): void {
    // Intentionally empty.
  }
  public info(): void {
    // Intentionally empty.
  }
  public warn(): void {
    // Intentionally empty.
  }
  public error(): void {
    // Intentionally empty.
  }
  public enabled(): boolean {
    return false;
  }

  public query(query: LogQuery = {}): Promise<LogRecord[]> {
    this.queries.push(query);
    return Promise.resolve(this.records);
  }

  public sessions(): Promise<LogSession[]> {
    return Promise.resolve(this.sessionList);
  }

  public batchListener: ((records: readonly LogRecord[]) => void) | null = null;

  public onRecords(listener: (records: readonly LogRecord[]) => void): () => void {
    this.batchListener = listener;
    // Most tests push one record at a time; a record is a batch of one.
    this.listener = (record: LogRecord): void => listener([record]);
    return (): void => {
      this.batchListener = null;
      this.listener = null;
    };
  }

  /**
   * Drops a trace line: the view's status-strip registration logs one.
   */
  public trace(): void {
    // Intentionally empty.
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
  readings: SystemMonitorReadings;
  shownTab: Signal<string>;
  selectTab(tab: string): void;
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
  let onScreen: WritableSignal<boolean>;

  /**
   * Creates the view with the fake log and metrics and the given seeded records, and settles the
   * initial load.
   * @param records The records the fake returns from a query.
   * @returns Returns a promise that resolves once the view has loaded.
   */
  async function create(
    records: LogRecord[] = [],
    tab: string = 'logs',
    machine: SystemInfo | null = null,
  ): Promise<void> {
    fake = new FakeLog();
    fake.records = records;
    metrics = new FakeMetrics();
    metrics.machine = machine;
    onScreen = signal<boolean>(true);
    await TestBed.configureTestingModule({
      imports: [SystemMonitorView],
      providers: [
        { provide: Log, useValue: fake },
        { provide: SystemMonitorMetrics, useValue: metrics },
        { provide: DocumentVisibility, useValue: { visible: onScreen } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(SystemMonitorView);
    fixture.componentRef.setInput('tabId', 'tab-1');
    fixture.componentRef.setInput('isActive', true);
    view = fixture.componentInstance as unknown as Testable;
    // Most tests drive the logs, which only render on their own tab.
    view.selectTab(tab);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  afterEach(() => {
    // The refresh-rate tests write a setting; settings persist in local storage across tests.
    globalThis.localStorage?.clear();
    TestBed.resetTestingModule();
  });

  it('load_populatesTheRecordsFromTheLiveSession', async () => {
    await create([record({ id: 1 }), record({ id: 2 })]);
    expect(view.records()).toHaveLength(2);
    expect(view.filtered()).toHaveLength(2);
  });

  it('tabs_openOnOverview_withATabPerResource_andTheLogsOnTheirOwn', async () => {
    await create([], 'overview');
    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    const tabs: string[] = Array.from(host.querySelectorAll('[role="tab"]')).map(
      (tab: Element): string => tab.textContent?.trim() ?? '',
    );

    expect(tabs).toEqual([
      'Overview',
      'Processes',
      'CPU',
      'Memory',
      'Disk',
      'Network',
      'GPU',
      'Logs',
    ]);
    expect(host.querySelector('app-system-monitor-overview-tab')).not.toBeNull();
    expect(host.querySelector('app-table')).toBeNull();
  });

  it('gpuTab_isLeftOut_whenGpuMonitoringIsOff_andAChosenGpuTabFallsBackToOverview', async () => {
    await create([], 'gpu');
    expect(view.shownTab()).toBe('gpu');

    TestBed.inject(Settings).set('systemMonitor.gpuMonitoring', false);
    fixture.detectChanges();
    await fixture.whenStable();

    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(view.shownTab()).toBe('overview');
    expect(
      Array.from(host.querySelectorAll('[role="tab"]')).some(
        (tab: Element): boolean => tab.textContent?.trim() === 'GPU',
      ),
    ).toBe(false);
  });

  it('selectTab_ignoresAnUnknownTab', async () => {
    await create([], 'overview');
    view.selectTab('nonsense');
    expect(view.shownTab()).toBe('overview');
  });

  it('processes_areListedOnlyWhileTheProcessesTabIsInFront', async () => {
    await create([], 'overview');
    expect(metrics.processesStarted).toBe(0);

    view.selectTab('processes');
    fixture.detectChanges();
    expect(metrics.processesStarted).toBe(1);

    // Hiding the monitor stops the listing too, and showing it again restarts it.
    fixture.componentRef.setInput('isActive', false);
    fixture.detectChanges();
    expect(metrics.processesStopped).toBe(1);
    fixture.componentRef.setInput('isActive', true);
    fixture.detectChanges();
    expect(metrics.processesStarted).toBe(2);

    view.selectTab('cpu');
    fixture.detectChanges();
    expect(metrics.processesStopped).toBe(2);
  });

  it('processes_snapshotsReachTheListing', async () => {
    await create([], 'processes');
    metrics.processListener?.({
      timestamp: 't',
      total: 1,
      processes: [
        {
          pid: 7,
          parentPid: 1,
          name: 'node',
          command: 'node',
          user: 'me',
          cpuPercent: 3,
          memoryBytes: 1024,
          memoryPercent: 1,
        },
      ],
    });

    const listing: SystemMonitorProcesses =
      fixture.debugElement.injector.get(SystemMonitorProcesses);
    expect(listing.processes().map((process: { pid: number }): number => process.pid)).toEqual([7]);
  });

  it('info_isReadOnce_intoTheReadings', async () => {
    const machine: SystemInfo = {
      cpuModel: 'Test CPU',
      logicalCores: 8,
      totalMemoryBytes: 1024,
      os: 'TestOS 1',
    };
    await create([], 'overview', machine);

    expect(view.readings.info()).toEqual(machine);
  });

  it('severity_isAChip_tonedByHowSevereItIs', async () => {
    await create([
      record({ id: 1, severity: 'trace' }),
      record({ id: 2, severity: 'debug' }),
      record({ id: 3, severity: 'info' }),
      record({ id: 4, severity: 'warning' }),
      record({ id: 5, severity: 'error' }),
    ]);
    // Trace and debug are hidden by default; show every severity so each chip renders.
    for (const severity of ['trace', 'debug'] as const) {
      if (!view.isEnabled(severity)) {
        view.toggleSeverity(severity);
      }
    }
    fixture.detectChanges();

    const tones: Record<string, string> = {};
    for (const chip of (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
      'app-chip.system-monitor__badge',
    )) {
      tones[chip.textContent?.trim() ?? ''] =
        [...chip.classList].find((name: string): boolean => name.startsWith('chip--')) ?? '';
    }
    expect(tones).toEqual({
      TRACE: 'chip--neutral',
      DEBUG: 'chip--info',
      INFO: 'chip--accent',
      WARNING: 'chip--warning',
      ERROR: 'chip--danger',
    });
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

  it('onRecords_appendsABatchInOneWrite_skippingDuplicatesAndOtherSessions', async () => {
    // #980 P5: a write per record copied the whole buffer and re-ran the filter once per record.
    await create([record({ id: 1 }), record({ id: 2 })]);
    const writes: number[] = [];
    const records: WritableSignal<readonly LogRecord[]> = view.records;
    const update: WritableSignal<readonly LogRecord[]>['update'] = records.update.bind(records);
    records.update = (fn: (value: readonly LogRecord[]) => readonly LogRecord[]): void => {
      writes.push(1);
      update(fn);
    };

    fake.batchListener?.([
      record({ id: 2, message: 'already loaded' }),
      record({ id: 3 }),
      record({ id: 4, sessionId: 'past' }),
      record({ id: 5 }),
    ]);

    expect(writes).toHaveLength(1);
    expect(view.records().map((r: LogRecord): number => r.id)).toEqual([1, 2, 3, 5]);
  });

  it('rows_formatEachRecordOnce_andReuseTheRowAcrossFilterChanges', async () => {
    await create([
      record({ id: 1, severity: 'error', origin: 'renderer', window: 'Main' }),
      record({ id: 2, timestamp: 'not a time' }),
    ]);
    const first: TableRow = view.rows()[0];
    expect(first.data).toMatchObject({
      severityLabel: 'ERROR',
      tone: 'danger',
      origin: 'renderer · Main',
      time: new Date('2026-08-10T10:00:00.000Z').toLocaleTimeString(),
    });
    expect((view.rows()[1].data as { time: string }).time).toBe('not a time');

    view.text.set('hello');
    expect(view.rows()[0]).toBe(first);
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

  it('whenHidden_detachesTheLiveRecordStream_andReactivationCatchesUp', async () => {
    await create([record({ id: 1 })]);
    expect(fake.listener).not.toBeNull();
    fixture.componentRef.setInput('isActive', false);
    fixture.detectChanges();
    expect(fake.listener).toBeNull();
    // Records that land while hidden arrive through the reactivation reload, not the stream.
    fake.records = [record({ id: 1 }), record({ id: 2 })];
    const before: number = fake.queries.length;
    fixture.componentRef.setInput('isActive', true);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fake.listener).not.toBeNull();
    expect(fake.queries.length).toBeGreaterThan(before);
    expect(view.records().map((r: LogRecord): number => r.id)).toEqual([1, 2]);
  });

  it('whenActive_startsSamplingAndStopsWhenHidden', async () => {
    await create();
    expect(metrics.started).toBeGreaterThan(0);
    const startedWhileActive: number = metrics.stopped;
    fixture.componentRef.setInput('isActive', false);
    fixture.detectChanges();
    expect(metrics.stopped).toBeGreaterThan(startedWhileActive);
  });

  it('whenTheWindowLeavesTheScreen_samplingAndTheLiveStreamPause_andResumeWhenItReturns', async () => {
    // Audit P4: the tab stays active behind another app or on another desktop; its feeds should not.
    await create([record({ id: 1 })]);
    expect(metrics.started).toBe(1);
    expect(fake.listener).not.toBeNull();
    const queries: number = fake.queries.length;

    onScreen.set(false);
    fixture.detectChanges();
    expect(metrics.stopped).toBe(1);
    expect(fake.listener).toBeNull();
    expect(TestBed.inject(SystemMonitorCommands).hasRecords()).toBe(true);

    onScreen.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(metrics.started).toBe(2);
    expect(fake.listener).not.toBeNull();
    expect(fake.queries.length).toBeGreaterThan(queries);
  });

  it('refreshRate_isSentBeforeSamplingStarts_andAChangeRetimesWithoutRestarting', async () => {
    await create();
    // Audit P3: the user's rate reaches the backend ahead of the first start, so the loop never runs
    // at the wrong rate; changing it afterwards is one rate message, not a stop and a start.
    expect(metrics.rates).toEqual([1000]);
    expect(metrics.started).toBe(1);
    TestBed.inject(Settings).set('systemMonitor.refreshRate', 500);
    fixture.detectChanges();
    expect(metrics.rates).toEqual([1000, 500]);
    expect(metrics.started).toBe(1);
    expect(metrics.stopped).toBe(0);
  });

  it('refreshRate_paused_stopsSampling_andResumesWhenARateIsChosenAgain', async () => {
    await create();
    TestBed.inject(Settings).set('systemMonitor.refreshRate', 0);
    fixture.detectChanges();
    expect(metrics.stopped).toBe(1);
    TestBed.inject(Settings).set('systemMonitor.refreshRate', 4000);
    fixture.detectChanges();
    expect(metrics.started).toBe(2);
    expect(metrics.rates.at(-1)).toBe(4000);
  });

  it('sample_updatesTheTileValuesAndHistories', async () => {
    await create();
    metrics.listener?.(
      sample({
        cpu: 42,
        memory: { usedBytes: 8 * 1024 ** 3, totalBytes: 16 * 1024 ** 3, percent: 50 },
      }),
    );
    expect(view.readings.cpuValue()).toBe('42%');
    expect(view.readings.memoryValue()).toBe('8.0 GB (50%)');
    expect(view.readings.memoryTotal()).toBe('16.0 GB');
    expect(view.readings.cpuHistory()).toEqual([42]);
    expect(view.readings.memoryHistory()).toEqual([50]);
  });

  it('cpuValue_isAPlaceholderBeforeTheFirstSample', async () => {
    await create();
    expect(view.readings.cpuValue()).toBe('—');
  });

  it('sample_splitsCpuAndMemoryIntoSysAndAppWhenAppShareIsPresent', async () => {
    await create();
    metrics.listener?.(
      sample({ app: { cpuPercent: 12, memoryBytes: 512 * 1024 ** 2, memoryPercent: 3 } }),
    );
    expect(view.readings.cpuAppValue()).toBe('12%');
    expect(view.readings.memoryAppValue()).toBe('512.0 MB (3%)');
    expect(view.readings.appCpuHistory()).toEqual([12]);
    expect(view.readings.appMemoryHistory()).toEqual([3]);
  });

  it('sample_omitsTheAppReadingAndKeepsNoAppHistoryWhenNotAttributed', async () => {
    await create();
    metrics.listener?.(sample({ app: undefined }));
    expect(view.readings.cpuAppValue()).toBeNull();
    expect(view.readings.memoryAppValue()).toBeNull();
    expect(view.readings.appCpuHistory()).toEqual([]);
    expect(view.readings.appMemoryHistory()).toEqual([]);
  });

  it('sample_splitsNetworkAndDiskIntoIndependentSeriesAndFormatsGpuPercent', async () => {
    await create();
    metrics.listener?.(sample());
    expect(view.readings.networkRxValue()).toBe('1.0 KB/s');
    expect(view.readings.networkTxValue()).toBe('512 B/s');
    expect(view.readings.diskReadValue()).toBe('2.0 KB/s');
    expect(view.readings.diskWriteValue()).toBe('256 B/s');
    expect(view.readings.gpuValue()).toBe('30%');
    expect(view.readings.networkRxHistory()).toEqual([1024]);
    expect(view.readings.networkTxHistory()).toEqual([512]);
    expect(view.readings.diskReadHistory()).toEqual([2048]);
    expect(view.readings.diskWriteHistory()).toEqual([256]);
    expect(view.readings.gpuHistory()).toEqual([30]);
  });

  it('gpu_showsNotAvailableAndKeepsNoHistoryWhenUnsupported', async () => {
    await create();
    metrics.listener?.(sample({ gpu: { available: false, percent: 0 } }));
    expect(view.readings.gpuValue()).toBe('N/A');
    expect(view.readings.gpuHistory()).toEqual([]);
  });

  it('network_showsPlaceholdersAndKeepsNoHistoryWhenUnavailable', async () => {
    await create();
    metrics.listener?.(sample({ network: undefined }));
    expect(view.readings.networkRxValue()).toBe('—');
    expect(view.readings.networkTxValue()).toBe('—');
    expect(view.readings.networkRxHistory()).toEqual([]);
    expect(view.readings.networkTxHistory()).toEqual([]);
  });
});
