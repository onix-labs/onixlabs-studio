import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { LogArchive } from '../../src/shared/electron/log-archive';
import { MediaProtocol } from '../../src/shared/electron/media-protocol';
import { BenchCase } from './bench-case';

/**
 * Specifies the size of the generated image.
 */
const IMAGE_BYTES: number = 200 * 1024 * 1024;

/**
 * Exposes the media handler's entry, which is otherwise only reached through Electron.
 */
interface MediaInternals {
  serve(request: Request): Promise<Response>;
}

/**
 * Exposes the session read, whichever form it takes.
 */
interface ArchiveInternals {
  readSession(sessionId: string): unknown;
  readSessionFile?(sessionId: string): unknown;
}

/**
 * Holds the generated files.
 */
let directory: string = '';

/**
 * Holds the longest time the event loop was held, for the note.
 */
let longestStallMs: number = 0;

/**
 * Holds the most buffer memory seen, for the note.
 */
let peakBuffersMb: number = 0;

/**
 * Runs an operation, sampling the event loop's longest gap and the buffers held.
 * @param operation The operation.
 * @returns Returns what it returned.
 */
async function sampled(operation: () => unknown): Promise<unknown> {
  let last: number = performance.now();
  let longest: number = 0;
  let peak: number = 0;
  let running: boolean = true;
  const sampling: Promise<void> = (async (): Promise<void> => {
    while (running) {
      await sleep(1);
      const now: number = performance.now();
      longest = Math.max(longest, now - last);
      peak = Math.max(peak, process.memoryUsage().arrayBuffers);
      last = now;
    }
  })();
  await sleep(2);
  const result: unknown = await operation();
  await sleep(2);
  running = false;
  await sampling;
  longestStallMs = longest;
  peakBuffersMb = peak / (1024 * 1024);
  return result;
}

/**
 * Reads a response to its end without keeping it.
 * @param response The response.
 * @returns Returns the bytes read.
 */
async function drain(response: Response): Promise<number> {
  const body: AsyncIterable<Uint8Array> | null = response.body;
  let total: number = 0;
  for await (const chunk of body ?? []) {
    total += chunk.byteLength;
  }
  return total;
}

/**
 * The cases.
 */
export const cases: readonly BenchCase[] = [
  {
    name: 'read a 100 MB session log',
    setup: (): void => {
      directory = mkdtempSync(join(tmpdir(), 'studio-bench-logs-'));
      const message: string = 'x'.repeat(180);
      const line: string = `${JSON.stringify({ time: 1, level: 'info', source: 'b', message })}\n`;
      mkdirSync(join(directory, 'sessions'));
      writeFileSync(
        join(directory, 'sessions', 'big.jsonl'),
        line.repeat(Math.ceil((100 * 1024 * 1024) / line.length)),
      );
      writeFileSync(join(directory, 'big.png'), Buffer.alloc(IMAGE_BYTES, 7));
    },
    run: async (): Promise<unknown> => {
      const archive: ArchiveInternals = new LogArchive(directory);
      const records: unknown = await sampled((): unknown =>
        archive.readSessionFile === undefined
          ? archive.readSession('big')
          : archive.readSessionFile('big'),
      );
      if (!Array.isArray(records) || records.length === 0) {
        throw new Error('Nothing was read; the measurement means nothing');
      }
      return records;
    },
    note: (): string => `longest event-loop stall ${longestStallMs.toFixed(1)} ms`,
  },
  {
    name: 'serve a 200 MB image',
    run: async (): Promise<unknown> => {
      const source: string = encodeURIComponent(join(directory, 'big.png'));
      const media: MediaInternals = new MediaProtocol() as unknown as MediaInternals;
      const total: unknown = await sampled(async (): Promise<number> =>
        drain(await media.serve(new Request(`studio-media://image/?src=${source}`))),
      );
      if (total !== IMAGE_BYTES) {
        throw new Error('The image did not arrive whole; the measurement means nothing');
      }
      return total;
    },
    note: (): string =>
      `longest stall ${longestStallMs.toFixed(1)} ms, peak buffers ${peakBuffersMb.toFixed(0)} MB`,
    teardown: (): void => {
      rmSync(directory, { recursive: true, force: true });
    },
  },
];
