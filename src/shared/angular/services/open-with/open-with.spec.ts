import { TestBed } from '@angular/core/testing';
import { AppChannel } from '@shared/api/app-channels';
import { Bridge } from '@shared/api/bridge';
import { FileOpener } from '@shared/angular/services/file-opener/file-opener';
import { OpenWith } from './open-with';

/**
 * A fake transport that records the take-pending invoke and lets the test push open-path messages
 * through the captured listener.
 */
class FakeBridge implements Bridge {
  public pending: unknown = [];
  public invoked: string[] = [];
  private openListener: ((...args: unknown[]) => void) | null = null;

  public invoke<T>(channel: string): Promise<T> {
    this.invoked.push(channel);
    if (channel === (AppChannel.TakePendingOpenPaths as string)) {
      return Promise.resolve(this.pending as T);
    }
    return Promise.resolve(null as T);
  }

  public send(): void {
    // Nothing sends in these tests.
  }

  public on(channel: string, listener: (...args: unknown[]) => void): () => void {
    if (channel === (AppChannel.OpenPath as string)) {
      this.openListener = listener;
      return (): void => {
        this.openListener = null;
      };
    }
    return (): void => undefined;
  }

  public pushOpenPath(path: unknown): void {
    this.openListener?.(path);
  }

  public get subscribed(): boolean {
    return this.openListener !== null;
  }
}

/**
 * Resolves pending microtasks so the constructor's drain settles.
 * @returns Returns a promise that resolves on the next macrotask.
 */
function flush(): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 0);
  });
}

describe('OpenWith', () => {
  let bridge: FakeBridge;
  let reopened: string[];

  beforeEach(() => {
    bridge = new FakeBridge();
    reopened = [];
    (window as unknown as { bridge: Bridge }).bridge = bridge;
    TestBed.configureTestingModule({
      providers: [
        {
          provide: FileOpener,
          useValue: {
            reopenFile: (path: string): Promise<boolean> => {
              reopened.push(path);
              return Promise.resolve(true);
            },
          },
        },
      ],
    });
  });

  afterEach(() => {
    delete (window as unknown as { bridge?: unknown }).bridge;
  });

  it('startup_drainsThePendingPathsAndOpensEach', async () => {
    bridge.pending = ['/tmp/a.md', '/tmp/b.cs'];
    TestBed.inject(OpenWith);
    await flush();

    expect(bridge.invoked).toContain(AppChannel.TakePendingOpenPaths);
    expect(reopened).toEqual(['/tmp/a.md', '/tmp/b.cs']);
  });

  it('pushedPath_afterStartup_opensTheFile', async () => {
    TestBed.inject(OpenWith);
    await flush();

    bridge.pushOpenPath('/tmp/pushed.ts');

    expect(reopened).toEqual(['/tmp/pushed.ts']);
  });

  it('subscribesBeforeDraining_soNoPushCanBeMissed', () => {
    // The subscription must exist synchronously at construction, before the async drain settles.
    TestBed.inject(OpenWith);

    expect(bridge.subscribed).toBe(true);
  });

  it('malformedPayloads_areIgnored', async () => {
    bridge.pending = [42, null, '', { path: '/tmp/x' }];
    TestBed.inject(OpenWith);
    await flush();

    bridge.pushOpenPath(123);
    bridge.pushOpenPath(undefined);

    expect(reopened).toEqual([]);
  });

  it('ngOnDestroy_unsubscribes', async () => {
    const service: OpenWith = TestBed.inject(OpenWith);
    await flush();

    service.ngOnDestroy();
    bridge.pushOpenPath('/tmp/late.ts');

    expect(reopened).toEqual([]);
    expect(bridge.subscribed).toBe(false);
  });

  it('withoutABridge_isANoOp', () => {
    delete (window as unknown as { bridge?: unknown }).bridge;

    expect((): OpenWith => TestBed.inject(OpenWith)).not.toThrow();
    expect(bridge.invoked).toEqual([]);
  });
});
