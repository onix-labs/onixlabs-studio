/**
 * JVM opcode table.
 *
 * Mechanical: 202 opcodes, of which all but four are fixed-length. The four that are not — both switch
 * forms, `wide`, and the prefixed pair — are where a decoder goes wrong, because a mis-sized
 * instruction desynchronises every offset after it.
 */

/**
 * Describes how to read an opcode's operands.
 */
export type OperandShape =
  /** No operands. */
  | 'none'
  /** One unsigned byte. */
  | 'u1'
  /** One signed byte. */
  | 's1'
  /** One unsigned short. */
  | 'u2'
  /** One signed short. */
  | 's2'
  /** One constant-pool index, one byte wide. */
  | 'cp1'
  /** One constant-pool index, two bytes wide. */
  | 'cp2'
  /** A two-byte signed branch offset, relative to the opcode. */
  | 'branch2'
  /** A four-byte signed branch offset, relative to the opcode. */
  | 'branch4'
  /** `iinc`: a local index and a signed byte delta. */
  | 'iinc'
  /** `invokeinterface`: a cp index, an argument count, and a zero byte. */
  | 'invokeinterface'
  /** `invokedynamic`: a cp index and two zero bytes. */
  | 'invokedynamic'
  /** `newarray`: a primitive array type code. */
  | 'newarray'
  /** `multianewarray`: a cp index and a dimension count. */
  | 'multianewarray'
  /** `wide`: widens the following instruction. Variable length. */
  | 'wide'
  /** `tableswitch`: padded to a 4-byte boundary, then default/low/high and a jump table. */
  | 'tableswitch'
  /** `lookupswitch`: padded to a 4-byte boundary, then default/npairs and match/offset pairs. */
  | 'lookupswitch';

/**
 * Holds an opcode's mnemonic and operand shape.
 */
export interface OpcodeSpec {
  readonly mnemonic: string;
  readonly shape: OperandShape;
}

/**
 * Maps opcode byte to its specification. Gaps (0xCB–0xFD, minus the reserved ones) are undefined and
 * decode as `.byte` fillers, mirroring what the native path does for undecodable bytes.
 */
export const OPCODES: readonly (OpcodeSpec | undefined)[] = buildOpcodeTable();

/**
 * Builds the opcode table.
 * @returns Returns the table, indexed by opcode byte.
 */
function buildOpcodeTable(): (OpcodeSpec | undefined)[] {
  const table: (OpcodeSpec | undefined)[] = new Array<OpcodeSpec | undefined>(256).fill(undefined);
  const put: (code: number, mnemonic: string, shape?: OperandShape) => void = (
    code: number,
    mnemonic: string,
    shape: OperandShape = 'none',
  ): void => {
    table[code] = { mnemonic, shape };
  };

  // 0x00–0x0f: constants.
  put(0x00, 'nop');
  put(0x01, 'aconst_null');
  ['iconst_m1', 'iconst_0', 'iconst_1', 'iconst_2', 'iconst_3', 'iconst_4', 'iconst_5'].forEach(
    (name: string, index: number): void => put(0x02 + index, name),
  );
  put(0x09, 'lconst_0');
  put(0x0a, 'lconst_1');
  put(0x0b, 'fconst_0');
  put(0x0c, 'fconst_1');
  put(0x0d, 'fconst_2');
  put(0x0e, 'dconst_0');
  put(0x0f, 'dconst_1');

  // 0x10–0x14: pushes and loads from the constant pool.
  put(0x10, 'bipush', 's1');
  put(0x11, 'sipush', 's2');
  put(0x12, 'ldc', 'cp1');
  put(0x13, 'ldc_w', 'cp2');
  put(0x14, 'ldc2_w', 'cp2');

  // 0x15–0x35: loads.
  put(0x15, 'iload', 'u1');
  put(0x16, 'lload', 'u1');
  put(0x17, 'fload', 'u1');
  put(0x18, 'dload', 'u1');
  put(0x19, 'aload', 'u1');
  ['i', 'l', 'f', 'd', 'a'].forEach((prefix: string, group: number): void => {
    for (let index: number = 0; index < 4; index += 1) {
      put(0x1a + group * 4 + index, `${prefix}load_${index}`);
    }
  });
  ['iaload', 'laload', 'faload', 'daload', 'aaload', 'baload', 'caload', 'saload'].forEach(
    (name: string, index: number): void => put(0x2e + index, name),
  );

  // 0x36–0x56: stores.
  put(0x36, 'istore', 'u1');
  put(0x37, 'lstore', 'u1');
  put(0x38, 'fstore', 'u1');
  put(0x39, 'dstore', 'u1');
  put(0x3a, 'astore', 'u1');
  ['i', 'l', 'f', 'd', 'a'].forEach((prefix: string, group: number): void => {
    for (let index: number = 0; index < 4; index += 1) {
      put(0x3b + group * 4 + index, `${prefix}store_${index}`);
    }
  });
  ['iastore', 'lastore', 'fastore', 'dastore', 'aastore', 'bastore', 'castore', 'sastore'].forEach(
    (name: string, index: number): void => put(0x4f + index, name),
  );

  // 0x57–0x5f: stack manipulation.
  ['pop', 'pop2', 'dup', 'dup_x1', 'dup_x2', 'dup2', 'dup2_x1', 'dup2_x2', 'swap'].forEach(
    (name: string, index: number): void => put(0x57 + index, name),
  );

  // 0x60–0x83: arithmetic and logic.
  ['add', 'sub', 'mul', 'div', 'rem'].forEach((op: string, group: number): void => {
    ['i', 'l', 'f', 'd'].forEach((prefix: string, index: number): void => {
      put(0x60 + group * 4 + index, `${prefix}${op}`);
    });
  });
  ['ineg', 'lneg', 'fneg', 'dneg'].forEach((name: string, index: number): void =>
    put(0x74 + index, name),
  );
  ['ishl', 'lshl', 'ishr', 'lshr', 'iushr', 'lushr'].forEach((name: string, index: number): void =>
    put(0x78 + index, name),
  );
  ['iand', 'land', 'ior', 'lor', 'ixor', 'lxor'].forEach((name: string, index: number): void =>
    put(0x7e + index, name),
  );
  put(0x84, 'iinc', 'iinc');

  // 0x85–0x93: conversions.
  [
    'i2l',
    'i2f',
    'i2d',
    'l2i',
    'l2f',
    'l2d',
    'f2i',
    'f2l',
    'f2d',
    'd2i',
    'd2l',
    'd2f',
    'i2b',
    'i2c',
    'i2s',
  ].forEach((name: string, index: number): void => put(0x85 + index, name));

  // 0x94–0x98: comparisons.
  put(0x94, 'lcmp');
  put(0x95, 'fcmpl');
  put(0x96, 'fcmpg');
  put(0x97, 'dcmpl');
  put(0x98, 'dcmpg');

  // 0x99–0xa8: branches.
  ['ifeq', 'ifne', 'iflt', 'ifge', 'ifgt', 'ifle'].forEach((name: string, index: number): void =>
    put(0x99 + index, name, 'branch2'),
  );
  [
    'if_icmpeq',
    'if_icmpne',
    'if_icmplt',
    'if_icmpge',
    'if_icmpgt',
    'if_icmple',
    'if_acmpeq',
    'if_acmpne',
  ].forEach((name: string, index: number): void => put(0x9f + index, name, 'branch2'));
  put(0xa7, 'goto', 'branch2');
  put(0xa8, 'jsr', 'branch2');
  put(0xa9, 'ret', 'u1');

  // 0xaa–0xab: the two switches — the only genuinely awkward opcodes, because of the 4-byte padding.
  put(0xaa, 'tableswitch', 'tableswitch');
  put(0xab, 'lookupswitch', 'lookupswitch');

  // 0xac–0xb1: returns.
  ['ireturn', 'lreturn', 'freturn', 'dreturn', 'areturn', 'return'].forEach(
    (name: string, index: number): void => put(0xac + index, name),
  );

  // 0xb2–0xb8: field and method access.
  put(0xb2, 'getstatic', 'cp2');
  put(0xb3, 'putstatic', 'cp2');
  put(0xb4, 'getfield', 'cp2');
  put(0xb5, 'putfield', 'cp2');
  put(0xb6, 'invokevirtual', 'cp2');
  put(0xb7, 'invokespecial', 'cp2');
  put(0xb8, 'invokestatic', 'cp2');
  put(0xb9, 'invokeinterface', 'invokeinterface');
  put(0xba, 'invokedynamic', 'invokedynamic');

  // 0xbb–0xc3: allocation, casts, monitors.
  put(0xbb, 'new', 'cp2');
  put(0xbc, 'newarray', 'newarray');
  put(0xbd, 'anewarray', 'cp2');
  put(0xbe, 'arraylength');
  put(0xbf, 'athrow');
  put(0xc0, 'checkcast', 'cp2');
  put(0xc1, 'instanceof', 'cp2');
  put(0xc2, 'monitorenter');
  put(0xc3, 'monitorexit');

  // 0xc4–0xc9: wide, multianewarray, null branches, wide gotos.
  put(0xc4, 'wide', 'wide');
  put(0xc5, 'multianewarray', 'multianewarray');
  put(0xc6, 'ifnull', 'branch2');
  put(0xc7, 'ifnonnull', 'branch2');
  put(0xc8, 'goto_w', 'branch4');
  put(0xc9, 'jsr_w', 'branch4');

  // 0xca: reserved for debuggers; appears in the wild inside breakpointed classes.
  put(0xca, 'breakpoint');

  return table;
}

/**
 * Maps a `newarray` type code to its type name.
 */
export const ARRAY_TYPES: Readonly<Record<number, string>> = {
  4: 'boolean',
  5: 'char',
  6: 'float',
  7: 'double',
  8: 'byte',
  9: 'short',
  10: 'int',
  11: 'long',
};
