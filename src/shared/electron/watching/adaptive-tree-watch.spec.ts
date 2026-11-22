import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { MetadataPolicies } from '../directory-watch-filter';
import { AdaptiveTreeWatch } from './adaptive-tree-watch';
import { WatchModes } from './watch-modes';

/**
 * Describes one event the watch reported.
 */
interface Reported {
  readonly eventType: string;
  readonly filename: string | null;
}

/**
 * Waits for the polls (at the shortest interval offered) to see a change.
 * @param milliseconds How long to wait.
 * @returns Returns a promise that resolves after the wait.
 */
function settle(milliseconds: number = 2500): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, milliseconds);
  });
}

/**
 * Waits until a condition holds, or a time limit passes.
 * @param condition The condition.
 * @returns Returns a promise that resolves once it holds or the limit passes.
 */
async function until(condition: () => boolean): Promise<void> {
  for (let waited: number = 0; waited < 3000 && !condition(); waited += 20) {
    await settle(20);
  }
}

describe('AdaptiveTreeWatch', () => {
  let scratch: string;
  let share: string;
  let modes: WatchModes;
  let watch: AdaptiveTreeWatch | undefined;
  let reported: Reported[];

  beforeEach(() => {
    scratch = realpathSync(mkdtempSync(path.join(tmpdir(), 'studio-adaptive-')));
    share = path.join(scratch, 'share');
    mkdirSync(path.join(share, 'site'), { recursive: true });
    modes = new WatchModes((): MetadataPolicies => new Map<string, readonly string[]>(), false);
    reported = [];
    watch = undefined;
  });

  afterEach(() => {
    watch?.close();
    rmSync(scratch, { recursive: true, force: true });
  });

  /**
   * Starts watching a folder, recording what is reported.
   * @param root The folder.
   */
  function start(root: string): void {
    watch = new AdaptiveTreeWatch(
      root,
      { recursive: true, modes },
      (eventType: string, filename: string | null): void => {
        reported.push({ eventType, filename });
      },
      (): void => undefined,
    );
  }

  it('watchesNatively_whenNoFolderIsPolled', () => {
    start(path.join(share, 'site'));

    expect(watch?.polling).toBe(false);
  });

  it('watchesNatively_aRootOutsideEveryPolledFolder', async () => {
    await modes.update([path.join(scratch, 'elsewhere')], 1);

    start(path.join(share, 'site'));
    await settle(50);

    expect(watch?.polling).toBe(false);
  });

  it('polls_aRootInsideAPolledFolder_andReportsAChangeMadeOutsideStudio', async () => {
    await modes.update([`${share}/`], 1);
    start(path.join(share, 'site'));
    await settle(200);

    writeFileSync(path.join(share, 'site', 'index.html'), '<p>new</p>');
    await until((): boolean => reported.some((event: Reported) => event.filename === 'index.html'));

    expect(watch?.polling).toBe(true);
    expect(reported).toContainEqual({ eventType: 'rename', filename: 'index.html' });
  });

  it('polls_aRootReachedThroughALinkIntoAPolledFolder', async () => {
    symlinkSync(path.join(share, 'site'), path.join(scratch, 'link'));
    await modes.update([share], 1);

    start(path.join(scratch, 'link'));
    await until((): boolean => watch?.polling === true);

    expect(watch?.polling).toBe(true);
  });

  it('switchesToPolling_whenItsFolderIsAdded_andSaysToLookAgain', async () => {
    start(path.join(share, 'site'));

    await modes.update([share], 1);
    await until((): boolean => watch?.polling === true);

    expect(watch?.polling).toBe(true);
    expect(reported).toContainEqual({ eventType: 'rename', filename: null });
  });

  it('switchesBackToNative_whenItsFolderIsRemoved', async () => {
    await modes.update([share], 1);
    start(path.join(share, 'site'));

    await modes.update([], 1);
    await until((): boolean => watch?.polling === false);

    expect(watch?.polling).toBe(false);
  });

  it('reportsNothingAfterClosing', async () => {
    await modes.update([share], 1);
    start(path.join(share, 'site'));
    await settle(200);

    watch?.close();
    writeFileSync(path.join(share, 'site', 'late.html'), 'x');
    await settle(1500);

    expect(reported).toEqual([]);
  });
});
