import {
  ContributionContext,
  ContributionListener,
  ContributionLogger,
  InvokeHandler,
  MainContribution,
} from './main-contribution';

/**
 * The narrow slice of `ipcMain` the registry drives, injected so the registry and its
 * {@link TrackedIpc} can be unit-tested with a fake in place of the real Electron singleton. The
 * real `ipcMain` satisfies this structurally.
 */
export interface IpcSurface {
  /**
   * Registers an invoke-style handler for a channel.
   * @param channel The IPC channel.
   * @param handler The handler invoked for each request.
   */
  handle(channel: string, handler: InvokeHandler): void;

  /**
   * Registers a fire-and-forget listener for a channel.
   * @param channel The IPC channel.
   * @param listener The listener invoked for each message.
   */
  on(channel: string, listener: ContributionListener): void;

  /**
   * Removes the invoke-style handler registered for a channel.
   * @param channel The IPC channel.
   */
  removeHandler(channel: string): void;

  /**
   * Removes a previously registered fire-and-forget listener.
   * @param channel The IPC channel.
   * @param listener The listener to remove.
   */
  removeListener(channel: string, listener: ContributionListener): void;
}

/**
 * Wraps an {@link IpcSurface}, recording every handler and listener a contribution registers so all of
 * them can be removed in one call. This is what makes contribution teardown automatic and leak-free —
 * the manual `removeHandler`/`removeListener` bookkeeping the existing managers do by hand is done here
 * instead, once, for every contribution.
 */
export class TrackedIpc {
  /**
   * Holds the channels whose invoke-style handlers were registered, for removal on dispose.
   */
  private readonly handledChannels: string[] = [];

  /**
   * Holds each registered listener with its channel, for removal on dispose.
   */
  private readonly listeners: { channel: string; listener: ContributionListener }[] = [];

  /**
   * Initializes a new instance of the {@link TrackedIpc} class.
   * @param ipc The IPC surface to register on and remove from.
   */
  public constructor(private readonly ipc: IpcSurface) {}

  /**
   * Registers an invoke-style handler and records it for automatic removal.
   * @param channel The IPC channel.
   * @param handler The handler invoked for each request.
   */
  public handle(channel: string, handler: InvokeHandler): void {
    this.ipc.handle(channel, handler);
    this.handledChannels.push(channel);
  }

  /**
   * Registers a fire-and-forget listener and records it for automatic removal.
   * @param channel The IPC channel.
   * @param listener The listener invoked for each message.
   */
  public on(channel: string, listener: ContributionListener): void {
    this.ipc.on(channel, listener);
    this.listeners.push({ channel, listener });
  }

  /**
   * Removes every handler and listener registered through this tracker. Idempotent: the records are
   * cleared, so a second call removes nothing.
   */
  public disposeAll(): void {
    for (const channel of this.handledChannels.splice(0)) {
      this.ipc.removeHandler(channel);
    }
    for (const { channel, listener } of this.listeners.splice(0)) {
      this.ipc.removeListener(channel, listener);
    }
  }
}

/**
 * The backend analog of the renderer's feature registry: the collection the application iterates so a
 * feature can bring its own main-process backend (IPC handlers, a renderer push channel, declared
 * capabilities) without any edit to core construction or teardown. Contributions run *alongside* the
 * existing hard-wired managers; this registry does not own or migrate them.
 */
export class MainContributionRegistry {
  /**
   * Holds each activated contribution with the tracker owning its IPC registrations, so disposal can
   * both call the contribution's own teardown and remove everything it registered.
   */
  private readonly active: Map<string, { contribution: MainContribution; track: TrackedIpc }> =
    new Map<string, { contribution: MainContribution; track: TrackedIpc }>();

  /**
   * Initializes a new instance of the {@link MainContributionRegistry} class.
   * @param contributions The contributions to activate at startup.
   * @param ipc The IPC surface each contribution's registrations are tracked on.
   * @param makeContext Builds the context handed to a contribution over its tracker.
   * @param log The registry's own logger, used to report a contribution that fails to activate.
   */
  public constructor(
    private readonly contributions: readonly MainContribution[],
    private readonly ipc: IpcSurface,
    private readonly makeContext: (
      contribution: MainContribution,
      track: TrackedIpc,
    ) => ContributionContext,
    private readonly log: ContributionLogger,
  ) {}

  /**
   * Activates every contribution once, at startup. Failure is isolated: a contribution that throws has
   * its partial registrations rolled back, is logged, and never activated — the remaining
   * contributions still activate and startup still completes.
   * @returns Returns a promise that resolves once every contribution has been attempted.
   */
  public async activateAll(): Promise<void> {
    for (const contribution of this.contributions) {
      const track: TrackedIpc = new TrackedIpc(this.ipc);
      try {
        await contribution.activate(this.makeContext(contribution, track));
        this.active.set(contribution.id, { contribution, track });
      } catch (error: unknown) {
        track.disposeAll();
        this.log.error(`contribution '${contribution.id}' failed to activate`, error);
      }
    }
  }

  /**
   * Disposes every active contribution: calls its own teardown (best effort) and removes every handler
   * and listener it registered. Clears the active set, so it is safe to call more than once.
   * @returns Returns a promise that resolves once every contribution has been disposed.
   */
  public async disposeAll(): Promise<void> {
    for (const { contribution, track } of this.active.values()) {
      try {
        await contribution.dispose?.();
      } catch (error: unknown) {
        this.log.error(`contribution '${contribution.id}' failed to dispose`, error);
      }
      track.disposeAll();
    }
    this.active.clear();
  }
}
