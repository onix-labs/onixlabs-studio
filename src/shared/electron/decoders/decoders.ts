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
   * @returns Returns the listing, or null when no decoder is installed for the format, it could not be
   * started, or it failed.
   */
  public async decode(
    format: string,
    bytes: Uint8Array,
    baseOffset: number,
    totalSize?: number,
    path?: string,
  ): Promise<CodeListing | null> {
    const client: DecoderClient | null = await this.clientFor(format);
    return client === null ? null : client.decode(format, bytes, baseOffset, totalSize, path);
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
   * Stops every running decoder. Called at quit and when a window closes the last binary.
   */
  public disposeAll(): void {
    for (const [, client] of this.clients) {
      client.dispose();
    }
    this.clients.clear();
    this.starting.clear();
    logger.debug('Decoders', 'All decoders stopped');
  }

  /**
   * Gets the running client for a format, starting it on first use.
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
      return Promise.resolve(existing);
    }
    const inFlight: Promise<DecoderClient | null> | undefined = this.starting.get(descriptor.id);
    if (inFlight !== undefined) {
      return inFlight;
    }
    const started: Promise<DecoderClient | null> = this.startClient(descriptor);
    this.starting.set(descriptor.id, started);
    return started;
  }

  /**
   * Starts a decoder and records it once it is ready.
   * @param descriptor The decoder to start.
   * @returns Returns the started client, or null when it could not be started.
   */
  private async startClient(descriptor: DecoderDescriptor): Promise<DecoderClient | null> {
    try {
      const resolution: DecoderResolution = descriptor.resolve();
      if (!resolution.available) {
        logger.debug(
          'Decoders',
          `Decoder '${descriptor.id}' is not available: ${resolution.reason}`,
        );
        return null;
      }
      const client: DecoderClient = new DecoderClient(descriptor.id, resolution.spec);
      if ((await client.start()) === null) {
        client.dispose();
        return null;
      }
      this.clients.set(descriptor.id, client);
      return client;
    } finally {
      this.starting.delete(descriptor.id);
    }
  }
}
