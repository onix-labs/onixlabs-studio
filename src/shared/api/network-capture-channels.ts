import { PacketSummary } from './packets/packet-model';

/**
 * The IPC contract for packet captures: watching an interface live, or opening a capture file. Either
 * way the main process reads the packets, summarises each, and streams the summaries to the renderer
 * in batches; the renderer asks for one packet's bytes when the user looks at it, and dissects those
 * itself. The packets stay in the main process, so a long capture never crosses the bridge whole.
 *
 * A live capture is the operating system's `tcpdump`, which holds the privilege capturing needs; Studio
 * reads what it writes. A capture is named by an id the renderer chooses.
 */
export enum NetworkCaptureChannel {
  /**
   * Renderer → main (invoke): starts capturing on an interface, a {@link CaptureRequest}; resolves a
   * {@link CaptureStart} once packets can flow, or once it is clear they cannot.
   */
  Start = 'network-capture:start',

  /**
   * Renderer → main (invoke): reads a capture file, a {@link CaptureFileRequest}; resolves a
   * {@link CaptureStart}, then streams its packets like a live capture's and ends.
   */
  Open = 'network-capture:open',

  /**
   * Renderer → main (send): stops a capture, by its id.
   */
  Stop = 'network-capture:stop',

  /**
   * Main → renderer (send): packets captured since the last batch, a {@link CaptureBatch}.
   */
  Packets = 'network-capture:packets',

  /**
   * Main → renderer (send): a capture has ended, a {@link CaptureEnd}.
   */
  Ended = 'network-capture:ended',

  /**
   * Renderer → main (invoke): one packet's bytes, a {@link CapturePacketRequest}; resolves a
   * {@link CapturedPacket}, or null when there is no such packet.
   */
  Packet = 'network-capture:packet',

  /**
   * Renderer → main (invoke): writes a capture to a file as pcap, a {@link CaptureSaveRequest};
   * resolves true once written.
   */
  Save = 'network-capture:save',

  /**
   * Renderer → main (send): forgets a capture — its packets and its temporary file — by its id.
   */
  Release = 'network-capture:release',
}

/**
 * The most packets one capture keeps. A capture reaching it stops, saying so.
 */
export const MAX_CAPTURE_PACKETS: number = 1_000_000;

/**
 * Asks for a live capture.
 */
export interface CaptureRequest {
  /**
   * Gets the capture's id, chosen by the renderer.
   */
  readonly id: string;

  /**
   * Gets the interface to capture on: `en0`, `lo0`.
   */
  readonly interfaceId: string;

  /**
   * Gets the capture filter, in tcpdump's (BPF) syntax, or empty for every packet.
   */
  readonly filter: string;
}

/**
 * Asks for a capture file to be read.
 */
export interface CaptureFileRequest {
  /**
   * Gets the capture's id, chosen by the renderer.
   */
  readonly id: string;

  /**
   * Gets the file's path.
   */
  readonly path: string;
}

/**
 * Says whether a capture started.
 */
export type CaptureStart =
  | { readonly kind: 'started' }
  | {
      readonly kind: 'failed';
      readonly message: string;
      /**
       * Gets whether it failed for want of permission to capture, which the user can grant.
       */
      readonly permission: boolean;
    };

/**
 * One captured packet, as the packet list shows it.
 */
export interface CapturedPacketRow {
  /**
   * Gets the packet's number in the capture, from 1.
   */
  readonly number: number;

  /**
   * Gets when it was captured, in milliseconds since the Unix epoch.
   */
  readonly timestampMs: number;

  /**
   * Gets its length on the wire.
   */
  readonly length: number;

  /**
   * Gets what it is.
   */
  readonly summary: PacketSummary;
}

/**
 * Carries the packets captured since the last batch.
 */
export interface CaptureBatch {
  /**
   * Gets the capture's id.
   */
  readonly id: string;

  /**
   * Gets the packets, in order.
   */
  readonly packets: readonly CapturedPacketRow[];
}

/**
 * Says a capture has ended, and why if it was not asked to.
 */
export interface CaptureEnd {
  /**
   * Gets the capture's id.
   */
  readonly id: string;

  /**
   * Gets why it ended, when that was not a stop the user asked for.
   */
  readonly message?: string;
}

/**
 * Asks for one packet's bytes.
 */
export interface CapturePacketRequest {
  /**
   * Gets the capture's id.
   */
  readonly id: string;

  /**
   * Gets the packet's number, from 1.
   */
  readonly number: number;
}

/**
 * One packet's bytes, for dissecting in full.
 */
export interface CapturedPacket {
  /**
   * Gets the capture's link-layer header type.
   */
  readonly linkType: number;

  /**
   * Gets the bytes captured.
   */
  readonly data: Uint8Array;
}

/**
 * Asks for a capture to be written to a file.
 */
export interface CaptureSaveRequest {
  /**
   * Gets the capture's id.
   */
  readonly id: string;

  /**
   * Gets the file to write.
   */
  readonly path: string;
}
