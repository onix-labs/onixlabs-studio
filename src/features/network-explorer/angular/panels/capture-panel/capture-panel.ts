import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  signal,
  Signal,
  viewChild,
  WritableSignal,
} from '@angular/core';
import { Chip, ChipTone } from '@shared/angular/components/chip/chip';
import { Button } from '@shared/angular/components/forms/button/button';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { PanelToolbar } from '@shared/angular/components/panel-toolbar/panel-toolbar';
import { Table, TableColumn, TableRow, TableRowDef } from '@shared/angular/components/table/table';
import { Icon } from '@shared/angular/icons/icon';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { FileSystem } from '@shared/angular/services/file-system/file-system';
import { CapturedPacket, CapturedPacketRow } from '@shared/api/network-capture-channels';
import { dissectPacket } from '@shared/api/packets/dissect-packet';
import { DissectedPacket } from '@shared/api/packets/packet-model';
import { CaptureClient } from '../../capture-client/capture-client';
import { Capture, CaptureStatus, NetworkCaptures } from '../../network-captures/network-captures';
import { PacketDetails } from '../../packet-details/packet-details';

/**
 * The packet a capture's document is showing in full.
 */
interface ChosenPacket {
  /**
   * Gets the packet's number.
   */
  readonly number: number;

  /**
   * Gets its bytes.
   */
  readonly data: Uint8Array;

  /**
   * Gets it taken apart.
   */
  readonly dissected: DissectedPacket;
}

/**
 * The packet list's columns, in order.
 */
const COLUMNS: readonly TableColumn[] = [
  { id: 'number', header: 'No.', width: '5rem', align: 'end' },
  { id: 'time', header: 'Time', width: '7.5rem', align: 'end' },
  { id: 'source', header: 'Source', width: '14rem' },
  { id: 'destination', header: 'Destination', width: '14rem' },
  { id: 'protocol', header: 'Protocol', width: '5.5rem' },
  { id: 'length', header: 'Length', width: '4.75rem', align: 'end' },
  { id: 'info', header: 'Info' },
];

/**
 * Formats a byte count.
 * @param bytes The count.
 * @returns Returns it in the unit that suits it.
 */
function formatBytes(bytes: number): string {
  const units: readonly string[] = ['B', 'KB', 'MB', 'GB'];
  let size: number = bytes;
  let unit: number = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? String(size) : size.toFixed(1)} ${units[unit]}`;
}

/**
 * A packet capture, as a document in the Network Explorer's well: the packets as they arrive, one per
 * row, and the chosen one taken apart beneath them, its layers beside its bytes.
 *
 * The list is virtual, so a capture of a hundred thousand packets draws only the rows in view; it
 * follows the newest packet while a capture runs, until the user scrolls away or turns that off. The
 * filter narrows the rows by protocol, address or what a packet says, without touching the capture.
 */
@Component({
  selector: 'app-capture-panel',
  imports: [AppIcon, Button, Chip, PacketDetails, PanelToolbar, Table, TableRowDef, TextField],
  templateUrl: './capture-panel.html',
  styleUrl: './capture-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CapturePanel {
  /**
   * Gets the dock panel this component is projected into, whose id is the capture's.
   */
  public readonly panel: InputSignal<DockPanel> = input.required<DockPanel>();

  /**
   * Holds the tab's captures.
   */
  private readonly captures: NetworkCaptures = inject(NetworkCaptures);

  /**
   * Holds the client a packet's bytes are fetched through.
   */
  private readonly client: CaptureClient = inject(CaptureClient);

  /**
   * Holds the file client, for the save dialog.
   */
  private readonly fileSystem: FileSystem = inject(FileSystem);

  /**
   * Holds the icon tokens used by the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the packet list's columns.
   */
  protected readonly columns: readonly TableColumn[] = COLUMNS;

  /**
   * Holds the table row standing for each packet row, made once per packet, so a capture of a
   * million packets does not make a million rows again with every batch that arrives.
   */
  private readonly tableRowsByPacket: WeakMap<CapturedPacketRow, TableRow> = new WeakMap<
    CapturedPacketRow,
    TableRow
  >();

  /**
   * Holds the packet row each table row stands for.
   */
  private readonly packetsByTableRow: WeakMap<TableRow, CapturedPacketRow> = new WeakMap<
    TableRow,
    CapturedPacketRow
  >();

  /**
   * Holds the filter typed into the strip.
   */
  protected readonly query: WritableSignal<string> = signal<string>('');

  /**
   * Holds whether the list keeps the newest packet in view.
   */
  protected readonly follow: WritableSignal<boolean> = signal<boolean>(true);

  /**
   * Holds the number of the packet chosen, or undefined when none is.
   */
  protected readonly chosenNumber: WritableSignal<number | undefined> = signal<number | undefined>(
    undefined,
  );

  /**
   * Holds the chosen packet once its bytes have arrived.
   */
  protected readonly chosen: WritableSignal<ChosenPacket | undefined> = signal<
    ChosenPacket | undefined
  >(undefined);

  /**
   * Gets the packet list.
   */
  private readonly table: Signal<Table | undefined> = viewChild(Table);

  /**
   * Gets the capture, or undefined when it is gone.
   */
  protected readonly capture: Signal<Capture | undefined> = computed((): Capture | undefined =>
    this.captures.captures().get(this.panel().id),
  );

  /**
   * Gets the capture's rows that the filter keeps.
   */
  protected readonly rows: Signal<readonly CapturedPacketRow[]> = computed(
    (): readonly CapturedPacketRow[] => {
      this.captures.version();
      const rows: readonly CapturedPacketRow[] = this.captures.rows(this.panel().id);
      const needle: string = this.query().trim().toLowerCase();
      if (needle.length === 0) {
        // A fresh array, so the list sees the rows have changed.
        return rows.slice();
      }
      return rows.filter((row: CapturedPacketRow): boolean =>
        [row.summary.protocol, row.summary.source, row.summary.destination, row.summary.info].some(
          (text: string): boolean => text.toLowerCase().includes(needle),
        ),
      );
    },
  );

  /**
   * Gets the packet list's rows, one per packet the filter keeps.
   */
  protected readonly tableRows: Signal<readonly TableRow[]> = computed((): readonly TableRow[] =>
    this.rows().map((row: CapturedPacketRow): TableRow => this.tableRowOf(row)),
  );

  /**
   * Gets the chosen packet's row id, as a set for the list's selection.
   */
  protected readonly chosenIds: Signal<ReadonlySet<string>> = computed((): ReadonlySet<string> => {
    const number: number | undefined = this.chosenNumber();
    return new Set<string>(number === undefined ? [] : [String(number)]);
  });

  /**
   * Gets what the empty list says: that the capture is starting, that it is waiting for its first
   * packet, or that there are none (or none the filter keeps).
   */
  protected readonly emptyText: Signal<string> = computed((): string => {
    switch (this.capture()?.status) {
      case 'starting':
        return 'Starting the capture…';
      case 'capturing':
        return 'Waiting for the first packet…';
      default:
        return 'No packets.';
    }
  });

  /**
   * Gets when the capture's first packet was captured, which every row's time counts from.
   */
  private readonly firstTimestamp: Signal<number> = computed((): number => {
    this.captures.version();
    return this.captures.rows(this.panel().id)[0]?.timestampMs ?? 0;
  });

  /**
   * Gets the strip's summary of the capture: how many packets, and how many bytes.
   */
  protected readonly totals: Signal<string> = computed((): string => {
    const capture: Capture | undefined = this.capture();
    if (capture === undefined) {
      return '';
    }
    const shown: number = this.rows().length;
    const packets: string = `${capture.count.toLocaleString('en')} ${capture.count === 1 ? 'packet' : 'packets'}`;
    const filtered: string = shown === capture.count ? '' : `, ${shown.toLocaleString('en')} shown`;
    return `${packets}${filtered} · ${formatBytes(capture.bytes)}`;
  });

  /**
   * Keeps the newest packet in view while following.
   */
  public constructor() {
    // After the render, so the list has already grown to hold the newest row it scrolls to.
    afterRenderEffect((): void => {
      const count: number = this.rows().length;
      const table: Table | undefined = this.table();
      if (table === undefined || count === 0 || !this.follow()) {
        return;
      }
      table.scrollToIndex(count - 1);
    });
  }

  /**
   * Gets the packet a table row stands for.
   * @param row The table row.
   * @returns Returns the packet's row, or undefined when the capture has started again without it.
   */
  protected rowOf(row: TableRow): CapturedPacketRow | undefined {
    return this.packetsByTableRow.get(row);
  }

  /**
   * Formats a packet's time, in seconds since the capture's first packet.
   * @param row The packet's row.
   * @returns Returns the time.
   */
  protected timeOf(row: CapturedPacketRow): string {
    return ((row.timestampMs - this.firstTimestamp()) / 1000).toFixed(6);
  }

  /**
   * Gets the tone the capture's status is shown in.
   * @param status The status.
   * @returns Returns the tone.
   */
  protected toneOf(status: CaptureStatus): ChipTone {
    switch (status) {
      case 'starting':
      case 'reading':
        return 'info';
      case 'capturing':
        return 'success';
      case 'stopped':
        return 'neutral';
      case 'failed':
        return 'danger';
    }
  }

  /**
   * Gets the words the capture's status is shown as.
   * @param status The status.
   * @returns Returns the label.
   */
  protected labelOf(status: CaptureStatus): string {
    switch (status) {
      case 'starting':
        return 'Starting';
      case 'capturing':
        return 'Capturing';
      case 'reading':
        return 'Reading';
      case 'stopped':
        return 'Stopped';
      case 'failed':
        return 'Failed';
    }
  }

  /**
   * Chooses a packet, fetching its bytes and taking it apart.
   * @param row The packet's row.
   */
  protected async choose(row: CapturedPacketRow): Promise<void> {
    this.chosenNumber.set(row.number);
    this.follow.set(false);
    const packet: CapturedPacket | undefined = await this.client.packet(
      this.panel().id,
      row.number,
    );
    if (packet === undefined || this.chosenNumber() !== row.number) {
      return;
    }
    this.chosen.set({
      number: row.number,
      data: packet.data,
      dissected: dissectPacket(packet.linkType, packet.data),
    });
  }

  /**
   * Moves the choice up or down the list with the arrow keys.
   * @param event The key press.
   */
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      return;
    }
    event.preventDefault();
    const rows: readonly CapturedPacketRow[] = this.rows();
    const index: number = rows.findIndex(
      (row: CapturedPacketRow): boolean => row.number === this.chosenNumber(),
    );
    const next: CapturedPacketRow | undefined =
      rows[Math.min(rows.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))];
    if (next !== undefined) {
      void this.choose(next);
      this.table()?.scrollToIndex(rows.indexOf(next));
    }
  }

  /**
   * Chooses the packet whose row was clicked.
   * @param row The table row.
   */
  protected onRowClick(row: TableRow): void {
    const packet: CapturedPacketRow | undefined = this.rowOf(row);
    if (packet !== undefined) {
      void this.choose(packet);
    }
  }

  /**
   * Stops following the newest packet when the user scrolls up from it.
   * @param atEnd Whether the list's last rows are still in view.
   */
  protected onScrolled(atEnd: boolean): void {
    if (!atEnd && this.follow()) {
      this.follow.set(false);
    }
  }

  /**
   * Stops the capture.
   */
  protected stop(): void {
    this.captures.stop(this.panel().id);
  }

  /**
   * Starts the capture again, from nothing.
   */
  protected restart(): void {
    this.chosenNumber.set(undefined);
    this.chosen.set(undefined);
    this.follow.set(true);
    this.captures.restart(this.panel().id);
  }

  /**
   * Saves the capture to a pcap file the user chooses.
   */
  protected async save(): Promise<void> {
    const capture: Capture | undefined = this.capture();
    if (capture === undefined) {
      return;
    }
    const path: string | null = await this.fileSystem.saveDialog(
      `${capture.title.replace(/[^A-Za-z0-9 ._()-]+/g, '-')}.pcap`,
    );
    if (path !== null) {
      await this.captures.save(capture.id, path);
    }
  }

  /**
   * Gets the table row standing for a packet row, making it the first time the packet is listed.
   * @param row The packet's row.
   * @returns Returns its table row.
   */
  private tableRowOf(row: CapturedPacketRow): TableRow {
    const existing: TableRow | undefined = this.tableRowsByPacket.get(row);
    if (existing !== undefined) {
      return existing;
    }
    const tableRow: TableRow = { id: String(row.number), data: row.number };
    this.tableRowsByPacket.set(row, tableRow);
    this.packetsByTableRow.set(tableRow, row);
    return tableRow;
  }
}
