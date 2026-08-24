import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  InputSignal,
  Signal,
  signal,
  WritableSignal,
} from '@angular/core';
import { Button } from '@shared/angular/components/forms/button/button';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { Table, TableColumn, TableRow, TableRowDef } from '@shared/angular/components/table/table';
import { Log } from '@shared/angular/services/log/log';
import { LogRecord, LogSession, SEVERITIES, Severity } from '@shared/api/log-channels';
import { MetricsSample, METRICS_HISTORY } from '@shared/api/system-monitor-channels';
import { MetricTile, TileChannel } from '../metric-tile/metric-tile';
import { SystemMonitorMetrics } from '../metrics/system-monitor-metrics';
import {
  SystemMonitorCommandHandler,
  SystemMonitorCommands,
} from '../system-monitor-commands/system-monitor-commands';

/**
 * The severities shown by default: the notable ones. Trace and debug are fine-grained diagnostics,
 * off by default so the audit stays readable, and toggled on when investigating.
 */
const DEFAULT_SEVERITIES: readonly Severity[] = ['info', 'warning', 'error'];

/**
 * The audit table's columns: a fixed-width severity badge and timestamp bracket a fixed-width source
 * and the flexing message.
 */
const AUDIT_COLUMNS: readonly TableColumn[] = [
  { id: 'severity', header: 'Severity', width: '6rem' },
  { id: 'where', header: 'Where', width: '12rem' },
  { id: 'message', header: 'Message' },
  { id: 'timestamp', header: 'Timestamp', width: '9rem' },
];

/**
 * The System Monitor tab. This phase (epic #395 P2 / #397) is the per-session **log audit**: a live,
 * filterable table of every log record — main-process and every renderer window — for the selected app
 * session, sourced from the P1 logging service. The live session streams in over the record push; a
 * past session is loaded from disk. Severity and free-text filters apply client-side over the buffered
 * records. The metric tiles (CPU/Memory/Network/Disk/GPU) land above this in P3/P4.
 */
@Component({
  selector: 'app-system-monitor-view',
  imports: [Button, Dropdown, TextField, Table, TableRowDef, MetricTile],
  templateUrl: './system-monitor-view.html',
  styleUrl: './system-monitor-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SystemMonitorView {
  /**
   * Gets the severities in display order, exposed for the filter chips.
   */
  protected readonly severities: readonly Severity[] = SEVERITIES;

  /**
   * Gets the audit table's columns.
   */
  protected readonly columns: readonly TableColumn[] = AUDIT_COLUMNS;

  /**
   * Gets the identifier of the tab hosting this view.
   */
  public readonly tabId: InputSignal<string> = input.required<string>();

  /**
   * Gets whether this tab is the active one.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Holds the logging client the view reads and streams through.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the metrics client the tiles sample through.
   */
  private readonly metrics: SystemMonitorMetrics = inject(SystemMonitorMetrics);

  /**
   * Holds the most recent metrics sample, or null before the first arrives.
   */
  private readonly latest: WritableSignal<MetricsSample | null> = signal<MetricsSample | null>(
    null,
  );

  /**
   * Holds the recent CPU utilisation history (percent), oldest first, for the CPU sparkline.
   */
  protected readonly cpuHistory: WritableSignal<readonly number[]> = signal<readonly number[]>([]);

  /**
   * Holds the recent memory-use history (percent), oldest first, for the memory sparkline.
   */
  protected readonly memoryHistory: WritableSignal<readonly number[]> = signal<readonly number[]>(
    [],
  );

  /**
   * Holds the recent app CPU-share history (percent), oldest first, overlaid on the CPU sparkline.
   */
  protected readonly appCpuHistory: WritableSignal<readonly number[]> = signal<readonly number[]>(
    [],
  );

  /**
   * Holds the recent app memory-share history (percent), oldest first, overlaid on the memory sparkline.
   */
  protected readonly appMemoryHistory: WritableSignal<readonly number[]> = signal<
    readonly number[]
  >([]);

  /**
   * Gets the CPU tile's current machine-wide reading, formatted as a percentage.
   */
  protected readonly cpuValue: Signal<string> = computed((): string => {
    const sample: MetricsSample | null = this.latest();
    return sample === null ? '—' : `${Math.round(sample.cpu)}%`;
  });

  /**
   * Gets the CPU tile's app-share reading, formatted as a percentage, or null when the app share was
   * not read (so the tile shows the machine reading alone).
   */
  protected readonly cpuAppValue: Signal<string | null> = computed((): string | null => {
    const usage: MetricsSample['app'] = this.latest()?.app;
    return usage === undefined ? null : `${Math.round(usage.cpuPercent)}%`;
  });

  /**
   * Gets the total physical memory, formatted for the memory tile's label suffix, or null before the
   * first sample.
   */
  protected readonly memoryTotal: Signal<string | null> = computed((): string | null => {
    const sample: MetricsSample | null = this.latest();
    return sample === null ? null : this.formatBytes(sample.memory.totalBytes);
  });

  /**
   * Gets the memory tile's current machine-wide reading: used bytes with the percentage (the total is
   * shown against the tile label).
   */
  protected readonly memoryValue: Signal<string> = computed((): string => {
    const sample: MetricsSample | null = this.latest();
    if (sample === null) {
      return '—';
    }
    const { usedBytes, percent }: MetricsSample['memory'] = sample.memory;
    return `${this.formatBytes(usedBytes)} (${Math.round(percent)}%)`;
  });

  /**
   * Gets the memory tile's app-share reading, formatted as bytes with the percentage, or null when the
   * app share was not read.
   */
  protected readonly memoryAppValue: Signal<string | null> = computed((): string | null => {
    const usage: MetricsSample['app'] = this.latest()?.app;
    return usage === undefined
      ? null
      : `${this.formatBytes(usage.memoryBytes)} (${Math.round(usage.memoryPercent)}%)`;
  });

  /**
   * Holds the recent inbound (received) network-throughput history (bytes/sec), oldest first.
   */
  protected readonly networkRxHistory: WritableSignal<readonly number[]> = signal<
    readonly number[]
  >([]);

  /**
   * Holds the recent outbound (sent) network-throughput history (bytes/sec), oldest first.
   */
  protected readonly networkTxHistory: WritableSignal<readonly number[]> = signal<
    readonly number[]
  >([]);

  /**
   * Holds the recent disk read-throughput history (bytes/sec), oldest first.
   */
  protected readonly diskReadHistory: WritableSignal<readonly number[]> = signal<readonly number[]>(
    [],
  );

  /**
   * Holds the recent disk write-throughput history (bytes/sec), oldest first.
   */
  protected readonly diskWriteHistory: WritableSignal<readonly number[]> = signal<
    readonly number[]
  >([]);

  /**
   * Holds the recent GPU-utilisation history (percent), oldest first.
   */
  protected readonly gpuHistory: WritableSignal<readonly number[]> = signal<readonly number[]>([]);

  /**
   * Gets the network tile's received-throughput reading, or a placeholder when unavailable.
   */
  protected readonly networkRxValue: Signal<string> = computed((): string => {
    const network: MetricsSample['network'] = this.latest()?.network;
    return network === undefined ? '—' : this.formatRate(network.rxBytesPerSec);
  });

  /**
   * Gets the network tile's sent-throughput reading, or a placeholder when unavailable.
   */
  protected readonly networkTxValue: Signal<string> = computed((): string => {
    const network: MetricsSample['network'] = this.latest()?.network;
    return network === undefined ? '—' : this.formatRate(network.txBytesPerSec);
  });

  /**
   * Gets the disk tile's read-throughput reading, or a placeholder when unavailable.
   */
  protected readonly diskReadValue: Signal<string> = computed((): string => {
    const disk: MetricsSample['disk'] = this.latest()?.disk;
    return disk === undefined ? '—' : this.formatRate(disk.readBytesPerSec);
  });

  /**
   * Gets the disk tile's write-throughput reading, or a placeholder when unavailable.
   */
  protected readonly diskWriteValue: Signal<string> = computed((): string => {
    const disk: MetricsSample['disk'] = this.latest()?.disk;
    return disk === undefined ? '—' : this.formatRate(disk.writeBytesPerSec);
  });

  /**
   * Gets the GPU tile's current value: its utilisation, or `N/A` where the platform does not report it.
   */
  protected readonly gpuValue: Signal<string> = computed((): string => {
    const gpu: MetricsSample['gpu'] = this.latest()?.gpu;
    if (this.latest() === null) {
      return '—';
    }
    return gpu?.available === true ? `${Math.round(gpu.percent)}%` : 'N/A';
  });

  /**
   * Gets the CPU tile's channel: a single graph with the machine reading and the app overlay.
   */
  protected readonly cpuChannels: Signal<readonly TileChannel[]> = computed(
    (): readonly TileChannel[] => [
      {
        value: this.cpuValue(),
        values: this.cpuHistory(),
        appValue: this.cpuAppValue(),
        appValues: this.appCpuHistory(),
      },
    ],
  );

  /**
   * Gets the GPU tile's channel: a single utilisation graph (no app attribution is possible).
   */
  protected readonly gpuChannels: Signal<readonly TileChannel[]> = computed(
    (): readonly TileChannel[] => [{ value: this.gpuValue(), values: this.gpuHistory() }],
  );

  /**
   * Gets the Memory tile's channel: a single graph with the used reading and the app overlay.
   */
  protected readonly memoryChannels: Signal<readonly TileChannel[]> = computed(
    (): readonly TileChannel[] => [
      {
        value: this.memoryValue(),
        values: this.memoryHistory(),
        appValue: this.memoryAppValue(),
        appValues: this.appMemoryHistory(),
      },
    ],
  );

  /**
   * Gets the Network tile's channels: independently-scaled Received and Sent graphs.
   */
  protected readonly networkChannels: Signal<readonly TileChannel[]> = computed(
    (): readonly TileChannel[] => [
      {
        caption: 'Received',
        value: this.networkRxValue(),
        values: this.networkRxHistory(),
        max: Math.max(1, ...this.networkRxHistory()),
      },
      {
        caption: 'Sent',
        value: this.networkTxValue(),
        values: this.networkTxHistory(),
        max: Math.max(1, ...this.networkTxHistory()),
      },
    ],
  );

  /**
   * Gets the Disk tile's channels: independently-scaled Read and Write graphs.
   */
  protected readonly diskChannels: Signal<readonly TileChannel[]> = computed(
    (): readonly TileChannel[] => [
      {
        caption: 'Read',
        value: this.diskReadValue(),
        values: this.diskReadHistory(),
        max: Math.max(1, ...this.diskReadHistory()),
      },
      {
        caption: 'Write',
        value: this.diskWriteValue(),
        values: this.diskWriteHistory(),
        max: Math.max(1, ...this.diskWriteHistory()),
      },
    ],
  );

  /**
   * Holds the records of the selected session, oldest first.
   */
  protected readonly records: WritableSignal<readonly LogRecord[]> = signal<readonly LogRecord[]>(
    [],
  );

  /**
   * Holds the known app sessions, newest first.
   */
  protected readonly sessions: WritableSignal<readonly LogSession[]> = signal<
    readonly LogSession[]
  >([]);

  /**
   * Holds the identifier of the live (current) session, so a selection can be recognised as live.
   */
  private readonly currentSessionId: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds the identifier of the session being viewed; null until sessions load, then the live session.
   */
  protected readonly selectedSessionId: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds the severities currently shown; all are shown initially.
   */
  protected readonly enabled: WritableSignal<ReadonlySet<Severity>> = signal<ReadonlySet<Severity>>(
    new Set<Severity>(DEFAULT_SEVERITIES),
  );

  /**
   * Holds the case-insensitive text the source or message must contain; empty shows all.
   */
  protected readonly text: WritableSignal<string> = signal<string>('');

  /**
   * Holds the ids (as strings) of the rows the user has selected by clicking them, so Copy can act on a
   * chosen subset rather than the whole audit. Empty means nothing is selected (Copy falls back to all).
   */
  protected readonly selected: WritableSignal<ReadonlySet<string>> = signal<ReadonlySet<string>>(
    new Set<string>(),
  );

  /**
   * Gets the number of currently-selected rows, for the toolbar count and to gate "copy selected".
   */
  protected readonly selectedCount: Signal<number> = computed((): number => this.selected().size);

  /**
   * Gets whether the viewed session is the live one, so new records stream into it.
   */
  private readonly viewingLive: Signal<boolean> = computed((): boolean => {
    const selected: string | null = this.selectedSessionId();
    return selected === null || selected === this.currentSessionId();
  });

  /**
   * Gets the records after the severity and text filters, oldest first.
   */
  protected readonly filtered: Signal<readonly LogRecord[]> = computed((): readonly LogRecord[] => {
    const enabled: ReadonlySet<Severity> = this.enabled();
    const needle: string = this.text().trim().toLowerCase();
    return this.records().filter((record: LogRecord): boolean => {
      if (!enabled.has(record.severity)) {
        return false;
      }
      if (
        needle.length > 0 &&
        !`${record.source} ${record.message}`.toLowerCase().includes(needle)
      ) {
        return false;
      }
      return true;
    });
  });

  /**
   * Gets the filtered records adapted to the table's row shape, oldest first.
   */
  protected readonly rows: Signal<readonly TableRow[]> = computed((): readonly TableRow[] =>
    this.filtered().map((record: LogRecord): TableRow => ({ id: String(record.id), data: record })),
  );

  /**
   * Gets whether the audit currently shows any records, gating the ribbon's Copy action.
   */
  private readonly hasRecords: Signal<boolean> = computed(
    (): boolean => this.filtered().length > 0,
  );

  /**
   * Holds the command registry the ribbon drives this view through while active.
   */
  private readonly commands: SystemMonitorCommands = inject(SystemMonitorCommands);

  /**
   * Holds the handler the ribbon drives the active view through.
   */
  private readonly commandHandler: SystemMonitorCommandHandler = {
    hasRecords: this.hasRecords,
    refresh: (): void => this.refresh(),
    clearFilters: (): void => this.clearFilters(),
    copy: (): void => void this.copy(),
  };

  /**
   * Gets the session picker options, newest first, the live session marked.
   */
  protected readonly sessionOptions: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] =>
      this.sessions().map(
        (session: LogSession): DropdownOption => ({
          value: session.id,
          label: session.current
            ? `Current session — ${this.formatDate(session.startedAt)}`
            : this.formatDate(session.startedAt),
        }),
      ),
  );

  /**
   * Gets the value shown in the session picker: the selection, falling back to the live session.
   */
  protected readonly selectedSessionValue: Signal<string> = computed(
    (): string => this.selectedSessionId() ?? this.currentSessionId() ?? '',
  );

  /**
   * Loads the sessions and the live session's records, then streams new live records in.
   */
  public constructor() {
    void this.loadSessions();
    void this.loadRecords();

    const unsubscribe: () => void = this.log.onRecord((record: LogRecord): void => {
      if (!this.viewingLive() || record.sessionId !== this.currentSessionId()) {
        return;
      }
      this.records.update((records: readonly LogRecord[]): readonly LogRecord[] => {
        // Ids are strictly monotonic within a session and the buffer is held oldest-first, so the
        // last record holds the highest id. A record's broadcast and the initial query reply travel
        // on separate IPC channels and can arrive out of order, so a record already included in the
        // loaded snapshot can be broadcast afterwards; appending it again would duplicate a row id
        // and trip Angular's @for tracking (NG0955). Only append records newer than the last held.
        const last: LogRecord | undefined = records[records.length - 1];
        return last !== undefined && record.id <= last.id ? records : [...records, record];
      });
    });
    const unsubscribeSamples: () => void = this.metrics.onSample((sample: MetricsSample): void =>
      this.accept(sample),
    );

    const destroy: DestroyRef = inject(DestroyRef);
    destroy.onDestroy(unsubscribe);
    destroy.onDestroy(unsubscribeSamples);
    destroy.onDestroy((): void => this.commands.unregister(this.commandHandler));
    destroy.onDestroy((): void => this.metrics.stop());

    // Sampling and the ribbon handler follow the tab's visibility: nothing is sampled while the
    // monitor is hidden (the performance-audit posture).
    effect((): void => {
      if (this.isActive()) {
        this.commands.register(this.commandHandler);
        this.metrics.start();
      } else {
        this.commands.unregister(this.commandHandler);
        this.metrics.stop();
      }
    });
  }

  /**
   * Records one metrics sample: it becomes the current reading and is appended to the sparkline
   * histories, which are bounded to {@link METRICS_HISTORY} points.
   * @param sample The sample to accept.
   */
  private accept(sample: MetricsSample): void {
    this.latest.set(sample);
    this.push(this.cpuHistory, sample.cpu);
    this.push(this.memoryHistory, sample.memory.percent);
    if (sample.app !== undefined) {
      this.push(this.appCpuHistory, sample.app.cpuPercent);
      this.push(this.appMemoryHistory, sample.app.memoryPercent);
    }
    if (sample.network !== undefined) {
      this.push(this.networkRxHistory, sample.network.rxBytesPerSec);
      this.push(this.networkTxHistory, sample.network.txBytesPerSec);
    }
    if (sample.disk !== undefined) {
      this.push(this.diskReadHistory, sample.disk.readBytesPerSec);
      this.push(this.diskWriteHistory, sample.disk.writeBytesPerSec);
    }
    if (sample.gpu?.available === true) {
      this.push(this.gpuHistory, sample.gpu.percent);
    }
  }

  /**
   * Appends one value to a bounded history signal.
   * @param history The history signal to append to.
   * @param value The value to append.
   */
  private push(history: WritableSignal<readonly number[]>, value: number): void {
    history.update((values: readonly number[]): readonly number[] =>
      [...values, value].slice(-METRICS_HISTORY),
    );
  }

  /**
   * Formats a byte count as a human-readable size.
   * @param bytes The size in bytes.
   * @returns Returns the formatted size (for example `6.1 GB`).
   */
  protected formatBytes(bytes: number): string {
    const units: readonly string[] = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size: number = bytes;
    let unit: number = 0;
    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024;
      unit += 1;
    }
    return `${unit === 0 ? size : size.toFixed(1)} ${units[unit]}`;
  }

  /**
   * Formats a per-second byte rate as a human-readable throughput.
   * @param bytesPerSec The rate in bytes per second.
   * @returns Returns the formatted throughput (for example `1.2 MB/s`).
   */
  protected formatRate(bytesPerSec: number): string {
    return `${this.formatBytes(bytesPerSec)}/s`;
  }

  /**
   * Reloads the sessions and the viewed session's records (ribbon action).
   */
  protected refresh(): void {
    void this.loadSessions();
    void this.loadRecords();
  }

  /**
   * Resets the severity and text filters to their defaults (ribbon action).
   */
  protected clearFilters(): void {
    this.enabled.set(new Set<Severity>(DEFAULT_SEVERITIES));
    this.text.set('');
  }

  /**
   * Copies log records to the clipboard as one human-readable line each (ribbon action). Copies the
   * selected rows when any are selected, otherwise every currently-shown record. A no-op where the
   * clipboard is unavailable.
   * @returns Returns a promise that resolves once the copy settles.
   */
  protected async copy(): Promise<void> {
    const selected: ReadonlySet<string> = this.selected();
    const records: readonly LogRecord[] =
      selected.size > 0
        ? this.filtered().filter((record: LogRecord): boolean => selected.has(String(record.id)))
        : this.filtered();
    const text: string = records
      .map(
        (record: LogRecord): string =>
          `${record.timestamp} [${record.severity}] ${record.source}: ${record.message}`,
      )
      .join('\n');
    try {
      await navigator.clipboard?.writeText(text);
    } catch {
      // A denied or unavailable clipboard is deliberately swallowed.
    }
  }

  /**
   * Toggles whether a clicked row is selected, so Copy can act on a chosen subset. Clicking a selected
   * row deselects it.
   * @param row The clicked table row.
   */
  protected toggleRow(row: TableRow): void {
    this.selected.update((selected: ReadonlySet<string>): ReadonlySet<string> => {
      const next: Set<string> = new Set<string>(selected);
      if (!next.delete(row.id)) {
        next.add(row.id);
      }
      return next;
    });
  }

  /**
   * Clears the row selection (the toolbar action and Escape in the table).
   */
  protected clearSelection(): void {
    this.selected.set(new Set<string>());
  }

  /**
   * Switches the viewed session and loads its records.
   * @param sessionId The session to view.
   */
  protected selectSession(sessionId: string): void {
    this.selectedSessionId.set(sessionId);
    void this.loadRecords();
  }

  /**
   * Toggles whether a severity is shown.
   * @param severity The severity to toggle.
   */
  protected toggleSeverity(severity: Severity): void {
    this.enabled.update((enabled: ReadonlySet<Severity>): ReadonlySet<Severity> => {
      const next: Set<Severity> = new Set<Severity>(enabled);
      if (next.has(severity)) {
        next.delete(severity);
      } else {
        next.add(severity);
      }
      return next;
    });
  }

  /**
   * Determines whether a severity is currently shown.
   * @param severity The severity to test.
   * @returns Returns true when the severity is shown.
   */
  protected isEnabled(severity: Severity): boolean {
    return this.enabled().has(severity);
  }

  /**
   * Clears the text filter.
   */
  protected clearText(): void {
    this.text.set('');
  }

  /**
   * Reads a table row's record payload.
   * @param row The table row.
   * @returns Returns the row's log record.
   */
  protected rec(row: TableRow): LogRecord {
    return row.data as LogRecord;
  }

  /**
   * Gets the display label for a severity (its upper-cased name).
   * @param severity The severity.
   * @returns Returns the label.
   */
  protected severityLabel(severity: Severity): string {
    return severity.toUpperCase();
  }

  /**
   * Builds the "Where" tooltip for a record: its origin and, for a renderer record, its window.
   * @param record The record.
   * @returns Returns the tooltip text.
   */
  protected origin(record: LogRecord): string {
    return record.window ? `${record.origin} · ${record.window}` : record.origin;
  }

  /**
   * Formats a record timestamp as a locale time with milliseconds.
   * @param timestamp The ISO-8601 timestamp.
   * @returns Returns the formatted time.
   */
  protected formatTime(timestamp: string): string {
    const date: Date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleTimeString();
  }

  /**
   * Formats a session start time as a locale date and time.
   * @param timestamp The ISO-8601 timestamp.
   * @returns Returns the formatted date and time.
   */
  private formatDate(timestamp: string): string {
    const date: Date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleString();
  }

  /**
   * Loads the known sessions and adopts the live one as the initial selection.
   * @returns Returns a promise that resolves once the sessions have loaded.
   */
  private async loadSessions(): Promise<void> {
    const sessions: LogSession[] = await this.log.sessions();
    this.sessions.set(sessions);
    const current: LogSession | undefined = sessions.find(
      (session: LogSession): boolean => session.current,
    );
    this.currentSessionId.set(current?.id ?? null);
    if (this.selectedSessionId() === null) {
      this.selectedSessionId.set(current?.id ?? null);
    }
  }

  /**
   * Loads the viewed session's records.
   * @returns Returns a promise that resolves once the records have loaded.
   */
  private async loadRecords(): Promise<void> {
    const sessionId: string | null = this.selectedSessionId();
    const records: LogRecord[] = await this.log.query(sessionId === null ? {} : { sessionId });
    this.records.set(records);
  }
}
