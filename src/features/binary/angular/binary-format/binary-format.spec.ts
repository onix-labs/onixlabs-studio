import {
  BinaryFormat,
  codeOffset,
  describeFormat,
  disassemblyArchitecture,
  sniffFormat,
} from './binary-format';

/**
 * Holds a byte buffer and a data view over it, for building header fixtures.
 */
interface HeaderBuffer {
  readonly bytes: Uint8Array;
  readonly view: DataView;
}

/**
 * Builds a zeroed byte buffer of a given size with a data view for setting header fields.
 * @param size The buffer size in bytes.
 * @returns Returns the bytes and a view over them.
 */
function buffer(size: number): HeaderBuffer {
  const bytes: Uint8Array = new Uint8Array(size);
  return { bytes, view: new DataView(bytes.buffer) };
}

/**
 * Builds a minimal PE header with a given machine, optional-header magic, and CLR directory RVA.
 * @param machine The FileHeader.Machine value.
 * @param optionalMagic The optional-header magic (0x10b PE32, 0x20b PE32+).
 * @param clrRva The CLR runtime data-directory RVA (non-zero marks a managed assembly).
 * @returns Returns the PE bytes.
 */
function makePe(machine: number, optionalMagic: number, clrRva: number): Uint8Array {
  const peOffset: number = 128;
  const directoriesOffset: number = peOffset + 24 + (optionalMagic === 0x20b ? 112 : 96);
  const { bytes, view } = buffer(directoriesOffset + 14 * 8 + 4);
  bytes[0] = 0x4d; // 'M'
  bytes[1] = 0x5a; // 'Z'
  view.setUint32(0x3c, peOffset, true);
  bytes[peOffset] = 0x50; // 'P'
  bytes[peOffset + 1] = 0x45; // 'E'
  view.setUint16(peOffset + 4, machine, true);
  view.setUint16(peOffset + 24, optionalMagic, true);
  view.setUint32(directoriesOffset + 14 * 8, clrRva, true);
  return bytes;
}

describe('sniffFormat', () => {
  it('detectsElfArchitectureByEndianness', () => {
    const le: HeaderBuffer = buffer(20);
    le.bytes.set([0x7f, 0x45, 0x4c, 0x46]);
    le.bytes[5] = 1; // little-endian
    le.view.setUint16(18, 62, true); // x64
    expect(sniffFormat(le.bytes)).toEqual({ kind: 'elf', architecture: 'x64' });

    const be: HeaderBuffer = buffer(20);
    be.bytes.set([0x7f, 0x45, 0x4c, 0x46]);
    be.bytes[5] = 2; // big-endian
    be.view.setUint16(18, 40, false); // ARM
    expect(sniffFormat(be.bytes)).toEqual({ kind: 'elf', architecture: 'ARM' });
  });

  it('detectsThinMachOArchitectureInEitherByteOrder', () => {
    const le64: HeaderBuffer = buffer(8);
    le64.view.setUint32(0, 0xfeedfacf, true); // MH_MAGIC_64, little-endian file
    le64.view.setUint32(4, 0x01000007, true); // CPU_TYPE_X86 | ABI64
    expect(sniffFormat(le64.bytes)).toEqual({ kind: 'macho', architecture: 'x64' });

    const be32: HeaderBuffer = buffer(8);
    be32.view.setUint32(0, 0xfeedface, false); // MH_MAGIC, big-endian file
    be32.view.setUint32(4, 12, false); // CPU_TYPE_ARM
    expect(sniffFormat(be32.bytes)).toEqual({ kind: 'macho', architecture: 'ARM' });
  });

  it('detectsJvmClassFiles', () => {
    const bytes: Uint8Array = new Uint8Array([0xca, 0xfe, 0xba, 0xbe, 0x00, 0x00, 0x00, 0x34]);
    expect(sniffFormat(bytes)).toEqual({ kind: 'jvm' });
  });

  it('detectsNativePeArchitectureAndManagedAssemblies', () => {
    expect(sniffFormat(makePe(0x8664, 0x20b, 0))).toEqual({
      kind: 'pe',
      architecture: 'x64',
      managed: false,
    });
    expect(sniffFormat(makePe(0x014c, 0x10b, 0x2000))).toEqual({
      kind: 'pe',
      architecture: 'x86',
      managed: true,
    });
  });

  it('detectsBareMzAsRealModeMsDos', () => {
    const bytes: Uint8Array = new Uint8Array(64);
    bytes[0] = 0x4d; // 'M'
    bytes[1] = 0x5a; // 'Z'
    // e_lfanew (0x3C) is left zero, so there is no PE signature: a real-mode MS-DOS executable.
    expect(sniffFormat(bytes)).toEqual({ kind: 'mz', architecture: 'x86-16' });
  });

  it('returnsUnknownForUnrecognisedHeaders', () => {
    expect(sniffFormat(new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toEqual({ kind: 'unknown' });
  });
});

describe('codeOffset', () => {
  it('mapsThePeEntryPointThroughItsSection', () => {
    const peOffset: number = 128;
    const optionalOffset: number = peOffset + 24;
    const optionalSize: number = 96;
    const sectionTable: number = optionalOffset + optionalSize;
    const { bytes, view } = buffer(sectionTable + 40);
    bytes[0] = 0x4d;
    bytes[1] = 0x5a;
    view.setUint32(0x3c, peOffset, true);
    bytes[peOffset] = 0x50; // 'P'
    bytes[peOffset + 1] = 0x45; // 'E'
    view.setUint16(peOffset + 6, 1, true); // one section
    view.setUint16(peOffset + 20, optionalSize, true); // size of optional header
    view.setUint32(optionalOffset + 16, 0x1000, true); // AddressOfEntryPoint
    view.setUint32(sectionTable + 8, 0x1000, true); // VirtualSize
    view.setUint32(sectionTable + 12, 0x1000, true); // VirtualAddress
    view.setUint32(sectionTable + 20, 0x400, true); // PointerToRawData
    expect(codeOffset(bytes)).toBe(0x400); // 0x1000 - 0x1000 + 0x400
  });

  it('mapsTheElfEntryPointThroughItsLoadSegment', () => {
    const { bytes, view } = buffer(128);
    bytes.set([0x7f, 0x45, 0x4c, 0x46]);
    bytes[4] = 2; // 64-bit
    bytes[5] = 1; // little-endian
    view.setBigUint64(24, 0x401000n, true); // e_entry
    view.setBigUint64(32, 64n, true); // e_phoff
    view.setUint16(54, 56, true); // e_phentsize
    view.setUint16(56, 1, true); // e_phnum
    view.setUint32(64, 1, true); // p_type = PT_LOAD
    view.setBigUint64(72, 0n, true); // p_offset
    view.setBigUint64(80, 0x400000n, true); // p_vaddr
    view.setBigUint64(96, 0x2000n, true); // p_filesz
    expect(codeOffset(bytes)).toBe(0x1000); // 0 + (0x401000 - 0x400000)
  });

  it('usesTheDosHeaderSizeForBareMz', () => {
    const { bytes, view } = buffer(64);
    bytes[0] = 0x4d;
    bytes[1] = 0x5a;
    view.setUint16(8, 2, true); // header size in paragraphs
    expect(codeOffset(bytes)).toBe(32); // 2 * 16
  });

  it('returnsNullForFormatsWithoutAKnownCodeOffset', () => {
    expect(codeOffset(new Uint8Array([0xca, 0xfe, 0xba, 0xbe]))).toBeNull();
  });
});

describe('describeFormat', () => {
  it('formatsEachKindForTheStatusStrip', () => {
    const cases: readonly { format: BinaryFormat; label: string }[] = [
      { format: { kind: 'pe', architecture: 'x64', managed: false }, label: 'PE · x64' },
      { format: { kind: 'pe', architecture: 'x86', managed: true }, label: '.NET · x86' },
      { format: { kind: 'mz', architecture: 'x86-16' }, label: 'MS-DOS · x86-16' },
      { format: { kind: 'elf', architecture: 'ARM64' }, label: 'ELF · ARM64' },
      { format: { kind: 'macho', architecture: 'x64' }, label: 'Mach-O · x64' },
      { format: { kind: 'jvm' }, label: 'JVM class' },
      { format: { kind: 'unknown' }, label: 'Binary' },
    ];
    for (const { format, label } of cases) {
      expect(describeFormat(format)).toBe(label);
    }
  });
});

describe('disassemblyArchitecture', () => {
  it('returnsTheArchitectureForNativeCodeAndNullForManagedOrUnsupported', () => {
    expect(disassemblyArchitecture({ kind: 'pe', architecture: 'x64', managed: false })).toBe('x64');
    expect(disassemblyArchitecture({ kind: 'elf', architecture: 'ARM64' })).toBe('ARM64');
    expect(disassemblyArchitecture({ kind: 'macho', architecture: 'x86' })).toBe('x86');
    expect(disassemblyArchitecture({ kind: 'mz', architecture: 'x86-16' })).toBe('x86-16');
    // Managed .NET, JVM, unknown, and unsupported architectures have no native disassembly.
    expect(disassemblyArchitecture({ kind: 'pe', architecture: 'x64', managed: true })).toBeNull();
    expect(disassemblyArchitecture({ kind: 'jvm' })).toBeNull();
    expect(disassemblyArchitecture({ kind: 'unknown' })).toBeNull();
    expect(disassemblyArchitecture({ kind: 'elf', architecture: 'RISC-V' })).toBeNull();
  });
});
