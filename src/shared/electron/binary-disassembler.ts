import { ipcMain, IpcMainInvokeEvent } from 'electron';
import * as fs from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import {
  Architecture,
  Capstone,
  CapstoneInstance,
  initialize,
  Instruction,
  Mode,
} from 'disassembler';
import { BinaryChannel, DecodedInstruction } from '@shared/api/binary-channels';
import { TrustedPaths } from './trusted-paths';
import { WorkspaceContext } from './workspace-context';

/**
 * Specifies how many bytes are read before the requested window, so an instruction straddling the
 * window start can be seen (and its partial lead discarded) rather than mis-decoding the window from a
 * mid-instruction byte. A little over the longest x86 instruction.
 */
const PAD_BEFORE: number = 16;

/**
 * Specifies how many bytes are read after the requested window, so an instruction straddling the
 * window end still decodes.
 */
const PAD_AFTER: number = 16;

/**
 * Specifies the largest window (in bytes) a single request will disassemble, bounding the work and the
 * IPC payload however large a range the renderer asks for.
 */
const MAX_WINDOW: number = 64 * 1024;

/**
 * Maps a sniffed architecture label to a Capstone architecture and mode.
 */
interface ArchitectureSpec {
  readonly architecture: Architecture;
  readonly mode: Mode;
}

/**
 * Disassembles windows of native machine code on behalf of the binary/hex editor, using Capstone
 * compiled to WebAssembly. It reads only the requested (padded) window from disk — confined to trusted
 * paths or the open workspace — and returns decoded instructions over the shared
 * {@link DecodedInstruction} contract.
 *
 * Capstone instances are created once per architecture and **held for the process lifetime**: the
 * underlying library frees any instance whose wrapper is garbage-collected, and that free path is
 * unstable, so keeping a strong reference avoids it entirely (and matches the "long-running per
 * session" guidance).
 */
export class BinaryDisassembler {
  /**
   * Holds the shared workspace context, used to confine reads to the open root.
   */
  private readonly workspace: WorkspaceContext;

  /**
   * Holds the store of paths the user has opened, used to authorise reads outside the workspace.
   */
  private readonly trusted: TrustedPaths;

  /**
   * Holds the in-flight or resolved Capstone framework initialization, created on first use.
   */
  private capstone: Promise<Capstone> | null = null;

  /**
   * Holds the long-lived Capstone instances, keyed by architecture label. Strong references, never
   * released, so the library's unstable instance-free path is never taken.
   */
  private readonly instances: Map<string, CapstoneInstance> = new Map<string, CapstoneInstance>();

  /**
   * Initializes a new instance of the {@link BinaryDisassembler} class.
   * @param workspace The shared workspace context to confine reads to.
   * @param trusted The store recording paths the user has opened, gating reads outside the workspace.
   */
  public constructor(workspace: WorkspaceContext, trusted: TrustedPaths) {
    this.workspace = workspace;
    this.trusted = trusted;
  }

  /**
   * Registers the disassembly IPC handler.
   */
  public register(): void {
    ipcMain.handle(
      BinaryChannel.Disassemble,
      (
        _event: IpcMainInvokeEvent,
        filePath: unknown,
        offset: unknown,
        length: unknown,
        architecture: unknown,
      ): Promise<DecodedInstruction[]> =>
        this.disassemble(filePath, offset, length, architecture),
    );
  }

  /**
   * Disassembles a window of a file's machine code. The window is padded on both sides and the partial
   * instruction straddling its start is discarded, so variable-length instructions decode correctly
   * rather than from a mid-instruction byte.
   * @param filePath The absolute path of the file.
   * @param offset The first byte of the window to return instructions for.
   * @param length The number of bytes in that window.
   * @param architecture The sniffed architecture label (`x86`, `x64`, `ARM`, `ARM64`).
   * @returns Returns the decoded instructions within the window, or an empty list when unsupported,
   * untrusted, or unreadable.
   */
  private async disassemble(
    filePath: unknown,
    offset: unknown,
    length: unknown,
    architecture: unknown,
  ): Promise<DecodedInstruction[]> {
    if (typeof filePath !== 'string' || filePath.length === 0) {
      return [];
    }
    if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0) {
      return [];
    }
    if (typeof length !== 'number' || !Number.isInteger(length) || length <= 0) {
      return [];
    }
    if (typeof architecture !== 'string') {
      return [];
    }
    if (!this.trusted.has(filePath) && !this.workspace.isWithin(filePath)) {
      return [];
    }
    const spec: ArchitectureSpec | null = architectureSpec(architecture);
    if (spec === null) {
      return [];
    }
    try {
      const windowLength: number = Math.min(length, MAX_WINDOW);
      const start: number = Math.max(0, offset - PAD_BEFORE);
      const bytes: Uint8Array = await this.readWindow(filePath, start, offset + windowLength + PAD_AFTER);
      const instance: CapstoneInstance = await this.instanceFor(architecture, spec);
      const decoded: Instruction[] = instance.disassemble(bytes, BigInt(start));
      const end: number = offset + windowLength;
      return decoded
        .map(
          (instruction: Instruction): DecodedInstruction => ({
            startOffset: Number(instruction.address),
            byteLength: instruction.size,
            mnemonic: instruction.mnemonic,
            operands: instruction.operands,
            raw: Array.from(instruction.bytes),
          }),
        )
        .filter(
          (instruction: DecodedInstruction): boolean =>
            instruction.startOffset >= offset && instruction.startOffset < end,
        );
    } catch {
      return [];
    }
  }

  /**
   * Gets the long-lived Capstone instance for an architecture, creating it on first use.
   * @param architecture The architecture label used as the cache key.
   * @param spec The Capstone architecture and mode.
   * @returns Returns the instance.
   */
  private async instanceFor(
    architecture: string,
    spec: ArchitectureSpec,
  ): Promise<CapstoneInstance> {
    const existing: CapstoneInstance | undefined = this.instances.get(architecture);
    if (existing !== undefined) {
      return existing;
    }
    this.capstone ??= initialize();
    const framework: Capstone = await this.capstone;
    const instance: CapstoneInstance = framework.createInstance(spec.architecture, spec.mode);
    this.instances.set(architecture, instance);
    return instance;
  }

  /**
   * Reads a byte window from a file, clamped to the file's size.
   * @param filePath The absolute path of the file.
   * @param start The first byte offset to read.
   * @param end The offset one past the last byte to read.
   * @returns Returns the bytes read (possibly shorter than requested near the end of the file).
   */
  private async readWindow(filePath: string, start: number, end: number): Promise<Uint8Array> {
    let handle: FileHandle | undefined;
    try {
      handle = await fs.open(filePath, 'r');
      const size: number = (await handle.stat()).size;
      const from: number = Math.min(start, size);
      const toRead: number = Math.max(0, Math.min(end, size) - from);
      const buffer: Buffer = Buffer.alloc(toRead);
      if (toRead > 0) {
        await handle.read(buffer, 0, toRead, from);
      }
      return new Uint8Array(buffer);
    } finally {
      await handle?.close();
    }
  }
}

/**
 * Maps a sniffed architecture label to a Capstone architecture and mode, or null when unsupported.
 * @param architecture The architecture label.
 * @returns Returns the Capstone spec, or null.
 */
function architectureSpec(architecture: string): ArchitectureSpec | null {
  switch (architecture) {
    case 'x86':
      return { architecture: Architecture.X86, mode: Mode.Bits32 };
    case 'x64':
      return { architecture: Architecture.X86, mode: Mode.Bits64 };
    case 'ARM':
      return { architecture: Architecture.ARM, mode: Mode.Arm };
    case 'ARM64':
      return { architecture: Architecture.ARM64, mode: Mode.Default };
    default:
      return null;
  }
}
