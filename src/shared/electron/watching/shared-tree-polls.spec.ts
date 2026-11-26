import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { SharedTreePolls } from './shared-tree-polls';
import type { TreeWatch } from './tree-watch';

/**
 * Waits for a few polls to pass.
 * @returns Returns a promise that resolves after the wait.
 */
function settle(): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 200);
  });
}

describe('SharedTreePolls', () => {
  let root: string;
  let polls: SharedTreePolls;
  let holds: TreeWatch[];

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'studio-shared-poll-'));
    mkdirSync(path.join(root, 'obj'));
    polls = new SharedTreePolls();
    holds = [];
  });

  afterEach(() => {
    for (const hold of holds) {
      hold.close();
    }
    rmSync(root, { recursive: true, force: true });
  });

  /**
   * Joins the poll of the temp root, collecting what this consumer hears.
   * @param heard Where the changed paths go.
   * @param descend Which directories the consumer wants read.
   * @param intervalMs The interval.
   */
  function join(
    heard: (string | null)[],
    descend: (relative: string) => boolean,
    intervalMs: number = 40,
  ): void {
    holds.push(
      polls.subscribe(
        root,
        intervalMs,
        true,
        descend,
        (_eventType: string, filename: string | null): void => {
          heard.push(filename);
        },
        (): void => undefined,
      ),
    );
  }

  it('runsOnePoll_forEveryConsumerOfAFolder', () => {
    join([], (): boolean => true);
    join([], (): boolean => true);

    expect(polls.size).toBe(1);
  });

  it('runsSeparatePolls_atDifferentIntervals', () => {
    join([], (): boolean => true, 40);
    join([], (): boolean => true, 80);

    expect(polls.size).toBe(2);
  });

  it('tellsEachConsumerOnlyOfTheFoldersItWantsRead', async () => {
    const explorer: (string | null)[] = [];
    const server: (string | null)[] = [];
    join(explorer, (relative: string): boolean => relative !== 'obj');
    join(server, (): boolean => true);
    await settle();

    writeFileSync(path.join(root, 'obj', 'project.assets.json'), '{}');
    writeFileSync(path.join(root, 'Program.cs'), 'x');
    await settle();

    expect(explorer).toEqual(['Program.cs']);
    expect(server.sort()).toEqual([path.join('obj', 'project.assets.json'), 'Program.cs'].sort());
  });

  it('stopsThePoll_whenTheLastConsumerLeaves', () => {
    join([], (): boolean => true);
    join([], (): boolean => true);

    holds[0].close();
    expect(polls.size).toBe(1);
    holds[1].close();
    expect(polls.size).toBe(0);
  });
});
