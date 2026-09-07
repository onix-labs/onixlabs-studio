import { BinaryFormat, codeOffset, describeFormat, formatKey, sniffFormat } from './binary-format';

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
 * Writes a Mach-O fixed-width, NUL-padded 16-byte name field.
 * @param bytes The buffer to write into.
 * @param offset The byte offset of the field.
 * @param name The name to write.
 */
function writeName(bytes: Uint8Array, offset: number, name: string): void {
  for (let index: number = 0; index < name.length; index += 1) {
    bytes[offset + index] = name.charCodeAt(index);
  }
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

  it('recoversReadyToRunArchitectureThroughEveryOperatingSystemOverride', () => {
    // .NET XORs the machine field with an OS-specific value for non-Windows ReadyToRun targets, so
    // the raw value means nothing until it is undone. 0xC020 is what a real `dotnet publish
    // -p:PublishReadyToRun -r osx-x64` writes, and 0xC020 ^ 0x4644 is 0x8664 (AMD64).
    const overrides: readonly { os: string; override: number }[] = [
      { os: 'Apple', override: 0x4644 },
      { os: 'Linux', override: 0x7b79 },
      { os: 'FreeBSD', override: 0xadc4 },
      { os: 'NetBSD', override: 0x1993 },
      { os: 'SunOS', override: 0x1992 },
    ];
    for (const { os, override } of overrides) {
      const x64: BinaryFormat = sniffFormat(makePe(0x8664 ^ override, 0x20b, 0x2000));
      expect(x64, `${os} x64`).toEqual({
        kind: 'pe',
        architecture: 'x64',
        managed: true,
        readyToRun: true,
      });
      const arm64: BinaryFormat = sniffFormat(makePe(0xaa64 ^ override, 0x20b, 0x2000));
      expect(arm64, `${os} ARM64`).toEqual({
        kind: 'pe',
        architecture: 'ARM64',
        managed: true,
        readyToRun: true,
      });
    }
  });

  it('readyToRunRecoveryIsNotAppliedToAnOrdinaryAssembly', () => {
    // Every override is a 16-bit XOR, so applied to a machine value that already means something it
    // would produce a different valid one. A recognised machine must never be reinterpreted.
    expect(sniffFormat(makePe(0x8664, 0x20b, 0x2000))).toEqual({
      kind: 'pe',
      architecture: 'x64',
      managed: true,
    });
  });

  it('readyToRunRecoveryIsNotAppliedToAnUnmanagedImage', () => {
    // A native PE whose machine is genuinely unrecognised stays unknown: only a managed image can be
    // ReadyToRun, so there is nothing here to undo.
    expect(sniffFormat(makePe(0xc020, 0x20b, 0))).toEqual({
      kind: 'pe',
      architecture: 'unknown',
      managed: false,
    });
  });

  it('anUnrecoverableManagedMachineStaysUnknownRatherThanBeingGuessedAt', () => {
    // Undoing every override still yields nothing recognisable, so the value is unrecognised for some
    // other reason and the sniffer must not invent an architecture for it.
    expect(sniffFormat(makePe(0x0001, 0x20b, 0x2000))).toEqual({
      kind: 'pe',
      architecture: 'unknown',
      managed: true,
    });
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

  it('findsTheMachOTextSection', () => {
    // A NativeAOT binary disassembled but its Code button did nothing, because Mach-O was the one
    // container this could not locate code in. Layout mirrors a real 64-bit image: header, one
    // LC_SEGMENT_64 for __TEXT, one __text section within it.
    const command: number = 32;
    const sections: number = command + 72;
    const { bytes, view } = buffer(sections + 80);
    view.setUint32(0, 0xfeedfacf, true); // MH_MAGIC_64
    view.setUint32(16, 1, true); // ncmds
    view.setUint32(command, 0x19, true); // LC_SEGMENT_64
    view.setUint32(command + 4, 72 + 80, true); // cmdsize
    writeName(bytes, command + 8, '__TEXT');
    view.setUint32(command + 64, 1, true); // nsects
    writeName(bytes, sections, '__text');
    view.setUint32(sections + 48, 0x1d10, true); // section offset
    expect(codeOffset(bytes)).toBe(0x1d10);
  });

  it('findsTheMachOTextSectionInA32BitImage', () => {
    const command: number = 28;
    const sections: number = command + 56;
    const { bytes, view } = buffer(sections + 68);
    view.setUint32(0, 0xfeedface, true); // MH_MAGIC
    view.setUint32(16, 1, true); // ncmds
    view.setUint32(command, 0x01, true); // LC_SEGMENT
    view.setUint32(command + 4, 56 + 68, true); // cmdsize
    writeName(bytes, command + 8, '__TEXT');
    view.setUint32(command + 48, 1, true); // nsects
    writeName(bytes, sections, '__text');
    view.setUint32(sections + 40, 0x900, true); // section offset
    expect(codeOffset(bytes)).toBe(0x900);
  });

  it('skipsMachOLoadCommandsBeforeTheTextSegment', () => {
    // __TEXT is rarely the first load command; the walk must step over the ones ahead of it by their
    // own declared size rather than assuming a position.
    const first: number = 32;
    const firstSize: number = 24;
    const command: number = first + firstSize;
    const sections: number = command + 72;
    const { bytes, view } = buffer(sections + 80);
    view.setUint32(0, 0xfeedfacf, true);
    view.setUint32(16, 2, true); // ncmds
    view.setUint32(first, 0x22, true); // LC_DYLD_INFO_ONLY — not a segment
    view.setUint32(first + 4, firstSize, true);
    view.setUint32(command, 0x19, true);
    view.setUint32(command + 4, 72 + 80, true);
    writeName(bytes, command + 8, '__TEXT');
    view.setUint32(command + 64, 1, true);
    writeName(bytes, sections, '__text');
    view.setUint32(sections + 48, 0x2000, true);
    expect(codeOffset(bytes)).toBe(0x2000);
  });

  it('returnsNullForFormatsWithoutAKnownCodeOffset', () => {
    expect(codeOffset(new Uint8Array([0xca, 0xfe, 0xba, 0xbe]))).toBeNull();
  });
});

describe('formatKey', () => {
  it('routesAReadyToRunImageToTheNativeDecoder_notTheIlOne', () => {
    // The native code is why the image was published this way, and it is exactly what an IL decoder
    // cannot show. An ordinary managed assembly still goes to the IL decoder.
    expect(formatKey({ kind: 'pe', architecture: 'x64', managed: true, readyToRun: true })).toBe(
      'pe/x64',
    );
    expect(formatKey({ kind: 'pe', architecture: 'x64', managed: true })).toBe('pe-managed');
  });

  it('fallsBackToTheIlDecoderWhenAReadyToRunArchitectureNeverResolved', () => {
    // Better a listing of its IL than nothing at all.
    expect(
      formatKey({ kind: 'pe', architecture: 'unknown', managed: true, readyToRun: true }),
    ).toBe('pe-managed');
  });
});

describe('describeFormat', () => {
  it('formatsEachKindForTheStatusStrip', () => {
    const cases: readonly { format: BinaryFormat; label: string }[] = [
      { format: { kind: 'pe', architecture: 'x64', managed: false }, label: 'PE · x64' },
      { format: { kind: 'pe', architecture: 'x86', managed: true }, label: '.NET · x86' },
      {
        format: { kind: 'pe', architecture: 'x64', managed: true, readyToRun: true },
        label: '.NET R2R · x64',
      },
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

describe('WebAssembly', (): void => {
  /**
   * Builds a minimal WebAssembly module header.
   * @param version The version to encode.
   * @returns Returns the bytes.
   */
  function wasmHeader(version: number = 1): Uint8Array {
    const bytes: Uint8Array = new Uint8Array(8);
    bytes.set([0x00, 0x61, 0x73, 0x6d], 0);
    new DataView(bytes.buffer).setUint32(4, version, true);
    return bytes;
  }

  it('sniffFormat_recognisesTheModuleMagicAndVersion', (): void => {
    expect(sniffFormat(wasmHeader())).toEqual({ kind: 'wasm', version: 1 });
  });

  it('describeFormat_namesTheVersion', (): void => {
    expect(describeFormat(sniffFormat(wasmHeader()))).toBe('WebAssembly · v1');
  });

  it('formatKey_resolvesToTheCanonicalWasmKey', (): void => {
    expect(formatKey(sniffFormat(wasmHeader()))).toBe('wasm');
  });

  it('sniffFormat_doesNotMistakeALeadingNulByteForAModule', (): void => {
    // A binary starting with a NUL is ordinary; only the full four-byte magic is a module.
    expect(sniffFormat(new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00]))).toEqual({
      kind: 'unknown',
    });
  });
});
