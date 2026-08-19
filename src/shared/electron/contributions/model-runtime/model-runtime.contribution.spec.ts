import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelRuntimeChannel } from '@shared/api/model-runtime-channels';
import {
  LocalModel,
  ModelDetails,
  ModelRuntimeStatus,
  RunningModel,
} from '@shared/api/model-runtime-types';
import {
  ContributionContext,
  ContributionListener,
  InvokeHandler,
  MainContribution,
} from '../main-contribution';
import { ModelRuntime } from './model-runtime';
import { ModelRuntimeContribution, sameStatus } from './model-runtime.contribution';

/**
 * A runtime whose status is settable, so availability transitions can be driven from a test.
 */
class FakeRuntime implements ModelRuntime {
  public readonly id: string = 'fake';
  public readonly displayName: string = 'Fake';
  public current: ModelRuntimeStatus = { available: false };
  public statusCalls: number = 0;
  public removed: string[] = [];
  public shown: string[] = [];

  public status(): Promise<ModelRuntimeStatus> {
    this.statusCalls += 1;
    return Promise.resolve(this.current);
  }

  public list(): Promise<LocalModel[]> {
    return Promise.resolve([]);
  }

  public running(): Promise<RunningModel[]> {
    return Promise.resolve([]);
  }

  public show(name: string): Promise<ModelDetails | null> {
    this.shown.push(name);
    return Promise.resolve(null);
  }

  public remove(name: string): Promise<boolean> {
    this.removed.push(name);
    return Promise.resolve(true);
  }
}

/**
 * A context capturing the registrations and pushes the contribution makes.
 */
class FakeContext {
  public readonly handlers: Map<string, InvokeHandler> = new Map<string, InvokeHandler>();
  public readonly listeners: Map<string, ContributionListener> = new Map<
    string,
    ContributionListener
  >();
  public readonly pushes: { channel: string; payload: unknown[] }[] = [];

  public readonly context: ContributionContext = {
    handle: (channel: string, handler: InvokeHandler): void => {
      this.handlers.set(channel, handler);
    },
    on: (channel: string, listener: ContributionListener): void => {
      this.listeners.set(channel, listener);
    },
    send: (channel: string, ...payload: unknown[]): void => {
      this.pushes.push({ channel, payload });
    },
    permission: <T>(): T => {
      throw new Error('no permissions declared');
    },
    mainWindow: (): null => null,
    log: { error: (): void => undefined, warn: (): void => undefined, info: (): void => undefined },
  };

  /**
   * Fires a fire-and-forget listener by channel.
   */
  public fire(channel: string): void {
    this.listeners.get(channel)?.({} as never);
  }
}

/**
 * Activates a contribution over a fake runtime and context.
 */
function activate(): {
  runtime: FakeRuntime;
  fake: FakeContext;
  contribution: ModelRuntimeContribution;
} {
  const runtime: FakeRuntime = new FakeRuntime();
  const fake: FakeContext = new FakeContext();
  const contribution: ModelRuntimeContribution = new ModelRuntimeContribution(runtime);
  contribution.activate(fake.context);
  return { runtime, fake, contribution };
}

beforeEach((): void => {
  vi.useFakeTimers();
});

afterEach((): void => {
  vi.useRealTimers();
});

describe('ModelRuntimeContribution activation', () => {
  it('wires every operation channel', () => {
    const { fake } = activate();

    expect([...fake.handlers.keys()].sort()).toEqual(
      [
        ModelRuntimeChannel.List,
        ModelRuntimeChannel.Remove,
        ModelRuntimeChannel.Running,
        ModelRuntimeChannel.Show,
        ModelRuntimeChannel.Status,
      ].sort(),
    );
  });

  it('declares no permissions', () => {
    const contribution: MainContribution = new ModelRuntimeContribution(new FakeRuntime());

    expect(contribution.permissions).toBeUndefined();
  });

  it('does not poll until a consumer asks it to', async () => {
    const { runtime } = activate();

    await vi.advanceTimersByTimeAsync(10_000);

    expect(runtime.statusCalls).toBe(0);
  });

  it('forwards a remove request to the runtime', async () => {
    const { runtime, fake } = activate();

    await fake.handlers.get(ModelRuntimeChannel.Remove)?.({} as never, 'llama3.2:3b');

    expect(runtime.removed).toEqual(['llama3.2:3b']);
  });

  it('forwards a show request to the runtime', async () => {
    const { runtime, fake } = activate();

    await fake.handlers.get(ModelRuntimeChannel.Show)?.({} as never, 'llama3.2:3b');

    expect(runtime.shown).toEqual(['llama3.2:3b']);
  });
});

describe('ModelRuntimeContribution status watch', () => {
  it('pushes the first reading immediately, without waiting an interval', async () => {
    const { fake } = activate();

    fake.fire(ModelRuntimeChannel.StartWatch);
    await vi.advanceTimersByTimeAsync(0);

    expect(fake.pushes).toEqual([
      { channel: ModelRuntimeChannel.StatusChanged, payload: [{ available: false }] },
    ]);
  });

  it('pushes only when the status actually changes', async () => {
    const { runtime, fake } = activate();

    fake.fire(ModelRuntimeChannel.StartWatch);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(9_000); // several unchanged polls
    expect(fake.pushes).toHaveLength(1);

    runtime.current = { available: true, version: '0.5.7' };
    await vi.advanceTimersByTimeAsync(3_000);

    expect(fake.pushes).toHaveLength(2);
    expect(fake.pushes[1]?.payload[0]).toEqual({ available: true, version: '0.5.7' });
  });

  it('shares one poll across consumers and stops when the last one leaves', async () => {
    const { runtime, fake } = activate();

    fake.fire(ModelRuntimeChannel.StartWatch);
    fake.fire(ModelRuntimeChannel.StartWatch);
    await vi.advanceTimersByTimeAsync(3_000);
    const shared: number = runtime.statusCalls;

    fake.fire(ModelRuntimeChannel.StopWatch);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(runtime.statusCalls).toBeGreaterThan(shared); // one consumer left, still polling

    const beforeLastLeaves: number = runtime.statusCalls;
    fake.fire(ModelRuntimeChannel.StopWatch);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(runtime.statusCalls).toBe(beforeLastLeaves);
  });

  it('stops polling on disposal', async () => {
    const { runtime, fake, contribution } = activate();

    fake.fire(ModelRuntimeChannel.StartWatch);
    await vi.advanceTimersByTimeAsync(3_000);
    contribution.dispose();
    const afterDispose: number = runtime.statusCalls;
    await vi.advanceTimersByTimeAsync(30_000);

    expect(runtime.statusCalls).toBe(afterDispose);
  });
});

describe('sameStatus', () => {
  it('treats a null previous status as a change, so the first reading is always pushed', () => {
    expect(sameStatus(null, { available: false })).toBe(false);
  });

  it('compares availability and version', () => {
    expect(sameStatus({ available: true, version: '1' }, { available: true, version: '1' })).toBe(
      true,
    );
    expect(sameStatus({ available: true, version: '1' }, { available: true, version: '2' })).toBe(
      false,
    );
    expect(sameStatus({ available: true, version: '1' }, { available: false })).toBe(false);
  });
});
