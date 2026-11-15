import { inject, Service, Signal, signal, Type, WritableSignal } from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { Log } from '@shared/angular/services/log/log';
import { CapturedPacketRow, CaptureStart } from '@shared/api/network-capture-channels';
import { CaptureClient } from '../capture-client/capture-client';
import { NetworkWell } from '../network-well/network-well';
import { NETWORK_CAPTURE_PANEL } from './network-capture-panel';

/**
 * Where a capture is: starting, capturing live, reading a file, ended, or unable to start.
 */
export type CaptureStatus = 'starting' | 'capturing' | 'reading' | 'stopped' | 'failed';

/**
 * What a capture reads: an interface, through a filter, or a file.
 */
export type CaptureSource =
  | { readonly kind: 'interface'; readonly interfaceId: string; readonly filter: string }
  | { readonly kind: 'file'; readonly path: string };

/**
 * One capture, as its document shows it.
 */
export interface Capture {
  /**
   * Gets the capture's id, which is also its document's.
   */
  readonly id: string;

  /**
   * Gets the document's title.
   */
  readonly title: string;

  /**
   * Gets what the capture reads.
   */
  readonly source: CaptureSource;

  /**
   * Gets where the capture is.
   */
  readonly status: CaptureStatus;

  /**
   * Gets why it failed or ended, fit to show.
   */
  readonly message?: string;

  /**
   * Gets whether it failed for want of permission to capture.
   */
  readonly permission: boolean;

  /**
   * Gets how many packets it has.
   */
  readonly count: number;

  /**
   * Gets how many bytes they came to on the wire.
   */
  readonly bytes: number;
}

/**
 * Gets the interface's name as a capture's title gives it.
 * @param interfaceId The interface's id.
 * @param name The interface's name.
 * @returns Returns `Wi-Fi (en0)`, or the id alone when that is its name.
 */
function interfaceLabel(interfaceId: string, name: string): string {
  return name === interfaceId ? interfaceId : `${name} (${interfaceId})`;
}

/**
 * The Network Explorer's packet captures, each a document in the well, shared by every panel in one
 * tab. A capture's packets stream in as summaries; their rows are kept here, where a document set
 * aside behind another finds them again.
 *
 * The rows are a plain array per capture, appended to in place, with one version signal saying
 * something changed: a capture of a hundred thousand packets is not copied every time a batch lands.
 */
@Service({ autoProvided: false })
export class NetworkCaptures {
  /**
   * Holds the client the captures run through.
   */
  private readonly client: CaptureClient = inject(CaptureClient);

  /**
   * Holds the well captures' documents open in.
   */
  private readonly well: NetworkWell = inject(NetworkWell);

  /**
   * Holds the component a capture's document renders.
   */
  private readonly panel: Type<unknown> = inject(NETWORK_CAPTURE_PANEL);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds every capture, by id.
   */
  private readonly capturesState: WritableSignal<ReadonlyMap<string, Capture>> = signal<
    ReadonlyMap<string, Capture>
  >(new Map<string, Capture>());

  /**
   * Holds each capture's rows, appended to in place.
   */
  private readonly rowsById: Map<string, CapturedPacketRow[]> = new Map<
    string,
    CapturedPacketRow[]
  >();

  /**
   * Counts changes to any capture's rows, so what reads them knows to read again.
   */
  private readonly versionState: WritableSignal<number> = signal<number>(0);

  /**
   * Gets every capture, by id.
   */
  public readonly captures: Signal<ReadonlyMap<string, Capture>> = this.capturesState.asReadonly();

  /**
   * Gets the count of changes to any capture's rows.
   */
  public readonly version: Signal<number> = this.versionState.asReadonly();

  /**
   * Gets a capture's rows. Read {@link version} alongside, to hear of rows added.
   * @param id The capture's id.
   * @returns Returns the rows, in order.
   */
  public rows(id: string): readonly CapturedPacketRow[] {
    return this.rowsById.get(id) ?? [];
  }

  /**
   * Captures every packet on an interface, in its own document.
   * @param interfaceId The interface's id.
   * @param name The interface's name.
   * @returns Returns the capture's id.
   */
  public watchInterface(interfaceId: string, name: string): string {
    return this.begin(`Capture on ${interfaceLabel(interfaceId, name)}`, {
      kind: 'interface',
      interfaceId,
      filter: '',
    });
  }

  /**
   * Captures one connection's packets — those to and from its remote end — on the interface it is
   * made over, in its own document.
   * @param interfaceId The interface's id.
   * @param remoteHost The remote end's address.
   * @param remotePort The remote end's port.
   * @returns Returns the capture's id.
   */
  public watchConnection(interfaceId: string, remoteHost: string, remotePort: number): string {
    // A link-local address's zone names the interface, which the capture already is.
    const host: string = remoteHost.split('%')[0];
    return this.begin(`Capture of ${host}:${String(remotePort)}`, {
      kind: 'interface',
      interfaceId,
      filter: `host ${host} and port ${String(remotePort)}`,
    });
  }

  /**
   * Reads a capture file, in its own document.
   * @param path The file.
   * @returns Returns the capture's id.
   */
  public openFile(path: string): string {
    const name: string = path.split(/[\\/]/).at(-1) ?? path;
    return this.begin(name, { kind: 'file', path });
  }

  /**
   * Stops a capture that is running.
   * @param id The capture's id.
   */
  public stop(id: string): void {
    const capture: Capture | undefined = this.capturesState().get(id);
    if (capture?.status === 'capturing' || capture?.status === 'starting') {
      this.client.stop(id);
    }
  }

  /**
   * Starts an ended capture again, from nothing.
   * @param id The capture's id.
   */
  public restart(id: string): void {
    const capture: Capture | undefined = this.capturesState().get(id);
    if (capture === undefined || capture.status === 'capturing' || capture.status === 'starting') {
      return;
    }
    this.client.release(id);
    void this.run(id, capture.title, capture.source);
  }

  /**
   * Writes a capture to a file.
   * @param id The capture's id.
   * @param path The file.
   * @returns Returns a promise resolving true once written.
   */
  public save(id: string, path: string): Promise<boolean> {
    return this.client.save(id, path);
  }

  /**
   * Stops and forgets every capture, as the tab closes.
   */
  public releaseAll(): void {
    for (const id of this.capturesState().keys()) {
      this.client.release(id);
    }
  }

  /**
   * Starts a capture in a new document.
   * @param title The document's title.
   * @param source What it reads.
   * @returns Returns the capture's id.
   */
  private begin(title: string, source: CaptureSource): string {
    const id: string = `capture-${crypto.randomUUID()}`;
    void this.run(id, title, source);
    this.well.open(id, title, Icon.NETWORK_CAPTURE, this.panel);
    return id;
  }

  /**
   * Runs a capture, keeping its document up to date as its packets arrive.
   * @param id The capture's id.
   * @param title The document's title.
   * @param source What it reads.
   */
  private async run(id: string, title: string, source: CaptureSource): Promise<void> {
    this.rowsById.set(id, []);
    this.put({ id, title, source, status: 'starting', permission: false, count: 0, bytes: 0 });
    this.versionState.update((version: number): number => version + 1);
    const listener: Parameters<CaptureClient['start']>[3] = {
      packets: (packets: readonly CapturedPacketRow[]): void => this.accept(id, packets),
      ended: (message: string | undefined): void =>
        this.patch(id, (capture: Capture): Capture => ({
          ...capture,
          status: 'stopped',
          ...(message === undefined ? {} : { message }),
        })),
    };
    const start: CaptureStart =
      source.kind === 'file'
        ? await this.client.open(id, source.path, listener)
        : await this.client.start(id, source.interfaceId, source.filter, listener);
    if (start.kind === 'failed') {
      this.log.warn('network-explorer.captures', 'Capture failed to start', {
        message: start.message,
      });
      this.patch(id, (capture: Capture): Capture => ({
        ...capture,
        status: 'failed',
        message: start.message,
        permission: start.permission,
      }));
      return;
    }
    this.patch(id, (capture: Capture): Capture =>
      capture.status === 'starting'
        ? { ...capture, status: source.kind === 'file' ? 'reading' : 'capturing' }
        : capture,
    );
  }

  /**
   * Takes in a batch of a capture's packets.
   * @param id The capture's id.
   * @param packets The packets.
   */
  private accept(id: string, packets: readonly CapturedPacketRow[]): void {
    const rows: CapturedPacketRow[] | undefined = this.rowsById.get(id);
    if (rows === undefined) {
      return;
    }
    rows.push(...packets);
    const bytes: number = packets.reduce(
      (sum: number, packet: CapturedPacketRow): number => sum + packet.length,
      0,
    );
    this.patch(id, (capture: Capture): Capture => ({
      ...capture,
      count: rows.length,
      bytes: capture.bytes + bytes,
    }));
    this.versionState.update((version: number): number => version + 1);
  }

  /**
   * Stores a capture, replacing any of the same id.
   * @param capture The capture.
   */
  private put(capture: Capture): void {
    this.capturesState.update(
      (captures: ReadonlyMap<string, Capture>): ReadonlyMap<string, Capture> =>
        new Map<string, Capture>(captures).set(capture.id, capture),
    );
  }

  /**
   * Changes a stored capture.
   * @param id The capture's id.
   * @param change Makes the changed capture from the stored one.
   */
  private patch(id: string, change: (capture: Capture) => Capture): void {
    const capture: Capture | undefined = this.capturesState().get(id);
    if (capture !== undefined) {
      this.put(change(capture));
    }
  }
}
