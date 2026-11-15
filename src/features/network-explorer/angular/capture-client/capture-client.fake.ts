import { CapturedPacket, CaptureStart } from '@shared/api/network-capture-channels';
import { CaptureListener } from './capture-client';

/**
 * A capture the fake has been asked for, which a test drives.
 */
export interface FakeCaptureRun {
  /**
   * Gets the capture's id.
   */
  readonly id: string;

  /**
   * Gets what it reads: `en0 tcp port 443`, or a file's path.
   */
  readonly source: string;

  /**
   * Gets the listener its packets and end go to.
   */
  readonly listener: CaptureListener;
}

/**
 * A stand-in for the capture backend: every capture starts (or fails, when told to), and the test
 * feeds it packets and ends it through the listener it records.
 */
export class FakeCaptureClient {
  /**
   * Gets the captures asked for, in order.
   */
  public readonly started: FakeCaptureRun[] = [];

  /**
   * Gets every other thing asked, in order.
   */
  public readonly calls: string[] = [];

  /**
   * Gets what the next start answers.
   */
  public answer: CaptureStart = { kind: 'started' };

  /**
   * Gets the bytes a packet fetch answers.
   */
  public packetBytes: CapturedPacket | undefined;

  /**
   * Records a live capture.
   * @param id The capture's id.
   * @param interfaceId The interface.
   * @param filter The filter.
   * @param listener The listener.
   * @returns Returns the configured answer.
   */
  public start(
    id: string,
    interfaceId: string,
    filter: string,
    listener: CaptureListener,
  ): Promise<CaptureStart> {
    this.started.push({ id, source: `${interfaceId} ${filter}`.trim(), listener });
    return Promise.resolve(this.answer);
  }

  /**
   * Records a file being opened.
   * @param id The capture's id.
   * @param path The file.
   * @param listener The listener.
   * @returns Returns the configured answer.
   */
  public open(id: string, path: string, listener: CaptureListener): Promise<CaptureStart> {
    this.started.push({ id, source: path, listener });
    return Promise.resolve(this.answer);
  }

  /**
   * Records a stop, and ends the capture as the backend would.
   * @param id The capture's id.
   */
  public stop(id: string): void {
    this.calls.push(`stop ${id}`);
    this.started
      .filter((run: FakeCaptureRun): boolean => run.id === id)
      .at(-1)
      ?.listener.ended(undefined);
  }

  /**
   * Records a release.
   * @param id The capture's id.
   */
  public release(id: string): void {
    this.calls.push(`release ${id}`);
  }

  /**
   * Answers a packet fetch.
   * @param id The capture's id.
   * @param number The packet's number.
   * @returns Returns the configured bytes.
   */
  public packet(id: string, number: number): Promise<CapturedPacket | undefined> {
    this.calls.push(`packet ${id} ${String(number)}`);
    return Promise.resolve(this.packetBytes);
  }

  /**
   * Records a save.
   * @param id The capture's id.
   * @param path The file.
   * @returns Returns true.
   */
  public save(id: string, path: string): Promise<boolean> {
    this.calls.push(`save ${id} ${path}`);
    return Promise.resolve(true);
  }
}
