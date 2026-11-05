import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { SearchResponse } from '../../src/shared/api/search-channels';
import { SearchManager } from '../../src/shared/electron/search-manager';
import { WorkspaceContext } from '../../src/shared/electron/workspace-context';
import { BenchCase } from './bench-case';

/**
 * Specifies how many generated files are searched.
 */
const FILES: number = 3000;

/**
 * Specifies the query as it grows, a keystroke at a time, 30 ms apart.
 */
const KEYSTROKES: readonly string[] = ['l', 'lo', 'lor', 'lore', 'lorem', 'lorem ', 'lorem i'];

/**
 * Exposes the search itself, which is otherwise only offered over IPC.
 */
interface ManagerInternals {
  run(request: unknown, senderId?: number): Promise<SearchResponse>;
}

/**
 * Holds the generated workspace.
 */
let root: string = '';

/**
 * Holds how long the final answer took from the first keystroke, for the note.
 */
let settledMs: number = 0;

/**
 * Holds the matches in the final answer, which must be the same however it was reached.
 */
let finalTotal: number = 0;

/**
 * Types the query, searching on each keystroke.
 * @param caller The name searches go under, or undefined to run each to its end, as they all did.
 * @returns Returns the final answer's match count.
 */
async function type(caller: string | undefined): Promise<number> {
  const workspace: WorkspaceContext = new WorkspaceContext();
  workspace.addRoot(root);
  const manager: ManagerInternals = new SearchManager(workspace) as unknown as ManagerInternals;
  const started: number = performance.now();
  const searches: Promise<SearchResponse>[] = [];
  for (const query of KEYSTROKES) {
    searches.push(
      manager.run(
        {
          query,
          root,
          caseSensitive: false,
          wholeWord: false,
          regexp: false,
          limits: { maxResults: 1_000_000 },
          ...(caller === undefined ? {} : { caller }),
        },
        1,
      ),
    );
    await sleep(30);
  }
  const answers: readonly SearchResponse[] = await Promise.all(searches);
  settledMs = performance.now() - started;
  finalTotal = answers.at(-1)?.total ?? 0;
  if (finalTotal === 0) {
    throw new Error('The final search found nothing; the measurement means nothing');
  }
  return finalTotal;
}

/**
 * Describes the run.
 * @returns Returns the note.
 */
function note(): string {
  return `all settled in ${settledMs.toFixed(0)} ms, final answer ${finalTotal} matches`;
}

/**
 * The cases.
 */
export const cases: readonly BenchCase[] = [
  {
    name: 'every keystroke runs to its end',
    setup: (): void => {
      root = mkdtempSync(join(tmpdir(), 'studio-bench-search-'));
      const text: string = `${'lorem ipsum dolor sit amet\n'.repeat(4000)}`;
      mkdirSync(join(root, 'src'));
      for (let index: number = 0; index < FILES; index += 1) {
        writeFileSync(join(root, 'src', `file-${index}.txt`), text);
      }
    },
    run: async (): Promise<number> => type(undefined),
    note,
  },
  {
    name: 'each keystroke replaces the last',
    run: async (): Promise<number> => type('bench'),
    note,
    teardown: (): void => {
      rmSync(root, { recursive: true, force: true });
    },
  },
];
