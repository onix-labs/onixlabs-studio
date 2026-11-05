import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { LspFileWatcher } from '../../src/shared/electron/lsp/lsp-file-watcher';
import { BenchCase } from './bench-case';

/**
 * Specifies how many entries change at once, as a branch switch or a package install does.
 */
const ENTRIES: number = 20_000;

/**
 * Exposes the two private steps measured: real events would measure the operating system's watcher.
 */
interface WatcherInternals {
  watcher: unknown;
  onEvent(eventType: string, filename: string): void;
  flush(): Promise<void> | void;
}

/**
 * Holds the directory the entries are made in.
 */
let directory: string = '';

/**
 * Holds the longest time the event loop was held, for the note.
 */
let longestStallMs: number = 0;

/**
 * Holds how many events came out, for the note.
 */
let delivered: number = 0;

/**
 * Starts sampling the event loop.
 * @returns Returns a function that stops sampling and gives the longest gap, in milliseconds.
 */
function sampleStalls(): () => Promise<number> {
  let last: number = performance.now();
  let longest: number = 0;
  let running: boolean = true;
  const sampling: Promise<void> = (async (): Promise<void> => {
    while (running) {
      await sleep(1);
      const now: number = performance.now();
      longest = Math.max(longest, now - last);
      last = now;
    }
  })();
  return async (): Promise<number> => {
    running = false;
    await sampling;
    return longest;
  };
}

/**
 * Pushes every entry through a watcher and flushes it.
 */
async function flushEverything(): Promise<void> {
  const watcher: LspFileWatcher = new LspFileWatcher(
    directory,
    (events: readonly unknown[]): void => {
      delivered += events.length;
    },
  );
  const internals: WatcherInternals = watcher as unknown as WatcherInternals;
  // The native watcher is out of the measurement: it reports nothing the injected events do not, and
  // where it is refused it fails a tick later, and the close that follows drops everything pending.
  watcher.close();
  internals.watcher = { close: (): void => undefined };
  for (let index: number = 0; index < ENTRIES; index += 1) {
    internals.onEvent('rename', `entry-${index}.txt`);
  }
  delivered = 0;
  const stop: () => Promise<number> = sampleStalls();
  await sleep(0);
  await internals.flush();
  // Bounded: a bench that waits on a count must not be able to hang when the count is wrong.
  const deadline: number = performance.now() + 30_000;
  while (delivered < ENTRIES && performance.now() < deadline) {
    await sleep(1);
  }
  longestStallMs = await stop();
  watcher.close();
  if (delivered !== ENTRIES) {
    throw new Error(`Delivered ${delivered} of ${ENTRIES} events; the measurement means nothing`);
  }
}

/**
 * The cases.
 */
export const cases: readonly BenchCase[] = [
  {
    name: `flush ${ENTRIES} renames`,
    setup: (): void => {
      directory = mkdtempSync(join(tmpdir(), 'studio-bench-watch-'));
      for (let index: number = 0; index < ENTRIES; index += 2) {
        writeFileSync(join(directory, `entry-${index}.txt`), '');
      }
    },
    run: flushEverything,
    note: (): string =>
      `longest event-loop stall ${longestStallMs.toFixed(1)} ms, ${delivered} events`,
    teardown: (): void => {
      rmSync(directory, { recursive: true, force: true });
    },
  },
];
