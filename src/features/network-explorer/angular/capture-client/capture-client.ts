import { Service } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import {
  CaptureBatch,
  CapturedPacket,
  CapturedPacketRow,
  CaptureEnd,
  CaptureFileRequest,
  CaptureRequest,
  CaptureStart,
  NetworkCaptureChannel,
} from '@shared/api/network-capture-channels';

/**
 * Receives what a capture sends: its packets as they are read, and its end.
 */
export interface CaptureListener {
  /**
   * Receives a batch of packets.
   * @param packets The packets, in order.
   */
  packets(packets: readonly CapturedPacketRow[]): void;

  /**
   * Receives the capture's end.
   * @param message Why it ended, when it was not asked to.
   */
  ended(message: string | undefined): void;
}

/**
 * The renderer client for packet captures: starting one on an interface or from a file, stopping and
 * saving it, and fetching a packet's bytes. A capture's packets and end are delivered to the listener
 * it was started with. Outside Electron every capture fails at once, saying why.
 */
@Service()
export class CaptureClient {
  /**
   * Holds the IPC transport, or undefined when running outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Holds each capture's listener, by capture id.
   */
  private readonly listeners: Map<string, CaptureListener> = new Map<string, CaptureListener>();

  /**
   * Routes every capture's batches and ends to its listener.
   */
  public constructor() {
    this.bridge?.on(NetworkCaptureChannel.Packets, (...args: unknown[]): void => {
      const batch: CaptureBatch = args[0] as CaptureBatch;
      this.listeners.get(batch.id)?.packets(batch.packets);
    });
    this.bridge?.on(NetworkCaptureChannel.Ended, (...args: unknown[]): void => {
      const end: CaptureEnd = args[0] as CaptureEnd;
      this.listeners.get(end.id)?.ended(end.message);
    });
  }

  /**
   * Starts capturing on an interface.
   * @param id The capture's id.
   * @param interfaceId The interface.
   * @param filter The capture filter, or empty for every packet.
   * @param listener Receives the capture's packets and end.
   * @returns Returns a promise resolving whether it started.
   */
  public start(
    id: string,
    interfaceId: string,
    filter: string,
    listener: CaptureListener,
  ): Promise<CaptureStart> {
    return this.begin(id, listener, NetworkCaptureChannel.Start, { id, interfaceId, filter });
  }

  /**
   * Reads a capture file.
   * @param id The capture's id.
   * @param path The file.
   * @param listener Receives the file's packets and its end.
   * @returns Returns a promise resolving whether it could be read.
   */
  public open(id: string, path: string, listener: CaptureListener): Promise<CaptureStart> {
    return this.begin(id, listener, NetworkCaptureChannel.Open, { id, path });
  }

  /**
   * Stops a capture.
   * @param id The capture's id.
   */
  public stop(id: string): void {
    this.bridge?.send(NetworkCaptureChannel.Stop, id);
  }

  /**
   * Forgets a capture, its packets and its temporary file.
   * @param id The capture's id.
   */
  public release(id: string): void {
    this.listeners.delete(id);
    this.bridge?.send(NetworkCaptureChannel.Release, id);
  }

  /**
   * Fetches one packet's bytes.
   * @param id The capture's id.
   * @param number The packet's number.
   * @returns Returns a promise resolving the packet, or undefined when it cannot be had.
   */
  public async packet(id: string, number: number): Promise<CapturedPacket | undefined> {
    if (this.bridge === undefined) {
      return undefined;
    }
    try {
      return (
        (await this.bridge.invoke<CapturedPacket | null>(NetworkCaptureChannel.Packet, {
          id,
          number,
        })) ?? undefined
      );
    } catch {
      return undefined;
    }
  }

  /**
   * Writes a capture to a file.
   * @param id The capture's id.
   * @param path The file.
   * @returns Returns a promise resolving true once written.
   */
  public async save(id: string, path: string): Promise<boolean> {
    if (this.bridge === undefined) {
      return false;
    }
    try {
      return await this.bridge.invoke<boolean>(NetworkCaptureChannel.Save, { id, path });
    } catch {
      return false;
    }
  }

  /**
   * Starts a capture of either kind, its listener registered first so no early batch is missed.
   * @param id The capture's id.
   * @param listener Receives the capture's packets and end.
   * @param channel The channel that starts it.
   * @param request What it is asked to capture.
   * @returns Returns a promise resolving whether it started.
   */
  private async begin(
    id: string,
    listener: CaptureListener,
    channel: NetworkCaptureChannel,
    request: CaptureRequest | CaptureFileRequest,
  ): Promise<CaptureStart> {
    if (this.bridge === undefined) {
      return { kind: 'failed', message: 'Capturing needs the desktop app.', permission: false };
    }
    this.listeners.set(id, listener);
    try {
      const start: CaptureStart = await this.bridge.invoke<CaptureStart>(channel, request);
      if (start.kind === 'failed') {
        this.listeners.delete(id);
      }
      return start;
    } catch (error: unknown) {
      this.listeners.delete(id);
      return {
        kind: 'failed',
        message: error instanceof Error ? error.message : String(error),
        permission: false,
      };
    }
  }
}
