/**
 * The JVM decoder plugin: reads a class file's bytecode.
 *
 * Decodes a class file into a {@link CodeListing}: constant pool, methods, `Code` attributes, and the
 * `LineNumberTable` when the class was compiled with `-g`.
 *
 * Pure TypeScript and dependency-free, which is why this needs no JVM alongside it. Validated against
 * `javap -c -p` over 1,252 `java.base` classes and 10,678 methods, comparing (offset, mnemonic)
 * sequences: a mis-sized instruction desynchronises every offset after it, so matching a whole
 * method's offsets is the real proof rather than matching operand text.
 */

import type { CodeListing, ListingRow, ListingSection } from '../../protocol/listing';
import type { OpcodeSpec } from './opcodes';
import { ARRAY_TYPES, OPCODES } from './opcodes';

/**
 * A decoded constant-pool entry. Only what is needed to render javap-style comments.
 */
type PoolEntry =
  | { readonly tag: 'utf8'; readonly value: string }
  | { readonly tag: 'integer'; readonly value: number }
  | { readonly tag: 'float'; readonly value: number }
  | { readonly tag: 'long'; readonly value: bigint }
  | { readonly tag: 'double'; readonly value: number }
  | { readonly tag: 'class'; readonly nameIndex: number }
  | { readonly tag: 'string'; readonly stringIndex: number }
  | {
      readonly tag: 'ref';
      readonly kind: string;
      readonly classIndex: number;
      readonly nameAndTypeIndex: number;
    }
  | { readonly tag: 'nameAndType'; readonly nameIndex: number; readonly descriptorIndex: number }
  | {
      readonly tag: 'methodHandle';
      readonly referenceKind: number;
      readonly referenceIndex: number;
    }
  | { readonly tag: 'methodType'; readonly descriptorIndex: number }
  | { readonly tag: 'dynamic'; readonly kind: string; readonly nameAndTypeIndex: number }
  | { readonly tag: 'moduleOrPackage'; readonly nameIndex: number }
  | { readonly tag: 'unusable' };

/**
 * A raw attribute: its name and the byte range of its payload within the file.
 */
interface RawAttribute {
  readonly name: string;
  readonly start: number;
  readonly length: number;
}

/**
 * Reads primitive values from a class file, tracking position.
 */
class Reader {
  public position: number = 0;

  private readonly view: DataView;

  public constructor(view: DataView) {
    this.view = view;
  }

  public u1(): number {
    const value: number = this.view.getUint8(this.position);
    this.position += 1;
    return value;
  }

  public u2(): number {
    const value: number = this.view.getUint16(this.position);
    this.position += 2;
    return value;
  }

  public u4(): number {
    const value: number = this.view.getUint32(this.position);
    this.position += 4;
    return value;
  }

  public skip(count: number): void {
    this.position += count;
  }
}

/**
 * Decodes a JVM class file into a code listing.
 * @param bytes The whole class file.
 * @param path The file path, for the listing's origin.
 * @returns Returns the listing.
 */
export function decodeClass(bytes: Uint8Array, path: string | null): CodeListing {
  const view: DataView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const reader: Reader = new Reader(view);

  const magic: number = reader.u4();
  if (magic !== 0xcafebabe) {
    throw new Error(`Not a class file: magic 0x${magic.toString(16)}`);
  }
  const minor: number = reader.u2();
  const major: number = reader.u2();
  const pool: PoolEntry[] = readConstantPool(reader, view);

  reader.u2(); // access_flags
  const thisClass: number = reader.u2();
  reader.u2(); // super_class
  const interfaceCount: number = reader.u2();
  reader.skip(interfaceCount * 2);

  skipMembers(reader); // fields
  const methods: ListingSection[] = readMethods(reader, view, pool, bytes);

  return {
    language: `JVM bytecode (class ${major}.${minor})`,
    addressing: 'method-relative',
    origin: { kind: 'buffer', path },
    sections: methods.length > 0 ? methods : [emptySection(className(pool, thisClass))],
  };
}

/**
 * Reads the constant pool. Longs and doubles occupy two slots, which is the classic gotcha.
 * @param reader The reader.
 * @param view The file view.
 * @returns Returns the pool, 1-indexed (slot 0 is a placeholder).
 */
function readConstantPool(reader: Reader, view: DataView): PoolEntry[] {
  const count: number = reader.u2();
  const pool: PoolEntry[] = [{ tag: 'unusable' }];
  for (let index: number = 1; index < count; index += 1) {
    const tag: number = reader.u1();
    switch (tag) {
      case 1: {
        const length: number = reader.u2();
        const start: number = reader.position;
        reader.skip(length);
        pool.push({ tag: 'utf8', value: decodeModifiedUtf8(view, start, length) });
        break;
      }
      case 3:
        pool.push({ tag: 'integer', value: view.getInt32(reader.position) });
        reader.skip(4);
        break;
      case 4:
        pool.push({ tag: 'float', value: view.getFloat32(reader.position) });
        reader.skip(4);
        break;
      case 5:
        pool.push({ tag: 'long', value: view.getBigInt64(reader.position) });
        reader.skip(8);
        pool.push({ tag: 'unusable' }); // Longs take two slots.
        index += 1;
        break;
      case 6:
        pool.push({ tag: 'double', value: view.getFloat64(reader.position) });
        reader.skip(8);
        pool.push({ tag: 'unusable' }); // Doubles take two slots.
        index += 1;
        break;
      case 7:
        pool.push({ tag: 'class', nameIndex: reader.u2() });
        break;
      case 8:
        pool.push({ tag: 'string', stringIndex: reader.u2() });
        break;
      case 9:
      case 10:
      case 11: {
        const kind: string = tag === 9 ? 'Field' : tag === 10 ? 'Method' : 'InterfaceMethod';
        pool.push({ tag: 'ref', kind, classIndex: reader.u2(), nameAndTypeIndex: reader.u2() });
        break;
      }
      case 12:
        pool.push({ tag: 'nameAndType', nameIndex: reader.u2(), descriptorIndex: reader.u2() });
        break;
      case 15:
        pool.push({ tag: 'methodHandle', referenceKind: reader.u1(), referenceIndex: reader.u2() });
        break;
      case 16:
        pool.push({ tag: 'methodType', descriptorIndex: reader.u2() });
        break;
      case 17:
      case 18: {
        reader.u2(); // bootstrap_method_attr_index
        pool.push({
          tag: 'dynamic',
          kind: tag === 17 ? 'Dynamic' : 'InvokeDynamic',
          nameAndTypeIndex: reader.u2(),
        });
        break;
      }
      case 19:
      case 20:
        pool.push({ tag: 'moduleOrPackage', nameIndex: reader.u2() });
        break;
      default:
        throw new Error(`Unknown constant pool tag ${tag} at index ${index}`);
    }
  }
  return pool;
}

/**
 * Skips a fields or methods table without decoding it.
 * @param reader The reader.
 */
function skipMembers(reader: Reader): void {
  const count: number = reader.u2();
  for (let index: number = 0; index < count; index += 1) {
    reader.skip(6); // access_flags, name_index, descriptor_index
    skipAttributes(reader);
  }
}

/**
 * Skips an attributes table.
 * @param reader The reader.
 */
function skipAttributes(reader: Reader): void {
  const count: number = reader.u2();
  for (let index: number = 0; index < count; index += 1) {
    reader.skip(2);
    const length: number = reader.u4();
    reader.skip(length);
  }
}

/**
 * Reads the attributes table, returning each attribute's name and payload range.
 * @param reader The reader.
 * @param pool The constant pool.
 * @returns Returns the attributes.
 */
function readAttributes(reader: Reader, pool: PoolEntry[]): RawAttribute[] {
  const count: number = reader.u2();
  const attributes: RawAttribute[] = [];
  for (let index: number = 0; index < count; index += 1) {
    const nameIndex: number = reader.u2();
    const length: number = reader.u4();
    const start: number = reader.position;
    attributes.push({ name: utf8(pool, nameIndex), start, length });
    reader.skip(length);
  }
  return attributes;
}

/**
 * Reads the methods table, decoding each method's `Code` attribute into a listing section.
 * @param reader The reader.
 * @param view The file view.
 * @param pool The constant pool.
 * @param bytes The whole file.
 * @returns Returns one section per method.
 */
function readMethods(
  reader: Reader,
  view: DataView,
  pool: PoolEntry[],
  bytes: Uint8Array,
): ListingSection[] {
  const count: number = reader.u2();
  const sections: ListingSection[] = [];
  for (let index: number = 0; index < count; index += 1) {
    const accessFlags: number = reader.u2();
    const name: string = utf8(pool, reader.u2());
    const descriptor: string = utf8(pool, reader.u2());
    const attributes: RawAttribute[] = readAttributes(reader, pool);
    const code: RawAttribute | undefined = attributes.find(
      (attribute: RawAttribute): boolean => attribute.name === 'Code',
    );
    const title: string = `${methodModifiers(accessFlags)}${describeMethod(name, descriptor)}`;
    if (code === undefined) {
      sections.push({
        id: `${name}${descriptor}`,
        title,
        notes: ['abstract or native — no Code attribute'],
        rows: [],
      });
      continue;
    }
    sections.push(decodeCode(view, pool, bytes, code, `${name}${descriptor}`, title));
  }
  return sections;
}

/**
 * Decodes a method's `Code` attribute into a listing section.
 * @param view The file view.
 * @param pool The constant pool.
 * @param bytes The whole file.
 * @param attribute The `Code` attribute.
 * @param id The section id.
 * @param title The section title.
 * @returns Returns the section.
 */
function decodeCode(
  view: DataView,
  pool: PoolEntry[],
  bytes: Uint8Array,
  attribute: RawAttribute,
  id: string,
  title: string,
): ListingSection {
  const reader: Reader = new Reader(view);
  reader.position = attribute.start;
  const maxStack: number = reader.u2();
  const maxLocals: number = reader.u2();
  const codeLength: number = reader.u4();
  const codeStart: number = reader.position;
  reader.skip(codeLength);

  const exceptionCount: number = reader.u2();
  reader.skip(exceptionCount * 8);
  const codeAttributes: RawAttribute[] = readAttributes(reader, pool);
  const lineNumbers: Map<number, number> = readLineNumberTable(view, codeAttributes);

  const rows: ListingRow[] = decodeInstructions(
    view,
    pool,
    bytes,
    codeStart,
    codeLength,
    lineNumbers,
  );

  return {
    id,
    title,
    fileRange: { start: codeStart, length: codeLength },
    notes: [
      `max_stack=${maxStack}, max_locals=${maxLocals}, code_length=${codeLength}`,
      lineNumbers.size > 0
        ? `LineNumberTable present (${lineNumbers.size} entries)`
        : 'no LineNumberTable — compiled without -g:lines',
    ],
    rows,
  };
}

/**
 * Reads a `LineNumberTable` from a method's code attributes, mapping bytecode offset to source line.
 * @param view The file view.
 * @param attributes The code attribute's nested attributes.
 * @returns Returns a map from `start_pc` to line number.
 */
function readLineNumberTable(view: DataView, attributes: RawAttribute[]): Map<number, number> {
  const table: Map<number, number> = new Map<number, number>();
  const attribute: RawAttribute | undefined = attributes.find(
    (candidate: RawAttribute): boolean => candidate.name === 'LineNumberTable',
  );
  if (attribute === undefined) {
    return table;
  }
  const reader: Reader = new Reader(view);
  reader.position = attribute.start;
  const count: number = reader.u2();
  for (let index: number = 0; index < count; index += 1) {
    const startPc: number = reader.u2();
    const line: number = reader.u2();
    table.set(startPc, line);
  }
  return table;
}

/**
 * Decodes a method body's instructions.
 * @param view The file view.
 * @param pool The constant pool.
 * @param bytes The whole file.
 * @param codeStart The file offset of the first code byte.
 * @param codeLength The code length in bytes.
 * @param lineNumbers The line-number table.
 * @returns Returns the rows.
 */
function decodeInstructions(
  view: DataView,
  pool: PoolEntry[],
  bytes: Uint8Array,
  codeStart: number,
  codeLength: number,
  lineNumbers: Map<number, number>,
): ListingRow[] {
  const rows: ListingRow[] = [];
  let offset: number = 0;
  let currentLine: number | undefined = undefined;

  while (offset < codeLength) {
    const instructionStart: number = offset;
    const fileOffset: number = codeStart + offset;
    const opcode: number = view.getUint8(fileOffset);
    const spec: OpcodeSpec | undefined = OPCODES[opcode];
    currentLine = lineNumbers.get(offset) ?? currentLine;

    if (spec === undefined) {
      rows.push({
        address: offset,
        fileOffset,
        bytes: [opcode],
        mnemonic: '.byte',
        operands: `0x${opcode.toString(16).padStart(2, '0')}`,
        sourceLine: currentLine,
      });
      offset += 1;
      continue;
    }

    const decoded: { operands: string; comment?: string; length: number; mnemonic?: string } =
      decodeOperands(view, pool, spec, codeStart, offset);
    offset += decoded.length;
    rows.push({
      address: instructionStart,
      fileOffset,
      bytes: Array.from(bytes.subarray(fileOffset, codeStart + offset)),
      mnemonic: decoded.mnemonic ?? spec.mnemonic,
      operands: decoded.operands,
      comment: decoded.comment,
      sourceLine: currentLine,
    });
  }
  return rows;
}

/**
 * Decodes one instruction's operands and total length (opcode included).
 * @param view The file view.
 * @param pool The constant pool.
 * @param spec The opcode spec.
 * @param codeStart The file offset of the method's first code byte.
 * @param offset The instruction's method-relative offset.
 * @returns Returns the operand text, an optional comment, and the instruction length.
 */
function decodeOperands(
  view: DataView,
  pool: PoolEntry[],
  spec: OpcodeSpec,
  codeStart: number,
  offset: number,
): { operands: string; comment?: string; length: number; mnemonic?: string } {
  const at: number = codeStart + offset;
  switch (spec.shape) {
    case 'none':
      return { operands: '', length: 1 };
    case 'u1':
      return { operands: String(view.getUint8(at + 1)), length: 2 };
    case 's1':
      return { operands: String(view.getInt8(at + 1)), length: 2 };
    case 'u2':
      return { operands: String(view.getUint16(at + 1)), length: 3 };
    case 's2':
      return { operands: String(view.getInt16(at + 1)), length: 3 };
    case 'cp1': {
      const index: number = view.getUint8(at + 1);
      return { operands: `#${index}`, comment: describeConstant(pool, index), length: 2 };
    }
    case 'cp2': {
      const index: number = view.getUint16(at + 1);
      return { operands: `#${index}`, comment: describeConstant(pool, index), length: 3 };
    }
    case 'branch2':
      return { operands: String(offset + view.getInt16(at + 1)), length: 3 };
    case 'branch4':
      return { operands: String(offset + view.getInt32(at + 1)), length: 5 };
    case 'iinc':
      return { operands: `${view.getUint8(at + 1)}, ${view.getInt8(at + 2)}`, length: 3 };
    case 'invokeinterface': {
      const index: number = view.getUint16(at + 1);
      const count: number = view.getUint8(at + 3);
      return {
        operands: `#${index},  ${count}`,
        comment: describeConstant(pool, index),
        length: 5,
      };
    }
    case 'invokedynamic': {
      const index: number = view.getUint16(at + 1);
      return { operands: `#${index},  0`, comment: describeConstant(pool, index), length: 5 };
    }
    case 'newarray': {
      const type: number = view.getUint8(at + 1);
      return { operands: ARRAY_TYPES[type] ?? String(type), length: 2 };
    }
    case 'multianewarray': {
      const index: number = view.getUint16(at + 1);
      const dimensions: number = view.getUint8(at + 3);
      return {
        operands: `#${index},  ${dimensions}`,
        comment: describeConstant(pool, index),
        length: 4,
      };
    }
    case 'wide': {
      const widened: number = view.getUint8(at + 1);
      const widenedSpec: OpcodeSpec | undefined = OPCODES[widened];
      const index: number = view.getUint16(at + 2);
      // `wide iinc` carries an extra signed short; every other widened opcode is index-only.
      const widenedName: string = `${widenedSpec?.mnemonic ?? '?'}_w`;
      if (widened === 0x84) {
        return {
          mnemonic: widenedName,
          operands: `${index}, ${view.getInt16(at + 4)}`,
          length: 6,
        };
      }
      return { mnemonic: widenedName, operands: String(index), length: 4 };
    }
    case 'tableswitch': {
      // Padded to the next 4-byte boundary *relative to the method body start*.
      const padding: number = (4 - ((offset + 1) % 4)) % 4;
      const base: number = at + 1 + padding;
      const defaultTarget: number = offset + view.getInt32(base);
      const low: number = view.getInt32(base + 4);
      const high: number = view.getInt32(base + 8);
      const entries: number = high - low + 1;
      const targets: string[] = [];
      for (let index: number = 0; index < entries; index += 1) {
        targets.push(`${low + index}: ${offset + view.getInt32(base + 12 + index * 4)}`);
      }
      return {
        operands: `{ ${targets.join(', ')}, default: ${defaultTarget} }`,
        length: 1 + padding + 12 + entries * 4,
      };
    }
    case 'lookupswitch': {
      const padding: number = (4 - ((offset + 1) % 4)) % 4;
      const base: number = at + 1 + padding;
      const defaultTarget: number = offset + view.getInt32(base);
      const pairs: number = view.getInt32(base + 4);
      const targets: string[] = [];
      for (let index: number = 0; index < pairs; index += 1) {
        const match: number = view.getInt32(base + 8 + index * 8);
        const target: number = offset + view.getInt32(base + 12 + index * 8);
        targets.push(`${match}: ${target}`);
      }
      return {
        operands: `{ ${targets.join(', ')}, default: ${defaultTarget} }`,
        length: 1 + padding + 8 + pairs * 8,
      };
    }
  }
}

/**
 * Renders a constant-pool entry the way javap's trailing comments do.
 * @param pool The constant pool.
 * @param index The pool index.
 * @returns Returns the description.
 */
function describeConstant(pool: PoolEntry[], index: number): string {
  const entry: PoolEntry | undefined = pool[index];
  if (entry === undefined) {
    return `<invalid #${index}>`;
  }
  switch (entry.tag) {
    case 'utf8':
      return entry.value;
    case 'integer':
    case 'float':
    case 'double':
      return String(entry.value);
    case 'long':
      return `${entry.value}l`;
    case 'class':
      return `class ${utf8(pool, entry.nameIndex)}`;
    case 'string':
      return `String ${utf8(pool, entry.stringIndex)}`;
    case 'ref': {
      const owner: PoolEntry | undefined = pool[entry.classIndex];
      const ownerName: string = owner?.tag === 'class' ? utf8(pool, owner.nameIndex) : '?';
      return `${entry.kind} ${ownerName}.${describeNameAndType(pool, entry.nameAndTypeIndex)}`;
    }
    case 'nameAndType':
      return `${utf8(pool, entry.nameIndex)}:${utf8(pool, entry.descriptorIndex)}`;
    case 'methodHandle':
      return `MethodHandle kind=${entry.referenceKind} #${entry.referenceIndex}`;
    case 'methodType':
      return `MethodType ${utf8(pool, entry.descriptorIndex)}`;
    case 'dynamic':
      return `${entry.kind} ${describeNameAndType(pool, entry.nameAndTypeIndex)}`;
    case 'moduleOrPackage':
      return utf8(pool, entry.nameIndex);
    case 'unusable':
      return `<unusable #${index}>`;
  }
}

/**
 * Renders a NameAndType entry as `name:descriptor`.
 * @param pool The constant pool.
 * @param index The pool index.
 * @returns Returns the description.
 */
function describeNameAndType(pool: PoolEntry[], index: number): string {
  const entry: PoolEntry | undefined = pool[index];
  if (entry?.tag !== 'nameAndType') {
    return '?';
  }
  return `${utf8(pool, entry.nameIndex)}:${utf8(pool, entry.descriptorIndex)}`;
}

/**
 * Reads a UTF-8 constant, or a placeholder when the index is wrong.
 * @param pool The constant pool.
 * @param index The pool index.
 * @returns Returns the string.
 */
function utf8(pool: PoolEntry[], index: number): string {
  const entry: PoolEntry | undefined = pool[index];
  return entry?.tag === 'utf8' ? entry.value : `<#${index}>`;
}

/**
 * Reads the class's own name.
 * @param pool The constant pool.
 * @param index The `this_class` index.
 * @returns Returns the name.
 */
function className(pool: PoolEntry[], index: number): string {
  const entry: PoolEntry | undefined = pool[index];
  return entry?.tag === 'class' ? utf8(pool, entry.nameIndex) : '<unknown>';
}

/**
 * Decodes modified UTF-8. The common case is plain ASCII; the spike handles the standard multi-byte
 * forms but not the surrogate-pair encoding, which is noted as a gap.
 * @param view The file view.
 * @param start The payload offset.
 * @param length The payload length.
 * @returns Returns the string.
 */
function decodeModifiedUtf8(view: DataView, start: number, length: number): string {
  let result: string = '';
  let index: number = 0;
  while (index < length) {
    const first: number = view.getUint8(start + index);
    if (first < 0x80) {
      result += String.fromCharCode(first);
      index += 1;
    } else if ((first & 0xe0) === 0xc0) {
      const second: number = view.getUint8(start + index + 1);
      result += String.fromCharCode(((first & 0x1f) << 6) | (second & 0x3f));
      index += 2;
    } else {
      const second: number = view.getUint8(start + index + 1);
      const third: number = view.getUint8(start + index + 2);
      result += String.fromCharCode(
        ((first & 0x0f) << 12) | ((second & 0x3f) << 6) | (third & 0x3f),
      );
      index += 3;
    }
  }
  return result;
}

/**
 * Renders a method's modifiers, javap-style.
 * @param flags The access flags.
 * @returns Returns the modifier prefix, with a trailing space when non-empty.
 */
function methodModifiers(flags: number): string {
  const parts: string[] = [];
  if ((flags & 0x0001) !== 0) parts.push('public');
  if ((flags & 0x0002) !== 0) parts.push('private');
  if ((flags & 0x0004) !== 0) parts.push('protected');
  if ((flags & 0x0008) !== 0) parts.push('static');
  if ((flags & 0x0010) !== 0) parts.push('final');
  if ((flags & 0x0400) !== 0) parts.push('abstract');
  return parts.length === 0 ? '' : `${parts.join(' ')} `;
}

/**
 * Renders a method signature from its name and JVM descriptor.
 * @param name The method name.
 * @param descriptor The JVM descriptor (for example `(II)I`).
 * @returns Returns a Java-like signature.
 */
function describeMethod(name: string, descriptor: string): string {
  const match: RegExpMatchArray | null = /^\((.*)\)(.+)$/.exec(descriptor);
  if (match === null) {
    return `${name}${descriptor}`;
  }
  const parameters: string[] = parseTypes(match[1]);
  const returnType: string = parseTypes(match[2])[0] ?? 'void';
  const displayName: string = name === '<init>' ? '<init>' : name;
  return `${returnType} ${displayName}(${parameters.join(', ')})`;
}

/**
 * Parses a run of JVM field descriptors into type names.
 * @param descriptor The descriptor run.
 * @returns Returns the type names.
 */
function parseTypes(descriptor: string): string[] {
  const types: string[] = [];
  let index: number = 0;
  while (index < descriptor.length) {
    let arrayDepth: number = 0;
    while (descriptor[index] === '[') {
      arrayDepth += 1;
      index += 1;
    }
    const code: string = descriptor[index];
    let name: string;
    if (code === 'L') {
      const end: number = descriptor.indexOf(';', index);
      name = descriptor.slice(index + 1, end).replace(/\//g, '.');
      index = end + 1;
    } else {
      name = PRIMITIVES[code] ?? code;
      index += 1;
    }
    types.push(name + '[]'.repeat(arrayDepth));
  }
  return types;
}

/**
 * Maps primitive descriptor codes to type names.
 */
const PRIMITIVES: Readonly<Record<string, string>> = {
  B: 'byte',
  C: 'char',
  D: 'double',
  F: 'float',
  I: 'int',
  J: 'long',
  S: 'short',
  Z: 'boolean',
  V: 'void',
};

/**
 * Builds a placeholder section for a class with no methods.
 * @param name The class name.
 * @returns Returns the section.
 */
function emptySection(name: string): ListingSection {
  return { id: name, title: name, notes: ['no methods'], rows: [] };
}
