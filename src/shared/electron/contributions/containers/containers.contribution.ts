import type { IpcMainInvokeEvent } from 'electron';
import { ContainerChannel } from '@shared/api/container-channels';
import { ContainerEngineInfo } from '@shared/api/container-types';
import { ContributionContext, MainContribution } from '../main-contribution';
import { PermissionId } from '../permissions/permission';
import { ContainerSocket } from '../permissions/brokers/container-socket';
import { contributedContainerEngines } from '../plugins/contributed';
import { launchDockerDesktop } from './docker-desktop';
import { ContainerEngine, ContainerEngineDescriptor, engineSocketPath } from './container-engine';
import { contributedEngines } from './container-engine-registry';
import { DockerEngine } from './docker-engine';
import { chooseEngine, describeEngines, selectedEngine } from './engine-selection';
import { DockerStreamHandle } from './docker-transport';

/**
 * The container engine backend contribution — the first real {@link MainContribution}. It requests the
 * `container.socket` permission through the P2 broker, exposes the container/image operations over the
 * {@link ContainerChannel} IPC channels, and pushes engine events to the renderer as they happen. It is
 * registered by appending it to the `mainContributions` manifest — no other `main.ts` change — which
 * is the north-star this whole seam exists to prove.
 *
 * It is named for the capability rather than for an engine because it serves whichever engine is in
 * effect (#394); only the {@link DockerEngine} it drives is Docker-specific.
 */
export class ContainersContribution implements MainContribution {
  /**
   * The stable contribution id and IPC channel namespace, matching the `container:*` channels.
   */
  public readonly id: string = 'containers';

  /**
   * The privileged permissions this contribution declares — just the engine socket.
   */
  public readonly permissions: readonly PermissionId[] = ['container.socket'];

  /**
   * The open event stream, held so it can be closed when the last consumer leaves (and on
   * disposal). Null while no consumer holds a watch.
   */
  private watchHandle: DockerStreamHandle | null = null;

  /**
   * Counts the renderer consumers holding the event stream open (see
   * {@link ContainerChannel.WatchStart}).
   */
  private watchConsumers: number = 0;

  /**
   * The contribution's namespaced logger, captured at activation for use during disposal.
   */
  private log: ContributionContext['log'] | null = null;

  /**
   * The engine client in use, rebuilt whenever the engine in effect or its endpoint changes.
   */
  private engine: ContainerEngine | null = null;

  /**
   * Identifies the engine {@link engine} was built for, as engine identity plus resolved endpoint. Both
   * halves matter: choosing a different engine changes the first, and an engine that was not running
   * when Studio started changes the second once it is.
   */
  private engineKey: string | null = null;

  /**
   * Resolves the socket permission, wires the operation channels, and starts the event push.
   * @param context The contribution context.
   */
  public activate(context: ContributionContext): void {
    // Throws PermissionDeniedError when the broker refuses; the registry isolates that (the feature
    // simply does not activate) rather than letting it abort startup.
    this.log = context.log;
    this.refreshContributedEngines();
    // Resolved now so activation says which engine it is talking to, but *not* held for the session:
    // every handler asks again, because the answer can change while Studio runs (#594).
    this.currentEngine(context);

    context.handle(
      ContainerChannel.ListContainers,
      (): Promise<unknown> => this.currentEngine(context)?.listContainers() ?? Promise.resolve([]),
    );
    context.handle(
      ContainerChannel.ListImages,
      (): Promise<unknown> => this.currentEngine(context)?.listImages() ?? Promise.resolve([]),
    );
    context.handle(
      ContainerChannel.Start,
      (_event: IpcMainInvokeEvent, id: unknown): Promise<boolean> =>
        this.currentEngine(context)?.start(String(id)) ?? Promise.resolve(false),
    );
    context.handle(
      ContainerChannel.Stop,
      (_event: IpcMainInvokeEvent, id: unknown): Promise<boolean> =>
        this.currentEngine(context)?.stop(String(id)) ?? Promise.resolve(false),
    );
    context.handle(
      ContainerChannel.Remove,
      (_event: IpcMainInvokeEvent, id: unknown): Promise<boolean> =>
        this.currentEngine(context)?.remove(String(id)) ?? Promise.resolve(false),
    );
    context.handle(
      ContainerChannel.Status,
      (): Promise<unknown> =>
        this.currentEngine(context)?.status() ?? Promise.resolve({ available: false }),
    );
    context.handle(ContainerChannel.LaunchDesktop, (): Promise<boolean> => launchDockerDesktop());
    context.handle(ContainerChannel.ListEngines, (): readonly ContainerEngineInfo[] => {
      // Recomputed here rather than cached from activation: this is the call the surface makes when
      // it wants to know what its choices are, so it is exactly when a plugin installed since launch
      // should start counting.
      this.refreshContributedEngines();
      return describeEngines();
    });
    context.handle(
      ContainerChannel.ChooseEngine,
      (_event: IpcMainInvokeEvent, id: unknown): readonly ContainerEngineInfo[] => {
        chooseEngine(typeof id === 'string' && id.length > 0 ? id : null);
        // The choice takes effect on the next call, not on the next launch: the engine client is
        // rebuilt when the engine in effect changes, so nothing here has to outlive the choice.
        return describeEngines();
      },
    );

    // The event stream is NOT started here: it is a persistent socket connection with capped-backoff
    // reconnection, and with no daemon installed an unconditional stream retried that connection
    // every thirty seconds for the life of the app, serving nobody. The renderer's consumers hold it
    // open by ref-count instead — the status-strip count holds one while the engine is reachable.
    context.handle(ContainerChannel.WatchStart, (): boolean => {
      this.watchConsumers += 1;
      if (this.watchConsumers === 1 && this.watchHandle === null) {
        this.log?.info('first watch consumer; opening the engine event stream');
        this.watchHandle = this.openWatch(context);
      }
      return true;
    });
    context.handle(ContainerChannel.WatchStop, (): boolean => {
      this.watchConsumers = Math.max(0, this.watchConsumers - 1);
      if (this.watchConsumers === 0 && this.watchHandle !== null) {
        this.log?.info('last watch consumer left; closing the engine event stream');
        this.watchHandle.close();
        this.watchHandle = null;
      }
      return true;
    });
    context.log.info('containers contribution active; channels wired, event watch on demand');
  }

  /**
   * Recomputes which engines installed plugins contribute (#594).
   *
   * Cheap and idempotent, so it is simply redone rather than invalidated on a signal: the alternative
   * is a cross-contribution notification from the Plugin Manager, which would couple two contributions
   * to save a directory check on a call the user made.
   */
  private refreshContributedEngines(): void {
    contributedEngines.replaceAll(contributedContainerEngines());
  }

  /**
   * Gets the engine client to serve a request with, rebuilding it when the engine in effect or its
   * endpoint has changed since the last one.
   *
   * This is the lifecycle the contribution used to lack. The socket was resolved once at activation and
   * captured in the handler closures, so choosing a different engine took effect only on the next
   * launch — untenable once an engine can be *installed* while Studio runs.
   * Null when no engine is installed at all — the state a Studio is in before an engine plugin arrives
   * (#595). Every operation degrades to an empty answer there rather than throwing: nothing is wrong,
   * there is simply nothing to ask.
   * @param context The contribution context, which is the only door to the socket permission.
   * @returns Returns the engine client, or null when no engine is installed.
   */
  private currentEngine(context: ContributionContext): ContainerEngine | null {
    const descriptor: ContainerEngineDescriptor | null = selectedEngine();
    if (descriptor === null) {
      this.releaseEngine();
      return null;
    }
    const key: string = `${descriptor.id}@${engineSocketPath(descriptor) ?? ''}`;
    if (this.engine === null || this.engineKey !== key) {
      this.adoptEngine(context, descriptor, key);
    }
    // Non-null by construction: the branch above assigns it when it is null.
    return this.engine!;
  }

  /**
   * Drops the engine client when there is no longer an engine to serve, closing any open stream. Reached
   * when the last engine plugin is uninstalled while Studio runs.
   */
  private releaseEngine(): void {
    if (this.engine === null) {
      return;
    }
    this.log?.info('no container engine is installed; releasing the engine client');
    this.watchHandle?.close();
    this.watchHandle = null;
    this.engine = null;
    this.engineKey = null;
  }

  /**
   * Builds the client for an engine and takes any open event stream across to it.
   *
   * The permission is resolved here rather than per request because resolving it mints a fresh handle
   * and audits the grant; doing that on every list would fill the audit with the same decision. Here it
   * happens exactly when the thing being granted has actually changed.
   * @param context The contribution context.
   * @param descriptor The engine now in effect.
   * @param key The identity of that engine and its endpoint.
   */
  private adoptEngine(
    context: ContributionContext,
    descriptor: ContainerEngineDescriptor,
    key: string,
  ): void {
    const socket: ContainerSocket = context.permission<ContainerSocket>('container.socket');
    context.log.info(
      `using the ${descriptor.displayName} engine; socket resolved at ${socket.path}`,
    );
    const watching: boolean = this.watchHandle !== null;
    this.watchHandle?.close();
    this.watchHandle = null;
    // Docker and Podman both serve the Docker Engine API, so one client speaks to either; the engine
    // in effect decides only which socket it opens and which CLI the surface drives.
    this.engine = new DockerEngine(socket);
    this.engineKey = key;
    if (watching && this.watchConsumers > 0) {
      // Consumers hold a watch on *the engine*, not on one connection to it, so a stream that was open
      // reopens against the new engine rather than leaving those consumers silently unsubscribed.
      this.log?.info('engine changed while watched; reopening the event stream');
      this.watchHandle = this.openWatch(context);
    }
  }

  /**
   * Opens the engine event stream and pushes each event to the renderer.
   * @param context The contribution context.
   * @returns Returns the stream handle, or null when no engine is installed to watch.
   */
  private openWatch(context: ContributionContext): DockerStreamHandle | null {
    return (
      this.currentEngine(context)?.watch((event): void =>
        context.send(ContainerChannel.Events, event),
      ) ?? null
    );
  }

  /**
   * Closes the event stream. The IPC handlers are removed automatically by the registry's tracker.
   */
  public dispose(): void {
    this.log?.info('disposing containers contribution; closing event stream');
    this.watchHandle?.close();
    this.watchHandle = null;
    this.watchConsumers = 0;
    this.engine = null;
    this.engineKey = null;
  }
}

/**
 * The singleton containers contribution appended to the `mainContributions` manifest.
 */
export const containersContribution: MainContribution = new ContainersContribution();
