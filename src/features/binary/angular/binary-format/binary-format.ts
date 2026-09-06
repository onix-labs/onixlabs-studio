import { decoderFormatKey } from '@shared/api/decoder-protocol';

/**
 * Describes the container format and target architecture of a binary, sniffed from its header. Drives
 * which disassembly back-end a binary's bytes are handed to, and is surfaced in the status strip.
 */
export type BinaryFormat =
  | {
      readonly kind: 'pe';
      readonly architecture: string;
      readonly managed: boolean;
      /**
       * Gets whether the image is ReadyToRun: managed, but carrying ahead-of-time compiled native
       * code for {@link architecture} as well as IL. Absent means no (an ordinary PE, managed or not).
       */
      readonly readyToRun?: boolean;
    }
  | { readonly kind: 'mz'; readonly architecture: string }
  | { readonly kind: 'elf'; readonly architecture: string }
  | { readonly kind: 'macho'; readonly architecture: string }
  | { readonly kind: 'jvm' }
  | { readonly kind: 'wasm'; readonly version: number }
  | { readonly kind: 'unknown' };

/**
 * Holds how many leading bytes are needed to classify a file (a PE header can sit a few hundred bytes
 * in via `e_lfanew`, well within the first fetched block).
 */
export const FORMAT_SNIFF_LENGTH: number = 512;

/**
 * The values .NET exclusive-ORs into a ReadyToRun image's PE `Machine` field when the target is not
 * Windows, keyed by the operating system they mark.
 *
 * The field is not corrupt and the image is not mis-built: a non-Windows R2R image deliberately
 * carries a machine value no Windows loader will accept, so it cannot be run as a native PE on the
 * wrong platform. Undoing the override is the only way to learn what the ahead-of-time code was
 * actually compiled for — an Apple x64 image reads `0xC020`, and `0xC020 ^ 0x4644` is `0x8664`.
 */
const R2R_MACHINE_OVERRIDES: ReadonlyMap<string, number> = new Map<string, number>([
  ['Apple', 0x4644],
  ['Linux', 0x7b79],
  ['FreeBSD', 0xadc4],
  ['NetBSD', 0x1993],
  ['SunOS', 0x1992],
]);

/**
 * Sniffs a binary's container format and architecture from its leading bytes. Pure and dependency
 * free: it reads only the header fields it needs, bounds-checked, and returns `unknown` for anything
 * it does not recognise.
 * @param bytes The file's leading bytes (the first block is more than enough).
 * @returns Returns the detected format.
 */
export function sniffFormat(bytes: Uint8Array): BinaryFormat {
  const view: DataView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // ELF: 0x7F 'E' 'L' 'F'.
  if (matches(bytes, 0, [0x7f, 0x45, 0x4c, 0x46])) {
    return sniffElf(bytes, view);
  }
  // Mach-O (thin): MH_MAGIC / MH_MAGIC_64 in either byte order.
  const macho: BinaryFormat | null = sniffMachO(bytes, view);
  if (macho !== null) {
    return macho;
  }
  // WebAssembly: '\0asm', then a four-byte little-endian version.
  if (matches(bytes, 0, [0x00, 0x61, 0x73, 0x6d])) {
    return { kind: 'wasm', version: readU32(view, 4, true) ?? 1 };
  }
  // JVM class: 0xCAFEBABE. (Shares its magic with Mach-O fat binaries, which are far rarer here; a
  // thin Mach-O is matched above, so a remaining 0xCAFEBABE is treated as a class file.)
  if (matches(bytes, 0, [0xca, 0xfe, 0xba, 0xbe])) {
    return { kind: 'jvm' };
  }
  // PE: 'MZ' DOS stub, then the PE signature at e_lfanew. A bare MZ with no PE signature is a
  // real-mode MS-DOS executable (16-bit x86).
  if (matches(bytes, 0, [0x4d, 0x5a])) {
    return sniffPe(bytes, view) ?? { kind: 'mz', architecture: 'x86-16' };
  }
  return { kind: 'unknown' };
}

/**
 * Resolves the file offset where a binary's code begins, so the editor can jump past the headers to
 * real instructions: the PE entry point (translated through the section table, or the first executable
 * section), the ELF entry point (translated through the program headers), the Mach-O `__TEXT,__text`
 * section, or the MS-DOS header size.
 * Returns null when it cannot be determined (JVM/WebAssembly/unknown, or a malformed or truncated
 * header).
 * @param bytes The file's leading bytes (the first block).
 * @returns Returns the code file offset, or null.
 */
export function codeOffset(bytes: Uint8Array): number | null {
  const view: DataView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (matches(bytes, 0, [0x7f, 0x45, 0x4c, 0x46])) {
    return elfCodeOffset(bytes, view);
  }
  const macho: number | null = machoCodeOffset(view);
  if (macho !== null) {
    return macho;
  }
  if (matches(bytes, 0, [0x4d, 0x5a])) {
    const peOffset: number | null = readU32(view, 0x3c, true);
    if (peOffset !== null && matches(bytes, peOffset, [0x50, 0x45, 0x00, 0x00])) {
      return peCodeOffset(view, peOffset);
    }
    // Bare MZ (real-mode MS-DOS): code follows the header, whose size is in paragraphs at offset 8.
    const headerParagraphs: number | null = readU16(view, 8, true);
    return headerParagraphs === null ? null : headerParagraphs * 16;
  }
  return null;
}

/**
 * Resolves the canonical decoder format key for a sniffed format, or null when the format is not one
 * any decoder could claim (an unrecognised container, or a container whose architecture did not
 * resolve).
 *
 * This is the join between what the sniffer detects and what a plugin's manifest claims, so both sides
 * must spell it the same way — hence one function rather than two conventions. A managed PE is its own
 * key rather than an architecture-bearing one: what decodes IL has nothing to do with the machine the
 * assembly nominally targets.
 * @param format The detected format.
 * @returns Returns the format key, or null when nothing could decode it.
 */
export function formatKey(format: BinaryFormat): string | null {
  switch (format.kind) {
    case 'pe':
      // A ReadyToRun image is managed and also carries ahead-of-time native code. It routes to the
      // native decoder rather than the IL one: the native code is the reason the image was published
      // this way, and it is what an IL decoder cannot show. Its IL is still in there, which is a
      // limitation recorded on the format rather than papered over — the panel shows one listing.
      if (format.readyToRun === true) {
        return format.architecture === 'unknown'
          ? 'pe-managed'
          : decoderFormatKey('pe', format.architecture);
      }
      return format.managed
        ? 'pe-managed'
        : format.architecture === 'unknown'
          ? null
          : decoderFormatKey('pe', format.architecture);
    case 'mz':
      return decoderFormatKey('mz', format.architecture);
    case 'elf':
    case 'macho':
      return format.architecture === 'unknown'
        ? null
        : decoderFormatKey(format.kind, format.architecture);
    case 'jvm':
      return decoderFormatKey('jvm');
    case 'wasm':
      return decoderFormatKey('wasm');
    case 'unknown':
      return null;
  }
}

/**
 * Resolves the architecture label the *assembler* takes for a format, or null when its machine code
 * cannot be written here.
 *
 * Separate from {@link formatKey} and named for what it is for. A format key identifies which decoder
 * reads a file; this identifies which instruction set is being written, and the two are different
 * values — the assembler wants `x64`, not `pe/x64`. Conflating them silently breaks every write.
 * @param format The detected format.
 * @returns Returns the architecture label, or null when the format holds no writable machine code.
 */
export function assemblerArchitecture(format: BinaryFormat): string | null {
  switch (format.kind) {
    case 'pe':
      // Managed code is IL, which this cannot write — except a ReadyToRun image, whose ahead-of-time
      // section is ordinary machine code for a real instruction set.
      return format.managed && format.readyToRun !== true
        ? null
        : nativeArchitecture(format.architecture);
    case 'mz':
    case 'elf':
    case 'macho':
      return nativeArchitecture(format.architecture);
    case 'jvm':
    case 'wasm':
    case 'unknown':
      return null;
  }
}

/**
 * Narrows a sniffed architecture label to one the assembler recognises.
 * @param architecture The sniffed label.
 * @returns Returns the label, or null when it is not a writable instruction set.
 */
function nativeArchitecture(architecture: string): string | null {
  return ['x86-16', 'x86', 'x64', 'ARM', 'ARM64'].includes(architecture) ? architecture : null;
}

/**
 * Formats a detected format for display in the status strip.
 * @param format The detected format.
 * @returns Returns a short human-readable label.
 */
export function describeFormat(format: BinaryFormat): string {
  switch (format.kind) {
    case 'pe':
      if (format.readyToRun === true) {
        return `.NET R2R · ${format.architecture}`;
      }
      return format.managed ? `.NET · ${format.architecture}` : `PE · ${format.architecture}`;
    case 'mz':
      return `MS-DOS · ${format.architecture}`;
    case 'elf':
      return `ELF · ${format.architecture}`;
    case 'macho':
      return `Mach-O · ${format.architecture}`;
    case 'jvm':
      return 'JVM class';
    case 'wasm':
      return `WebAssembly · v${format.version}`;
    case 'unknown':
      return 'Binary';
  }
}

/**
 * Determines whether the bytes at an offset equal a signature.
 * @param bytes The bytes to test.
 * @param offset The offset to test at.
 * @param signature The expected byte values.
 * @returns Returns true when every signature byte matches.
 */
function matches(bytes: Uint8Array, offset: number, signature: readonly number[]): boolean {
  if (offset + signature.length > bytes.length) {
    return false;
  }
  return signature.every(
    (value: number, index: number): boolean => bytes[offset + index] === value,
  );
}

/**
 * Sniffs an ELF header's architecture from `e_machine`, honouring its endianness flag.
 * @param bytes The file's leading bytes.
 * @param view A view over those bytes.
 * @returns Returns the ELF format.
 */
function sniffElf(bytes: Uint8Array, view: DataView): BinaryFormat {
  const littleEndian: boolean = bytes[5] !== 2; // EI_DATA: 1 = little, 2 = big.
  const machine: number | null = readU16(view, 18, littleEndian);
  return { kind: 'elf', architecture: elfArchitecture(machine) };
}

/**
 * Sniffs a thin Mach-O header's architecture from `cputype`, or returns null when the magic does not
 * match a thin Mach-O in either byte order.
 * @param bytes The file's leading bytes.
 * @param view A view over those bytes.
 * @returns Returns the Mach-O format, or null.
 */
function sniffMachO(bytes: Uint8Array, view: DataView): BinaryFormat | null {
  const magicBe: number | null = readU32(view, 0, false);
  const magicLe: number | null = readU32(view, 0, true);
  const isThin: (magic: number | null) => boolean = (magic: number | null): boolean =>
    magic === 0xfeedface || magic === 0xfeedfacf;
  let littleEndian: boolean;
  if (isThin(magicBe)) {
    littleEndian = false;
  } else if (isThin(magicLe)) {
    littleEndian = true;
  } else {
    return null;
  }
  const cpuType: number | null = readU32(view, 4, littleEndian);
  return { kind: 'macho', architecture: machoArchitecture(cpuType) };
}

/**
 * Sniffs a PE header's architecture from `FileHeader.Machine`, and whether it is a managed (.NET)
 * assembly from the presence of the CLR runtime data directory.
 * @param bytes The file's leading bytes.
 * @param view A view over those bytes.
 * @returns Returns the PE format, or null when the PE signature is absent or truncated.
 */
function sniffPe(bytes: Uint8Array, view: DataView): BinaryFormat | null {
  const peOffset: number | null = readU32(view, 0x3c, true);
  if (peOffset === null || !matches(bytes, peOffset, [0x50, 0x45, 0x00, 0x00])) {
    return null;
  }
  const machine: number | null = readU16(view, peOffset + 4, true);
  const optionalOffset: number = peOffset + 24;
  const optionalMagic: number | null = readU16(view, optionalOffset, true);
  // Data directories follow the optional header: 96 bytes in for PE32, 112 for PE32+.
  const directoriesOffset: number = optionalOffset + (optionalMagic === 0x20b ? 112 : 96);
  // The CLR runtime header is data directory index 14; a non-zero RVA marks a managed assembly.
  const clrRva: number | null = readU32(view, directoriesOffset + 14 * 8, true);
  const managed: boolean = clrRva !== null && clrRva !== 0;
  const architecture: string = peArchitecture(machine);
  if (architecture !== 'unknown' || !managed) {
    return { kind: 'pe', architecture, managed };
  }
  // A managed image whose machine value means nothing is the ReadyToRun case: the value is XORed with
  // an operating-system override, so undo each in turn and take the one that yields a real machine.
  const revealed: string | null = readyToRunArchitecture(machine);
  return revealed === null
    ? { kind: 'pe', architecture, managed }
    : { kind: 'pe', architecture: revealed, managed, readyToRun: true };
}

/**
 * Recovers the architecture of a ReadyToRun image whose `Machine` field carries a non-Windows
 * operating-system override, or null when undoing every known override still yields nothing
 * recognisable (so the value is unrecognised for some other reason and must not be guessed at).
 *
 * Only ever consulted for a managed image whose machine value is already unrecognised, which is what
 * keeps it from reinterpreting an ordinary assembly: every override is a 16-bit XOR, so applied to a
 * valid machine value it would happily produce a different valid one.
 * @param machine The raw machine value, or null.
 * @returns Returns the architecture label, or null.
 */
function readyToRunArchitecture(machine: number | null): string | null {
  if (machine === null) {
    return null;
  }
  for (const [, override] of R2R_MACHINE_OVERRIDES) {
    const architecture: string = peArchitecture(machine ^ override);
    if (architecture !== 'unknown') {
      return architecture;
    }
  }
  return null;
}

/**
 * Resolves a PE file's code offset: the entry point mapped through the section that contains it, or
 * the first executable section's raw pointer (for DLLs with no entry point).
 * @param view A view over the file's leading bytes.
 * @param peOffset The offset of the PE signature.
 * @returns Returns the code file offset, or null.
 */
function peCodeOffset(view: DataView, peOffset: number): number | null {
  const sectionCount: number | null = readU16(view, peOffset + 6, true);
  const optionalSize: number | null = readU16(view, peOffset + 20, true);
  const entryRva: number | null = readU32(view, peOffset + 24 + 16, true);
  if (sectionCount === null || optionalSize === null) {
    return null;
  }
  const sectionTable: number = peOffset + 24 + optionalSize;
  let executableFallback: number | null = null;
  for (let index: number = 0; index < sectionCount; index += 1) {
    const section: number = sectionTable + index * 40;
    const virtualSize: number | null = readU32(view, section + 8, true);
    const virtualAddress: number | null = readU32(view, section + 12, true);
    const rawPointer: number | null = readU32(view, section + 20, true);
    const characteristics: number | null = readU32(view, section + 36, true);
    if (virtualAddress === null || rawPointer === null) {
      break;
    }
    if (
      entryRva !== null &&
      entryRva !== 0 &&
      virtualAddress <= entryRva &&
      entryRva < virtualAddress + (virtualSize ?? 0)
    ) {
      return entryRva - virtualAddress + rawPointer;
    }
    // IMAGE_SCN_MEM_EXECUTE (0x20000000): the first executable section, used when there is no entry.
    if (
      executableFallback === null &&
      characteristics !== null &&
      (characteristics & 0x20000000) !== 0
    ) {
      executableFallback = rawPointer;
    }
  }
  return executableFallback;
}

/**
 * Resolves an ELF file's code offset: the entry point mapped through the loadable program header that
 * contains it.
 * @param bytes The file's leading bytes.
 * @param view A view over those bytes.
 * @returns Returns the code file offset, or null.
 */
function elfCodeOffset(bytes: Uint8Array, view: DataView): number | null {
  const is64: boolean = bytes[4] === 2; // EI_CLASS: 1 = 32-bit, 2 = 64-bit.
  const littleEndian: boolean = bytes[5] !== 2; // EI_DATA: 1 = little, 2 = big.
  const entry: number | null = is64
    ? readU64(view, 24, littleEndian)
    : readU32(view, 24, littleEndian);
  const phOffset: number | null = is64
    ? readU64(view, 32, littleEndian)
    : readU32(view, 28, littleEndian);
  const phEntrySize: number | null = readU16(view, is64 ? 54 : 42, littleEndian);
  const phCount: number | null = readU16(view, is64 ? 56 : 44, littleEndian);
  if (entry === null || phOffset === null || phEntrySize === null || phCount === null) {
    return null;
  }
  for (let index: number = 0; index < phCount; index += 1) {
    const header: number = phOffset + index * phEntrySize;
    const type: number | null = readU32(view, header, littleEndian);
    const fileOffset: number | null = is64
      ? readU64(view, header + 8, littleEndian)
      : readU32(view, header + 4, littleEndian);
    const virtualAddress: number | null = is64
      ? readU64(view, header + 16, littleEndian)
      : readU32(view, header + 8, littleEndian);
    const fileSize: number | null = is64
      ? readU64(view, header + 32, littleEndian)
      : readU32(view, header + 16, littleEndian);
    if (type === null || fileOffset === null || virtualAddress === null || fileSize === null) {
      break;
    }
    // PT_LOAD (1) segment containing the entry point.
    if (type === 1 && virtualAddress <= entry && entry < virtualAddress + fileSize) {
      return fileOffset + (entry - virtualAddress);
    }
  }
  return null;
}

/**
 * Resolves a Mach-O file's code offset: the `__text` section of the `__TEXT` segment, which is where
 * a Mach-O keeps its machine code. Returns null when the file is not a thin Mach-O, or when the load
 * commands do not describe that section.
 *
 * Unlike ELF and PE this does not follow an entry point. A Mach-O entry is `LC_MAIN`, whose `entryoff`
 * is already a file offset into `__TEXT` — but a dynamic library has no `LC_MAIN` at all, and a
 * NativeAOT binary's interesting code is not at its entry anyway. The section start is what the
 * ribbon's Code button should land on in every case.
 * @param view A view over the file's leading bytes.
 * @returns Returns the code file offset, or null.
 */
function machoCodeOffset(view: DataView): number | null {
  const magicBe: number | null = readU32(view, 0, false);
  const magicLe: number | null = readU32(view, 0, true);
  let littleEndian: boolean;
  let magic: number;
  if (magicBe === 0xfeedface || magicBe === 0xfeedfacf) {
    littleEndian = false;
    magic = magicBe;
  } else if (magicLe === 0xfeedface || magicLe === 0xfeedfacf) {
    littleEndian = true;
    magic = magicLe;
  } else {
    return null;
  }
  const is64: boolean = magic === 0xfeedfacf;
  const commandCount: number | null = readU32(view, 16, littleEndian);
  if (commandCount === null) {
    return null;
  }
  // The 64-bit header carries a trailing reserved word the 32-bit one does not.
  let command: number = is64 ? 32 : 28;
  for (let index: number = 0; index < commandCount; index += 1) {
    const kind: number | null = readU32(view, command, littleEndian);
    const size: number | null = readU32(view, command + 4, littleEndian);
    if (kind === null || size === null || size <= 0) {
      return null;
    }
    // LC_SEGMENT_64 (0x19) and LC_SEGMENT (0x01) share a layout up to their section count, differing
    // only in the width of the address and size fields between.
    const isSegment64: boolean = kind === 0x19;
    if ((isSegment64 || kind === 0x01) && readName(view, command + 8) === '__TEXT') {
      const sectionCount: number | null = readU32(
        view,
        command + (isSegment64 ? 64 : 48),
        littleEndian,
      );
      const sections: number = command + (isSegment64 ? 72 : 56);
      const sectionSize: number = isSegment64 ? 80 : 68;
      for (let section: number = 0; section < (sectionCount ?? 0); section += 1) {
        const start: number = sections + section * sectionSize;
        if (readName(view, start) === '__text') {
          return readU32(view, start + (isSegment64 ? 48 : 40), littleEndian);
        }
      }
      return null;
    }
    command += size;
  }
  return null;
}

/**
 * Reads a Mach-O fixed-width, NUL-padded 16-byte name field.
 * @param view The data view.
 * @param offset The byte offset of the field.
 * @returns Returns the name, or an empty string when out of bounds.
 */
function readName(view: DataView, offset: number): string {
  if (offset + 16 > view.byteLength) {
    return '';
  }
  let name: string = '';
  for (let index: number = 0; index < 16; index += 1) {
    const byte: number = view.getUint8(offset + index);
    if (byte === 0) {
      break;
    }
    name += String.fromCharCode(byte);
  }
  return name;
}

/**
 * Reads a little/big-endian 16-bit value, or null when out of bounds.
 * @param view The data view.
 * @param offset The byte offset.
 * @param littleEndian Whether to read little-endian.
 * @returns Returns the value, or null.
 */
function readU16(view: DataView, offset: number, littleEndian: boolean): number | null {
  return offset + 2 <= view.byteLength ? view.getUint16(offset, littleEndian) : null;
}

/**
 * Reads a little/big-endian 32-bit value, or null when out of bounds.
 * @param view The data view.
 * @param offset The byte offset.
 * @param littleEndian Whether to read little-endian.
 * @returns Returns the value, or null.
 */
function readU32(view: DataView, offset: number, littleEndian: boolean): number | null {
  return offset + 4 <= view.byteLength ? view.getUint32(offset, littleEndian) : null;
}

/**
 * Reads a little/big-endian 64-bit value as a number, or null when out of bounds. File offsets and
 * virtual addresses in real binaries stay well within a safe integer.
 * @param view The data view.
 * @param offset The byte offset.
 * @param littleEndian Whether to read little-endian.
 * @returns Returns the value, or null.
 */
function readU64(view: DataView, offset: number, littleEndian: boolean): number | null {
  return offset + 8 <= view.byteLength ? Number(view.getBigUint64(offset, littleEndian)) : null;
}

/**
 * Maps a PE `Machine` value to an architecture label.
 * @param machine The machine value, or null.
 * @returns Returns the architecture label.
 */
function peArchitecture(machine: number | null): string {
  switch (machine) {
    case 0x014c:
      return 'x86';
    case 0x8664:
      return 'x64';
    case 0x01c0:
    case 0x01c4:
      return 'ARM';
    case 0xaa64:
      return 'ARM64';
    default:
      return 'unknown';
  }
}

/**
 * Maps an ELF `e_machine` value to an architecture label.
 * @param machine The machine value, or null.
 * @returns Returns the architecture label.
 */
function elfArchitecture(machine: number | null): string {
  switch (machine) {
    case 3:
      return 'x86';
    case 62:
      return 'x64';
    case 40:
      return 'ARM';
    case 183:
      return 'ARM64';
    case 243:
      return 'RISC-V';
    default:
      return 'unknown';
  }
}

/**
 * Maps a Mach-O `cputype` value to an architecture label, honouring the 64-bit ABI flag.
 * @param cpuType The cputype value, or null.
 * @returns Returns the architecture label.
 */
function machoArchitecture(cpuType: number | null): string {
  if (cpuType === null) {
    return 'unknown';
  }
  const is64: boolean = (cpuType & 0x01000000) !== 0;
  switch (cpuType & ~0x01000000) {
    case 7:
      return is64 ? 'x64' : 'x86';
    case 12:
      return is64 ? 'ARM64' : 'ARM';
    default:
      return 'unknown';
  }
}
