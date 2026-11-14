import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { Button } from '@shared/angular/components/forms/button/button';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { Chip } from '@shared/angular/components/chip/chip';
import {
  Table,
  TableColumn,
  TableRow,
  TableRowDef,
  TableSort,
} from '@shared/angular/components/table/table';
import { Icon } from '@shared/angular/icons/icon';
import {
  ProcessesSnapshot,
  ProcessSample,
  StudioProcessKind,
} from '@shared/api/system-monitor-channels';
import { MetricTile, TileChannel } from '../../metric-tile/metric-tile';
import { formatBytes, formatShare } from '../../readings/format';
import {
  ChosenProcess,
  ProcessHistory,
  SystemMonitorProcesses,
} from '../../readings/system-monitor-processes';

/**
 * Identifies which processes the list shows.
 * - `all`: every process listed.
 * - `studio`: Studio's own, and those it started.
 */
type ProcessScope = 'all' | 'studio';

/**
 * Describes one process's row, its strings formatted once per snapshot.
 */
interface ProcessRow {
  /**
   * Gets the process as listed.
   */
  readonly process: ProcessSample;

  /**
   * Gets the CPU share, formatted.
   */
  readonly cpu: string;

  /**
   * Gets the resident memory, formatted.
   */
  readonly memory: string;

  /**
   * Gets the Studio role, or null when the process is not Studio's.
   */
  readonly studio: string | null;
}

/**
 * Describes one fact shown about the chosen process.
 */
interface ProcessFact {
  /**
   * Gets the fact's label.
   */
  readonly label: string;

  /**
   * Gets the fact's value.
   */
  readonly value: string;
}

/**
 * The process list's columns.
 */
const COLUMNS: readonly TableColumn[] = [
  { id: 'name', header: 'Name', sortable: true },
  { id: 'pid', header: 'PID', width: '5.5rem', align: 'end', sortable: true },
  { id: 'cpu', header: 'CPU', width: '5.5rem', align: 'end', sortable: true },
  { id: 'memory', header: 'Memory', width: '7rem', align: 'end', sortable: true },
  { id: 'user', header: 'User', width: '8rem' },
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
 * The least scale a process's CPU graph is drawn to, so a process idling at a fraction of a percent
 * does not fill its graph with noise.
 */
const MIN_CPU_SCALE: number = 5;

/**
 * Represents the System Monitor's Processes tab: the machine's processes, busiest first, with Studio's
 * own marked — its windows and helpers, and everything it started (shells, language servers, agents,
 * builds). The list can be narrowed to Studio's, filtered by name or command, and sorted; choosing a
 * process graphs its CPU and memory over the last two minutes beside the list.
 *
 * CPU is each process's share of the whole machine, so it reads against the CPU tab's graph. Only
 * Studio's processes and the busiest of the rest are listed, so the list stays cheap to refresh.
 */
@Component({
  selector: 'app-system-monitor-processes-tab',
  imports: [Button, TextField, Chip, Table, TableRowDef, MetricTile],
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
   * Gets the list's columns.
   */
  protected readonly columns: readonly TableColumn[] = COLUMNS;

  /**
   * Gets the view's process listing.
   */
  protected readonly listing: SystemMonitorProcesses = inject(SystemMonitorProcesses);

  /**
   * Holds which processes the list shows.
   */
  protected readonly scope: WritableSignal<ProcessScope> = signal<ProcessScope>('all');

  /**
   * Holds the filter text, matched against each process's name and command.
   */
  protected readonly text: WritableSignal<string> = signal<string>('');

  /**
   * Holds the sort the list's header asks for, or null to keep the listing's busiest-first order.
   */
  private readonly sort: WritableSignal<TableSort | null> = signal<TableSort | null>(null);

  /**
   * Gets every listed process's row, formatted once per snapshot.
   */
  private readonly allRows: Signal<readonly ProcessRow[]> = computed((): readonly ProcessRow[] =>
    this.listing.processes().map((process: ProcessSample): ProcessRow => ({
      process,
      cpu: formatShare(process.cpuPercent),
      memory: formatBytes(process.memoryBytes),
      studio: process.studio === undefined ? null : STUDIO_ROLES[process.studio],
    })),
  );

  /**
   * Gets the rows shown: those in scope that match the filter, in the order asked for.
   */
  private readonly shown: Signal<readonly ProcessRow[]> = computed((): readonly ProcessRow[] => {
    const studioOnly: boolean = this.scope() === 'studio';
    const needle: string = this.text().trim().toLowerCase();
    const rows: readonly ProcessRow[] = this.allRows().filter(
      (row: ProcessRow): boolean =>
        (!studioOnly || row.studio !== null) &&
        (needle.length === 0 ||
          row.process.name.toLowerCase().includes(needle) ||
          row.process.command.toLowerCase().includes(needle) ||
          `${row.process.pid}` === needle),
    );
    const sort: TableSort | null = this.sort();
    return sort === null ? rows : [...rows].sort(comparer(sort));
  });

  /**
   * Gets each shown row's process by its row id, so a row's cells read their process without a cast.
   */
  private readonly rowsById: Signal<ReadonlyMap<string, ProcessRow>> = computed(
    (): ReadonlyMap<string, ProcessRow> =>
      new Map<string, ProcessRow>(
        this.shown().map((row: ProcessRow): [string, ProcessRow] => [`${row.process.pid}`, row]),
      ),
  );

  /**
   * Gets the table's rows.
   */
  protected readonly rows: Signal<readonly TableRow[]> = computed((): readonly TableRow[] =>
    this.shown().map((row: ProcessRow): TableRow => ({
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
   * Gets the count shown in the toolbar: the processes shown, of all running.
   */
  protected readonly count: Signal<string> = computed((): string => {
    const snapshot: ProcessesSnapshot | null = this.listing.snapshot();
    return snapshot === null ? '' : `${this.shown().length} of ${snapshot.total}`;
  });

  /**
   * Gets the message the empty list shows: waiting for the first listing, or nothing matching.
   */
  protected readonly emptyText: Signal<string> = computed((): string =>
    this.listing.snapshot() === null ? 'Listing processes…' : 'No processes match.',
  );

  /**
   * Gets the chosen process's facts.
   */
  protected readonly facts: Signal<readonly ProcessFact[]> = computed(
    (): readonly ProcessFact[] => {
      const process: ProcessSample | undefined = this.listing.selected()?.process;
      if (process === undefined) {
        return [];
      }
      const facts: ProcessFact[] = [
        { label: 'PID', value: `${process.pid}` },
        { label: 'Parent PID', value: process.parentPid > 0 ? `${process.parentPid}` : '—' },
        { label: 'User', value: process.user.length > 0 ? process.user : '—' },
      ];
      if (process.studio !== undefined) {
        facts.push({ label: 'Studio', value: STUDIO_ROLES[process.studio] });
      }
      return facts;
    },
  );

  /**
   * Gets the chosen process's CPU graph.
   */
  protected readonly cpuChannels: Signal<readonly TileChannel[]> = computed(
    (): readonly TileChannel[] => {
      const history: ProcessHistory = this.listing.selectedHistory();
      const chosen: ChosenProcess | null = this.listing.selected();
      return [
        {
          value: chosen?.listed === true ? formatShare(chosen.process.cpuPercent) : '—',
          values: history.cpu,
          max: Math.max(MIN_CPU_SCALE, ...history.cpu),
        },
      ];
    },
  );

  /**
   * Gets the chosen process's memory graph.
   */
  protected readonly memoryChannels: Signal<readonly TileChannel[]> = computed(
    (): readonly TileChannel[] => {
      const history: ProcessHistory = this.listing.selectedHistory();
      const chosen: ChosenProcess | null = this.listing.selected();
      return [
        {
          value: chosen?.listed === true ? formatBytes(chosen.process.memoryBytes) : '—',
          values: history.memory,
          max: Math.max(1, ...history.memory),
        },
      ];
    },
  );

  /**
   * Gets the row a table row stands for.
   * @param row The table row.
   * @returns Returns the process row, or undefined when it has just left the listing.
   */
  protected rowOf(row: TableRow): ProcessRow | undefined {
    return this.rowsById().get(row.id);
  }

  /**
   * Shows every process, or only Studio's.
   * @param scope The processes to show.
   */
  protected setScope(scope: ProcessScope): void {
    this.scope.set(scope);
  }

  /**
   * Applies the sort the list's header asks for.
   * @param sort The sort, or null to return to busiest first.
   */
  protected onSort(sort: TableSort | null): void {
    this.sort.set(sort);
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
   * Closes the chosen process's details.
   */
  protected closeDetails(): void {
    this.listing.select(null);
  }
}

/**
 * Builds the comparison that orders rows by a sort.
 * @param sort The sort.
 * @returns Returns the comparison.
 */
function comparer(sort: TableSort): (a: ProcessRow, b: ProcessRow) => number {
  const direction: number = sort.direction === 'asc' ? 1 : -1;
  return (a: ProcessRow, b: ProcessRow): number => {
    switch (sort.columnId) {
      case 'name':
        return direction * a.process.name.localeCompare(b.process.name);
      case 'pid':
        return direction * (a.process.pid - b.process.pid);
      case 'memory':
        return direction * (a.process.memoryBytes - b.process.memoryBytes);
      default:
        return direction * (a.process.cpuPercent - b.process.cpuPercent);
    }
  };
}
