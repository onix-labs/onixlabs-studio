import { inject, Service } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import { BinaryChannel } from '@shared/api/binary-channels';
import { CodeListing } from '@shared/api/code-listing';
import { DecoderDescription } from '@shared/api/decoder-protocol';
import { JitCaptureResult } from '@shared/api/jit-capture';
import { DecoderPerf } from '@shared/angular/services/decoder-perf/decoder-perf';
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
   * Holds the decode-latency probe, so what moving decoding out of process costs is measured rather
   * than assumed (#583).
   */
  private readonly perf: DecoderPerf = inject(DecoderPerf);

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
    // Measured here rather than at either call site: this is the one place every decode passes
    // through, from both the binary editor and the code editor (#583). A whole-file decode is
    // recognised by the bytes being the file rather than a window of it — the two are judged against
    // different budgets because they are different interactions.
    const startedAt: number = performance.now();
    const wholeFile: boolean = totalSize === undefined || bytes.length >= totalSize;
    try {
      const listing: CodeListing | null = await this.bridge.invoke<CodeListing | null>(
        BinaryChannel.DecodeListing,
        format,
        bytes,
        baseOffset,
        totalSize,
        path,
        companions,
      );
      this.perf.decoded(
        format,
        performance.now() - startedAt,
        bytes.length,
        wholeFile,
        listing !== null,
      );
      return listing;
    } catch (error: unknown) {
      this.perf.decoded(format, performance.now() - startedAt, bytes.length, wholeFile, false);
      this.log.debug('decoders', 'Decoder request failed', error);
      return null;
    }
  }

  /**
   * Runs an assembly with JIT disassembly enabled and returns what the JIT generated.
   *
   * Unlike everything else here this executes the program: JIT assembly is not a decode, and there is
   * no way to obtain it without running the code that provokes it.
   * @param assemblyPath The assembly to run.
   * @param methodPattern The JitDisasm method pattern.
   * @param tier The optimisation tier to ask for.
   * @returns Returns the capture result, or a failure when the bridge is absent.
   */
  public async captureJit(
    assemblyPath: string,
    methodPattern: string,
    tier: 'tier0' | 'full-opts',
  ): Promise<JitCaptureResult> {
    if (this.bridge === undefined) {
      return { ok: false, error: 'JIT capture needs the desktop application.' };
    }
    try {
      return await this.bridge.invoke<JitCaptureResult>(
        BinaryChannel.JitCapture,
        assemblyPath,
        methodPattern,
        tier,
      );
    } catch (error: unknown) {
      this.log.debug('decoders', 'JIT capture failed', error);
      return { ok: false, error: 'The JIT capture could not be started.' };
    }
  }
}
