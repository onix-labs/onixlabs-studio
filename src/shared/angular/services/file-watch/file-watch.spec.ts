import { TestBed } from '@angular/core/testing';

import { FileApi, FileInfo } from '@shared/studio-api';
import { FileSystem } from '../file-system/file-system';
import { FileWatch } from './file-watch';

/**
 * The file the stubbed file-system re-reads when a watched path changes.
 */
const REREAD: FileInfo = {
  path: '/ws/main.ts',
  name: 'main.ts',
  extension: '.ts',
  content: 'reloaded',
};

describe('FileWatch', () => {
  let fileWatch: FileWatch;
  let watched: string[];
  let unwatched: string[];
  let fireChange: (path: string) => void;

  /**
   * Flushes pending microtasks so the asynchronous re-read settles.
   * @returns Returns a promise that resolves after the current task queue drains.
   */
  function flush(): Promise<void> {
    return new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
  }

  beforeEach(() => {
    watched = [];
    unwatched = [];
    const fileApi: FileApi = {
      watch: (path: string): Promise<void> => {
        watched.push(path);
        return Promise.resolve();
      },
      unwatch: (path: string): Promise<void> => {
        unwatched.push(path);
        return Promise.resolve();
      },
      onChanged: (listener: (path: string) => void): (() => void) => {
        fireChange = listener;
        return (): void => undefined;
      },
    } as unknown as FileApi;
    (globalThis as unknown as { studio: { file: FileApi } }).studio = { file: fileApi };

    TestBed.configureTestingModule({
      providers: [
        {
          provide: FileSystem,
          useValue: {
            read: (): Promise<FileInfo> => Promise.resolve(REREAD),
          } as unknown as FileSystem,
        },
      ],
    });
    fileWatch = TestBed.inject(FileWatch);
  });

  afterEach(() => {
    delete (globalThis as unknown as { studio?: unknown }).studio;
  });

  it('watch_whenFirstSubscriberForPath_bridgesToTheMainWatcher', () => {
    fileWatch.watch('/ws/main.ts', (): void => undefined);

    expect(watched).toEqual(['/ws/main.ts']);
  });

  it('watch_whenSecondSubscriberForSamePath_doesNotBridgeAgain', () => {
    fileWatch.watch('/ws/main.ts', (): void => undefined);
    fileWatch.watch('/ws/main.ts', (): void => undefined);

    expect(watched).toEqual(['/ws/main.ts']);
  });

  it('watch_whenFileChanges_notifiesSubscriberWithTheRereadFile', async () => {
    let received: FileInfo | undefined;
    fileWatch.watch('/ws/main.ts', (info: FileInfo): void => {
      received = info;
    });

    fireChange('/ws/main.ts');
    await flush();

    expect(received).toEqual(REREAD);
  });

  it('dispose_whenLastSubscriberRemoved_stopsWatchingThePath', () => {
    const dispose: () => void = fileWatch.watch('/ws/main.ts', (): void => undefined);

    dispose();

    expect(unwatched).toEqual(['/ws/main.ts']);
  });

  it('dispose_whenOtherSubscribersRemain_keepsWatchingThePath', () => {
    const dispose: () => void = fileWatch.watch('/ws/main.ts', (): void => undefined);
    fileWatch.watch('/ws/main.ts', (): void => undefined);

    dispose();

    expect(unwatched).toEqual([]);
  });
});
