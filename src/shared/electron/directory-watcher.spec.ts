import type { FSWatcher } from 'node:fs';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileChannel } from '@shared/api/file-channels';
import type { DirectoryChangeEvent } from '@shared/api/file-channels';
import type { BrowserWindow, WebContents } from 'electron';

/**
 * Describes an IPC handler as the fake `ipcMain` captures it.
 */
type Handler = (event: unknown, ...args: unknown[]) => unknown;

/**
 * Describes the listener `fs.watch` was given.
 */
type WatchListener = (eventType: string, filename: string | Buffer | null) => void;

/**
 * Describes a watcher the wrapped `fs.watch` opened.
 */
interface OpenedWatch {
  root: string;
  watcher: FSWatcher;
  listener: WatchListener;
}

/**
 * Holds the IPC handlers and the watchers opened, and the error the next watch throws.
 */
const fakes: {
  handlers: Map<string, Handler>;
  watches: OpenedWatch[];
  watchError: Error | undefined;
  realEvents: boolean;
} = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  watches: [],
  watchError: undefined,
  realEvents: false,
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler): void => void fakes.handlers.set(channel, handler),
  },
}));

// A real recursive watcher on a real directory with its listener captured, so a test can drive an
// exact burst or raise an error the operating system will not produce on request. What the operating
// system reports reaches the listener only when a test asks for it: a stray event for the fresh
// directory would otherwise land in a burst counted to the exact cap.
vi.mock('node:fs', async (importOriginal: () => Promise<typeof fs>) => {
  const real: typeof fs = await importOriginal();
  const watch: (root: string, options: fs.WatchOptions, listener: WatchListener) => FSWatcher = (
    root: string,
    options: fs.WatchOptions,
    listener: WatchListener,
  ): FSWatcher => {
    if (fakes.watchError !== undefined) {
      throw fakes.watchError;
    }
    const watcher: FSWatcher = real.watch(root, options, (eventType, filename): void => {
      if (fakes.realEvents) {
        listener(eventType, filename);
      }
    });
    fakes.watches.push({ root, watcher, listener });
    return watcher;
  };
  return Object.assign({}, real, { watch, default: Object.assign({}, real, { watch }) });
});

const { DirectoryWatcher } = await import('./directory-watcher');

/**
 * Stands in for a renderer's web contents: an id, and a way to fire its destruction.
 */
class FakeSender {
  public readonly listeners: (() => void)[] = [];

  public constructor(public readonly id: number) {}

  public once(_event: string, listener: () => void): void {
    this.listeners.push(listener);
  }

  public destroy(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

describe('DirectoryWatcher', () => {
  let root: string;
  let manager: InstanceType<typeof DirectoryWatcher>;
  let sent: DirectoryChangeEvent[];
  let windowOpen: boolean;
  let sender: FakeSender;

  /**
   * Starts watching a root as a renderer would.
   * @param target The root.
   * @param from The renderer asking.
   * @returns Returns a promise resolving when it has run.
   */
  async function watch(target: unknown = root, from: FakeSender = sender): Promise<void> {
    await fakes.handlers.get(FileChannel.WatchDirectory)?.(
      { sender: from as unknown as WebContents },
      target,
    );
  }

  /**
   * Stops watching a root as a renderer would.
   * @param target The root.
   * @param from The renderer asking.
   * @returns Returns a promise resolving when it has run.
   */
  async function unwatch(target: unknown = root, from: FakeSender = sender): Promise<void> {
    await fakes.handlers.get(FileChannel.UnwatchDirectory)?.(
      { sender: from as unknown as WebContents },
      target,
    );
  }

  /**
   * Fires the native listener of the most recent watch.
   * @param filename The path reported, relative to the root.
   */
  function nativeEvent(filename: string | Buffer | null): void {
    fakes.watches.at(-1)?.listener('rename', filename);
  }

  beforeEach(() => {
    fakes.realEvents = false;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'directory-watcher-')));
    fakes.handlers.clear();
    fakes.watches = [];
    fakes.watchError = undefined;
    sent = [];
    windowOpen = true;
    sender = new FakeSender(1);
    manager = new DirectoryWatcher(
      (): BrowserWindow | null =>
        windowOpen
          ? ({
              isDestroyed: (): boolean => false,
              webContents: {
                send: (_channel: unknown, event: DirectoryChangeEvent): void =>
                  void sent.push(event),
              },
            } as unknown as BrowserWindow)
          : null,
      (): ReadonlyMap<string, readonly string[]> =>
        new Map<string, readonly string[]>([['.git', ['HEAD']]]),
    );
    manager.register();
  });

  afterEach(() => {
    manager.disposeAll();
    vi.useRealTimers();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('events_coalesceIntoOneNotification_perChangedDirectory', async () => {
    await watch();

    nativeEvent('src/a.ts');
    nativeEvent('src/b.ts');
    nativeEvent('docs/c.md');
    nativeEvent('top.txt');
    await vi.advanceTimersByTimeAsync(200);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ root, overflow: false });
    expect([...(sent[0]?.directories ?? [])].sort()).toEqual(
      [root, path.join(root, 'docs'), path.join(root, 'src')].sort(),
    );
  });

  it('events_aContinuousBurst_stillNotifiesAtTheCadence', async () => {
    await watch();

    for (let tick: number = 0; tick < 10; tick += 1) {
      nativeEvent(`dir${tick}/a`);
      await vi.advanceTimersByTimeAsync(50);
    }

    expect(sent).toHaveLength(2);
  });

  it('events_atExactlyTheCap_stillListTheDirectories', async () => {
    await watch();

    for (let index: number = 0; index < 512; index += 1) {
      nativeEvent(`dir${index}/a`);
    }
    await vi.advanceTimersByTimeAsync(200);

    expect(sent[0]?.overflow).toBe(false);
    expect(sent[0]?.directories).toHaveLength(512);
  });

  it('events_oneOverTheCap_collapseIntoAnOverflow', async () => {
    await watch();

    for (let index: number = 0; index < 600; index += 1) {
      nativeEvent(`dir${index}/a`);
    }
    await vi.advanceTimersByTimeAsync(200);

    expect(sent).toEqual([{ root, directories: [], overflow: true }]);
  });

  it('overflow_isForgottenByTheNextWindow', async () => {
    await watch();
    nativeEvent(null);
    await vi.advanceTimersByTimeAsync(200);

    nativeEvent('src/a.ts');
    await vi.advanceTimersByTimeAsync(200);

    expect(sent[1]).toMatchObject({ overflow: false, directories: [path.join(root, 'src')] });
  });

  it.each([[null], [''], [Buffer.from('x')]])(
    'event_withItsPathWithheld_reportsAnOverflow %#',
    async (filename: string | Buffer | null) => {
      await watch();

      nativeEvent(filename);
      await vi.advanceTimersByTimeAsync(200);

      expect(sent).toEqual([{ root, directories: [], overflow: true }]);
    },
  );

  it.each([['node_modules/x/index.js'], ['.git/objects/ab/cd'], ['obj/Debug/a.dll']])(
    'churn %s_opensNoWindow',
    async (filename: string) => {
      await watch();

      nativeEvent(filename);
      await vi.advanceTimersByTimeAsync(1000);

      expect(sent).toEqual([]);
    },
  );

  it('churn_neverCountsTowardTheCap', async () => {
    await watch();

    for (let index: number = 0; index < 1000; index += 1) {
      nativeEvent(`node_modules/p${index}/index.js`);
    }
    nativeEvent('src/a.ts');
    await vi.advanceTimersByTimeAsync(200);

    expect(sent).toEqual([{ root, directories: [path.join(root, 'src')], overflow: false }]);
  });

  it('metadata_namedByAVersionControlPlugin_isForwarded', async () => {
    await watch();

    nativeEvent('.git/HEAD');
    await vi.advanceTimersByTimeAsync(200);

    expect(sent).toHaveLength(1);
  });

  it.each([[null], [7], [{}]])('watch_withANonString_opensNothing %#', async (target: unknown) => {
    await watch(target);
    await unwatch(target);

    expect(fakes.watches).toEqual([]);
  });

  it('watch_ofARootThatDoesNotExist_doesNotThrow', async () => {
    await expect(watch(path.join(root, 'gone'))).resolves.toBeUndefined();
  });

  it('watch_thatFails_isRetriedNextTime', async () => {
    fakes.watchError = new Error('ENOSPC: inotify limit');
    await watch();

    fakes.watchError = undefined;
    await watch();

    expect(fakes.watches).toHaveLength(1);
  });

  it('watch_twice_sharesOneWatcher_untilBothRelease', async () => {
    await watch();
    await watch();
    const opened: OpenedWatch | undefined = fakes.watches[0];
    const closed: unknown = vi.spyOn(opened?.watcher, 'close');

    await unwatch();
    expect(closed).not.toHaveBeenCalled();

    await unwatch();
    expect(closed).toHaveBeenCalledOnce();
    expect(fakes.watches).toHaveLength(1);
  });

  it('unwatch_ofAnotherRenderersHold_releasesNothing', async () => {
    await watch();
    const closed: unknown = vi.spyOn(fakes.watches[0]?.watcher, 'close');

    await unwatch(root, new FakeSender(2));

    expect(closed).not.toHaveBeenCalled();
  });

  it('unwatch_ofARootNeverWatched_isANoOp', async () => {
    await expect(unwatch('/never/watched')).resolves.toBeUndefined();
  });

  it('unwatch_duringACoalescingWindow_sendsNothingLate', async () => {
    await watch();
    nativeEvent('src/a.ts');

    await unwatch();
    await vi.advanceTimersByTimeAsync(1000);

    expect(sent).toEqual([]);
  });

  it('rendererDestroyed_releasesOnlyItsOwnHolds', async () => {
    const other: FakeSender = new FakeSender(2);
    const second: string = path.join(root, 'second');
    fs.mkdirSync(second);
    await watch();
    await watch(root);
    await watch(root, other);
    await watch(second);
    const shared: unknown = vi.spyOn(fakes.watches[0]?.watcher, 'close');
    const own: unknown = vi.spyOn(fakes.watches[1]?.watcher, 'close');

    sender.destroy();

    expect(shared).not.toHaveBeenCalled();
    expect(own).toHaveBeenCalledOnce();
  });

  it('rendererDestroyed_withItsLastHold_dropsThePendingWindow', async () => {
    await watch();
    nativeEvent('src/a.ts');

    sender.destroy();
    await vi.advanceTimersByTimeAsync(1000);

    expect(sent).toEqual([]);
  });

  it('renderer_observesDestructionOnce_howeverManyRootsItWatches', async () => {
    const second: string = path.join(root, 'second');
    fs.mkdirSync(second);

    await watch();
    await watch(second);

    expect(sender.listeners).toHaveLength(1);
  });

  it('renderer_reloadedAfterDestruction_isObservedAgain', async () => {
    await watch();
    sender.destroy();

    await watch();

    expect(sender.listeners).toHaveLength(2);
  });

  it('watcherError_reportsAnOverflow_andDropsTheDeadWatcher', async () => {
    await watch();
    const opened: OpenedWatch | undefined = fakes.watches[0];
    const closed: unknown = vi.spyOn(opened?.watcher, 'close');

    opened?.watcher.emit('error', new Error('root vanished'));
    await vi.advanceTimersByTimeAsync(200);

    expect(closed).toHaveBeenCalledOnce();
    expect(sent).toEqual([{ root, directories: [], overflow: true }]);
  });

  it('watcherError_letsTheRootBeWatchedAgain', async () => {
    await watch();
    fakes.watches[0]?.watcher.emit('error', new Error('root vanished'));

    await watch();

    expect(fakes.watches).toHaveLength(2);
  });

  it('disposeAll_duringABurst_sendsNothingLate', async () => {
    await watch();
    nativeEvent('src/a.ts');

    manager.disposeAll();
    await vi.advanceTimersByTimeAsync(1000);

    expect(sent).toEqual([]);
  });

  it('disposeAll_letsARendererBeObservedAfresh', async () => {
    await watch();

    manager.disposeAll();
    await watch();

    expect(sender.listeners).toHaveLength(2);
  });

  it('notification_withTheWindowGone_isDropped', async () => {
    await watch();
    nativeEvent('src/a.ts');
    windowOpen = false;

    await vi.advanceTimersByTimeAsync(200);

    expect(sent).toEqual([]);
  });

  it('realFileSystem_aFileCreatedUnderTheRoot_reachesTheRenderer', async () => {
    vi.useRealTimers();
    fakes.realEvents = true;
    await watch();

    await new Promise<void>((resolve: () => void): void => void setTimeout(resolve, 100));
    fs.mkdirSync(path.join(root, 'made'));
    fs.writeFileSync(path.join(root, 'made', 'a.txt'), 'hello');

    await vi.waitFor(
      (): void => {
        expect(sent.length).toBeGreaterThan(0);
      },
      { timeout: 4000, interval: 50 },
    );
  });
});
