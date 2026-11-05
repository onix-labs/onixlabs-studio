import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { RootLimiter } from '../../plugins/git/src/root-limiter';
import { BenchCase } from './bench-case';

/**
 * Specifies how many requests arrive at once.
 */
const REQUESTS: number = 64;

/**
 * Runs a program to its end.
 */
const run: (file: string, args: readonly string[], options: { cwd: string }) => Promise<unknown> =
  promisify(execFile);

/**
 * Holds the generated repository.
 */
let repository: string = '';

/**
 * Holds the most processes alive at once, for the note.
 */
let peak: number = 0;

/**
 * Runs `git status`, counting the processes alive.
 * @param counter The running count.
 * @returns Returns a promise that resolves when it has finished.
 */
async function status(counter: { running: number }): Promise<void> {
  counter.running += 1;
  peak = Math.max(peak, counter.running);
  await run('git', ['status', '--porcelain=v2'], { cwd: repository });
  counter.running -= 1;
}

/**
 * Runs every request through a limiter.
 * @param limit The limit.
 * @returns Returns a promise that resolves when all have finished.
 */
async function limited(limit: number): Promise<void> {
  peak = 0;
  const counter: { running: number } = { running: 0 };
  const limiter: RootLimiter = new RootLimiter(limit);
  await Promise.all(
    Array.from({ length: REQUESTS }, async (): Promise<void> =>
      limiter.run(repository, async (): Promise<void> => status(counter)),
    ),
  );
}

/**
 * Describes the run.
 * @returns Returns the note.
 */
function note(): string {
  return `peak ${peak} git processes for ${REQUESTS} requests`;
}

/**
 * The cases.
 */
export const cases: readonly BenchCase[] = [
  {
    name: 'every request at once',
    setup: (): void => {
      repository = mkdtempSync(join(tmpdir(), 'studio-bench-git-'));
      execFileSync('git', ['init', '-q'], { cwd: repository });
      for (let index: number = 0; index < 3000; index += 1) {
        writeFileSync(join(repository, `file-${index}.txt`), `${index}\n`);
      }
      execFileSync('git', ['add', '.'], { cwd: repository });
    },
    run: async (): Promise<void> => {
      peak = 0;
      const counter: { running: number } = { running: 0 };
      await Promise.all(
        Array.from({ length: REQUESTS }, async (): Promise<void> => status(counter)),
      );
    },
    note,
  },
  {
    name: 'limited to 8',
    run: async (): Promise<void> => limited(8),
    note,
  },
  {
    name: 'limited to 4',
    run: async (): Promise<void> => limited(4),
    note,
    teardown: (): void => {
      rmSync(repository, { recursive: true, force: true });
    },
  },
];
