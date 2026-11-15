import { CdkVirtualScrollViewport, ScrollingModule } from '@angular/cdk/scrolling';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  InputSignal,
  signal,
  Signal,
  untracked,
  viewChild,
  WritableSignal,
} from '@angular/core';
import { Chip, ChipTone } from '@shared/angular/components/chip/chip';
import { Button } from '@shared/angular/components/forms/button/button';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { PanelToolbar } from '@shared/angular/components/panel-toolbar/panel-toolbar';
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
 * The height of a packet row, in pixels: the virtual list lays rows out by it.
 */
const ROW_HEIGHT: number = 22;

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
  imports: [AppIcon, Button, Chip, PacketDetails, PanelToolbar, ScrollingModule, TextField],
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
   * Gets the height of a packet row, for the virtual list.
   */
  protected readonly rowHeight: number = ROW_HEIGHT;

  /**
   * Identifies a row for the virtual list by its packet's number, which never changes.
   * @param _index The row's index, unused.
   * @param row The row.
   * @returns Returns the packet's number.
   */
  protected readonly trackRow: (_index: number, row: CapturedPacketRow) => number = (
    _index: number,
    row: CapturedPacketRow,
  ): number => row.number;

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
   * Gets the virtual list.
   */
  private readonly viewport: Signal<CdkVirtualScrollViewport | undefined> =
    viewChild(CdkVirtualScrollViewport);

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
        // A fresh array, so the virtual list sees the rows have changed.
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
    effect((): void => {
      const count: number = this.rows().length;
      const viewport: CdkVirtualScrollViewport | undefined = this.viewport();
      if (viewport === undefined || count === 0 || !this.follow()) {
        return;
      }
      untracked((): void => viewport.scrollToIndex(count - 1));
    });
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
      this.viewport()?.scrollToIndex(rows.indexOf(next));
    }
  }

  /**
   * Stops following the newest packet when the user scrolls up from it.
   * @param index The first row in view.
   */
  protected onScrolled(index: number): void {
    const viewport: CdkVirtualScrollViewport | undefined = this.viewport();
    if (viewport === undefined || !this.follow()) {
      return;
    }
    const visible: number = Math.ceil(viewport.getViewportSize() / ROW_HEIGHT);
    if (index + visible < this.rows().length - 2) {
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
}
