import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import type { Severity } from '@shared/api/log-channels';
import { Chip, type ChipTone } from '@shared/angular/components/chip/chip';
import { SEVERITY_TONES } from '@shared/angular/components/chip/severity-tones';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { PanelToolbar } from '@shared/angular/components/panel-toolbar/panel-toolbar';
import { Button } from '@shared/angular/components/forms/button/button';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { Table, TableColumn, TableRow, TableRowDef } from '@shared/angular/components/table/table';
import { Icon } from '@shared/angular/icons/icon';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { Log } from '@shared/angular/services/log/log';
import { Output, OutputChannelInfo, OutputEntry } from '@shared/angular/services/output/output';

/**
 * The channel choice that lists every channel together, with a Source column saying which each line
 * came from.
 */
const ALL_CHANNELS: string = '*';

/**
 * How severe a line must be to be listed, by the level filter's value.
 */
const LEVEL_FLOORS: Readonly<Record<string, number>> = {
  all: 0,
  info: 2,
  warning: 3,
  error: 4,
};

/**
 * Each severity's rank, for the level filter.
 */
const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
  trace: 0,
  debug: 1,
  info: 2,
  warning: 3,
  error: 4,
};

/**
 * One line of the table, its strings built once so a pass only reads them.
 */
interface LogRow {
  readonly entry: OutputEntry;
  readonly time: string;
  readonly level: string;
  readonly tone: ChipTone;
  readonly source: string;
  readonly message: string;
}

/**
 * The workspace's Logs panel: what language servers, the debugger, test runs and the like write, as a
 * table of time, level and message (and, listing every channel together, where each line came from),
 * the level shown as a chip in the System Monitor's colours. Filtered by channel, by how severe, and by
 * text; it follows the newest lines while scrolled to the end.
 */
@Component({
  selector: 'app-output-panel',
  imports: [Button, Chip, Dropdown, PanelToolbar, Table, TableRowDef, TextField],
  templateUrl: './output-panel.html',
  styleUrl: './output-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OutputPanel {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the dock panel this view fills.
   */
  public readonly panel: InputSignal<DockPanel> = input.required<DockPanel>();

  /**
   * Gets whether the panel is the one shown in its dock.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Holds the output channels.
   */
  private readonly output: Output = inject(Output);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds whether every channel is listed together, rather than the one chosen.
   */
  protected readonly showAll: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the level filter's value.
   */
  protected readonly levelFilter: WritableSignal<string> = signal<string>('all');

  /**
   * Holds the text filter.
   */
  protected readonly query: WritableSignal<string> = signal<string>('');

  /**
   * Gets the channel shown: one channel's id, or the value standing for all of them.
   */
  protected readonly channelValue: Signal<string> = computed((): string =>
    this.showAll() ? ALL_CHANNELS : this.output.activeChannelId(),
  );

  /**
   * Gets the channel choices: every channel together, then each one.
   */
  protected readonly channelOptions: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] => [
      { value: ALL_CHANNELS, label: 'All channels' },
      ...this.output.channels().map((channel: OutputChannelInfo): DropdownOption => ({
        value: channel.id,
        label: channel.label,
      })),
    ],
  );

  /**
   * Gets the level filter's choices.
   */
  protected readonly levelOptions: readonly DropdownOption[] = [
    { value: 'all', label: 'All levels' },
    { value: 'info', label: 'Info and above' },
    { value: 'warning', label: 'Warnings and errors' },
    { value: 'error', label: 'Errors only' },
  ];

  /**
   * Gets the table's columns: a Source column only while every channel is listed together.
   */
  protected readonly columns: Signal<readonly TableColumn[]> = computed(
    (): readonly TableColumn[] => [
      { id: 'time', header: 'Time', width: '7.5rem' },
      { id: 'level', header: 'Level', width: '6.5rem' },
      ...(this.showAll() ? [{ id: 'source', header: 'Source', width: '11rem' }] : []),
      { id: 'message', header: 'Message' },
    ],
  );

  /**
   * Gets the rows, filtered and in the order they were written.
   */
  protected readonly rows: Signal<readonly TableRow[]> = computed((): readonly TableRow[] => {
    this.output.revision();
    const labels: ReadonlyMap<string, string> = new Map<string, string>(
      this.output
        .channels()
        .map((channel: OutputChannelInfo): [string, string] => [channel.id, channel.label]),
    );
    const floor: number = LEVEL_FLOORS[this.levelFilter()] ?? 0;
    const text: string = this.query().trim().toLowerCase();
    return this.output
      .entriesOf(this.showAll() ? null : this.output.activeChannelId())
      .filter(
        (entry: OutputEntry): boolean =>
          SEVERITY_RANK[entry.level] >= floor &&
          (text.length === 0 || entry.text.toLowerCase().includes(text)),
      )
      .map((entry: OutputEntry): TableRow => ({
        id: String(entry.id),
        data: {
          entry,
          time: formatTime(entry.time),
          level: entry.level.toUpperCase(),
          tone: SEVERITY_TONES[entry.level],
          source: labels.get(entry.channelId) ?? entry.channelId,
          message: entry.text,
        } satisfies LogRow,
      }));
  });

  /**
   * Gets what the empty table says.
   */
  protected readonly emptyText: Signal<string> = computed((): string =>
    this.query().trim().length > 0 || this.levelFilter() !== 'all'
      ? 'No lines match the filters.'
      : 'Nothing has been logged here yet.',
  );

  /**
   * Reads a row's line.
   * @param row The row.
   * @returns Returns the line.
   */
  protected lineOf(row: TableRow): LogRow {
    return row.data as LogRow;
  }

  /**
   * Shows a channel, or every channel together.
   * @param value The channel's id, or the value standing for all of them.
   */
  protected selectChannel(value: string): void {
    if (value === ALL_CHANNELS) {
      this.showAll.set(true);
      return;
    }
    this.log.debug('workspace.output', 'Select output channel', value);
    this.showAll.set(false);
    this.output.setActive(value);
  }

  /**
   * Clears what is shown: the channel, or every channel while all are listed.
   */
  protected clear(): void {
    const ids: readonly string[] = this.showAll()
      ? this.output.channels().map((channel: OutputChannelInfo): string => channel.id)
      : [this.output.activeChannelId()];
    this.log.info('workspace.output', 'Clear output', ids.join(', '));
    for (const id of ids) {
      this.output.clearChannel(id);
    }
  }
}

/**
 * Formats a line's time to the millisecond, in local time, as a log reads it (`14:02:07.351`).
 * @param time The time (epoch milliseconds).
 * @returns Returns the time.
 */
function formatTime(time: number): string {
  const date: Date = new Date(time);
  const pad: (value: number, length?: number) => string = (
    value: number,
    length: number = 2,
  ): string => `${value}`.padStart(length, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}
