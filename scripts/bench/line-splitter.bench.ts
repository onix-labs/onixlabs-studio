import { LineSplitter } from '../../src/shared/electron/line-splitter';
import { BenchCase } from './bench-case';

/**
 * Specifies the size of the chunks a pipe hands over.
 */
const CHUNK_LENGTH: number = 64 * 1024;

/**
 * Generates one line delivered in pipe-sized chunks.
 * @param megabytes The size of the line.
 * @returns Returns the chunks, the last ending in the newline.
 */
function chunksOf(megabytes: number): readonly string[] {
  const total: number = megabytes * 1024 * 1024;
  const chunk: string = 'x'.repeat(CHUNK_LENGTH);
  const chunks: string[] = new Array<string>(Math.floor(total / CHUNK_LENGTH)).fill(chunk);
  chunks.push('\n');
  return chunks;
}

/**
 * Consumes chunks with the loop the clients carried before the shared splitter, kept here verbatim
 * as the baseline: it is what every number from this bench is compared against.
 * @param chunks The chunks.
 * @returns Returns how many characters of lines came out.
 */
function legacy(chunks: readonly string[]): number {
  let buffer: string = '';
  let seen: number = 0;
  for (const chunk of chunks) {
    buffer += chunk;
    let newline: number = buffer.indexOf('\n');
    while (newline !== -1) {
      const line: string = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      seen += line.length;
      newline = buffer.indexOf('\n');
    }
  }
  return seen;
}

/**
 * Consumes chunks with the shared splitter.
 * @param chunks The chunks.
 * @returns Returns how many characters of lines came out.
 */
function shared(chunks: readonly string[]): number {
  let seen: number = 0;
  const splitter: LineSplitter = new LineSplitter({
    trim: true,
    onLine: (line: string): void => {
      seen += line.length;
    },
  });
  for (const chunk of chunks) {
    splitter.push(chunk);
  }
  return seen;
}

const eightMegabytes: readonly string[] = chunksOf(8);
const sixtyFourMegabytes: readonly string[] = chunksOf(64);

/**
 * The cases.
 */
export const cases: readonly BenchCase[] = [
  { name: 'legacy 8 MB line', run: (): number => legacy(eightMegabytes) },
  { name: 'legacy 64 MB line', maxIterations: 2, run: (): number => legacy(sixtyFourMegabytes) },
  { name: 'shared 8 MB line', run: (): number => shared(eightMegabytes) },
  { name: 'shared 64 MB line', run: (): number => shared(sixtyFourMegabytes) },
];
