import { inject, Service } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import { BinaryChannel } from '@shared/api/binary-channels';
import { CodeListing } from '@shared/api/code-listing';
import { DecoderDescription } from '@shared/api/decoder-protocol';
import { Log } from '@shared/angular/services/log/log';

/**
 * Represents the renderer-side client for decoder plugins.
 *
 * Shared rather than owned by the binary editor because two surfaces now ask the same questions: the
 * binary editor decodes the file on screen, and the code editor decodes what an open source file
 * compiled into. Both want the same two answers, so they ask through one client rather than each
 * keeping its own copy of the channel names.
 *
 * Outside Electron the bridge is absent and every answer is null, so a view still renders.
 */
@Service()
export class Decoders {
  /**
   * Holds the generic transport, or undefined when running outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Holds the structured logger for decoder requests.
   */
  private readonly log: Log = inject(Log);

  /**
   * Reports what the decoder for a format is, starting it if needed.
   *
   * Asked before decoding, because a decoder that needs the whole file cannot be handed a window and
   * only the decoder knows which kind it is.
   * @param format The canonical decoder format key.
   * @returns Returns the decoder's description, or null when none is installed.
   */
  public async info(format: string): Promise<DecoderDescription | null> {
    if (this.bridge === undefined) {
      return null;
    }
    try {
      return await this.bridge.invoke<DecoderDescription | null>(BinaryChannel.DecoderInfo, format);
    } catch (error: unknown) {
      this.log.debug('decoders', 'Decoder info request failed', error);
      return null;
    }
  }

  /**
   * Decodes bytes into a listing using whichever installed decoder fills the format's slot.
   *
   * Passing the bytes the caller holds, rather than a path, is what keeps unsaved edits reflected.
   * @param format The canonical decoder format key.
   * @param bytes The bytes to decode.
   * @param baseOffset The absolute file offset of the first byte.
   * @param totalSize The whole file's size, when the bytes are a window of it.
   * @param path The file the bytes came from, for display only.
   * @param companions Companion files the decoder may need, keyed by a name it understands.
   * @returns Returns the listing, or null when no decoder is installed or it failed.
   */
  public async decode(
    format: string,
    bytes: Uint8Array,
    baseOffset: number,
    totalSize?: number,
    path?: string,
    companions?: Readonly<Record<string, Uint8Array>>,
  ): Promise<CodeListing | null> {
    if (this.bridge === undefined) {
      return null;
    }
    try {
      return await this.bridge.invoke<CodeListing | null>(
        BinaryChannel.DecodeListing,
        format,
        bytes,
        baseOffset,
        totalSize,
        path,
        companions,
      );
    } catch (error: unknown) {
      this.log.debug('decoders', 'Decoder request failed', error);
      return null;
    }
  }
}
