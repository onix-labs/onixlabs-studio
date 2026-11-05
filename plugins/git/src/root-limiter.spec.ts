import { describe, expect, it } from 'vitest';
import { RootLimiter } from './root-limiter';

/**
 * A task finished from outside, so a test decides the order things end in.
 */
class Gate {
  /**
   * Holds the function that finishes the task.
   */
  public open: () => void = (): void => undefined;

  /**
   * Holds the promise the task waits on.
   */
  public readonly closed: Promise<void> = new Promise<void>((resolve: () => void): void => {
    this.open = resolve;
  });
}

/**
 * Lets everything already able to run do so.
 * @returns Returns a promise that resolves once it has.
 */
async function settle(): Promise<void> {
  await new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 0);
  });
}

describe('RootLimiter', () => {
  it('run_upToTheLimit_startsAtOnce', async () => {
    const limiter: RootLimiter = new RootLimiter(2);
    const gate: Gate = new Gate();
    const started: string[] = [];

    const runs: Promise<void>[] = ['a', 'b'].map(async (name: string): Promise<void> =>
      limiter.run('/repo', async (): Promise<void> => {
        started.push(name);
        await gate.closed;
      }),
    );
    await settle();

    expect(started).toEqual(['a', 'b']);
    gate.open();
    await Promise.all(runs);
  });

  it('run_pastTheLimit_waitsAndStartsInArrivalOrder', async () => {
    const limiter: RootLimiter = new RootLimiter(1);
    const gates: readonly Gate[] = [new Gate(), new Gate(), new Gate()];
    const started: number[] = [];

    const runs: Promise<void>[] = gates.map(async (gate: Gate, index: number): Promise<void> =>
      limiter.run('/repo', async (): Promise<void> => {
        started.push(index);
        await gate.closed;
      }),
    );
    await settle();
    expect(started).toEqual([0]);

    gates[0].open();
    await settle();
    expect(started).toEqual([0, 1]);

    gates[1].open();
    gates[2].open();
    await Promise.all(runs);
    expect(started).toEqual([0, 1, 2]);
  });

  it('run_neverExceedsTheLimit_whateverFinishesFirst', async () => {
    const limiter: RootLimiter = new RootLimiter(3);
    let running: number = 0;
    let most: number = 0;

    await Promise.all(
      Array.from({ length: 40 }, async (_unused: unknown, index: number): Promise<void> =>
        limiter.run('/repo', async (): Promise<void> => {
          running += 1;
          most = Math.max(most, running);
          await new Promise<void>((resolve: () => void): void => {
            setTimeout(resolve, index % 3);
          });
          running -= 1;
        }),
      ),
    );

    expect(most).toBe(3);
  });

  it('run_inAnotherRepository_isNotHeldUp', async () => {
    const limiter: RootLimiter = new RootLimiter(1);
    const gate: Gate = new Gate();
    const held: Promise<void> = limiter.run('/one', (): Promise<void> => gate.closed);

    expect(await limiter.run('/two', (): Promise<string> => Promise.resolve('answered'))).toBe(
      'answered',
    );

    gate.open();
    await held;
  });

  it('run_whenARequestFails_givesItsPlaceUp_andReportsTheFailure', async () => {
    const limiter: RootLimiter = new RootLimiter(1);

    await expect(
      limiter.run('/repo', async (): Promise<void> => {
        await settle();
        throw new Error('git failed');
      }),
    ).rejects.toThrow('git failed');

    expect(await limiter.run('/repo', (): Promise<string> => Promise.resolve('next'))).toBe('next');
  });

  it('run_returnsWhatTheRequestReturns', async () => {
    expect(await new RootLimiter().run('/repo', (): Promise<number> => Promise.resolve(42))).toBe(
      42,
    );
  });
});
