/**
 * Describes the container format and target architecture of a binary, sniffed from its header. Drives
 * which disassembly back-end a binary's bytes are handed to, and is surfaced in the status strip.
 */
export type BinaryFormat =
  | { readonly kind: 'pe'; readonly architecture: string; readonly managed: boolean }
  | { readonly kind: 'elf'; readonly architecture: string }
  | { readonly kind: 'macho'; readonly architecture: string }
  | { readonly kind: 'jvm' }
  | { readonly kind: 'unknown' };

/**
 * Holds how many leading bytes are needed to classify a file (a PE header can sit a few hundred bytes
 * in via `e_lfanew`, well within the first fetched block).
 */
export const FORMAT_SNIFF_LENGTH: number = 512;

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
  // JVM class: 0xCAFEBABE. (Shares its magic with Mach-O fat binaries, which are far rarer here; a
  // thin Mach-O is matched above, so a remaining 0xCAFEBABE is treated as a class file.)
  if (matches(bytes, 0, [0xca, 0xfe, 0xba, 0xbe])) {
    return { kind: 'jvm' };
  }
  // PE: 'MZ' DOS stub, then the PE signature at e_lfanew.
  if (matches(bytes, 0, [0x4d, 0x5a])) {
    const pe: BinaryFormat | null = sniffPe(bytes, view);
    if (pe !== null) {
      return pe;
    }
  }
  return { kind: 'unknown' };
}

/**
 * Holds the architecture labels the native disassembler supports.
 */
const DISASSEMBLABLE: ReadonlySet<string> = new Set<string>(['x86', 'x64', 'ARM', 'ARM64']);

/**
 * Resolves the architecture a format's native code should be disassembled as, or null when native
 * disassembly does not apply — managed .NET assemblies, JVM class files, and unknown or unsupported
 * architectures (the managed formats are handled by later phases' sidecars).
 * @param format The detected format.
 * @returns Returns the architecture label, or null.
 */
export function disassemblyArchitecture(format: BinaryFormat): string | null {
  switch (format.kind) {
    case 'pe':
      return !format.managed && DISASSEMBLABLE.has(format.architecture) ? format.architecture : null;
    case 'elf':
    case 'macho':
      return DISASSEMBLABLE.has(format.architecture) ? format.architecture : null;
    case 'jvm':
    case 'unknown':
      return null;
  }
}

/**
 * Formats a detected format for display in the status strip.
 * @param format The detected format.
 * @returns Returns a short human-readable label.
 */
export function describeFormat(format: BinaryFormat): string {
  switch (format.kind) {
    case 'pe':
      return format.managed ? `.NET · ${format.architecture}` : `PE · ${format.architecture}`;
    case 'elf':
      return `ELF · ${format.architecture}`;
    case 'macho':
      return `Mach-O · ${format.architecture}`;
    case 'jvm':
      return 'JVM class';
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
  return signature.every((value: number, index: number): boolean => bytes[offset + index] === value);
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
  return { kind: 'pe', architecture: peArchitecture(machine), managed };
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
