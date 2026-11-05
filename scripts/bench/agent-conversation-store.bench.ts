import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { AgentConversationStore } from '../../src/shared/electron/ai/agent-conversation-store';
import { BenchCase } from './bench-case';

/**
 * Specifies the directory the store keeps under user data.
 */
const STORE_DIR: string = 'agent-conversations';

/**
 * Specifies how many conversations the category case rewrites.
 */
const FILED: number = 200;

/**
 * Exposes the steps measured, which the store otherwise only offers over IPC.
 */
interface StoreInternals {
  load(id: string): unknown;
  save(value: unknown): unknown;
  clearCategory(id: string): unknown;
  flush(): Promise<void>;
}

/**
 * Holds the temporary user data directory.
 */
let userData: string = '';

/**
 * Holds the longest time the event loop was held, for the note.
 */
let longestStallMs: number = 0;

/**
 * Holds how long the operation itself took, for a case that has to rebuild its fixture each run.
 */
let operationMs: number = 0;

/**
 * Builds a conversation of about the given size.
 * @param id Its id.
 * @param megabytes Its size.
 * @param categoryId The category it is filed under.
 * @returns Returns the conversation.
 */
function conversation(id: string, megabytes: number, categoryId?: string): Record<string, unknown> {
  const item: Record<string, unknown> = { role: 'assistant', text: 'lorem ipsum '.repeat(80) };
  const count: number = Math.ceil((megabytes * 1024 * 1024) / JSON.stringify(item).length);
  return {
    id,
    contextId: 'bench',
    title: id,
    messageCount: count,
    createdAt: 1,
    updatedAt: 2,
    provider: 'bench',
    model: 'bench',
    items: new Array<unknown>(count).fill(item),
    ...(categoryId === undefined ? {} : { categoryId }),
  };
}

/**
 * Writes the fixture conversations straight to the temporary directory.
 */
function createFixture(): void {
  userData = mkdtempSync(join(tmpdir(), 'studio-bench-conversations-'));
  process.env['STUDIO_BENCH_USER_DATA'] = userData;
  const store: string = join(userData, STORE_DIR);
  mkdirSync(store);
  writeFileSync(join(store, 'large.json'), JSON.stringify(conversation('large', 50)));
  fileConversations();
}

/**
 * Files the category's conversations, which clearing the category undoes, so each run has it all to do.
 */
function fileConversations(): void {
  const store: string = join(userData, STORE_DIR);
  const summaries: unknown[] = [];
  for (let index: number = 0; index < FILED; index += 1) {
    const value: Record<string, unknown> = conversation(`filed-${index}`, 1, 'category');
    writeFileSync(join(store, `filed-${index}.json`), JSON.stringify(value));
    summaries.push({ ...value, items: undefined });
  }
  writeFileSync(join(store, 'index.json'), JSON.stringify(summaries));
}

/**
 * Measures the event loop's longest gap across an operation.
 * @param operation The operation.
 * @returns Returns what it returned.
 */
async function sampled(operation: () => unknown): Promise<unknown> {
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
  await sleep(2);
  const started: number = performance.now();
  const result: unknown = await operation();
  operationMs = performance.now() - started;
  await sleep(2);
  running = false;
  await sampling;
  longestStallMs = longest;
  return result;
}

/**
 * Builds a store over the fixture.
 * @returns Returns its internals.
 */
function store(): StoreInternals {
  return new AgentConversationStore() as unknown as StoreInternals;
}

/**
 * Describes the stall.
 * @returns Returns the note.
 */
function stallNote(): string {
  return `longest event-loop stall ${longestStallMs.toFixed(1)} ms`;
}

/**
 * The cases.
 */
export const cases: readonly BenchCase[] = [
  {
    name: 'load 50 MB conversation',
    setup: createFixture,
    run: async (): Promise<unknown> => {
      const internals: StoreInternals = store();
      const loaded: unknown = await sampled((): unknown => internals.load('large'));
      if (loaded === null) {
        throw new Error('The fixture did not load; the measurement means nothing');
      }
      return loaded;
    },
    note: stallNote,
  },
  {
    name: `clear a category over ${FILED} 1 MB conversations`,
    run: async (): Promise<void> => {
      fileConversations();
      const internals: StoreInternals = store();
      await sampled((): unknown => internals.clearCategory('category'));
      await internals.flush();
      const unfiled: string = readFileSync(join(userData, STORE_DIR, 'index.json'), 'utf8');
      if (unfiled.includes('"categoryId":"category"')) {
        throw new Error('The category was not cleared; the measurement means nothing');
      }
    },
    maxIterations: 3,
    note: (): string => `${stallNote()}, last clear ${operationMs.toFixed(0)} ms`,
  },
  {
    name: 'save 50 MB conversation',
    run: async (): Promise<void> => {
      const internals: StoreInternals = store();
      await sampled(async (): Promise<void> => {
        internals.save(conversation('saved', 50));
        await internals.flush();
      });
    },
    note: stallNote,
    teardown: (): void => {
      rmSync(userData, { recursive: true, force: true });
    },
  },
];
