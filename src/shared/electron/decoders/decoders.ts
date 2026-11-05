import { CodeListing } from '@shared/api/code-listing';
import { DecoderDescription } from '@shared/api/decoder-protocol';
import { logger } from '../logger';
import { DecoderClient } from './decoder-client';
import { DecoderDescriptor, DecoderResolution } from './decoder-descriptor';
import { DecoderRegistry } from './decoder-registry';

/**
 * Owns the running decoders: which one serves a format, when it starts, and when it stops.
 *
 * One process per decoder for the whole session, started on first use rather than at launch — a user
 * who never opens a binary never pays for a decoder they did not need. Stopped together at quit, which
 * is what keeps #195's original promise of leaving no orphaned processes behind.
 */
export class Decoders {
  /**
   * Holds the registry the format slot is resolved through.
   */
  private readonly registry: DecoderRegistry;

  /**
   * Holds the running clients, keyed by decoder identifier.
   */
  private readonly clients: Map<string, DecoderClient> = new Map<string, DecoderClient>();

  /**
   * Holds the in-flight starts, so two concurrent decodes of the same format start one process rather
   * than racing to start two.
   */
  private readonly starting: Map<string, Promise<DecoderClient | null>> = new Map<
    string,
    Promise<DecoderClient | null>
  >();

  /**
   * Counts the calls to {@link disposeAll}, so a start that was under way when one came knows that
   * nothing will ever stop the process it has just brought up.
   */
  private disposals: number = 0;

  /**
   * Initializes the host over a registry.
   * @param registry The decoder registry.
   */
  public constructor(registry: DecoderRegistry) {
    this.registry = registry;
  }

  /**
   * Decodes a window of bytes with whichever decoder fills the format's slot.
   * @param format The canonical format key.
   * @param bytes The bytes to decode.
   * @param baseOffset The absolute file offset of the first byte.
   * @param totalSize The whole file's size, when the bytes are a window of it.
   * @param path The file the bytes came from, for display only.
   * @param companions Companion files the decoder may need, keyed by name.
   * @returns Returns the listing, or null when no decoder is installed for the format, it could not be
   * started, or it failed.
   */
  public async decode(
    format: string,
    bytes: Uint8Array,
    baseOffset: number,
    totalSize?: number,
    path?: string,
    companions?: Readonly<Record<string, Uint8Array>>,
  ): Promise<CodeListing | null> {
    const client: DecoderClient | null = await this.clientFor(format);
    return client === null
      ? null
      : client.decode(format, bytes, baseOffset, totalSize, path, companions);
  }

  /**
   * Gets what the decoder for a format is, starting it if it is not already running.
   *
   * Starting it is the point: whether a decoder needs the whole file rather than a window is something
   * only the decoder can say, and the caller has to know before it decides what to send.
   * @param format The canonical format key.
   * @returns Returns the decoder's description, or null when none is installed or it failed to start.
   */
  public async info(format: string): Promise<DecoderDescription | null> {
    const client: DecoderClient | null = await this.clientFor(format);
    return client?.describe() ?? null;
  }

  /**
   * Gets whether a decoder is installed and startable for a format, without decoding anything. Drives
   * the panel's "no decoder installed" state.
   * @param format The canonical format key.
   * @returns Returns true when a decoder for the format resolves to something runnable.
   */
  public isAvailable(format: string): boolean {
    return this.registry.resolve(format)?.resolve().available === true;
  }

  /**
   * Stops every running decoder.
   *
   * Called on every path that ends the application: an ordinary quit, a shell-delivered SIGTERM/SIGINT,
   * and a renderer that died. What no path covers is an abrupt kill, which runs no shutdown at all —
   * hence the pid journal each decoder registers with, which reaps on the next launch whatever was
   * left behind.
   */
  public disposeAll(): void {
    for (const [, client] of this.clients) {
      client.dispose();
    }
    this.clients.clear();
    this.starting.clear();
    this.disposals += 1;
    logger.debug('Decoders', 'All decoders stopped');
  }

  /**
   * Gets the running client for a format, starting it on first use, and again if it has since died:
   * one crash must cost one decode, not every decode for the rest of the session.
   * @param format The canonical format key.
   * @returns Returns the client, or null when none is installed or it could not be started.
   */
  private clientFor(format: string): Promise<DecoderClient | null> {
    const descriptor: DecoderDescriptor | null = this.registry.resolve(format);
    if (descriptor === null) {
      return Promise.resolve(null);
    }
    const existing: DecoderClient | undefined = this.clients.get(descriptor.id);
    if (existing !== undefined) {
      if (existing.describe() !== null) {
        return Promise.resolve(existing);
      }
      logger.info('Decoders', `Decoder '${descriptor.id}' has stopped; starting it again`);
      existing.dispose();
      this.clients.delete(descriptor.id);
    }
    const inFlight: Promise<DecoderClient | null> | undefined = this.starting.get(descriptor.id);
    if (inFlight !== undefined) {
      return inFlight;
    }
    // 🔥 Cleared here rather than inside `startClient`: that can finish without ever suspending, before
    // the entry exists, which would leave a settled "no decoder" in place as the start in flight and
    // the format dark even after the user installs one. Only this start's own entry goes, since a
    // dispose may have made room for another.
    const started: Promise<DecoderClient | null> = this.startClient(descriptor).finally(
      (): void => {
        if (this.starting.get(descriptor.id) === started) {
          this.starting.delete(descriptor.id);
        }
      },
    );
    this.starting.set(descriptor.id, started);
    return started;
  }

  /**
   * Starts a decoder and records it once it is ready.
   * @param descriptor The decoder to start.
   * @returns Returns the started client, or null when it could not be started.
   */
  private async startClient(descriptor: DecoderDescriptor): Promise<DecoderClient | null> {
    const disposals: number = this.disposals;
    let resolution: DecoderResolution;
    try {
      resolution = descriptor.resolve();
    } catch (error: unknown) {
      logger.warn('Decoders', `Could not resolve decoder '${descriptor.id}'`, error);
      return null;
    }
    if (!resolution.available) {
      logger.debug('Decoders', `Decoder '${descriptor.id}' is not available: ${resolution.reason}`);
      return null;
    }
    const client: DecoderClient = new DecoderClient(descriptor.id, resolution.spec);
    if ((await client.start()) === null || disposals !== this.disposals) {
      client.dispose();
      return null;
    }
    this.clients.set(descriptor.id, client);
    return client;
  }
}
