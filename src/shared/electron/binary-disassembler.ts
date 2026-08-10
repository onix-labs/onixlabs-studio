import { ipcMain, IpcMainInvokeEvent } from 'electron';
import {
  Architecture,
  Capstone,
  CapstoneInstance,
  initialize,
  Instruction,
  Mode,
} from 'disassembler';
import { BinaryChannel, DecodedInstruction } from '@shared/api/binary-channels';
import { logger } from './logger';

/**
 * Specifies the largest buffer (in bytes) a single request will disassemble, bounding the work and the
 * IPC payload however large a range the renderer asks for.
 */
const MAX_WINDOW: number = 64 * 1024;

/**
 * Specifies the largest number of decoded rows a single request returns, bounding a data-heavy window
 * where the resync path emits one row per undecodable byte.
 */
const MAX_ROWS: number = 8192;

/**
 * Maps a sniffed architecture label to a Capstone architecture and mode.
 */
interface ArchitectureSpec {
  readonly architecture: Architecture;
  readonly mode: Mode;
}

/**
 * Disassembles buffers of native machine code on behalf of the binary/hex editor, using Capstone
 * compiled to WebAssembly. The renderer sends the bytes it is displaying (already obtained through the
 * gated byte-read channel and with any unsaved edits applied), so this holds no path and touches no
 * disk; it decodes the buffer and returns instructions over the shared {@link DecodedInstruction}
 * contract.
 *
 * Capstone instances are created once per architecture and **held for the process lifetime**: the
 * underlying library frees any instance whose wrapper is garbage-collected, and that free path is
 * unstable, so keeping a strong reference avoids it entirely (and matches the "long-running per
 * session" guidance).
 */
export class BinaryDisassembler {
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
   * Registers the disassembly IPC handler.
   */
  public register(): void {
    ipcMain.handle(
      BinaryChannel.Disassemble,
      (
        _event: IpcMainInvokeEvent,
        bytes: unknown,
        baseOffset: unknown,
        filterStart: unknown,
        filterEnd: unknown,
        architecture: unknown,
      ): Promise<DecodedInstruction[]> =>
        this.disassemble(bytes, baseOffset, filterStart, filterEnd, architecture),
    );
  }

  /**
   * Disassembles a buffer of machine code and returns the instructions whose start falls in the
   * requested sub-range. The renderer pads the buffer on both sides of that sub-range, so an
   * instruction straddling its start is decoded (and then filtered out) rather than mis-decoded from a
   * mid-instruction byte.
   * @param bytes The buffer to disassemble (a byte array from the renderer).
   * @param baseOffset The absolute file offset of the buffer's first byte.
   * @param filterStart The first offset to return instructions for.
   * @param filterEnd The offset one past the last to return instructions for.
   * @param architecture The sniffed architecture label (`x86`, `x64`, `ARM`, `ARM64`).
   * @returns Returns the decoded instructions within the sub-range, or an empty list when unsupported
   * or on error.
   */
  private async disassemble(
    bytes: unknown,
    baseOffset: unknown,
    filterStart: unknown,
    filterEnd: unknown,
    architecture: unknown,
  ): Promise<DecodedInstruction[]> {
    if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
      return [];
    }
    if (typeof baseOffset !== 'number' || !Number.isInteger(baseOffset) || baseOffset < 0) {
      return [];
    }
    if (typeof filterStart !== 'number' || !Number.isInteger(filterStart)) {
      return [];
    }
    if (typeof filterEnd !== 'number' || !Number.isInteger(filterEnd)) {
      return [];
    }
    if (typeof architecture !== 'string') {
      return [];
    }
    const spec: ArchitectureSpec | null = architectureSpec(architecture);
    if (spec === null) {
      return [];
    }
    try {
      const buffer: Uint8Array = bytes.subarray(0, MAX_WINDOW);
      const instance: CapstoneInstance = await this.instanceFor(architecture, spec);
      return this.decodeWithResync(instance, buffer, baseOffset).filter(
        (instruction: DecodedInstruction): boolean =>
          instruction.startOffset >= filterStart && instruction.startOffset < filterEnd,
      );
    } catch (error: unknown) {
      logger.debug('BinaryDisassembler', 'Disassembly failed; returning no instructions', error);
      return [];
    }
  }

  /**
   * Disassembles a byte buffer, resyncing past bytes Capstone cannot decode. Capstone stops linear
   * disassembly at the first invalid opcode; to keep the column populated across data and misaligned
   * regions, an undecodable byte is emitted as a `.byte` and disassembly resumes at the next byte.
   * @param instance The Capstone instance.
   * @param bytes The buffer to decode.
   * @param baseOffset The absolute file offset of the buffer's first byte.
   * @returns Returns the decoded instructions and `.byte` fillers in order.
   */
  private decodeWithResync(
    instance: CapstoneInstance,
    bytes: Uint8Array,
    baseOffset: number,
  ): DecodedInstruction[] {
    const result: DecodedInstruction[] = [];
    const bufferEnd: number = baseOffset + bytes.length;
    let position: number = baseOffset;
    while (position < bufferEnd && result.length < MAX_ROWS) {
      const decoded: Instruction[] = instance.disassemble(
        bytes.subarray(position - baseOffset),
        BigInt(position),
      );
      if (decoded.length === 0) {
        result.push(byteFiller(position, bytes[position - baseOffset]));
        position += 1;
        continue;
      }
      for (const instruction of decoded) {
        result.push({
          startOffset: Number(instruction.address),
          byteLength: instruction.size,
          mnemonic: instruction.mnemonic,
          operands: instruction.operands,
          raw: Array.from(instruction.bytes),
        });
      }
      const last: Instruction = decoded[decoded.length - 1];
      const next: number = Number(last.address) + last.size;
      // Guard against a zero-length decode failing to advance (never expected, but keeps the loop safe).
      if (next <= position) {
        result.push(byteFiller(position, bytes[position - baseOffset]));
        position += 1;
      } else {
        position = next;
      }
    }
    return result;
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
}

/**
 * Builds a `.byte` filler row for a byte Capstone could not decode.
 * @param offset The byte's absolute file offset.
 * @param value The byte value.
 * @returns Returns the filler instruction.
 */
function byteFiller(offset: number, value: number): DecodedInstruction {
  return {
    startOffset: offset,
    byteLength: 1,
    mnemonic: '.byte',
    operands: `0x${value.toString(16).padStart(2, '0')}`,
    raw: [value],
  };
}

/**
 * Maps a sniffed architecture label to a Capstone architecture and mode, or null when unsupported.
 * @param architecture The architecture label.
 * @returns Returns the Capstone spec, or null.
 */
function architectureSpec(architecture: string): ArchitectureSpec | null {
  switch (architecture) {
    case 'x86-16':
      return { architecture: Architecture.X86, mode: Mode.Bits16 };
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
