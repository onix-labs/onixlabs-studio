import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { BinaryChannel } from '@shared/api/binary-channels';
import { CodeListing } from '@shared/api/code-listing';
import { DecoderDescription } from '@shared/api/decoder-protocol';
import { contributedDecoders } from '../contributions/plugins/contributed';
import { NodeRuntimeSpec } from '../contributions/plugins/plugin-loader';
import { logger } from '../logger';
import { DecoderDescriptor } from './decoder-descriptor';
import { DecoderRegistry } from './decoder-registry';
import { Decoders } from './decoders';

/**
 * Hosts the decoder registry and answers the renderer's decode requests.
 *
 * Studio contributes no decoder of its own, so this starts empty and fills only from installed
 * plugins. A format nothing decodes answers null, which the panel turns into an offer to install
 * rather than a blank pane.
 */
export class DecoderHost {
  /**
   * Holds the registry the format slot resolves through.
   */
  private readonly registry: DecoderRegistry = new DecoderRegistry();

  /**
   * Holds the running decoders.
   */
  private readonly decoders: Decoders = new Decoders(this.registry);

  /**
   * Registers every contributed decoder and the decode IPC handler.
   */
  public register(): void {
    for (const descriptor of contributedDecoders(nodeRuntime)) {
      this.registry.register(descriptor);
    }
    const registered: readonly DecoderDescriptor[] = this.registry.all();
    logger.info(
      'DecoderHost',
      registered.length === 0
        ? 'No decoders installed; the binary editor will offer one when a binary is opened'
        : `Registered ${registered.length} decoder(s): ${registered
            .map((descriptor: DecoderDescriptor): string => descriptor.id)
            .join(', ')}`,
    );

    ipcMain.handle(
      BinaryChannel.DecoderInfo,
      (_event: IpcMainInvokeEvent, format: unknown): Promise<DecoderDescription | null> =>
        typeof format === 'string' && format.length > 0
          ? this.decoders.info(format)
          : Promise.resolve(null),
    );

    ipcMain.handle(
      BinaryChannel.DecodeListing,
      (
        _event: IpcMainInvokeEvent,
        format: unknown,
        bytes: unknown,
        baseOffset: unknown,
        totalSize: unknown,
        path: unknown,
        companions: unknown,
      ): Promise<CodeListing | null> =>
        this.decode(format, bytes, baseOffset, totalSize, path, companions),
    );
  }

  /**
   * Stops every running decoder, so none outlives the application.
   */
  public dispose(): void {
    this.decoders.disposeAll();
  }

  /**
   * Validates a decode request and hands it to the resolved decoder.
   * @param format The canonical format key.
   * @param bytes The bytes to decode.
   * @param baseOffset The absolute file offset of the first byte.
   * @param totalSize The whole file's size, when the bytes are a window of it.
   * @param path The file the bytes came from, for display only.
   * @param companions Companion files the renderer read through its own gate, keyed by name.
   * @returns Returns the listing, or null when the request is malformed or nothing decodes the format.
   */
  private decode(
    format: unknown,
    bytes: unknown,
    baseOffset: unknown,
    totalSize: unknown,
    path: unknown,
    companions: unknown,
  ): Promise<CodeListing | null> {
    if (typeof format !== 'string' || format.length === 0) {
      return Promise.resolve(null);
    }
    if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
      return Promise.resolve(null);
    }
    if (typeof baseOffset !== 'number' || !Number.isInteger(baseOffset) || baseOffset < 0) {
      return Promise.resolve(null);
    }
    return this.decoders.decode(
      format,
      bytes,
      baseOffset,
      typeof totalSize === 'number' ? totalSize : undefined,
      typeof path === 'string' ? path : undefined,
      readCompanions(companions),
    );
  }
}

/**
 * Builds how to run a decoder's JavaScript entry point: through the Electron binary in Node mode, the
 * same way a Node-based language server is run, so a decoder shipped as a bundle needs no Node on the
 * machine.
 * @param entryPoint The entry point to run.
 * @returns Returns the command and arguments.
 */
function nodeRuntime(entryPoint: string): NodeRuntimeSpec {
  return {
    command: process.execPath,
    args: [entryPoint],
    // Runs the Electron binary as plain Node, the same way a Node-based language server is run.
    env: { ELECTRON_RUN_AS_NODE: '1' },
  };
}

/**
 * Validates the companion files a renderer sent, discarding anything that is not bytes.
 *
 * The renderer read these through the same trust gate as the main file, so this is shape validation
 * rather than a second permission check.
 * @param value The candidate companions.
 * @returns Returns the companions, or undefined when there are none.
 */
function readCompanions(value: unknown): Readonly<Record<string, Uint8Array>> | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const result: Record<string, Uint8Array> = {};
  for (const [name, bytes] of Object.entries(value)) {
    if (bytes instanceof Uint8Array && bytes.length > 0) {
      result[name] = bytes;
    }
  }
  return Object.keys(result).length === 0 ? undefined : result;
}
