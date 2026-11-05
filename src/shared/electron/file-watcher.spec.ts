import type { FSWatcher } from 'node:fs';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileChannel } from '@shared/api/file-channels';
import type { BrowserWindow } from 'electron';

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
  directory: string;
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
} = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  watches: [],
  watchError: undefined,
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler): void => void fakes.handlers.set(channel, handler),
  },
}));

// A real watcher on a real directory, but its listener is captured: a test can then drive a precise
// burst, or raise an error, which the operating system will not do on request.
vi.mock('node:fs', async (importOriginal: () => Promise<typeof fs>) => {
  const real: typeof fs = await importOriginal();
  const watch: (directory: string, listener: WatchListener) => FSWatcher = (
    directory: string,
    listener: WatchListener,
  ): FSWatcher => {
    if (fakes.watchError !== undefined) {
      throw fakes.watchError;
    }
    const watcher: FSWatcher = real.watch(directory, listener);
    fakes.watches.push({ directory, watcher, listener });
    return watcher;
  };
  return Object.assign({}, real, { watch, default: Object.assign({}, real, { watch }) });
});

const { FileWatcher } = await import('./file-watcher');

describe('FileWatcher', () => {
  let directory: string;
  let file: string;
  let manager: InstanceType<typeof FileWatcher>;
  let sent: (readonly [unknown, unknown])[];
  let windowOpen: boolean;

  /**
   * Fires a captured IPC handler.
   * @param channel The channel.
   * @param target The renderer-supplied path.
   * @returns Returns a promise resolving when it has run.
   */
  async function invoke(channel: string, target: unknown): Promise<void> {
    await fakes.handlers.get(channel)?.({}, target);
  }

  /**
   * Fires the native listener of the most recent watch, as the operating system would.
   * @param filename The name reported.
   */
  function nativeEvent(filename: string | Buffer | null): void {
    fakes.watches.at(-1)?.listener('change', filename);
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'file-watcher-')));
    file = path.join(directory, 'a.txt');
    fs.writeFileSync(file, 'hello');
    fakes.handlers.clear();
    fakes.watches = [];
    fakes.watchError = undefined;
    sent = [];
    windowOpen = true;
    manager = new FileWatcher((): BrowserWindow | null =>
      windowOpen
        ? ({
            isDestroyed: (): boolean => false,
            webContents: {
              send: (channel: unknown, target: unknown): void => void sent.push([channel, target]),
            },
          } as unknown as BrowserWindow)
        : null,
    );
    manager.register();
  });

  afterEach(() => {
    manager.disposeAll();
    vi.useRealTimers();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('change_ofAWatchedFile_notifiesOnceAfterTheDebounce', async () => {
    await invoke(FileChannel.Watch, file);

    nativeEvent('a.txt');
    nativeEvent('a.txt');
    await vi.advanceTimersByTimeAsync(119);
    nativeEvent('a.txt');
    await vi.advanceTimersByTimeAsync(119);

    expect(sent).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);

    expect(sent).toEqual([[FileChannel.Changed, file]]);
  });

  it('change_ofAnUnwatchedSibling_isIgnored', async () => {
    await invoke(FileChannel.Watch, file);

    nativeEvent('other.txt');
    await vi.advanceTimersByTimeAsync(500);

    expect(sent).toEqual([]);
  });

  it.each([[null], [Buffer.from('a.txt')]])(
    'event_withoutAStringName_isIgnored %#',
    async (filename: string | Buffer | null) => {
      await invoke(FileChannel.Watch, file);

      nativeEvent(filename);
      await vi.advanceTimersByTimeAsync(500);

      expect(sent).toEqual([]);
    },
  );

  it('removal_ofAWatchedFile_reportsRemoved', async () => {
    await invoke(FileChannel.Watch, file);
    fs.rmSync(file);

    nativeEvent('a.txt');
    await vi.advanceTimersByTimeAsync(120);

    expect(sent).toEqual([[FileChannel.Removed, file]]);
  });

  it('writeTempThenRename_withinTheDebounce_reportsChanged', async () => {
    await invoke(FileChannel.Watch, file);

    fs.rmSync(file);
    nativeEvent('a.txt');
    fs.writeFileSync(file, 'new');
    nativeEvent('a.txt');
    await vi.advanceTimersByTimeAsync(120);

    expect(sent).toEqual([[FileChannel.Changed, file]]);
  });

  it('twoFilesInOneDirectory_shareAWatcher_andDebounceApart', async () => {
    const second: string = path.join(directory, 'b.txt');
    await invoke(FileChannel.Watch, file);
    await invoke(FileChannel.Watch, second);

    nativeEvent('a.txt');
    fs.writeFileSync(second, '');
    nativeEvent('b.txt');
    await vi.advanceTimersByTimeAsync(120);

    expect(fakes.watches).toHaveLength(1);
    expect(sent).toHaveLength(2);
  });

  it('watch_isReferenceCounted', async () => {
    await invoke(FileChannel.Watch, file);
    await invoke(FileChannel.Watch, file);

    await invoke(FileChannel.Unwatch, file);
    nativeEvent('a.txt');
    await vi.advanceTimersByTimeAsync(120);

    expect(sent).toHaveLength(1);
  });

  it('unwatch_ofTheLastFile_closesTheWatcher', async () => {
    await invoke(FileChannel.Watch, file);
    const close: unknown = vi.spyOn(fakes.watches[0]?.watcher, 'close');

    await invoke(FileChannel.Unwatch, file);

    expect(close).toHaveBeenCalledOnce();
  });

  it('unwatch_duringADebounce_sendsNothingLate', async () => {
    await invoke(FileChannel.Watch, file);
    nativeEvent('a.txt');

    await invoke(FileChannel.Unwatch, file);
    await vi.advanceTimersByTimeAsync(500);

    expect(sent).toEqual([]);
  });

  it('unwatch_ofSomethingNeverWatched_changesNothing', async () => {
    await invoke(FileChannel.Watch, file);

    await invoke(FileChannel.Unwatch, path.join(directory, 'other.txt'));
    await invoke(FileChannel.Unwatch, '/never/watched');
    nativeEvent('a.txt');
    await vi.advanceTimersByTimeAsync(120);

    expect(sent).toHaveLength(1);
  });

  it.each([[undefined], [null], [7], [{}]])(
    'watchAndUnwatch_withANonString_doNothing %#',
    async (target: unknown) => {
      await invoke(FileChannel.Watch, target);
      await invoke(FileChannel.Unwatch, target);

      expect(fakes.watches).toEqual([]);
    },
  );

  it('watch_inADirectoryThatDoesNotExist_doesNotThrow', async () => {
    await expect(
      invoke(FileChannel.Watch, path.join(directory, 'gone', 'a.txt')),
    ).resolves.toBeUndefined();
  });

  it('watch_thatFails_isRetriedNextTime', async () => {
    fakes.watchError = new Error('EMFILE');
    await invoke(FileChannel.Watch, file);

    fakes.watchError = undefined;
    await invoke(FileChannel.Watch, file);

    expect(fakes.watches).toHaveLength(1);
  });

  it('disposeAll_duringABurst_sendsNothingLate', async () => {
    await invoke(FileChannel.Watch, file);
    nativeEvent('a.txt');

    manager.disposeAll();
    await vi.advanceTimersByTimeAsync(500);

    expect(sent).toEqual([]);
  });

  it('notification_withTheWindowGone_isDropped', async () => {
    await invoke(FileChannel.Watch, file);
    nativeEvent('a.txt');
    windowOpen = false;

    await vi.advanceTimersByTimeAsync(120);

    expect(sent).toEqual([]);
  });
});
