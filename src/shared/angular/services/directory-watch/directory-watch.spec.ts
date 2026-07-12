import { TestBed } from '@angular/core/testing';

import { Bridge } from '@shared/api/bridge';
import { DirectoryChangeEvent, FileChannel } from '@shared/api/file-channels';
import { DirectoryWatch } from './directory-watch';

describe('DirectoryWatch', () => {
  let directoryWatch: DirectoryWatch;
  let watched: string[];
  let unwatched: string[];
  let fireChange: (event: DirectoryChangeEvent) => void;

  beforeEach(() => {
    watched = [];
    unwatched = [];
    const bridge: Bridge = {
      invoke: <T>(channel: string, ...args: unknown[]): Promise<T> => {
        if (channel === (FileChannel.WatchDirectory as string)) {
          watched.push(args[0] as string);
        } else if (channel === (FileChannel.UnwatchDirectory as string)) {
          unwatched.push(args[0] as string);
        }
        return Promise.resolve(undefined as T);
      },
      send: (): void => undefined,
      on: (channel: string, listener: (...args: unknown[]) => void): (() => void) => {
        if (channel === (FileChannel.DirectoryChanged as string)) {
          fireChange = (event: DirectoryChangeEvent): void => listener(event);
        }
        return (): void => undefined;
      },
    };
    (globalThis as unknown as { bridge: Bridge }).bridge = bridge;

    TestBed.configureTestingModule({});
    directoryWatch = TestBed.inject(DirectoryWatch);
  });

  afterEach(() => {
    delete (globalThis as unknown as { bridge?: unknown }).bridge;
  });

  it('watch_whenFirstSubscriberForRoot_bridgesToTheMainWatcher', () => {
    directoryWatch.watch('/ws', (): void => undefined);

    expect(watched).toEqual(['/ws']);
  });

  it('watch_whenSecondSubscriberForSameRoot_doesNotBridgeAgain', () => {
    directoryWatch.watch('/ws', (): void => undefined);
    directoryWatch.watch('/ws', (): void => undefined);

    expect(watched).toEqual(['/ws']);
  });

  it('watch_whenEntriesChangeUnderTheRoot_notifiesItsSubscribers', () => {
    let received: DirectoryChangeEvent | undefined;
    directoryWatch.watch('/ws', (event: DirectoryChangeEvent): void => {
      received = event;
    });

    const change: DirectoryChangeEvent = { root: '/ws', directories: ['/ws/src'], overflow: false };
    fireChange(change);

    expect(received).toEqual(change);
  });

  it('watch_whenEntriesChangeUnderAnotherRoot_doesNotNotify', () => {
    let notified: boolean = false;
    directoryWatch.watch('/ws', (): void => {
      notified = true;
    });

    fireChange({ root: '/other', directories: ['/other/src'], overflow: false });

    expect(notified).toBe(false);
  });

  it('dispose_whenLastSubscriberRemoved_stopsWatchingTheRoot', () => {
    const dispose: () => void = directoryWatch.watch('/ws', (): void => undefined);

    dispose();

    expect(unwatched).toEqual(['/ws']);
  });

  it('dispose_whenOtherSubscribersRemain_keepsWatchingTheRoot', () => {
    const dispose: () => void = directoryWatch.watch('/ws', (): void => undefined);
    directoryWatch.watch('/ws', (): void => undefined);

    dispose();

    expect(unwatched).toEqual([]);
  });
});
