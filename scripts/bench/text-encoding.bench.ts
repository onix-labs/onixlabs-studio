import { decodeText } from '../../src/shared/electron/text-encoding';
import { BenchCase } from './bench-case';

/**
 * Generates bytes covering every value, so both halves of the Windows 1252 table are read.
 * @param megabytes The size.
 * @returns Returns the bytes.
 */
function everyByte(megabytes: number): Uint8Array {
  const bytes: Uint8Array = new Uint8Array(megabytes * 1024 * 1024);
  for (let index: number = 0; index < bytes.length; index += 1) {
    bytes[index] = index % 256;
  }
  return bytes;
}

const fiftyMegabytes: Uint8Array = everyByte(50);

/**
 * The cases.
 */
export const cases: readonly BenchCase[] = [
  {
    name: 'decode 50 MB windows1252',
    maxIterations: 3,
    run: (): string => decodeText(fiftyMegabytes, { encoding: 'windows1252' }).text,
  },
];
