import { inject, Service } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import { BinaryChannel, DecodedInstruction } from '@shared/api/binary-channels';
import { CodeListing } from '@shared/api/code-listing';
import { DecoderDescription } from '@shared/api/decoder-protocol';
import { Log } from '@shared/angular/services/log/log';

/**
 * Represents the renderer-side client for native disassembly. It is a thin typed wrapper over the
 * generic {@link Bridge} transport; when the application runs outside Electron the bridge is absent and
 * disassembly degrades to an empty result so the editor still renders.
 */
@Service()
export class BinaryDisassembly {
  /**
   * Holds the generic transport, or undefined when running outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Holds the structured logger for disassembly requests.
   */
  private readonly log: Log = inject(Log);

  /**
   * Disassembles a buffer of machine code, returning the instructions whose start falls in the
   * requested sub-range. The caller pads the buffer around that sub-range so straddling instructions
   * decode; passing the bytes it holds (rather than a path) reflects any unsaved edits.
   * @param bytes The buffer to disassemble.
   * @param baseOffset The absolute file offset of the buffer's first byte.
   * @param filterStart The first offset to return instructions for.
   * @param filterEnd The offset one past the last to return instructions for.
   * @param architecture The sniffed architecture label (`x86`, `x64`, `ARM`, `ARM64`).
   * @returns Returns the decoded instructions within the sub-range, or an empty list when unsupported
   * or running outside Electron.
   */
  public disassemble(
    bytes: Uint8Array,
    baseOffset: number,
    filterStart: number,
    filterEnd: number,
    architecture: string,
  ): Promise<readonly DecodedInstruction[]> {
    this.log.trace(
      'binary.disassembly',
      `Disassemble ${architecture} [0x${filterStart.toString(16)}, 0x${filterEnd.toString(16)})`,
    );
    return (
      this.bridge?.invoke<readonly DecodedInstruction[]>(
        BinaryChannel.Disassemble,
        bytes,
        baseOffset,
        filterStart,
        filterEnd,
        architecture,
      ) ?? Promise.resolve([])
    );
  }

  /**
   * Decodes a window of bytes into a listing using whichever installed decoder plugin fills the
   * format's slot.
   *
   * Passing the bytes the renderer holds, rather than a path, is what keeps unsaved edits reflected —
   * the same invariant the native path has always had, now extended to every format.
   * @param format The canonical decoder format key.
   * @param bytes The bytes to decode.
   * @param baseOffset The absolute file offset of the buffer's first byte.
   * @param totalSize The whole file's size, when the bytes are a window of it.
   * @param path The file the bytes came from, for display only.
   * @returns Returns the listing, or null when no decoder is installed, it failed, or the application
   * is running outside Electron.
   */
  public async decodeListing(
    format: string,
    bytes: Uint8Array,
    baseOffset: number,
    totalSize?: number,
    path?: string,
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
      );
    } catch (error: unknown) {
      this.log.debug('binary.disassembly', 'Decoder request failed', error);
      return null;
    }
  }

  /**
   * Reports what the decoder for a format is, or null when none is installed.
   *
   * Asked before decoding, because a decoder that needs the whole file cannot be handed a viewport
   * window and only the decoder knows which kind it is.
   * @param format The canonical decoder format key.
   * @returns Returns the decoder's description, or null.
   */
  public async decoderInfo(format: string): Promise<DecoderDescription | null> {
    if (this.bridge === undefined) {
      return null;
    }
    try {
      return await this.bridge.invoke<DecoderDescription | null>(BinaryChannel.DecoderInfo, format);
    } catch (error: unknown) {
      this.log.debug('binary.disassembly', 'Decoder info request failed', error);
      return null;
    }
  }
}
