/**
 * Names the binary/hex editor's IPC channels and the types their payloads carry. The renderer's typed
 * client and the main-process disassembler name their channels from here, over the generic
 * {@link import('./bridge').Bridge} transport. Path-taking operations are confined to trusted paths or
 * the open workspace in the main process before any disk access.
 */
export enum BinaryChannel {
  /**
   * Disassembles a window of a file's machine code for the given architecture (invoke).
   */
  Disassemble = 'binary:disassemble',
}

/**
 * Describes one decoded machine instruction. This is the single contract the disassembly renderer
 * consumes, regardless of whether the bytes were decoded by Capstone (native code) or, in later
 * phases, a managed-code sidecar (.NET IL, JVM bytecode).
 */
export interface DecodedInstruction {
  /**
   * Gets the absolute file offset of the instruction's first byte.
   */
  readonly startOffset: number;

  /**
   * Gets the instruction's length in bytes.
   */
  readonly byteLength: number;

  /**
   * Gets the instruction mnemonic (for example, `mov`).
   */
  readonly mnemonic: string;

  /**
   * Gets the instruction operands as text (for example, `rax, rbx`), empty when there are none.
   */
  readonly operands: string;

  /**
   * Gets the instruction's raw bytes.
   */
  readonly raw: readonly number[];
}
