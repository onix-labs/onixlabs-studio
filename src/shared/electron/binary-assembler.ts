import { ipcMain, IpcMainInvokeEvent } from 'electron';
import type { AssemblyState as AssemblyStateType } from '@defasm/core';
import { AssembleResult, BinaryChannel } from '@shared/api/binary-channels';
import { logger } from './logger';

/**
 * Bounds the assembly text a single request will assemble, keeping a malformed or runaway snippet from
 * driving the assembler (and the IPC payload) without limit. Instruction-level edits are tiny; this is
 * a generous ceiling, not a working size.
 */
const MAX_ASSEMBLY_LENGTH: number = 16 * 1024;

/**
 * The subset of the DefAssembler module the assembler uses, resolved through a dynamic import.
 */
interface DefasmModule {
  readonly AssemblyState: new (config?: {
    syntax?: { intel: boolean; prefix: boolean };
    bitness?: number;
  }) => AssemblyStateType;
}

/**
 * Maps a sniffed architecture label to a DefAssembler target bitness. Only the x86 family is covered:
 * DefAssembler is an x86-64 assembler, so the ARM families the disassembler can read are not
 * assemblable here (there is no permissively-licensed ARM assembler to pair with it).
 */
function bitnessFor(architecture: string): number | null {
  switch (architecture) {
    case 'x86-16':
      return 16;
    case 'x86':
      return 32;
    case 'x64':
      return 64;
    default:
      return null;
  }
}

/**
 * Assembles snippets of assembly into machine bytes on behalf of the binary/hex editor, using
 * DefAssembler — a lightweight, permissively-licensed (ISC) JavaScript x86-64 assembler. It is the
 * write-side counterpart to {@link import('./binary-disassembler')}, but covers only the x86 family:
 * ARM/ARM64 binaries can be disassembled (read) but not assembled (written), and the tool reports that
 * clearly. The renderer sends assembly text, the architecture label, and the address the code lands at;
 * this holds no path and touches no disk, returning the assembled bytes (which the renderer then writes
 * into its in-memory document) or the assembler's diagnostic.
 *
 * DefAssembler is ESM-only and the main process compiles to CommonJS, so it is loaded with a dynamic
 * `import()`, mirroring how the Claude Agent SDK is loaded.
 */
export class BinaryAssembler {
  /**
   * Holds the in-flight or resolved DefAssembler module import, created on first use.
   */
  private module: Promise<DefasmModule> | null = null;

  /**
   * Registers the assembly IPC handler.
   */
  public register(): void {
    ipcMain.handle(
      BinaryChannel.Assemble,
      (
        _event: IpcMainInvokeEvent,
        assembly: unknown,
        architecture: unknown,
        address: unknown,
      ): Promise<AssembleResult> => this.assemble(assembly, architecture, address),
    );
  }

  /**
   * Assembles a snippet of assembly for an architecture.
   * @param assembly The assembly text (one or more instructions, newline-separated).
   * @param architecture The sniffed architecture label (`x86-16`, `x86`, `x64`, `ARM`, `ARM64`).
   * @param address The absolute address the code is assembled at. DefAssembler assembles at address 0
   * and does not accept a base, so this is validated but not applied — instruction-level edits do not
   * depend on it, but a branch to an absolute target will not resolve (use PC-relative operands).
   * @returns Returns the assembled bytes, or the reason assembly failed.
   */
  private async assemble(
    assembly: unknown,
    architecture: unknown,
    address: unknown,
  ): Promise<AssembleResult> {
    if (typeof assembly !== 'string' || assembly.trim().length === 0) {
      return { ok: false, error: 'No assembly was provided.' };
    }
    if (assembly.length > MAX_ASSEMBLY_LENGTH) {
      return { ok: false, error: `The assembly exceeds the ${MAX_ASSEMBLY_LENGTH}-byte limit.` };
    }
    if (typeof architecture !== 'string') {
      return { ok: false, error: 'No architecture was provided.' };
    }
    if (typeof address !== 'number' || !Number.isInteger(address) || address < 0) {
      return { ok: false, error: 'A non-negative integer address is required.' };
    }
    const bitness: number | null = bitnessFor(architecture);
    if (bitness === null) {
      return {
        ok: false,
        error: `Studio can only assemble x86 and x64; the ${architecture} architecture is not supported.`,
      };
    }
    try {
      const { AssemblyState } = await this.load();
      const state: AssemblyStateType = new AssemblyState({
        syntax: { intel: true, prefix: false },
        bitness,
      });
      state.compile(assembly);
      if (state.errors.length > 0) {
        return { ok: false, error: state.errors.map((error) => error.message).join('; ') };
      }
      const bytes: Uint8Array = state.head.dump();
      if (bytes.length === 0) {
        return { ok: false, error: 'The assembly produced no machine bytes.' };
      }
      return { ok: true, bytes: Array.from(bytes) };
    } catch (error: unknown) {
      // Assembly failure is usually invalid user input, not a system fault, so it is debug.
      logger.debug('BinaryAssembler', 'Assembly failed', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Loads the DefAssembler module once, caching the import promise.
   * @returns Returns the module.
   */
  private load(): Promise<DefasmModule> {
    this.module ??= import('@defasm/core') as Promise<DefasmModule>;
    return this.module;
  }
}
