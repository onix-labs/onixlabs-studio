import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelRuntimeChannel } from '@shared/api/model-runtime-channels';
import {
  LocalModel,
  ModelDetails,
  ModelDiskUsage,
  ModelPullProgress,
  ModelRuntimeStatus,
  RunningModel,
  RuntimeInstallation,
  RuntimeInstallProgress,
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
  public started: number = 0;
  public stopped: number = 0;
  public disposed: number = 0;
  public pulled: string[] = [];
  public install_: RuntimeInstallation = { kind: 'absent', executable: '', version: '' };

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

  public installation(): Promise<RuntimeInstallation> {
    return Promise.resolve(this.install_);
  }

  public install(
    onProgress: (progress: RuntimeInstallProgress) => void,
  ): Promise<RuntimeInstallation> {
    onProgress({ stage: 'done', received: 1, total: 1 });
    this.install_ = { kind: 'managed', executable: '/managed/ollama', version: '0.1.0' };
    return Promise.resolve(this.install_);
  }

  public start(): Promise<boolean> {
    this.started += 1;
    return Promise.resolve(true);
  }

  public stop(): Promise<boolean> {
    this.stopped += 1;
    return Promise.resolve(true);
  }

  public diskUsage(): Promise<ModelDiskUsage> {
    return Promise.resolve({ bytes: 42, path: '/models' });
  }

  /**
   * Resolves the in-flight pull, so a test can hold one open while it cancels.
   */
  public finishPull: ((ok: boolean) => void) | null = null;

  /**
   * The signals handed to each pull, so a test can assert one was aborted.
   */
  public pullSignals: (AbortSignal | undefined)[] = [];

  public pull(
    name: string,
    onProgress: (progress: ModelPullProgress) => void,
    signal?: AbortSignal,
  ): Promise<boolean> {
    this.pulled.push(name);
    this.pullSignals.push(signal);
    onProgress({ model: name, stage: 'queued', status: 'queued', received: 0, total: 0 });
    return new Promise<boolean>((resolve: (ok: boolean) => void): void => {
      this.finishPull = resolve;
      signal?.addEventListener('abort', (): void => resolve(false), { once: true });
    });
  }

  public dispose(): void {
    this.disposed += 1;
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
        ModelRuntimeChannel.CancelPull,
        ModelRuntimeChannel.Describe,
        ModelRuntimeChannel.DiskUsage,
        ModelRuntimeChannel.Install,
        ModelRuntimeChannel.Installation,
        ModelRuntimeChannel.List,
        ModelRuntimeChannel.Pull,
        ModelRuntimeChannel.Remove,
        ModelRuntimeChannel.Running,
        ModelRuntimeChannel.SearchCatalog,
        ModelRuntimeChannel.Show,
        ModelRuntimeChannel.Start,
        ModelRuntimeChannel.Status,
        ModelRuntimeChannel.Stop,
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

describe('ModelRuntimeContribution lifecycle channels', () => {
  it('forwards start and stop to the runtime', async () => {
    const { runtime, fake } = activate();

    await fake.handlers.get(ModelRuntimeChannel.Start)?.({} as never);
    await fake.handlers.get(ModelRuntimeChannel.Stop)?.({} as never);

    expect(runtime.started).toBe(1);
    expect(runtime.stopped).toBe(1);
  });

  it('pushes install progress to the renderer as the install reports it', async () => {
    const { fake } = activate();

    await fake.handlers.get(ModelRuntimeChannel.Install)?.({} as never);

    expect(fake.pushes).toContainEqual({
      channel: ModelRuntimeChannel.InstallProgress,
      payload: [{ stage: 'done', received: 1, total: 1 }],
    });
  });

  it('reports the installation and the disk usage', async () => {
    const { fake } = activate();

    expect(await fake.handlers.get(ModelRuntimeChannel.Installation)?.({} as never)).toEqual({
      kind: 'absent',
      executable: '',
      version: '',
    });
    expect(await fake.handlers.get(ModelRuntimeChannel.DiskUsage)?.({} as never)).toEqual({
      bytes: 42,
      path: '/models',
    });
  });

  it('disposes the runtime, so a Studio-started server is cleaned up with the app', () => {
    const { runtime, contribution } = activate();

    contribution.dispose();

    expect(runtime.disposed).toBe(1);
  });
});

describe('ModelRuntimeContribution pull', () => {
  it('pushes pull progress to the renderer', async () => {
    const { fake } = activate();

    void fake.handlers.get(ModelRuntimeChannel.Pull)?.({} as never, 'llama3.2:3b');
    await vi.advanceTimersByTimeAsync(0);

    expect(fake.pushes).toContainEqual({
      channel: ModelRuntimeChannel.PullProgress,
      payload: [{ model: 'llama3.2:3b', stage: 'queued', status: 'queued', received: 0, total: 0 }],
    });
  });

  it('cancels an in-flight pull through its abort signal', async () => {
    const { runtime, fake } = activate();
    const pull: Promise<unknown> = fake.handlers.get(ModelRuntimeChannel.Pull)?.(
      {} as never,
      'llama3.2:3b',
    ) as Promise<unknown>;
    await vi.advanceTimersByTimeAsync(0);

    const cancelled: unknown = fake.handlers.get(ModelRuntimeChannel.CancelPull)?.(
      {} as never,
      'llama3.2:3b',
    );

    expect(cancelled).toBe(true);
    expect(runtime.pullSignals[0]?.aborted).toBe(true);
    expect(await pull).toBe(false);
  });

  it('reports nothing to cancel for a model that is not being pulled', () => {
    const { fake } = activate();

    expect(fake.handlers.get(ModelRuntimeChannel.CancelPull)?.({} as never, 'ghost')).toBe(false);
  });

  it('refuses a duplicate pull of a model already in flight', async () => {
    const { runtime, fake } = activate();
    void fake.handlers.get(ModelRuntimeChannel.Pull)?.({} as never, 'llama3.2:3b');
    await vi.advanceTimersByTimeAsync(0);

    const second: unknown = await fake.handlers.get(ModelRuntimeChannel.Pull)?.(
      {} as never,
      'llama3.2:3b',
    );

    expect(second).toBe(false);
    // The second request must not have reached the runtime, or the two would race for the weights.
    expect(runtime.pulled).toEqual(['llama3.2:3b']);
  });

  it('releases the model once its pull settles, so it can be pulled again', async () => {
    const { runtime, fake } = activate();
    const first: Promise<unknown> = fake.handlers.get(ModelRuntimeChannel.Pull)?.(
      {} as never,
      'llama3.2:3b',
    ) as Promise<unknown>;
    await vi.advanceTimersByTimeAsync(0);
    runtime.finishPull?.(true);
    await first;

    void fake.handlers.get(ModelRuntimeChannel.Pull)?.({} as never, 'llama3.2:3b');
    await vi.advanceTimersByTimeAsync(0);

    expect(runtime.pulled).toEqual(['llama3.2:3b', 'llama3.2:3b']);
  });

  it('aborts in-flight pulls on disposal, so none outlives the contribution', async () => {
    const { runtime, fake, contribution } = activate();
    void fake.handlers.get(ModelRuntimeChannel.Pull)?.({} as never, 'llama3.2:3b');
    await vi.advanceTimersByTimeAsync(0);

    contribution.dispose();

    expect(runtime.pullSignals[0]?.aborted).toBe(true);
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
