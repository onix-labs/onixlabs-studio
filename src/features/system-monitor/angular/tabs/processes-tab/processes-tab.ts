import { CdkMenuTrigger } from '@angular/cdk/menu';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  Signal,
  untracked,
  WritableSignal,
} from '@angular/core';
import { Chip } from '@shared/angular/components/chip/chip';
import { Button } from '@shared/angular/components/forms/button/button';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { Menu, MenuItem } from '@shared/angular/components/menu/menu';
import {
  Table,
  TableColumn,
  TableRow,
  TableRowDef,
  TableRowSize,
  TableSort,
} from '@shared/angular/components/table/table';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Icon } from '@shared/angular/icons/icon';
import {
  MetricsSample,
  ProcessesSnapshot,
  ProcessSample,
  StudioProcessKind,
} from '@shared/api/system-monitor-channels';
import { Sparkline } from '../../charts/sparkline/sparkline';
import { SystemMonitorMetrics } from '../../metrics/system-monitor-metrics';
import { formatBytes, formatDuration, formatPercent, formatShare } from '../../readings/format';
import {
  PROCESS_HISTORY,
  ProcessHistory,
  SystemMonitorProcesses,
} from '../../readings/system-monitor-processes';
import { SystemMonitorReadings } from '../../readings/system-monitor-readings';
import { pageNumbers } from './pagination';

/**
 * Identifies which processes the list shows.
 * - `all`: every process listed.
 * - `user`: those running as the user's own account.
 * - `system`: those running as any other account (the OS's services and daemons).
 * - `studio`: Studio's own, and those it started.
 * - `gpu`: those using the GPU in the latest GPU reading.
 */
type ProcessScope = 'all' | 'user' | 'system' | 'studio' | 'gpu';

/**
 * Identifies one of the list's columns.
 */
type ProcessColumnId =
  | 'name'
  | 'pid'
  | 'user'
  | 'cpu'
  | 'cpuGraph'
  | 'memory'
  | 'memoryGraph'
  | 'gpu'
  | 'gpuGraph'
  | 'threads'
  | 'uptime';

/**
 * Describes one of the scope buttons above the list.
 */
interface ScopeOption {
  /**
   * Gets the scope.
   */
  readonly scope: ProcessScope;

  /**
   * Gets the button's label.
   */
  readonly label: string;
}

/**
 * Describes one process's row, its strings formatted once per listing.
 */
interface ProcessRow {
  /**
   * Gets the process as listed.
   */
  readonly process: ProcessSample;

  /**
   * Gets the process's recent readings.
   */
  readonly history: ProcessHistory;

  /**
   * Gets the CPU share, formatted.
   */
  readonly cpu: string;

  /**
   * Gets the top of the CPU graph's scale.
   */
  readonly cpuMax: number;

  /**
   * Gets the resident memory, formatted.
   */
  readonly memory: string;

  /**
   * Gets the top of the memory graph's scale.
   */
  readonly memoryMax: number;

  /**
   * Gets the share of the GPU, or 0 when the GPU is not read per process.
   */
  readonly gpuPercent: number;

  /**
   * Gets the share of the GPU, formatted, or a dash when the GPU is not read per process.
   */
  readonly gpu: string;

  /**
   * Gets the top of the GPU graph's scale.
   */
  readonly gpuMax: number;

  /**
   * Gets the thread count, formatted, or a dash when it could not be read.
   */
  readonly threads: string;

  /**
   * Gets how long the process has run, in seconds, or -1 when unknown.
   */
  readonly uptimeSeconds: number;

  /**
   * Gets how long the process has run, formatted, or a dash when unknown.
   */
  readonly uptime: string;

  /**
   * Gets the Studio role, or null when the process is not Studio's.
   */
  readonly studio: string | null;

  /**
   * Gets the key the process's icon is looked up by, or null when it has no executable folder to look
   * one up from.
   */
  readonly iconKey: string | null;
}

/**
 * Describes a summary tile over the list: a machine-wide reading and its recent trend.
 */
interface SummaryTile {
  /**
   * Gets the tile's label.
   */
  readonly label: string;

  /**
   * Gets the tile's icon.
   */
  readonly icon: Icon;

  /**
   * Gets the reading.
   */
  readonly value: string;

  /**
   * Gets the reading's context (the total it is a share of), or the empty string.
   */
  readonly detail: string;

  /**
   * Gets the recent readings, oldest first, as percentages.
   */
  readonly values: readonly number[];
}

/**
 * Every column the list can show, in order.
 */
const COLUMNS: readonly (TableColumn & { readonly id: ProcessColumnId })[] = [
  { id: 'name', header: 'Name', sortable: true },
  { id: 'pid', header: 'PID', width: '5rem', align: 'end', sortable: true },
  { id: 'user', header: 'User', width: '8rem', sortable: true },
  { id: 'cpu', header: 'CPU', width: '4.75rem', align: 'end', sortable: true },
  { id: 'cpuGraph', header: 'CPU (Graph)', width: '8.5rem' },
  { id: 'memory', header: 'Memory', width: '6.25rem', align: 'end', sortable: true },
  { id: 'memoryGraph', header: 'Memory (Graph)', width: '8.5rem' },
  { id: 'gpu', header: 'GPU', width: '4.75rem', align: 'end', sortable: true },
  { id: 'gpuGraph', header: 'GPU (Graph)', width: '8.5rem' },
  { id: 'threads', header: 'Threads', width: '5rem', align: 'end', sortable: true },
  { id: 'uptime', header: 'Uptime', width: '6rem', align: 'end', sortable: true },
];

/**
 * The scope buttons, in order.
 */
const SCOPES: readonly ScopeOption[] = [
  { scope: 'all', label: 'All Processes' },
  { scope: 'user', label: 'User Processes' },
  { scope: 'system', label: 'System Processes' },
  { scope: 'studio', label: 'Studio' },
  { scope: 'gpu', label: 'GPU Active' },
];

/**
 * The page sizes offered.
 */
const PAGE_SIZES: readonly DropdownOption[] = [
  { value: '25', label: '25' },
  { value: '50', label: '50' },
  { value: '100', label: '100' },
];

/**
 * How each of Studio's processes is described.
 */
const STUDIO_ROLES: Readonly<Record<StudioProcessKind, string>> = {
  main: 'Studio',
  renderer: 'Window',
  gpu: 'GPU',
  utility: 'Helper',
  child: 'Started by Studio',
};

/**
 * The least scale a process's CPU or GPU graph is drawn to, so a process idling at a fraction of a
 * percent does not fill its graph with noise.
 */
const MIN_SHARE_SCALE: number = 5;

/**
 * How far above a process's largest memory reading its graph's scale reaches, so a steady footprint
 * draws as a line part-way up rather than along the top.
 */
const MEMORY_HEADROOM: number = 1.5;

/**
 * Reads the account name out of a process's user, which Windows qualifies with a domain
 * (`MACHINE\name`).
 * @param user The process's user.
 * @returns Returns the account name, lower-cased for comparison.
 */
function accountOf(user: string): string {
  return user.slice(user.lastIndexOf('\\') + 1).toLowerCase();
}

/**
 * Represents the System Monitor's Processes view: the machine's processes in a paged table — each with
 * its app's icon, its CPU, memory and GPU readings beside their last two minutes as sparklines, its
 * threads and how long it has run — under a summary of the machine's CPU, memory and GPU.
 *
 * The list narrows to the user's own processes, the system's, Studio's (its windows and helpers, and
 * everything it started), or those using the GPU, and filters by name, PID, path or user. Its columns
 * can be chosen, its rows made compact, and its pages sized.
 *
 * CPU is each process's share of the whole machine, so it reads against the CPU view. Only Studio's
 * processes and the busiest of the rest are listed, so the list stays cheap to refresh; GPU shares are
 * read while GPU Monitoring is on, on the platforms that report them per process.
 */
@Component({
  selector: 'app-system-monitor-processes-tab',
  imports: [
    AppIcon,
    Button,
    CdkMenuTrigger,
    Chip,
    Dropdown,
    Menu,
    Sparkline,
    Table,
    TableRowDef,
    TextField,
  ],
  templateUrl: './processes-tab.html',
  styleUrl: './processes-tab.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProcessesTab {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the scope buttons.
   */
  protected readonly scopes: readonly ScopeOption[] = SCOPES;

  /**
   * Gets the page sizes offered.
   */
  protected readonly pageSizes: readonly DropdownOption[] = PAGE_SIZES;

  /**
   * Gets how many readings a process's sparklines span.
   */
  protected readonly historyLength: number = PROCESS_HISTORY;

  /**
   * Gets the view's process listing.
   */
  protected readonly listing: SystemMonitorProcesses = inject(SystemMonitorProcesses);

  /**
   * Gets the view's machine readings, for the summary.
   */
  protected readonly readings: SystemMonitorReadings = inject(SystemMonitorReadings);

  /**
   * Holds the backend, asked for each app's icon.
   */
  private readonly metrics: SystemMonitorMetrics = inject(SystemMonitorMetrics);

  /**
   * Holds which processes the list shows.
   */
  protected readonly scope: WritableSignal<ProcessScope> = signal<ProcessScope>('all');

  /**
   * Holds the filter text, matched against each process's name, PID, path and user.
   */
  protected readonly text: WritableSignal<string> = signal<string>('');

  /**
   * Holds the sort the list's header asks for, or null to keep the listing's busiest-first order.
   */
  private readonly sort: WritableSignal<TableSort | null> = signal<TableSort | null>(null);

  /**
   * Holds the columns hidden through the Columns menu.
   */
  private readonly hidden: WritableSignal<ReadonlySet<ProcessColumnId>> = signal<
    ReadonlySet<ProcessColumnId>
  >(new Set<ProcessColumnId>());

  /**
   * Holds how tall the list's rows are.
   */
  protected readonly rowSize: WritableSignal<TableRowSize> = signal<TableRowSize>('comfortable');

  /**
   * Holds the current page, from 1.
   */
  protected readonly page: WritableSignal<number> = signal<number>(1);

  /**
   * Holds how many rows a page shows.
   */
  protected readonly pageSize: WritableSignal<number> = signal<number>(50);

  /**
   * Holds each app's icon as looked up, by icon key: a data URL, or null for none of its own.
   */
  private readonly icons: WritableSignal<ReadonlyMap<string, string | null>> = signal<
    ReadonlyMap<string, string | null>
  >(new Map<string, string | null>());

  /**
   * Holds the icon keys asked for and not yet answered, so each is asked once.
   */
  private readonly asked: Set<string> = new Set<string>();

  /**
   * Gets the columns shown.
   */
  protected readonly columns: Signal<readonly TableColumn[]> = computed(
    (): readonly TableColumn[] => {
      const hidden: ReadonlySet<ProcessColumnId> = this.hidden();
      return COLUMNS.filter(
        (column: TableColumn): boolean => !hidden.has(column.id as ProcessColumnId),
      );
    },
  );

  /**
   * Gets the Columns menu: every column but the name, ticked when shown.
   */
  protected readonly columnItems: Signal<readonly MenuItem[]> = computed(
    (): readonly MenuItem[] => {
      const hidden: ReadonlySet<ProcessColumnId> = this.hidden();
      return COLUMNS.filter((column: TableColumn): boolean => column.id !== 'name').map(
        (column: TableColumn): MenuItem => ({
          id: column.id,
          label: column.header,
          checked: !hidden.has(column.id as ProcessColumnId),
        }),
      );
    },
  );

  /**
   * Gets the summary tiles: the machine's CPU, memory and GPU.
   */
  protected readonly summary: Signal<readonly SummaryTile[]> = computed(
    (): readonly SummaryTile[] => {
      const sample: MetricsSample | null = this.readings.latest();
      const memory: MetricsSample['memory'] | undefined = sample?.memory;
      return [
        {
          label: 'CPU',
          icon: Icon.MONITOR_CPU,
          value: this.readings.cpuValue(),
          detail: '',
          values: this.readings.cpuHistory(),
        },
        {
          label: 'Memory',
          icon: Icon.MONITOR_MEMORY,
          value: memory === undefined ? '—' : formatBytes(memory.usedBytes),
          detail:
            memory === undefined
              ? ''
              : `/ ${formatBytes(memory.totalBytes)} (${formatPercent(memory.percent)})`,
          values: this.readings.memoryHistory(),
        },
        {
          label: 'GPU',
          icon: Icon.MONITOR_GPU,
          value: this.readings.gpuValue(),
          detail: '',
          values: this.readings.gpuHistory(),
        },
      ];
    },
  );

  /**
   * Gets the count shown beside the title: the processes running, and how many are listed.
   */
  protected readonly count: Signal<string> = computed((): string => {
    const snapshot: ProcessesSnapshot | null = this.listing.snapshot();
    return snapshot === null
      ? ''
      : `${snapshot.total} processes • ${snapshot.processes.length} shown`;
  });

  /**
   * Gets whether the GPU is read per process, so the GPU Active scope has something to go on.
   */
  protected readonly gpuRead: Signal<boolean> = computed(
    (): boolean => this.listing.gpuShares() !== null,
  );

  /**
   * Gets every listed process's row, formatted once per listing.
   */
  private readonly allRows: Signal<readonly ProcessRow[]> = computed((): readonly ProcessRow[] => {
    const snapshot: ProcessesSnapshot | null = this.listing.snapshot();
    if (snapshot === null) {
      return [];
    }
    const histories: ReadonlyMap<number, ProcessHistory> = this.listing.allHistories();
    const shares: ReadonlyMap<number, number> | null = this.listing.gpuShares();
    const now: number = Date.parse(snapshot.timestamp);
    return snapshot.processes.map((process: ProcessSample): ProcessRow => {
      const history: ProcessHistory = histories.get(process.pid) ?? {
        cpu: [],
        memory: [],
        gpu: [],
      };
      const gpuPercent: number = shares?.get(process.pid) ?? 0;
      const uptimeSeconds: number =
        process.startedAt === undefined || !Number.isFinite(now)
          ? -1
          : Math.max(0, (now - process.startedAt) / 1000);
      return {
        process,
        history,
        cpu: formatShare(process.cpuPercent),
        cpuMax: Math.max(MIN_SHARE_SCALE, ...history.cpu),
        memory: formatBytes(process.memoryBytes),
        memoryMax: Math.max(1, ...history.memory) * MEMORY_HEADROOM,
        gpuPercent,
        gpu: shares === null ? '—' : formatShare(gpuPercent),
        gpuMax: Math.max(MIN_SHARE_SCALE, ...history.gpu),
        threads: process.threads === undefined ? '—' : `${process.threads}`,
        uptimeSeconds,
        uptime: uptimeSeconds < 0 ? '—' : formatDuration(uptimeSeconds),
        studio: process.studio === undefined ? null : STUDIO_ROLES[process.studio],
        iconKey: process.location === undefined ? null : `${process.location}\u0000${process.name}`,
      };
    });
  });

  /**
   * Gets the rows that pass the scope and filter, in the order asked for.
   */
  private readonly shown: Signal<readonly ProcessRow[]> = computed((): readonly ProcessRow[] => {
    const scope: ProcessScope = this.scope();
    const account: string = accountOf(this.listing.snapshot()?.user ?? '');
    const needle: string = this.text().trim().toLowerCase();
    const rows: readonly ProcessRow[] = this.allRows().filter(
      (row: ProcessRow): boolean =>
        inScope(row, scope, account) && (needle.length === 0 || matches(row, needle)),
    );
    const sort: TableSort | null = this.sort();
    return sort === null ? rows : [...rows].sort(comparer(sort));
  });

  /**
   * Gets the number of pages.
   */
  protected readonly pageCount: Signal<number> = computed((): number =>
    Math.max(1, Math.ceil(this.shown().length / this.pageSize())),
  );

  /**
   * Gets the current page, held within the pages there are as the list shrinks.
   */
  protected readonly currentPage: Signal<number> = computed((): number =>
    Math.min(this.page(), this.pageCount()),
  );

  /**
   * Gets the page numbers the pager shows, with null for each gap.
   */
  protected readonly pages: Signal<readonly (number | null)[]> = computed(
    (): readonly (number | null)[] => pageNumbers(this.currentPage(), this.pageCount()),
  );

  /**
   * Gets the rows on the current page.
   */
  private readonly pageRows: Signal<readonly ProcessRow[]> = computed((): readonly ProcessRow[] => {
    const size: number = this.pageSize();
    const start: number = (this.currentPage() - 1) * size;
    return this.shown().slice(start, start + size);
  });

  /**
   * Gets each row on the page by its row id, so a row's cells read their process without a cast.
   */
  private readonly rowsById: Signal<ReadonlyMap<string, ProcessRow>> = computed(
    (): ReadonlyMap<string, ProcessRow> =>
      new Map<string, ProcessRow>(
        this.pageRows().map((row: ProcessRow): [string, ProcessRow] => [`${row.process.pid}`, row]),
      ),
  );

  /**
   * Gets the table's rows.
   */
  protected readonly rows: Signal<readonly TableRow[]> = computed((): readonly TableRow[] =>
    this.pageRows().map((row: ProcessRow): TableRow => ({
      id: `${row.process.pid}`,
      data: row.process.pid,
    })),
  );

  /**
   * Gets the chosen process's row id, as a set for the table's selection.
   */
  protected readonly selectedIds: Signal<ReadonlySet<string>> = computed(
    (): ReadonlySet<string> => {
      const pid: number | null = this.listing.selectedPid();
      return new Set<string>(pid === null ? [] : [`${pid}`]);
    },
  );

  /**
   * Gets the message the empty list shows: waiting for the first listing, or nothing matching.
   */
  protected readonly emptyText: Signal<string> = computed((): string =>
    this.listing.snapshot() === null ? 'Listing processes…' : 'No processes match.',
  );

  /**
   * Starts looking up the icons of the apps on the current page.
   */
  public constructor() {
    effect((): void => {
      const keys: readonly ProcessRow[] = this.pageRows();
      untracked((): void => {
        for (const row of keys) {
          this.askIcon(row);
        }
      });
    });
  }

  /**
   * Gets the row a table row stands for.
   * @param row The table row.
   * @returns Returns the process row, or undefined when it has just left the listing.
   */
  protected rowOf(row: TableRow): ProcessRow | undefined {
    return this.rowsById().get(row.id);
  }

  /**
   * Gets the icon of the app a row's process belongs to.
   * @param row The row.
   * @returns Returns the icon as a data URL, or null when it has none of its own or is not read yet.
   */
  protected iconOf(row: ProcessRow): string | null {
    return row.iconKey === null ? null : (this.icons().get(row.iconKey) ?? null);
  }

  /**
   * Gets the generic icon a process without one of its own wears.
   * @param row The row.
   * @returns Returns a shell's icon for a shell, otherwise a process's.
   */
  protected fallbackIcon(row: ProcessRow): Icon {
    return /^-?(ba|z|fi|k|tc|c|da|pw|nu)?sh$|^(powershell|pwsh|cmd)(\.exe)?$/i.test(
      row.process.name,
    )
      ? Icon.MONITOR_SHELL
      : Icon.MONITOR_PROCESS;
  }

  /**
   * Shows the processes in a scope, from the first page.
   * @param scope The processes to show.
   */
  protected setScope(scope: ProcessScope): void {
    this.scope.set(scope);
    this.page.set(1);
  }

  /**
   * Filters the list, from the first page.
   * @param text The filter text.
   */
  protected setText(text: string): void {
    this.text.set(text);
    this.page.set(1);
  }

  /**
   * Applies the sort the list's header asks for.
   * @param sort The sort, or null to return to busiest first.
   */
  protected onSort(sort: TableSort | null): void {
    this.sort.set(sort);
  }

  /**
   * Shows or hides a column.
   * @param id The column's id.
   */
  protected toggleColumn(id: string): void {
    this.hidden.update((hidden: ReadonlySet<ProcessColumnId>): ReadonlySet<ProcessColumnId> => {
      const next: Set<ProcessColumnId> = new Set<ProcessColumnId>(hidden);
      const column: ProcessColumnId = id as ProcessColumnId;
      if (!next.delete(column)) {
        next.add(column);
      }
      return next;
    });
  }

  /**
   * Goes to a page.
   * @param page The page, from 1; held within the pages there are.
   */
  protected goTo(page: number): void {
    this.page.set(Math.min(this.pageCount(), Math.max(1, page)));
  }

  /**
   * Changes how many rows a page shows, keeping the first row on screen in view.
   * @param size The page size, as the dropdown's value.
   */
  protected setPageSize(size: string): void {
    const first: number = (this.currentPage() - 1) * this.pageSize();
    const next: number = Number(size);
    this.pageSize.set(next);
    this.page.set(Math.floor(first / next) + 1);
  }

  /**
   * Chooses the clicked process, or clears the choice when it was already chosen.
   * @param row The clicked row.
   */
  protected onRowClick(row: TableRow): void {
    const pid: number = Number(row.id);
    this.listing.select(this.listing.selectedPid() === pid ? null : pid);
  }

  /**
   * Asks the backend for the icon of the app a row's process belongs to, once per app.
   * @param row The row.
   */
  private askIcon(row: ProcessRow): void {
    const key: string | null = row.iconKey;
    const location: string | undefined = row.process.location;
    if (key === null || location === undefined || this.asked.has(key)) {
      return;
    }
    this.asked.add(key);
    void this.metrics.processIcon(location, row.process.name).then((icon: string | null): void => {
      this.icons.update(
        (icons: ReadonlyMap<string, string | null>): ReadonlyMap<string, string | null> =>
          new Map<string, string | null>(icons).set(key, icon),
      );
    });
  }
}

/**
 * Decides whether a row is in a scope.
 * @param row The row.
 * @param scope The scope.
 * @param account The user's own account, lower-cased.
 * @returns Returns true when the row's process is in the scope.
 */
function inScope(row: ProcessRow, scope: ProcessScope, account: string): boolean {
  switch (scope) {
    case 'user':
      return account.length > 0 && accountOf(row.process.user) === account;
    case 'system':
      return account.length > 0 && accountOf(row.process.user) !== account;
    case 'studio':
      return row.studio !== null;
    case 'gpu':
      return row.gpuPercent > 0;
    default:
      return true;
  }
}

/**
 * Decides whether a row matches the filter: its name, command, executable folder or user contains the
 * text, or its PID is it.
 * @param row The row.
 * @param needle The filter text, trimmed and lower-cased.
 * @returns Returns true when the row matches.
 */
function matches(row: ProcessRow, needle: string): boolean {
  const process: ProcessSample = row.process;
  return (
    `${process.pid}` === needle ||
    process.name.toLowerCase().includes(needle) ||
    process.command.toLowerCase().includes(needle) ||
    (process.location ?? '').toLowerCase().includes(needle) ||
    process.user.toLowerCase().includes(needle)
  );
}

/**
 * Builds the comparison that orders rows by a sort.
 * @param sort The sort.
 * @returns Returns the comparison.
 */
function comparer(sort: TableSort): (a: ProcessRow, b: ProcessRow) => number {
  const direction: number = sort.direction === 'asc' ? 1 : -1;
  return (a: ProcessRow, b: ProcessRow): number => {
    switch (sort.columnId as ProcessColumnId) {
      case 'name':
        return direction * a.process.name.localeCompare(b.process.name);
      case 'pid':
        return direction * (a.process.pid - b.process.pid);
      case 'user':
        return direction * a.process.user.localeCompare(b.process.user);
      case 'memory':
        return direction * (a.process.memoryBytes - b.process.memoryBytes);
      case 'gpu':
        return direction * (a.gpuPercent - b.gpuPercent);
      case 'threads':
        return direction * ((a.process.threads ?? -1) - (b.process.threads ?? -1));
      case 'uptime':
        return direction * (a.uptimeSeconds - b.uptimeSeconds);
      default:
        return direction * (a.process.cpuPercent - b.process.cpuPercent);
    }
  };
}
