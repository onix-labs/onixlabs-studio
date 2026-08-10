import { inject, Service } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import { AssembleResult, BinaryChannel } from '@shared/api/binary-channels';
import { Log } from '@shared/angular/services/log/log';

/**
 * Represents the renderer-side client for native assembly. It is a thin typed wrapper over the generic
 * {@link Bridge} transport, the write-side counterpart to {@link import('../binary-disassembly/binary-disassembly').BinaryDisassembly};
 * when the application runs outside Electron the bridge is absent and assembly reports that it is
 * unavailable so callers degrade gracefully.
 */
@Service()
export class BinaryAssembly {
  /**
   * Holds the generic transport, or undefined when running outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Holds the structured logger for assembly requests.
   */
  private readonly log: Log = inject(Log);

  /**
   * Assembles a snippet of assembly into machine bytes for an architecture at a given address.
   * @param assembly The assembly text (one or more instructions).
   * @param architecture The sniffed architecture label (`x86`, `x64`, `ARM`, `ARM64`).
   * @param address The absolute address the code is assembled at, so PC-relative operands resolve.
   * @returns Returns the assembled bytes, or the reason assembly failed (including when running outside
   * Electron).
   */
  public assemble(
    assembly: string,
    architecture: string,
    address: number,
  ): Promise<AssembleResult> {
    this.log.trace(
      'binary.assembly',
      `Assemble ${architecture} at 0x${address.toString(16)}`,
    );
    return (
      this.bridge?.invoke<AssembleResult>(
        BinaryChannel.Assemble,
        assembly,
        architecture,
        address,
      ) ?? Promise.resolve({ ok: false, error: 'Assembly is not available outside Electron.' })
    );
  }
}
