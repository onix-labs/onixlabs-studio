import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  InputSignal,
  OnInit,
  Signal,
  signal,
  untracked,
  WritableSignal,
} from '@angular/core';
import { Button } from '@shared/angular/components/forms/button/button';
import { ButtonRow } from '@shared/angular/components/forms/button-row/button-row';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import {
  Table,
  TableColumn,
  TableRow,
  TableRowDef,
  TableRowSelect,
  TableSort,
} from '@shared/angular/components/table/table';
import { CdkMenuTrigger } from '@angular/cdk/menu';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Menu, MenuItem } from '@shared/angular/components/menu/menu';
import { Icon } from '@shared/angular/icons/icon';
import { LogContextCard } from '../tabs/logs-tab/log-context-card/log-context-card';
import { LogDetailsCard } from '../tabs/logs-tab/log-details-card/log-details-card';
import { formatLogTime, SEVERITY_TONES } from '../tabs/logs-tab/log-format';
import { Panel } from '@shared/angular/components/panel-layout/panel';
import { PanelLayout } from '@shared/angular/components/panel-layout/panel-layout';
import { Log } from '@shared/angular/services/log/log';
import { DocumentVisibility } from '@shared/angular/services/document-visibility/document-visibility';
import { Settings } from '@shared/angular/services/settings/settings';
import {
  createViewInjectorRegistrar,
  ViewInjectorRegistrar,
} from '@shared/angular/services/view-injectors/view-injector-registration';
import { LogOrigin, LogRecord, LogSession, SEVERITIES, Severity } from '@shared/api/log-channels';
import { fullMessage } from '@shared/api/log-format';
import {
  GpuReading,
  MetricsSample,
  NetworkInfo,
  NetworkReading,
  ProcessesSnapshot,
  StorageInfo,
  StorageReading,
  SystemInfo,
} from '@shared/api/system-monitor-channels';
import { SystemMonitorReadings } from '../readings/system-monitor-readings';
import { SystemMonitorProcesses } from '../readings/system-monitor-processes';
import { SystemMonitorGpu } from '../readings/system-monitor-gpu';
import { SystemMonitorStorage } from '../readings/system-monitor-storage';
import { SystemMonitorNetwork } from '../readings/system-monitor-network';
import { SystemMonitorTabId } from '../tabs/system-monitor-tab-id';
import { OverviewTab } from '../tabs/overview-tab/overview-tab';
import { ProcessesTab } from '../tabs/processes-tab/processes-tab';
import { CpuTab } from '../tabs/cpu-tab/cpu-tab';
import { MemoryTab } from '../tabs/memory-tab/memory-tab';
import { StorageTab } from '../tabs/storage-tab/storage-tab';
import { LogsOverview } from '../tabs/overview-tab/logs-overview';
import { NetworkTab } from '../tabs/network-tab/network-tab';
import { GpuTab } from '../tabs/gpu-tab/gpu-tab';
import { SystemMonitorMetrics } from '../metrics/system-monitor-metrics';
import {
  SystemMonitorCommandHandler,
  SystemMonitorCommands,
} from '../system-monitor-commands/system-monitor-commands';
import { Chip, ChipTone } from '@shared/angular/components/chip/chip';
import { Agent } from '@shared/angular/services/agent/agent';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import {
  AgentHostRegistrar,
  createAgentHostRegistrar,
} from '@shared/angular/services/agent-hosts/agent-host-registration';
import { AGENT_CONVERSATION_KIND } from '@shared/angular/services/agent-conversations/agent-conversation-context';
import { SystemMonitorAgentCapabilities } from '../system-monitor-agent/system-monitor-agent-capabilities';
import { SystemMonitorAgentPanel } from '../system-monitor-agent/system-monitor-agent-panel';

/**
 * The audit table's columns: a fixed-width severity badge and timestamp bracket a fixed-width source
 * and the flexing message.
 */
const AUDIT_COLUMNS: readonly TableColumn[] = [
  { id: 'time', header: 'Time', width: '8.5rem', sortable: true },
  { id: 'level', header: 'Level', width: '6.5rem' },
  { id: 'component', header: 'Component', width: '15rem' },
  { id: 'message', header: 'Message' },
];

/**
 * The origins the Filters menu offers, in order, with how each is named.
 */
const ORIGIN_LABELS: Readonly<Record<LogOrigin, string>> = {
  main: 'Main process',
  renderer: 'Renderer windows',
};

/**
 * Describes the viewed session's records counted by severity, for the Logs header.
 */
export interface SeverityCounts {
  /**
   * Gets every record in the session.
   */
  readonly total: number;

  /**
   * Gets the records of each severity.
   */
  readonly bySeverity: Readonly<Record<Severity, number>>;
}

/**
 * The number of latest records the Overview's Logs card lists.
 */
const OVERVIEW_RECORDS: number = 6;

/**
 * What the System Monitor tab's status strip reports.
 */
export interface SystemMonitorSummary {
  /**
   * Gets the log session being read, in words.
   */
  readonly session: string;

  /**
   * Gets how many records the session holds.
   */
  readonly records: number;

  /**
   * Gets how many of them the severity and text filters show.
   */
  readonly shown: number;

  /**
   * Gets how many of the session's records are errors.
   */
  readonly errors: number;

  /**
   * Gets how many of the session's records are warnings.
   */
  readonly warnings: number;

  /**
   * Gets how many records are selected.
   */
  readonly selected: number;

  /**
   * Gets Studio's own CPU share, formatted, or null before it is read.
   */
  readonly appCpu: string | null;

  /**
   * Gets Studio's own memory, formatted, or null before it is read.
   */
  readonly appMemory: string | null;
}

/**
 * One audit row's display strings, built once per record so change detection only reads them (#980
 * P5).
 */
interface AuditEntry {
  /**
   * Gets the record the row shows.
   */
  readonly record: LogRecord;

  /**
   * Gets the severity badge's label.
   */
  readonly severityLabel: string;

  /**
   * Gets the severity badge's tone.
   */
  readonly tone: ChipTone;

  /**
   * Gets the "Where" tooltip: the record's origin and, for a renderer record, its window.
   */
  readonly origin: string;

  /**
   * Gets the record's time, formatted.
   */
  readonly time: string;
}

/**
 * The System Monitor tab. This phase (epic #395 P2 / #397) is the per-session **log audit**: a live,
 * filterable table of every log record — main-process and every renderer window — for the selected app
 * session, sourced from the P1 logging service. The live session streams in over the record push; a
 * past session is loaded from disk. Severity and free-text filters apply client-side over the buffered
 * records. The metric tiles (CPU/Memory/Network/Disk/GPU) land above this in P3/P4.
 */
@Component({
  selector: 'app-system-monitor-view',
  imports: [
    AppIcon,
    CdkMenuTrigger,
    Chip,
    Button,
    LogContextCard,
    LogDetailsCard,
    Menu,
    ButtonRow,
    Dropdown,
    TextField,
    Table,
    TableRowDef,
    OverviewTab,
    ProcessesTab,
    CpuTab,
    MemoryTab,
    StorageTab,
    NetworkTab,
    GpuTab,
    Panel,
    PanelLayout,
    SystemMonitorAgentPanel,
  ],
  // The agent and its conversation live on the VIEW, not the docked panel (#966): the panel mounts on
  // first show and can be closed, and a run in flight must outlive both.
  providers: [
    Agent,
    AgentConversation,
    { provide: AGENT_CONVERSATION_KIND, useValue: 'monitor' },
    SystemMonitorAgentCapabilities,
    // One monitor's readings and process listing, shared by its tabs; a second monitor keeps its own.
    SystemMonitorReadings,
    SystemMonitorProcesses,
    SystemMonitorGpu,
    SystemMonitorStorage,
    SystemMonitorNetwork,
  ],
  templateUrl: './system-monitor-view.html',
  styleUrl: './system-monitor-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SystemMonitorView implements OnInit {
  /**
   * Gets the tab identities, exposed for the template.
   */
  protected readonly Tab: typeof SystemMonitorTabId = SystemMonitorTabId;

  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

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
   * Holds how often the machine is sampled while the monitor shows, in milliseconds, or 0 when the
   * user paused it (the Refresh rate setting).
   */
  private readonly refreshRate: Signal<number> = inject(Settings).systemMonitorRefreshRate;

  /**
   * Holds the settings, which decide what is shown and kept.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds this monitor's machine readings, shared with its tabs.
   */
  protected readonly readings: SystemMonitorReadings = inject(SystemMonitorReadings);

  /**
   * Holds this monitor's process listing, shared with the Processes tab.
   */
  private readonly processes: SystemMonitorProcesses = inject(SystemMonitorProcesses);

  /**
   * Holds this monitor's GPU readings, shared with the GPU view.
   */
  private readonly gpu: SystemMonitorGpu = inject(SystemMonitorGpu);

  /**
   * Holds this monitor's storage readings, shared with the Storage tab.
   */
  private readonly storage: SystemMonitorStorage = inject(SystemMonitorStorage);

  /**
   * Holds this monitor's network readings, shared with the Network tab.
   */
  private readonly network: SystemMonitorNetwork = inject(SystemMonitorNetwork);

  /**
   * Holds the view chosen, which the ribbon's View group shows pressed. Overview first: it is the
   * monitor at a glance.
   */
  protected readonly selectedTab: WritableSignal<SystemMonitorTabId> = signal<SystemMonitorTabId>(
    SystemMonitorTabId.Overview,
  );

  /**
   * Holds whether the window is on screen. A tab in front of a minimised or covered window is still
   * "active"; nothing it shows can be seen, so its feeds pause (audit P4).
   */
  private readonly onScreen: Signal<boolean> = inject(DocumentVisibility).visible;

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
   * Holds the severities currently shown, the Severities Shown by Default to begin with; the filter
   * chips change them for the session.
   */
  protected readonly enabled: WritableSignal<ReadonlySet<Severity>> = signal<ReadonlySet<Severity>>(
    new Set<Severity>(this.settings.get('systemMonitor.defaultSeverities')),
  );

  /**
   * Holds the origins shown (the main process, the renderer windows); the Filters menu changes them.
   */
  protected readonly origins: WritableSignal<ReadonlySet<LogOrigin>> = signal<
    ReadonlySet<LogOrigin>
  >(new Set<LogOrigin>(['main', 'renderer']));

  /**
   * Holds the order the records are listed in by time: oldest first, or newest first.
   */
  private readonly newestFirst: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the id (as a string) of the record whose details are shown: the one last clicked.
   */
  protected readonly focusedId: WritableSignal<string | null> = signal<string | null>(null);

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
   * Holds the live record stream's unsubscribe, or null while the tab is hidden and the stream is
   * closed.
   */
  private liveRecordsUnsubscribe: (() => void) | null = null;

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
    const origins: ReadonlySet<LogOrigin> = this.origins();
    const needle: string = this.text().trim().toLowerCase();
    return this.records().filter((record: LogRecord): boolean => {
      if (!enabled.has(record.severity) || !origins.has(record.origin)) {
        return false;
      }
      if (
        needle.length > 0 &&
        !`${record.source} ${fullMessage(record)}`.toLowerCase().includes(needle)
      ) {
        return false;
      }
      return true;
    });
  });

  /**
   * Gets what the tab's status strip reports (#882): the log session being read, how many of its
   * records the filters show, its errors and warnings (counted over the whole session, so a filter
   * cannot hide that they exist), the selection, and Studio's own CPU and memory as the tiles read
   * them. Read by the strip through the injector this view publishes.
   */
  public readonly summary: Signal<SystemMonitorSummary> = computed((): SystemMonitorSummary => {
    const records: readonly LogRecord[] = this.records();
    const viewed: LogSession | undefined = this.sessions().find(
      (session: LogSession): boolean => session.id === this.selectedSessionValue(),
    );
    return {
      session:
        this.viewingLive() || viewed === undefined
          ? 'Current session'
          : this.formatDate(viewed.startedAt),
      records: records.length,
      shown: this.filtered().length,
      errors: records.filter((record: LogRecord): boolean => record.severity === 'error').length,
      warnings: records.filter((record: LogRecord): boolean => record.severity === 'warning')
        .length,
      selected: this.selectedCount(),
      appCpu: this.readings.cpuAppValue(),
      appMemory: this.readings.memoryAppValue(),
    };
  });

  /**
   * Gets the logs at a glance for the Overview: the viewed session's counts by severity, and its latest
   * records as the Logs view's filters show them, newest first — so the card and the view agree.
   */
  protected readonly logsOverview: Signal<LogsOverview> = computed((): LogsOverview => {
    const records: readonly LogRecord[] = this.records();
    let info: number = 0;
    let warnings: number = 0;
    let errors: number = 0;
    for (const record of records) {
      if (record.severity === 'info') {
        info += 1;
      } else if (record.severity === 'warning') {
        warnings += 1;
      } else if (record.severity === 'error') {
        errors += 1;
      }
    }
    return { info, warnings, errors, recent: this.filtered().slice(-OVERVIEW_RECORDS).reverse() };
  });

  /**
   * Gets when the current logging session started, or null before the sessions have loaded.
   */
  protected readonly sessionStartedAt: Signal<string | null> = computed((): string | null => {
    const current: string | null = this.currentSessionId();
    return (
      this.sessions().find((session: LogSession): boolean => session.id === current)?.startedAt ??
      null
    );
  });

  /**
   * Publishes this view's injector while it is active, so the status strip mounts the tab's status
   * (#882) inside it.
   */
  private readonly statusHost: ViewInjectorRegistrar = createViewInjectorRegistrar({
    isActive: this.isActive,
  });

  /**
   * Registers the view's agent with Mission Control and the requests inbox for the tab's whole life,
   * service-only — the docked panel mounts on first show (#966).
   */
  private readonly agentHost: AgentHostRegistrar = createAgentHostRegistrar({
    isActive: this.isActive,
    surface: 'monitor',
  });

  /**
   * Registers the capabilities the agent reads the logs through, for the view's life.
   */
  private readonly agentCapabilities: SystemMonitorAgentCapabilities = inject(
    SystemMonitorAgentCapabilities,
  );

  /**
   * Holds whether the agent panel has been shown, after which it stays mounted so a closed panel keeps
   * its place and its conversation.
   */
  protected readonly agentMounted: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds whether the agent panel is showing.
   */
  protected readonly agentVisible: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Publishes this view's injector to the status strip and its agent to Mission Control, now that the
   * tab id is readable.
   */
  public ngOnInit(): void {
    this.statusHost.register(this.tabId());
    this.agentHost.register(this.tabId());
  }

  /**
   * Shows the agent panel, or hides it.
   */
  protected toggleAgent(): void {
    const showing: boolean = !this.agentVisible();
    if (showing) {
      this.agentMounted.set(true);
    }
    this.agentVisible.set(showing);
  }

  /**
   * Holds each record's table row, built the first time the record is shown, so a filter change or a
   * live append re-uses every row already built instead of re-formatting it. Keyed weakly, so a
   * session's rows go when its records do.
   */
  private readonly rowCache: WeakMap<LogRecord, TableRow> = new WeakMap<LogRecord, TableRow>();

  /**
   * Gets the filtered records adapted to the table's row shape, oldest first. Each row carries its
   * {@link AuditEntry} display strings, so the template formats nothing.
   */
  protected readonly rows: Signal<readonly TableRow[]> = computed((): readonly TableRow[] => {
    const rows: TableRow[] = this.filtered().map((record: LogRecord): TableRow =>
      this.rowFor(record),
    );
    return this.newestFirst() ? rows.reverse() : rows;
  });

  /**
   * Gets the record whose details are shown, or null when none has been chosen (or it has left the
   * session's records).
   */
  protected readonly focusedRecord: Signal<LogRecord | null> = computed((): LogRecord | null => {
    const id: string | null = this.focusedId();
    return id === null
      ? null
      : (this.records().find((record: LogRecord): boolean => String(record.id) === id) ?? null);
  });

  /**
   * Gets the viewed session's records counted by severity, over the whole session whatever the
   * filters show.
   */
  protected readonly severityCounts: Signal<SeverityCounts> = computed((): SeverityCounts => {
    const bySeverity: Record<Severity, number> = {
      trace: 0,
      debug: 0,
      info: 0,
      warning: 0,
      error: 0,
    };
    for (const record of this.records()) {
      bySeverity[record.severity] += 1;
    }
    return { total: this.records().length, bySeverity };
  });

  /**
   * Gets whether every severity is shown, so the All filter reads pressed.
   */
  protected readonly allSeverities: Signal<boolean> = computed(
    (): boolean => this.enabled().size === SEVERITIES.length,
  );

  /**
   * Gets the Filters menu: each origin, ticked while shown.
   */
  protected readonly filterItems: Signal<readonly MenuItem[]> = computed(
    (): readonly MenuItem[] => {
      const origins: ReadonlySet<LogOrigin> = this.origins();
      return (Object.keys(ORIGIN_LABELS) as LogOrigin[]).map((origin: LogOrigin): MenuItem => ({
        id: origin,
        label: ORIGIN_LABELS[origin],
        checked: origins.has(origin),
      }));
    },
  );

  /**
   * Gets the Logs view's more-actions menu.
   */
  protected readonly moreItems: Signal<readonly MenuItem[]> = computed((): readonly MenuItem[] => [
    { id: 'refresh', label: 'Refresh', icon: Icon.REFRESH },
    {
      id: 'copy',
      label: this.selectedCount() > 0 ? 'Copy Selected' : 'Copy Shown',
      icon: Icon.COPY,
      disabled: this.filtered().length === 0,
    },
    { id: 'select-none', label: 'Clear Selection', disabled: this.selectedCount() === 0 },
    { id: 'clear-filters', label: 'Reset Filters' },
  ]);

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
    agentShown: this.agentVisible,
    toggleAgent: (): void => this.toggleAgent(),
    refresh: (): void => this.refresh(),
    clearFilters: (): void => this.clearFilters(),
    copy: (): void => void this.copy(),
    tab: this.selectedTab.asReadonly(),
    selectTab: (tab: SystemMonitorTabId): void => this.selectTab(tab),
  };

  /**
   * Gets the session picker options, newest first, the live session marked.
   */
  protected readonly sessionOptions: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] =>
      this.sessions().map((session: LogSession): DropdownOption => ({
        value: session.id,
        label: session.current
          ? `Current session — ${this.formatDate(session.startedAt)}`
          : this.formatDate(session.startedAt),
      })),
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

    const unsubscribeSamples: () => void = this.metrics.onSample((sample: MetricsSample): void =>
      this.readings.accept(sample),
    );
    const unsubscribeProcesses: () => void = this.metrics.onProcesses(
      (snapshot: ProcessesSnapshot): void => this.processes.accept(snapshot),
    );
    const unsubscribeGpu: () => void = this.metrics.onGpu((reading: GpuReading): void => {
      this.gpu.accept(reading);
      this.processes.acceptGpu(reading);
    });
    void this.loadInfo();

    // Whether this view has asked the backend to sample (one start per stop, whatever the rate does).
    let sampling: boolean = false;
    const destroy: DestroyRef = inject(DestroyRef);
    destroy.onDestroy(unsubscribeSamples);
    destroy.onDestroy(unsubscribeProcesses);
    destroy.onDestroy(unsubscribeGpu);
    destroy.onDestroy(
      this.metrics.onStorage((reading: StorageReading): void => this.storage.accept(reading)),
    );
    destroy.onDestroy(
      this.metrics.onNetwork((reading: NetworkReading): void => this.network.accept(reading)),
    );
    destroy.onDestroy((): void => this.unsubscribeFromLiveRecords());
    destroy.onDestroy((): void => this.commands.unregister(this.commandHandler));
    destroy.onDestroy((): void => {
      if (sampling) {
        this.metrics.stop();
      }
    });

    // Whether this view has asked the backend to list processes.
    let listing: boolean = false;
    destroy.onDestroy((): void => {
      if (listing) {
        this.metrics.stopProcesses();
      }
    });

    // Whether this view has asked the backend to read the GPU.
    // Storage devices are read only while the Storage view is in front of the user. The devices are
    // looked up again each time it comes forward, so a drive plugged in since is listed.
    let readingStorage: boolean = false;
    destroy.onDestroy((): void => {
      if (readingStorage) {
        this.metrics.stopStorage();
      }
    });
    effect((): void => {
      const wanted: boolean =
        this.isActive() && this.onScreen() && this.selectedTab() === SystemMonitorTabId.Storage;
      untracked((): void => {
        if (wanted && !readingStorage) {
          this.metrics.startStorage();
          void this.loadStorageInfo();
        } else if (!wanted && readingStorage) {
          this.metrics.stopStorage();
        }
        readingStorage = wanted;
      });
    });

    // The network is read only while the Network view is in front of the user. The interfaces are
    // looked up again each time it comes forward, so one that came up since is listed.
    let readingNetwork: boolean = false;
    destroy.onDestroy((): void => {
      if (readingNetwork) {
        this.metrics.stopNetwork();
      }
    });
    effect((): void => {
      const wanted: boolean =
        this.isActive() && this.onScreen() && this.selectedTab() === SystemMonitorTabId.Network;
      untracked((): void => {
        if (wanted && !readingNetwork) {
          this.metrics.startNetwork();
          void this.loadNetworkInfo();
        } else if (!wanted && readingNetwork) {
          this.metrics.stopNetwork();
        }
        readingNetwork = wanted;
      });
    });

    let readingGpu: boolean = false;
    destroy.onDestroy((): void => {
      if (readingGpu) {
        this.metrics.stopGpu();
      }
    });

    // The GPU is read in detail only while the GPU or Processes view is in front of the user and GPU
    // Monitoring is on; its engines and processes are costlier than a sample, and no other view shows
    // them.
    effect((): void => {
      const tab: SystemMonitorTabId = this.selectedTab();
      const wanted: boolean =
        this.isActive() &&
        this.onScreen() &&
        (tab === SystemMonitorTabId.Gpu || tab === SystemMonitorTabId.Processes) &&
        this.readings.gpuMonitoring();
      untracked((): void => {
        if (wanted && !readingGpu) {
          this.metrics.startGpu();
        } else if (!wanted && readingGpu) {
          this.metrics.stopGpu();
        }
        readingGpu = wanted;
      });
    });

    // The ribbon handler follows the tab: its actions belong to the tab in front, on screen or not.
    effect((): void => {
      if (this.isActive()) {
        this.commands.register(this.commandHandler);
      } else {
        this.commands.unregister(this.commandHandler);
      }
    });

    // The live record stream follows what can be seen: no record push is processed while the monitor
    // is hidden behind another tab or the window is off screen (the performance-audit posture).
    // Reactivation reloads the viewed session first, catching up on whatever was recorded while the
    // stream was down.
    effect((): void => {
      const showing: boolean = this.isActive() && this.onScreen();
      // The reactive dependency is the visibility alone: the catch-up reload reads the selected
      // session synchronously, and tracking that here would re-run this effect every time the viewed
      // session changes.
      untracked((): void => {
        if (showing) {
          this.subscribeToLiveRecords();
        } else {
          this.unsubscribeFromLiveRecords();
        }
      });
    });

    // Sampling follows what can be seen and the user's refresh rate: nothing is sampled while the
    // monitor is hidden, the window is off screen or the rate is paused, and a rate change re-times a
    // running loop without restarting it (restarting would reset the CPU baseline and blank a tick).
    // The backend's ref-count sees one start per stop, whatever the rate does in between.
    effect((): void => {
      const rate: number = this.refreshRate();
      const gpu: boolean = this.readings.gpuMonitoring();
      const wanted: boolean = this.isActive() && this.onScreen() && rate > 0;
      untracked((): void => {
        if (wanted) {
          this.metrics.setRate(rate, gpu);
        }
        if (wanted && !sampling) {
          this.metrics.start();
        } else if (!wanted && sampling) {
          this.metrics.stop();
        }
        sampling = wanted;
      });
    });

    // Processes are listed only while a view showing them is in front of the user — Processes, the
    // Overview's Processes card, the CPU and Memory views' top processes, or the GPU view's (whose
    // readings on Windows carry pids, not names): a listing is a `ps` (or WMI query) every couple of
    // seconds, far costlier than a sample.
    effect((): void => {
      const tab: SystemMonitorTabId = this.selectedTab();
      const wanted: boolean =
        this.isActive() &&
        this.onScreen() &&
        (tab === SystemMonitorTabId.Processes ||
          tab === SystemMonitorTabId.Overview ||
          tab === SystemMonitorTabId.Cpu ||
          tab === SystemMonitorTabId.Memory ||
          tab === SystemMonitorTabId.Gpu);
      untracked((): void => {
        if (wanted && !listing) {
          this.metrics.startProcesses();
        } else if (!wanted && listing) {
          this.metrics.stopProcesses();
        }
        listing = wanted;
      });
    });
  }

  /**
   * Opens the live record stream (idempotent) and reloads the viewed session so records that landed
   * while the stream was down appear before new ones stream in.
   */
  private subscribeToLiveRecords(): void {
    if (this.liveRecordsUnsubscribe !== null) {
      return;
    }
    // A flush window's batch lands in ONE write (#980 P5): a write per record would copy the whole
    // buffer and re-run the filter and row mapping once per record.
    this.liveRecordsUnsubscribe = this.log.onRecords((batch: readonly LogRecord[]): void => {
      if (!this.viewingLive()) {
        return;
      }
      const session: string | null = this.currentSessionId();
      this.records.update((records: readonly LogRecord[]): readonly LogRecord[] => {
        // Ids are strictly monotonic within a session and the buffer is held oldest-first, so the
        // last record holds the highest id. A record's broadcast and the initial query reply travel
        // on separate IPC channels and can arrive out of order, so a record already included in the
        // loaded snapshot can be broadcast afterwards; appending it again would duplicate a row id
        // and trip Angular's @for tracking (NG0955). Only append records newer than the last held.
        let lastId: number = records[records.length - 1]?.id ?? Number.NEGATIVE_INFINITY;
        const fresh: LogRecord[] = [];
        for (const record of batch) {
          if (record.sessionId === session && record.id > lastId) {
            fresh.push(record);
            lastId = record.id;
          }
        }
        // Held to Live Log Records, as the main process holds its own buffer: a long session's stream
        // would otherwise grow without end.
        return fresh.length === 0
          ? records
          : [...records, ...fresh].slice(-this.settings.get('systemMonitor.liveLogRecords'));
      });
    });
    void this.loadRecords();
  }

  /**
   * Closes the live record stream, if open. The last subscriber going away withdraws the renderer's
   * subscription in main, so a hidden monitor costs no record IPC at all.
   */
  private unsubscribeFromLiveRecords(): void {
    this.liveRecordsUnsubscribe?.();
    this.liveRecordsUnsubscribe = null;
  }

  /**
   * Shows a view, as the ribbon's View group asks.
   * @param tab The view to show.
   */
  protected selectTab(tab: SystemMonitorTabId): void {
    this.selectedTab.set(tab);
  }

  /**
   * Reads the machine's network interfaces, DNS servers and gateway, for the Network tab.
   */
  private async loadNetworkInfo(): Promise<void> {
    const info: NetworkInfo | null = await this.metrics.networkInfo();
    if (info !== null) {
      this.network.setInfo(info);
    }
  }

  /**
   * Reads the machine's storage devices and the device each volume is on, for the Storage tab.
   */
  private async loadStorageInfo(): Promise<void> {
    const info: StorageInfo | null = await this.metrics.storageInfo();
    if (info !== null) {
      this.storage.setInfo(info);
    }
  }

  /**
   * Reads the machine's description once, for the Overview and CPU tabs.
   */
  private async loadInfo(): Promise<void> {
    const info: SystemInfo | null = await this.metrics.info();
    if (info !== null) {
      this.readings.setInfo(info);
    }
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
    this.enabled.set(new Set<Severity>(this.settings.get('systemMonitor.defaultSeverities')));
    this.origins.set(new Set<LogOrigin>(['main', 'renderer']));
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
          `${record.timestamp} [${record.severity}] ${record.source}: ${fullMessage(record)}`,
      )
      .join('\n');
    try {
      await navigator.clipboard?.writeText(text);
    } catch {
      // A denied or unavailable clipboard is deliberately swallowed.
    }
  }

  /**
   * Chooses a clicked row: a plain click selects it alone and shows its details; ⌘ or Ctrl adds it to
   * the selection or takes it out; Shift selects every row shown from the last one chosen to it. Copy
   * acts on the selection.
   * @param select The click, with its modifier keys.
   */
  protected selectRow(select: TableRowSelect): void {
    const id: string = select.row.id;
    const anchor: string | null = this.focusedId();
    if (select.range && anchor !== null) {
      const ids: readonly string[] = this.rows().map((row: TableRow): string => row.id);
      const from: number = ids.indexOf(anchor);
      const to: number = ids.indexOf(id);
      if (from >= 0 && to >= 0) {
        this.selected.set(new Set<string>(ids.slice(Math.min(from, to), Math.max(from, to) + 1)));
        return;
      }
    }
    if (select.toggle) {
      this.selected.update((selected: ReadonlySet<string>): ReadonlySet<string> => {
        const next: Set<string> = new Set<string>(selected);
        if (!next.delete(id)) {
          next.add(id);
        }
        return next;
      });
    } else {
      this.selected.set(new Set<string>([id]));
    }
    this.focusedId.set(id);
  }

  /**
   * Lists the records oldest or newest first, as the Time header asks.
   * @param sort The sort, or null to return to oldest first.
   */
  protected onSort(sort: TableSort | null): void {
    this.newestFirst.set(sort?.direction === 'desc');
  }

  /**
   * Shows every severity (the All filter).
   */
  protected showAllSeverities(): void {
    this.enabled.set(new Set<Severity>(SEVERITIES));
  }

  /**
   * Shows or hides an origin (the Filters menu).
   * @param id The origin, as the menu item's id.
   */
  protected toggleOrigin(id: string): void {
    const origin: LogOrigin = id === 'main' ? 'main' : 'renderer';
    this.origins.update((origins: ReadonlySet<LogOrigin>): ReadonlySet<LogOrigin> => {
      const next: Set<LogOrigin> = new Set<LogOrigin>(origins);
      if (!next.delete(origin)) {
        next.add(origin);
      }
      return next;
    });
  }

  /**
   * Runs an action from the more-actions menu.
   * @param id The action's id.
   */
  protected onMore(id: string): void {
    switch (id) {
      case 'refresh':
        this.refresh();
        break;
      case 'copy':
        void this.copy();
        break;
      case 'select-none':
        this.clearSelection();
        break;
      case 'clear-filters':
        this.clearFilters();
        break;
      default:
        break;
    }
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
   * Reads a table row's display strings.
   * @param row The table row.
   * @returns Returns the row's audit entry.
   */
  protected entryOf(row: TableRow): AuditEntry {
    return row.data as AuditEntry;
  }

  /**
   * Gets a record's table row, building it (and formatting its display strings) only the first time
   * the record is shown.
   * @param record The record.
   * @returns Returns the row.
   */
  private rowFor(record: LogRecord): TableRow {
    let row: TableRow | undefined = this.rowCache.get(record);
    if (row === undefined) {
      const entry: AuditEntry = {
        record,
        severityLabel: this.severityLabel(record.severity),
        tone: this.severityTone(record.severity),
        origin: this.origin(record),
        time: formatLogTime(record.timestamp),
      };
      row = { id: String(record.id), data: entry };
      this.rowCache.set(record, row);
    }
    return row;
  }

  /**
   * Gets a severity's name as a filter or count reads it (`Warning`).
   * @param severity The severity.
   * @returns Returns the name.
   */
  protected severityName(severity: Severity): string {
    return `${severity.charAt(0).toUpperCase()}${severity.slice(1)}`;
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
   * Gets the chip tone a severity is labelled in, rising with how severe it is.
   * @param severity The severity.
   * @returns Returns the tone.
   */
  private severityTone(severity: Severity): ChipTone {
    return SEVERITY_TONES[severity];
  }

  /**
   * Builds the "Where" tooltip for a record: its origin and, for a renderer record, its window.
   * @param record The record.
   * @returns Returns the tooltip text.
   */
  private origin(record: LogRecord): string {
    return record.window ? `${record.origin} · ${record.window}` : record.origin;
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
