import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssembleResult, BinaryChannel } from '@shared/api/binary-channels';

/**
 * The handlers registered on the fake `ipcMain`.
 */
const ipc: { handlers: Map<string, (...args: unknown[]) => unknown> } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}));

vi.mock('electron', () => ({
  app: { isReady: (): boolean => false, isPackaged: false },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown): void =>
      void ipc.handlers.set(channel, handler),
  },
  shell: {},
}));

const { BinaryAssembler } = await import('./binary-assembler');

describe('BinaryAssembler', () => {
  /**
   * Assembles through the IPC handler, as the renderer does.
   * @param assembly The assembly text.
   * @param architecture The architecture.
   * @param address The address.
   * @returns Returns the result.
   */
  function assemble(
    assembly: unknown,
    architecture: unknown = 'x64',
    address: unknown = 0,
  ): Promise<AssembleResult> {
    const handler: ((...args: unknown[]) => unknown) | undefined = ipc.handlers.get(
      BinaryChannel.Assemble,
    );
    if (handler === undefined) {
      throw new Error('Nothing handles the channel.');
    }
    return handler({}, assembly, architecture, address) as Promise<AssembleResult>;
  }

  beforeEach(() => {
    ipc.handlers.clear();
    new BinaryAssembler().register();
  });

  it.each<[string, string, readonly number[]]>([
    ['x64', 'nop', [0x90]],
    ['x64', 'ret', [0xc3]],
    ['x64', 'mov rax, 1', [0x48, 0xc7, 0xc0, 0x01, 0x00, 0x00, 0x00]],
    ['x86', 'mov eax, 1', [0xb8, 0x01, 0x00, 0x00, 0x00]],
    ['x86-16', 'nop', [0x90]],
    ['x86-16', 'mov al, 1', [0xb0, 0x01]],
  ])('assembles_%s_%s', async (architecture: string, text: string, bytes: readonly number[]) => {
    expect(await assemble(text, architecture)).toEqual({ ok: true, bytes });
  });

  // 🔥 For Matthew to rule on. DefAssembler has no 16-bit mode: its `bitness` is 32 or 64, and 16 is
  // taken as 32. So this answers 66 b8 01 00, which is right in 32-bit code and wrong here, where the
  // 0x66 widens the operand and the CPU takes the next two bytes of the program as the immediate. The
  // caller is told it worked and patches that into the binary. Refusing x86-16 would stop it, as ARM
  // is refused, but takes away the width-free instructions that do come out right.
  it.fails('assemblesAWordInstruction_for16BitCode', async () => {
    expect(await assemble('mov ax, 1', 'x86-16')).toEqual({ ok: true, bytes: [0xb8, 0x01, 0x00] });
  });

  it('assemblesSeveralInstructions', async () => {
    expect(await assemble('nop\nret')).toEqual({ ok: true, bytes: [0x90, 0xc3] });
  });

  it.each<[string, unknown]>([
    ['nothing', undefined],
    ['anEmptyString', ''],
    ['whitespace', ' \n\t '],
    ['aNumber', 7],
    ['bytes', new Uint8Array([1])],
  ])('refusesAssemblyThatIs_%s', async (_name: string, assembly: unknown) => {
    expect(await assemble(assembly)).toEqual({ ok: false, error: 'No assembly was provided.' });
  });

  it('takesAssemblyAtTheLimit', async () => {
    const text: string = 'nop\n'.repeat(4 * 1024 - 1) + 'nop';

    expect((await assemble(text)).ok).toBe(true);
  });

  it('refusesAssemblyOverTheLimit', async () => {
    const result: AssembleResult = await assemble('n'.repeat(16 * 1024 + 1));

    expect(result).toEqual({ ok: false, error: 'The assembly exceeds the 16384-byte limit.' });
  });

  it.each<[string, unknown]>([
    ['missing', null],
    ['aNumber', 64],
  ])('refusesAnArchitectureThatIs_%s', async (_name: string, architecture: unknown) => {
    expect(await assemble('nop', architecture)).toEqual({
      ok: false,
      error: 'No architecture was provided.',
    });
  });

  it.each(['ARM', 'ARM64', '', 'x64 '])('saysItCannotAssemble_%s', async (architecture: string) => {
    const result: AssembleResult = await assemble('nop', architecture);

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).toContain('can only assemble x86 and x64');
  });

  it.each<[string, unknown]>([
    ['negative', -1],
    ['fractional', 1.5],
    ['notANumber', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
    ['aString', '0'],
    ['missing', null],
  ])('refusesAnAddressThatIs_%s', async (_name: string, address: unknown) => {
    expect(await assemble('nop', 'x64', address)).toEqual({
      ok: false,
      error: 'A non-negative integer address is required.',
    });
  });

  it('reportsWhatTheAssemblerSaid_aboutBadAssembly', async () => {
    const result: AssembleResult = await assemble('this is not assembly');

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).toContain('Unknown opcode');
  });

  it('refusesAnInstructionTheModeCannotEncode', async () => {
    expect((await assemble('mov rax, 1', 'x86')).ok).toBe(false);
  });

  it('saysSo_whenTheAssemblyProducesNoBytes', async () => {
    expect(await assemble('label:')).toEqual({
      ok: false,
      error: 'The assembly produced no machine bytes.',
    });
  });

  it('refusesTheDirectivesThatWouldGrowATinyRequest', async () => {
    // The text limit is what bounds the output, so it only holds while these stay out of reach.
    for (const text of ['.zero 134217728', '.fill 134217728, 8, 0', '.rept 1000000\nnop\n.endr']) {
      expect((await assemble(text)).ok, text).toBe(false);
    }
  });

  it('isReusable_afterAFailure', async () => {
    await assemble('this is not assembly');

    expect((await assemble('nop')).ok).toBe(true);
  });

  it('servesConcurrentRequests', async () => {
    const results: readonly AssembleResult[] = await Promise.all([
      assemble('nop'),
      assemble('ret'),
      assemble('nonsense'),
    ]);

    expect(results.map((result: AssembleResult): boolean => result.ok)).toEqual([
      true,
      true,
      false,
    ]);
  });
});
