/**
 * The WebAssembly decoder plugin: reads a module's function bodies.
 *
 * The epic's fourth format. WebAssembly is the strongest addition after JVM: it is a real output
 * target for the Rust/Go/C++ project systems already in the repo, and `.wasm` currently sniffs as
 * `unknown` in the binary view.
 *
 * Decodes the module's section table, function bodies, and enough of the opcode space to render a
 * method-keyed listing. Function bodies use *file offsets* directly (unlike JVM/IL, where addresses
 * are method-relative), which is itself a finding: WASM sits between the two addressing modes.
 */

import type { CodeListing, ListingRow, ListingSection } from '../../protocol/listing';

/**
 * Names the WebAssembly section ids.
 */
const SECTION_NAMES: Readonly<Record<number, string>> = {
  0: 'custom',
  1: 'type',
  2: 'import',
  3: 'function',
  4: 'table',
  5: 'memory',
  6: 'global',
  7: 'export',
  8: 'start',
  9: 'element',
  10: 'code',
  11: 'data',
  12: 'datacount',
};

/**
 * Describes a WebAssembly opcode: its mnemonic and how to read its immediates.
 */
interface WasmOp {
  readonly mnemonic: string;
  readonly immediates: readonly ImmediateKind[];
}

/**
 * Names the immediate encodings the decoder understands.
 */
type ImmediateKind =
  | 'u32' // LEB128 unsigned
  | 'i32' // LEB128 signed
  | 'i64' // LEB128 signed, 64-bit
  | 'f32' // 4 raw bytes
  | 'f64' // 8 raw bytes
  | 'blocktype' // a value type, 0x40 for empty, or a signed type index
  | 'memarg' // align + offset, both u32
  | 'brtable' // a vector of label indices plus a default
  | 'reftype'; // a single byte reference type

/**
 * Maps opcode byte to its specification. Covers the MVP instruction set plus the saturating-conversion
 * and bulk-memory prefixes, which is enough for any Rust/Go/C++ output the spike is likely to see.
 */
const OPS: Readonly<Record<number, WasmOp>> = buildOps();

/**
 * Builds the opcode table.
 * @returns Returns the table.
 */
function buildOps(): Record<number, WasmOp> {
  const table: Record<number, WasmOp> = {};
  const put: (code: number, mnemonic: string, ...immediates: ImmediateKind[]) => void = (
    code: number,
    mnemonic: string,
    ...immediates: ImmediateKind[]
  ): void => {
    table[code] = { mnemonic, immediates };
  };

  // Control.
  put(0x00, 'unreachable');
  put(0x01, 'nop');
  put(0x02, 'block', 'blocktype');
  put(0x03, 'loop', 'blocktype');
  put(0x04, 'if', 'blocktype');
  put(0x05, 'else');
  put(0x0b, 'end');
  put(0x0c, 'br', 'u32');
  put(0x0d, 'br_if', 'u32');
  put(0x0e, 'br_table', 'brtable');
  put(0x0f, 'return');
  put(0x10, 'call', 'u32');
  put(0x11, 'call_indirect', 'u32', 'u32');

  // Parametric and variables.
  put(0x1a, 'drop');
  put(0x1b, 'select');
  put(0x20, 'local.get', 'u32');
  put(0x21, 'local.set', 'u32');
  put(0x22, 'local.tee', 'u32');
  put(0x23, 'global.get', 'u32');
  put(0x24, 'global.set', 'u32');

  // Memory loads and stores — all take a memarg.
  const loads: string[] = [
    'i32.load',
    'i64.load',
    'f32.load',
    'f64.load',
    'i32.load8_s',
    'i32.load8_u',
    'i32.load16_s',
    'i32.load16_u',
    'i64.load8_s',
    'i64.load8_u',
    'i64.load16_s',
    'i64.load16_u',
    'i64.load32_s',
    'i64.load32_u',
  ];
  loads.forEach((name: string, index: number): void => put(0x28 + index, name, 'memarg'));
  const stores: string[] = [
    'i32.store',
    'i64.store',
    'f32.store',
    'f64.store',
    'i32.store8',
    'i32.store16',
    'i64.store8',
    'i64.store16',
    'i64.store32',
  ];
  stores.forEach((name: string, index: number): void => put(0x36 + index, name, 'memarg'));
  put(0x3f, 'memory.size', 'u32');
  put(0x40, 'memory.grow', 'u32');

  // Constants.
  put(0x41, 'i32.const', 'i32');
  put(0x42, 'i64.const', 'i64');
  put(0x43, 'f32.const', 'f32');
  put(0x44, 'f64.const', 'f64');

  // Numeric — one contiguous run of operand-free opcodes from 0x45 to 0xc4.
  const numeric: string[] = [
    'i32.eqz',
    'i32.eq',
    'i32.ne',
    'i32.lt_s',
    'i32.lt_u',
    'i32.gt_s',
    'i32.gt_u',
    'i32.le_s',
    'i32.le_u',
    'i32.ge_s',
    'i32.ge_u',
    'i64.eqz',
    'i64.eq',
    'i64.ne',
    'i64.lt_s',
    'i64.lt_u',
    'i64.gt_s',
    'i64.gt_u',
    'i64.le_s',
    'i64.le_u',
    'i64.ge_s',
    'i64.ge_u',
    'f32.eq',
    'f32.ne',
    'f32.lt',
    'f32.gt',
    'f32.le',
    'f32.ge',
    'f64.eq',
    'f64.ne',
    'f64.lt',
    'f64.gt',
    'f64.le',
    'f64.ge',
    'i32.clz',
    'i32.ctz',
    'i32.popcnt',
    'i32.add',
    'i32.sub',
    'i32.mul',
    'i32.div_s',
    'i32.div_u',
    'i32.rem_s',
    'i32.rem_u',
    'i32.and',
    'i32.or',
    'i32.xor',
    'i32.shl',
    'i32.shr_s',
    'i32.shr_u',
    'i32.rotl',
    'i32.rotr',
    'i64.clz',
    'i64.ctz',
    'i64.popcnt',
    'i64.add',
    'i64.sub',
    'i64.mul',
    'i64.div_s',
    'i64.div_u',
    'i64.rem_s',
    'i64.rem_u',
    'i64.and',
    'i64.or',
    'i64.xor',
    'i64.shl',
    'i64.shr_s',
    'i64.shr_u',
    'i64.rotl',
    'i64.rotr',
    'f32.abs',
    'f32.neg',
    'f32.ceil',
    'f32.floor',
    'f32.trunc',
    'f32.nearest',
    'f32.sqrt',
    'f32.add',
    'f32.sub',
    'f32.mul',
    'f32.div',
    'f32.min',
    'f32.max',
    'f32.copysign',
    'f64.abs',
    'f64.neg',
    'f64.ceil',
    'f64.floor',
    'f64.trunc',
    'f64.nearest',
    'f64.sqrt',
    'f64.add',
    'f64.sub',
    'f64.mul',
    'f64.div',
    'f64.min',
    'f64.max',
    'f64.copysign',
    'i32.wrap_i64',
    'i32.trunc_f32_s',
    'i32.trunc_f32_u',
    'i32.trunc_f64_s',
    'i32.trunc_f64_u',
    'i64.extend_i32_s',
    'i64.extend_i32_u',
    'i64.trunc_f32_s',
    'i64.trunc_f32_u',
    'i64.trunc_f64_s',
    'i64.trunc_f64_u',
    'f32.convert_i32_s',
    'f32.convert_i32_u',
    'f32.convert_i64_s',
    'f32.convert_i64_u',
    'f32.demote_f64',
    'f64.convert_i32_s',
    'f64.convert_i32_u',
    'f64.convert_i64_s',
    'f64.convert_i64_u',
    'f64.promote_f32',
    'i32.reinterpret_f32',
    'i64.reinterpret_f64',
    'f32.reinterpret_i32',
    'f64.reinterpret_i64',
    'i32.extend8_s',
    'i32.extend16_s',
    'i64.extend8_s',
    'i64.extend16_s',
    'i64.extend32_s',
  ];
  numeric.forEach((name: string, index: number): void => put(0x45 + index, name));

  // Reference types.
  put(0xd0, 'ref.null', 'reftype');
  put(0xd1, 'ref.is_null');
  put(0xd2, 'ref.func', 'u32');

  return table;
}

/**
 * Reads WebAssembly's little-endian LEB128 encodings and raw values.
 */
class WasmReader {
  public position: number;

  private readonly bytes: Uint8Array;

  private readonly view: DataView;

  public constructor(bytes: Uint8Array, position: number = 0) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.position = position;
  }

  public byte(): number {
    const value: number = this.bytes[this.position];
    this.position += 1;
    return value;
  }

  /**
   * Reads an unsigned LEB128 integer.
   * @returns Returns the value.
   */
  public u32(): number {
    let result: number = 0;
    let shift: number = 0;
    for (;;) {
      const byte: number = this.byte();
      result |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) {
        return result >>> 0;
      }
      shift += 7;
    }
  }

  /**
   * Reads a signed LEB128 integer.
   * @returns Returns the value.
   */
  public i32(): number {
    let result: number = 0;
    let shift: number = 0;
    let byte: number;
    do {
      byte = this.byte();
      result |= (byte & 0x7f) << shift;
      shift += 7;
    } while ((byte & 0x80) !== 0);
    if (shift < 32 && (byte & 0x40) !== 0) {
      result |= -(1 << shift);
    }
    return result;
  }

  /**
   * Reads a signed 64-bit LEB128 integer.
   * @returns Returns the value.
   */
  public i64(): bigint {
    let result: bigint = 0n;
    let shift: bigint = 0n;
    let byte: number;
    do {
      byte = this.byte();
      result |= BigInt(byte & 0x7f) << shift;
      shift += 7n;
    } while ((byte & 0x80) !== 0);
    if ((byte & 0x40) !== 0) {
      result -= 1n << shift;
    }
    return result;
  }

  public f32(): number {
    const value: number = this.view.getFloat32(this.position, true);
    this.position += 4;
    return value;
  }

  public f64(): number {
    const value: number = this.view.getFloat64(this.position, true);
    this.position += 8;
    return value;
  }

  public utf8(length: number): string {
    const text: string = new TextDecoder().decode(
      this.bytes.subarray(this.position, this.position + length),
    );
    this.position += length;
    return text;
  }
}

/**
 * Decodes a WebAssembly module into a code listing, one section per function body.
 * @param bytes The whole `.wasm` module.
 * @param path The file path, for the listing's origin.
 * @returns Returns the listing.
 */
export function decodeWasm(bytes: Uint8Array, path: string | null): CodeListing {
  const reader: WasmReader = new WasmReader(bytes);
  const magic: number[] = [reader.byte(), reader.byte(), reader.byte(), reader.byte()];
  if (magic[0] !== 0x00 || magic[1] !== 0x61 || magic[2] !== 0x73 || magic[3] !== 0x6d) {
    throw new Error('Not a WebAssembly module (missing \\0asm magic)');
  }
  const version: number =
    reader.byte() | (reader.byte() << 8) | (reader.byte() << 16) | (reader.byte() << 24);

  const names: Map<number, string> = new Map<number, string>();
  const sections: ListingSection[] = [];
  const moduleSections: string[] = [];
  let codeSection: { start: number; length: number } | null = null;

  while (reader.position < bytes.length) {
    const id: number = reader.byte();
    const size: number = reader.u32();
    const payloadStart: number = reader.position;
    moduleSections.push(`${SECTION_NAMES[id] ?? `unknown(${id})`} (${size} bytes)`);

    if (id === 7) {
      readExports(new WasmReader(bytes, payloadStart), names);
    } else if (id === 10) {
      codeSection = { start: payloadStart, length: size };
    }
    reader.position = payloadStart + size;
  }

  if (codeSection !== null) {
    sections.push(...readCode(bytes, codeSection.start, names));
  }

  return {
    language: `WebAssembly (v${version})`,
    addressing: 'file-offset',
    origin: { kind: 'buffer', path },
    sections:
      sections.length > 0
        ? sections
        : [{ id: 'module', title: 'module', notes: moduleSections, rows: [] }],
  };
}

/**
 * Reads the export section, so functions can be titled by their exported names.
 * @param reader A reader positioned at the export section payload.
 * @param names The map to fill, keyed by function index.
 */
function readExports(reader: WasmReader, names: Map<number, string>): void {
  const count: number = reader.u32();
  for (let index: number = 0; index < count; index += 1) {
    const nameLength: number = reader.u32();
    const name: string = reader.utf8(nameLength);
    const kind: number = reader.byte();
    const target: number = reader.u32();
    if (kind === 0x00) {
      names.set(target, name);
    }
  }
}

/**
 * Reads the code section, decoding every function body into a listing section.
 * @param bytes The whole module.
 * @param start The code section payload offset.
 * @param names Exported function names, keyed by function index.
 * @returns Returns one section per function body.
 */
function readCode(bytes: Uint8Array, start: number, names: Map<number, string>): ListingSection[] {
  const reader: WasmReader = new WasmReader(bytes, start);
  const count: number = reader.u32();
  const sections: ListingSection[] = [];

  for (let index: number = 0; index < count; index += 1) {
    const bodySize: number = reader.u32();
    const bodyStart: number = reader.position;
    const bodyEnd: number = bodyStart + bodySize;

    // Local declarations precede the instructions.
    const localGroups: number = reader.u32();
    const locals: string[] = [];
    for (let group: number = 0; group < localGroups; group += 1) {
      const localCount: number = reader.u32();
      const type: number = reader.byte();
      locals.push(`${localCount} × ${valueType(type)}`);
    }

    const rows: ListingRow[] = decodeBody(bytes, reader.position, bodyEnd);
    const name: string | undefined = names.get(index);
    sections.push({
      id: `func${index}`,
      title: name === undefined ? `func[${index}]` : `func[${index}] "${name}"`,
      fileRange: { start: bodyStart, length: bodySize },
      notes: [locals.length === 0 ? 'no locals' : `locals: ${locals.join(', ')}`],
      rows,
    });
    reader.position = bodyEnd;
  }
  return sections;
}

/**
 * Decodes one function body's instructions.
 * @param bytes The whole module.
 * @param start The first instruction's file offset.
 * @param end The offset one past the body.
 * @returns Returns the rows.
 */
function decodeBody(bytes: Uint8Array, start: number, end: number): ListingRow[] {
  const reader: WasmReader = new WasmReader(bytes, start);
  const rows: ListingRow[] = [];
  let depth: number = 0;

  while (reader.position < end) {
    const at: number = reader.position;
    const opcode: number = reader.byte();

    // Prefixed opcode spaces (0xFC saturating conversions / bulk memory, 0xFD SIMD).
    if (opcode === 0xfc || opcode === 0xfd) {
      const sub: number = reader.u32();
      rows.push({
        address: at,
        fileOffset: at,
        mnemonic: opcode === 0xfc ? `misc.${sub}` : `simd.${sub}`,
        operands: '',
        comment: 'prefixed opcode — spike decodes the prefix only',
        bytes: Array.from(bytes.subarray(at, reader.position)),
      });
      continue;
    }

    const op: WasmOp | undefined = OPS[opcode];
    if (op === undefined) {
      rows.push({
        address: at,
        fileOffset: at,
        mnemonic: '.byte',
        operands: `0x${opcode.toString(16).padStart(2, '0')}`,
        bytes: [opcode],
      });
      continue;
    }

    if (op.mnemonic === 'end' || op.mnemonic === 'else') {
      depth = Math.max(0, depth - 1);
    }
    const operands: string = readImmediates(reader, op);
    if (op.mnemonic === 'block' || op.mnemonic === 'loop' || op.mnemonic === 'if') {
      depth += 1;
    }

    rows.push({
      address: at,
      fileOffset: at,
      mnemonic: `${'  '.repeat(op.mnemonic === 'end' || op.mnemonic === 'else' ? depth : Math.max(0, depth - (op.mnemonic === 'block' || op.mnemonic === 'loop' || op.mnemonic === 'if' ? 1 : 0)))}${op.mnemonic}`,
      operands,
      bytes: Array.from(bytes.subarray(at, reader.position)),
    });
  }
  return rows;
}

/**
 * Reads an opcode's immediates and renders them as text.
 * @param reader The reader, positioned after the opcode.
 * @param op The opcode spec.
 * @returns Returns the operand text.
 */
function readImmediates(reader: WasmReader, op: WasmOp): string {
  const parts: string[] = [];
  for (const kind of op.immediates) {
    switch (kind) {
      case 'u32':
        parts.push(String(reader.u32()));
        break;
      case 'i32':
        parts.push(String(reader.i32()));
        break;
      case 'i64':
        parts.push(String(reader.i64()));
        break;
      case 'f32':
        parts.push(String(reader.f32()));
        break;
      case 'f64':
        parts.push(String(reader.f64()));
        break;
      case 'blocktype': {
        const type: number = reader.byte();
        parts.push(type === 0x40 ? '' : valueType(type));
        break;
      }
      case 'memarg': {
        const align: number = reader.u32();
        const offset: number = reader.u32();
        parts.push(offset === 0 ? `align=${1 << align}` : `offset=${offset} align=${1 << align}`);
        break;
      }
      case 'reftype':
        parts.push(valueType(reader.byte()));
        break;
      case 'brtable': {
        const count: number = reader.u32();
        const labels: number[] = [];
        for (let index: number = 0; index < count; index += 1) {
          labels.push(reader.u32());
        }
        labels.push(reader.u32()); // default
        parts.push(labels.join(' '));
        break;
      }
    }
  }
  return parts.filter((part: string): boolean => part !== '').join(' ');
}

/**
 * Names a WebAssembly value type byte.
 * @param type The type byte.
 * @returns Returns the type name.
 */
function valueType(type: number): string {
  switch (type) {
    case 0x7f:
      return 'i32';
    case 0x7e:
      return 'i64';
    case 0x7d:
      return 'f32';
    case 0x7c:
      return 'f64';
    case 0x7b:
      return 'v128';
    case 0x70:
      return 'funcref';
    case 0x6f:
      return 'externref';
    default:
      return `type(0x${type.toString(16)})`;
  }
}
