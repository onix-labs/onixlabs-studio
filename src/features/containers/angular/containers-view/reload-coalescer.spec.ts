import { ReloadCoalescer } from './reload-coalescer';

/**
 * Waits for the given milliseconds of real time.
 * @param ms The milliseconds.
 * @returns Returns a promise that resolves afterwards.
 */
function wait(ms: number): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, ms);
  });
}

describe('ReloadCoalescer', () => {
  it('foldsABurstOfRequestsIntoOneReload', async () => {
    let reloads: number = 0;
    const coalescer: ReloadCoalescer = new ReloadCoalescer((): Promise<void> => {
      reloads += 1;
      return Promise.resolve();
    }, 20);

    for (let i: number = 0; i < 25; i++) {
      coalescer.request();
      await wait(2);
    }
    expect(reloads).toBe(0);
    await wait(40);

    expect(reloads).toBe(1);
  });

  it('runsOneMoreReload_whenARequestArrivesWhileOneIsRunning', async () => {
    let reloads: number = 0;
    let release: () => void = (): void => undefined;
    const coalescer: ReloadCoalescer = new ReloadCoalescer((): Promise<void> => {
      reloads += 1;
      return new Promise<void>((resolve: () => void): void => {
        release = resolve;
      });
    }, 5);

    coalescer.request();
    await wait(15);
    expect(reloads).toBe(1);
    // Events keep arriving while the first reload is still fetching.
    coalescer.request();
    coalescer.request();
    await wait(15);
    expect(reloads).toBe(1);

    release();
    await wait(5);
    expect(reloads).toBe(2);
    release();
    await wait(5);
    expect(reloads).toBe(2);
  });

  it('cancel_dropsAPendingRequest', async () => {
    let reloads: number = 0;
    const coalescer: ReloadCoalescer = new ReloadCoalescer((): Promise<void> => {
      reloads += 1;
      return Promise.resolve();
    }, 5);

    coalescer.request();
    coalescer.cancel();
    await wait(15);

    expect(reloads).toBe(0);
  });
});
