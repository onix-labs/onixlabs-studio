import { Service } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import { BinaryChannel, DecodedInstruction } from '@shared/api/binary-channels';

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
   * Disassembles a window of a file's machine code for the given architecture.
   * @param path The absolute path of the file.
   * @param offset The first byte of the window to return instructions for.
   * @param length The number of bytes in that window.
   * @param architecture The sniffed architecture label (`x86`, `x64`, `ARM`, `ARM64`).
   * @returns Returns the decoded instructions within the window, or an empty list when unsupported or
   * running outside Electron.
   */
  public disassemble(
    path: string,
    offset: number,
    length: number,
    architecture: string,
  ): Promise<readonly DecodedInstruction[]> {
    return (
      this.bridge?.invoke<readonly DecodedInstruction[]>(
        BinaryChannel.Disassemble,
        path,
        offset,
        length,
        architecture,
      ) ?? Promise.resolve([])
    );
  }
}
