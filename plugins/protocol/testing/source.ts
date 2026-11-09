// Helpers every test adapter's discovery and results share (#1351): a bounded walk of a folder's source
// files, line numbers for a match, and links out of a failure's stack.
//
// ⛔ Discovery reads files; it never runs them. These helpers only ever read.
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { TestLocation, TestStackFrame } from './protocol';

/**
 * The directories no walk enters: what tools generate and what package managers install, where a test
 * found would be a dependency's. Hidden directories are skipped as well.
 */
export const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set<string>([
  'node_modules',
  'bin',
  'obj',
  'dist',
  'build',
  'out',
  'target',
  'vendor',
  'coverage',
  '__pycache__',
  'venv',
  'TestResults',
]);

/**
 * The most files one walk returns, so a huge tree costs a bounded read.
 */
const MAX_FILES: number = 20_000;

/**
 * The largest file a discovery reads. A generated source of megabytes is not where tests are written.
 */
export const MAX_SOURCE_BYTES: number = 2 * 1024 * 1024;

/**
 * Describes how a walk chooses its files.
 */
export interface WalkOptions {
  /**
   * Decides whether a file is wanted.
   * @param name The file's name.
   * @param relative Its path relative to the walk's root, with `/` separators.
   * @returns Returns true to include it.
   */
  readonly accept: (name: string, relative: string) => boolean;

  /**
   * Gets further directory names to skip.
   */
  readonly skip?: ReadonlySet<string>;

  /**
   * Gets whether hidden directories are entered. False by default.
   */
  readonly hidden?: boolean;
}

/**
 * Walks a folder for the files an adapter wants, breadth first and bounded.
 * @param root The absolute folder.
 * @param options What to include and skip.
 * @returns Returns the absolute paths, sorted.
 */
export async function walkFiles(root: string, options: WalkOptions): Promise<readonly string[]> {
  const found: string[] = [];
  let level: readonly string[] = [root];
  while (level.length > 0 && found.length < MAX_FILES) {
    const next: string[] = [];
    for (const directory of level) {
      let entries: import('node:fs').Dirent[];
      try {
        entries = await fs.readdir(directory, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const full: string = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (
            (options.hidden !== true && entry.name.startsWith('.')) ||
            SKIPPED_DIRECTORIES.has(entry.name) ||
            options.skip?.has(entry.name) === true
          ) {
            continue;
          }
          next.push(full);
        } else if (
          entry.isFile() &&
          options.accept(entry.name, path.relative(root, full).split(path.sep).join('/'))
        ) {
          found.push(full);
          if (found.length >= MAX_FILES) {
            break;
          }
        }
      }
    }
    level = next;
  }
  return found.sort();
}

/**
 * Reads a source file as text, skipping one too large to be hand-written.
 * @param file The absolute path.
 * @returns Returns the text, or null when it cannot be read or is too large.
 */
export async function readSource(file: string): Promise<string | null> {
  try {
    const stat: import('node:fs').Stats = await fs.stat(file);
    if (stat.size > MAX_SOURCE_BYTES) {
      return null;
    }
    return await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Builds a function that turns an offset into a 1-based line number, for one text.
 * @param text The text.
 * @returns Returns the function.
 */
export function lineIndex(text: string): (offset: number) => number {
  const starts: number[] = [0];
  for (let index: number = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) {
      starts.push(index + 1);
    }
  }
  return (offset: number): number => {
    let low: number = 0;
    let high: number = starts.length - 1;
    while (low < high) {
      const middle: number = (low + high + 1) >> 1;
      if (starts[middle] <= offset) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    return low + 1;
  };
}

/**
 * The patterns a stack line names a file and line by, tried in order: .NET's `in <file>:line <n>`,
 * Python's `File "<file>", line <n>`, then the `<file>:<line>[:<column>]` nearly everything else prints.
 */
const FRAME_PATTERNS: readonly RegExp[] = [
  / in (.+?):line (\d+)/,
  /File "([^"]+)", line (\d+)/,
  /(?:file:\/\/)?((?:[A-Za-z]:)?[^\s():'"]*[\\/]?[^\s():'"]+\.[A-Za-z0-9]+):(\d+)(?::\d+)?/,
];

/**
 * Reads where a stack line points.
 * @param line The line.
 * @param base The folder a relative path is resolved against.
 * @returns Returns the location, or undefined when it names no file.
 */
export function frameLocation(line: string, base: string): TestLocation | undefined {
  for (const pattern of FRAME_PATTERNS) {
    const match: RegExpExecArray | null = pattern.exec(line);
    if (match !== null) {
      const lineNumber: number = Number(match[2]);
      if (!Number.isInteger(lineNumber) || lineNumber < 1) {
        continue;
      }
      return { file: path.resolve(base, match[1]), line: lineNumber };
    }
  }
  return undefined;
}

/**
 * Splits a stack into frames, each linked where it names a file. Studio keeps a link only when it points
 * inside the folder, so frames inside a framework are shown and not linked.
 * @param stack The stack's text.
 * @param base The folder relative paths are resolved against.
 * @returns Returns the frames.
 */
export function stackFrames(stack: string | undefined, base: string): readonly TestStackFrame[] {
  if (stack === undefined) {
    return [];
  }
  return stack
    .split(/\r?\n/)
    .map((line: string): string => line.trim())
    .filter((line: string): boolean => line.length > 0)
    .map((text: string): TestStackFrame => {
      const location: TestLocation | undefined = frameLocation(text, base);
      return location === undefined ? { text } : { text, location };
    });
}
