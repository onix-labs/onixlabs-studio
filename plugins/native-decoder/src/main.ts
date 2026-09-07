/**
 * The native decoder plugin: disassembles machine code with Capstone and speaks the decoder protocol.
 *
 * This is the code that used to be `src/shared/electron/binary-disassembler.ts`, moved out of core.
 * Studio ships no decoder of its own, so this is where native disassembly now lives — and it takes the
 * same route as any third-party plugin rather than a privileged one.
 *
 * Protocol: newline-delimited JSON on standard streams, one request per line in, one response per line
 * out. Bytes arrive base64-encoded and are authoritative: the file at `path` may differ, because the
 * caller may be showing unsaved edits.
 */

import {
  Architecture,
  Capstone,
  CapstoneInstance,
  initialize,
  Instruction,
  Mode,
} from 'disassembler';

/**
 * Specifies the largest buffer a single request will disassemble, bounding the work and the response
 * size however large a window the caller sends.
 */
const MAX_WINDOW: number = 64 * 1024;

/**
 * Specifies the largest number of rows a single response returns, bounding a data-heavy window where
 * the resync path emits one row per undecodable byte.
 */
const MAX_ROWS: number = 8192;

/**
 * Holds the protocol version this decoder speaks.
 */
const PROTOCOL: string = '1.0';

/**
 * Maps a canonical format key to the Capstone architecture and mode that decodes it.
 *
 * Keyed by the whole format key rather than by architecture alone, so what this decoder claims in its
 * manifest and what it can actually decode are the same list — a decoder that claims a format it
 * cannot decode is worse than one that claims less.
 */
const FORMATS: Readonly<Record<string, { architecture: Architecture; mode: Mode }>> = {
  'pe/x86': { architecture: Architecture.X86, mode: Mode.Bits32 },
  'pe/x64': { architecture: Architecture.X86, mode: Mode.Bits64 },
  'pe/arm': { architecture: Architecture.ARM, mode: Mode.Arm },
  'pe/arm64': { architecture: Architecture.ARM64, mode: Mode.Default },
  'mz/x86-16': { architecture: Architecture.X86, mode: Mode.Bits16 },
  'elf/x86': { architecture: Architecture.X86, mode: Mode.Bits32 },
  'elf/x64': { architecture: Architecture.X86, mode: Mode.Bits64 },
  'elf/arm': { architecture: Architecture.ARM, mode: Mode.Arm },
  'elf/arm64': { architecture: Architecture.ARM64, mode: Mode.Default },
  'macho/x86': { architecture: Architecture.X86, mode: Mode.Bits32 },
  'macho/x64': { architecture: Architecture.X86, mode: Mode.Bits64 },
  'macho/arm': { architecture: Architecture.ARM, mode: Mode.Arm },
  'macho/arm64': { architecture: Architecture.ARM64, mode: Mode.Default },
};

/**
 * Holds the in-flight or resolved Capstone framework initialization.
 */
let capstone: Promise<Capstone> | null = null;

/**
 * Holds the long-lived Capstone instances, keyed by format.
 *
 * Strong references, never released, and that is deliberate rather than careless: the library frees any
 * instance whose wrapper is garbage-collected, and that free path is unstable — it throws a WASM
 * "memory access out of bounds" from a timer, which would take this process down. Holding every
 * instance for the process lifetime means the buggy path is never taken.
 */
const instances: Map<string, CapstoneInstance> = new Map<string, CapstoneInstance>();

/**
 * Gets the Capstone instance for a format, creating it on first use.
 * @param format The canonical format key.
 * @returns Returns the instance.
 */
async function instanceFor(format: string): Promise<CapstoneInstance> {
  const existing: CapstoneInstance | undefined = instances.get(format);
  if (existing !== undefined) {
    return existing;
  }
  capstone ??= initialize();
  const framework: Capstone = await capstone;
  const spec: { architecture: Architecture; mode: Mode } = FORMATS[format];
  const instance: CapstoneInstance = framework.createInstance(spec.architecture, spec.mode);
  instances.set(format, instance);
  return instance;
}

/**
 * Describes one decoded row, matching the shared `ListingRow` contract.
 */
interface Row {
  readonly kind: 'instruction';
  readonly address: number;
  readonly fileOffset: number;
  readonly bytes: readonly number[];
  readonly mnemonic: string;
  readonly operands: string;
}

/**
 * Builds a `.byte` filler for a byte Capstone could not decode.
 * @param offset The byte's absolute file offset.
 * @param value The byte value.
 * @returns Returns the filler row.
 */
function byteFiller(offset: number, value: number): Row {
  return {
    kind: 'instruction',
    address: offset,
    fileOffset: offset,
    bytes: [value],
    mnemonic: '.byte',
    operands: `0x${value.toString(16).padStart(2, '0')}`,
  };
}

/**
 * Disassembles a buffer, resyncing past bytes Capstone cannot decode.
 *
 * Capstone stops linear disassembly at the first invalid opcode. To keep the listing populated across
 * data and misaligned regions, an undecodable byte is emitted as a `.byte` and decoding resumes at the
 * next one — the library has no option to do this itself.
 * @param instance The Capstone instance.
 * @param bytes The buffer to decode.
 * @param baseOffset The absolute file offset of the buffer's first byte.
 * @returns Returns the rows, in order.
 */
function decodeWithResync(
  instance: CapstoneInstance,
  bytes: Uint8Array,
  baseOffset: number,
): Row[] {
  const result: Row[] = [];
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
      const address: number = Number(instruction.address);
      result.push({
        kind: 'instruction',
        address,
        fileOffset: address,
        bytes: Array.from(instruction.bytes),
        mnemonic: instruction.mnemonic,
        operands: instruction.operands,
      });
    }
    const last: Instruction = decoded[decoded.length - 1];
    const next: number = Number(last.address) + last.size;
    // Guard against a zero-length decode failing to advance, which would spin forever.
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
 * Handles one request and produces its response.
 * @param request The parsed request.
 * @returns Returns the response object.
 */
async function handle(request: Record<string, unknown>): Promise<unknown> {
  const id: number = typeof request['id'] === 'number' ? request['id'] : 0;
  const op: unknown = request['op'];

  if (op === 'describe') {
    return {
      id,
      ok: true,
      description: {
        protocol: PROTOCOL,
        formats: Object.keys(FORMATS),
        requiresWholeFile: false,
      },
    };
  }

  if (op !== 'decode') {
    return { id, ok: false, error: `unknown op '${String(op)}'` };
  }

  const format: unknown = request['format'];
  const encoded: unknown = request['bytes'];
  const baseOffset: unknown = request['baseOffset'];
  if (typeof format !== 'string' || !(format in FORMATS)) {
    return { id, ok: false, error: `unsupported format '${String(format)}'` };
  }
  if (typeof encoded !== 'string') {
    return { id, ok: false, error: 'bytes must be a base64 string' };
  }
  if (typeof baseOffset !== 'number' || !Number.isInteger(baseOffset) || baseOffset < 0) {
    return { id, ok: false, error: 'baseOffset must be a non-negative integer' };
  }

  try {
    const buffer: Buffer = Buffer.from(encoded, 'base64');
    const bytes: Uint8Array = new Uint8Array(
      buffer.buffer,
      buffer.byteOffset,
      Math.min(buffer.byteLength, MAX_WINDOW),
    );
    const instance: CapstoneInstance = await instanceFor(format);
    const rows: Row[] = decodeWithResync(instance, bytes, baseOffset);
    const path: unknown = request['path'];
    return {
      id,
      ok: true,
      listing: {
        language: format.split('/')[1] ?? format,
        addressing: 'file-offset',
        origin: { kind: 'buffer', path: typeof path === 'string' ? path : null },
        sections: [{ id: 'native', title: '', rows }],
      },
    };
  } catch (error: unknown) {
    return { id, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Reads newline-delimited requests from standard input and answers each on standard output.
 *
 * Buffered across chunks: a chunk boundary falls wherever the pipe decides, so a request routinely
 * arrives in two pieces.
 */
function main(): void {
  let buffer: string = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string): void => {
    buffer += chunk;
    let newline: number = buffer.indexOf('\n');
    while (newline !== -1) {
      const line: string = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line.length > 0) {
        void answer(line);
      }
      newline = buffer.indexOf('\n');
    }
  });
  process.stdin.on('end', (): void => process.exit(0));
}

/**
 * Answers one request line.
 * @param line The request line.
 */
async function answer(line: string): Promise<void> {
  let response: unknown;
  try {
    response = await handle(JSON.parse(line) as Record<string, unknown>);
  } catch (error: unknown) {
    response = { id: 0, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

main();
