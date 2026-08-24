import { describe, expect, it, Mock, vi } from 'vitest';
import {
  ContributionContext,
  ContributionListener,
  ContributionLogger,
  InvokeHandler,
  MainContribution,
} from './main-contribution';
import { IpcSurface, MainContributionRegistry, TrackedIpc } from './main-contribution-registry';

/**
 * Records every registration and removal so a test can assert exactly what a contribution wired and,
 * after disposal, that nothing it wired was left behind.
 */
class FakeIpc implements IpcSurface {
  public readonly handled: { channel: string; handler: InvokeHandler }[] = [];
  public readonly listeners: { channel: string; listener: ContributionListener }[] = [];
  public readonly removedHandlers: string[] = [];
  public readonly removedListeners: { channel: string; listener: ContributionListener }[] = [];

  public handle(channel: string, handler: InvokeHandler): void {
    this.handled.push({ channel, handler });
  }

  public on(channel: string, listener: ContributionListener): void {
    this.listeners.push({ channel, listener });
  }

  public removeHandler(channel: string): void {
    this.removedHandlers.push(channel);
  }

  public removeListener(channel: string, listener: ContributionListener): void {
    this.removedListeners.push({ channel, listener });
  }
}

/**
 * A {@link ContributionLogger} whose methods are spies, so a test can assert a failed activation or
 * disposal was reported.
 */
interface SpiedLogger extends ContributionLogger {
  error: Mock;
  warn: Mock;
  info: Mock;
}

/**
 * Builds a logger whose calls are recorded for assertion.
 */
function fakeLogger(): SpiedLogger {
  return { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
}

/**
 * Builds the context the registry hands a contribution: delegates IPC to the tracker (the behaviour
 * under test) and stubs the rest.
 */
function contextFactory(): (
  contribution: MainContribution,
  track: TrackedIpc,
) => ContributionContext {
  return (_contribution: MainContribution, track: TrackedIpc): ContributionContext => ({
    handle: (channel: string, handler: InvokeHandler): void => track.handle(channel, handler),
    on: (channel: string, listener: ContributionListener): void => track.on(channel, listener),
    send: vi.fn(),
    permission: <T>(): T => {
      throw new Error('not granted');
    },
    mainWindow: (): null => null,
    log: fakeLogger(),
  });
}

describe('TrackedIpc', () => {
  it('handleAndOn_registerOnTheSurfaceAndRecordForRemoval', () => {
    const ipc: FakeIpc = new FakeIpc();
    const tracked: TrackedIpc = new TrackedIpc(ipc);
    const handler: InvokeHandler = (): string => 'ok';
    const listener: ContributionListener = (): void => undefined;

    tracked.handle('demo:invoke', handler);
    tracked.on('demo:event', listener);

    expect(ipc.handled).toEqual([{ channel: 'demo:invoke', handler }]);
    expect(ipc.listeners).toEqual([{ channel: 'demo:event', listener }]);
  });

  it('disposeAll_removesEveryHandlerAndListenerAndIsIdempotent', () => {
    const ipc: FakeIpc = new FakeIpc();
    const tracked: TrackedIpc = new TrackedIpc(ipc);
    const listener: ContributionListener = (): void => undefined;
    tracked.handle('demo:invoke', (): string => 'ok');
    tracked.on('demo:event', listener);

    tracked.disposeAll();
    tracked.disposeAll();

    expect(ipc.removedHandlers).toEqual(['demo:invoke']);
    expect(ipc.removedListeners).toEqual([{ channel: 'demo:event', listener }]);
  });
});

describe('MainContributionRegistry', () => {
  it('activateAll_handsEachContributionItsContextAndWiresItsChannels', async () => {
    const ipc: FakeIpc = new FakeIpc();
    let received: ContributionContext | null = null;
    const contribution: MainContribution = {
      id: 'sample',
      activate: (context: ContributionContext): void => {
        received = context;
        context.handle('sample:ping', (): string => 'pong');
      },
    };
    const registry: MainContributionRegistry = new MainContributionRegistry(
      [contribution],
      ipc,
      contextFactory(),
      fakeLogger(),
    );

    await registry.activateAll();

    expect(received).not.toBeNull();
    expect(ipc.handled.map((entry) => entry.channel)).toEqual(['sample:ping']);
  });

  it('activateAll_awaitsAsyncActivation', async () => {
    const ipc: FakeIpc = new FakeIpc();
    const contribution: MainContribution = {
      id: 'async',
      activate: async (context: ContributionContext): Promise<void> => {
        await Promise.resolve();
        context.handle('async:ready', (): boolean => true);
      },
    };
    const registry: MainContributionRegistry = new MainContributionRegistry(
      [contribution],
      ipc,
      contextFactory(),
      fakeLogger(),
    );

    await registry.activateAll();

    expect(ipc.handled.map((entry) => entry.channel)).toEqual(['async:ready']);
  });

  it('activateAll_isolatesAThrowingContribution_rollingBackItsRegistrationsAndActivatingTheRest', async () => {
    const ipc: FakeIpc = new FakeIpc();
    const log: SpiedLogger = fakeLogger();
    const failing: MainContribution = {
      id: 'broken',
      activate: (context: ContributionContext): void => {
        context.handle('broken:invoke', (): void => undefined);
        throw new Error('boom');
      },
    };
    const healthy: MainContribution = {
      id: 'healthy',
      activate: (context: ContributionContext): void => {
        context.handle('healthy:invoke', (): string => 'ok');
      },
    };
    const registry: MainContributionRegistry = new MainContributionRegistry(
      [failing, healthy],
      ipc,
      contextFactory(),
      log,
    );

    await registry.activateAll();

    // The failing contribution's partial registration is rolled back...
    expect(ipc.removedHandlers).toEqual(['broken:invoke']);
    // ...it is reported...
    expect(log.error).toHaveBeenCalledWith(
      "contribution 'broken' failed to activate",
      expect.any(Error),
    );
    // ...and the healthy contribution still activated.
    expect(ipc.handled.map((entry) => entry.channel)).toContain('healthy:invoke');
  });

  it('disposeAll_removesEveryRegisteredHandlerAndCallsContributionDispose', async () => {
    const ipc: FakeIpc = new FakeIpc();
    const dispose: Mock = vi.fn();
    const contribution: MainContribution = {
      id: 'sample',
      activate: (context: ContributionContext): void => {
        context.handle('sample:ping', (): string => 'pong');
        context.on('sample:tick', (): void => undefined);
      },
      dispose,
    };
    const registry: MainContributionRegistry = new MainContributionRegistry(
      [contribution],
      ipc,
      contextFactory(),
      fakeLogger(),
    );

    await registry.activateAll();
    await registry.disposeAll();

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(ipc.removedHandlers).toEqual(['sample:ping']);
    expect(ipc.removedListeners.map((entry) => entry.channel)).toEqual(['sample:tick']);
  });

  it('disposeAll_isolatesAThrowingDispose_stillTearingDownTheRest', async () => {
    const ipc: FakeIpc = new FakeIpc();
    const log: SpiedLogger = fakeLogger();
    const goodDispose: Mock = vi.fn();
    const throwing: MainContribution = {
      id: 'throws',
      activate: (context: ContributionContext): void =>
        context.handle('throws:x', (): void => undefined),
      dispose: (): void => {
        throw new Error('dispose failed');
      },
    };
    const good: MainContribution = {
      id: 'good',
      activate: (context: ContributionContext): void =>
        context.handle('good:x', (): void => undefined),
      dispose: goodDispose,
    };
    const registry: MainContributionRegistry = new MainContributionRegistry(
      [throwing, good],
      ipc,
      contextFactory(),
      log,
    );

    await registry.activateAll();
    await registry.disposeAll();

    expect(goodDispose).toHaveBeenCalledTimes(1);
    expect(ipc.removedHandlers).toEqual(expect.arrayContaining(['throws:x', 'good:x']));
    expect(log.error).toHaveBeenCalledWith(
      "contribution 'throws' failed to dispose",
      expect.any(Error),
    );
  });

  it('disposeAll_isSafeToCallTwice', async () => {
    const ipc: FakeIpc = new FakeIpc();
    const contribution: MainContribution = {
      id: 'sample',
      activate: (context: ContributionContext): void =>
        context.handle('sample:ping', (): void => undefined),
    };
    const registry: MainContributionRegistry = new MainContributionRegistry(
      [contribution],
      ipc,
      contextFactory(),
      fakeLogger(),
    );

    await registry.activateAll();
    await registry.disposeAll();
    await registry.disposeAll();

    expect(ipc.removedHandlers).toEqual(['sample:ping']);
  });
});
