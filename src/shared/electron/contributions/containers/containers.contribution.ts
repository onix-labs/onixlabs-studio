import type { IpcMainInvokeEvent } from 'electron';
import { ContainerChannel } from '@shared/api/container-channels';
import { ContainerEngineInfo } from '@shared/api/container-types';
import { ContributionContext, MainContribution } from '../main-contribution';
import { PermissionId } from '../permissions/permission';
import { ContainerSocket } from '../permissions/brokers/container-socket';
import { launchDockerDesktop } from './docker-desktop';
import { ContainerEngine, ContainerEngineDescriptor } from './container-engine';
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
   * Resolves the socket permission, wires the operation channels, and starts the event push.
   * @param context The contribution context.
   */
  public activate(context: ContributionContext): void {
    // Throws PermissionDeniedError when the broker refuses; the registry isolates that (the feature
    // simply does not activate) rather than letting it abort startup.
    this.log = context.log;
    const socket: ContainerSocket = context.permission<ContainerSocket>('container.socket');
    const descriptor: ContainerEngineDescriptor = selectedEngine();
    context.log.info(
      `activating with the ${descriptor.displayName} engine; socket resolved at ${socket.path}`,
    );
    // Docker and Podman both serve the Docker Engine API, so one client speaks to either; the engine
    // in effect decides only which socket was opened above and which CLI the surface drives.
    const engine: ContainerEngine = new DockerEngine(socket);

    context.handle(ContainerChannel.ListContainers, (): Promise<unknown> =>
      engine.listContainers(),
    );
    context.handle(ContainerChannel.ListImages, (): Promise<unknown> => engine.listImages());
    context.handle(
      ContainerChannel.Start,
      (_event: IpcMainInvokeEvent, id: unknown): Promise<boolean> => engine.start(String(id)),
    );
    context.handle(
      ContainerChannel.Stop,
      (_event: IpcMainInvokeEvent, id: unknown): Promise<boolean> => engine.stop(String(id)),
    );
    context.handle(
      ContainerChannel.Remove,
      (_event: IpcMainInvokeEvent, id: unknown): Promise<boolean> => engine.remove(String(id)),
    );
    context.handle(ContainerChannel.Status, (): Promise<unknown> => engine.status());
    context.handle(ContainerChannel.LaunchDesktop, (): Promise<boolean> => launchDockerDesktop());
    context.handle(ContainerChannel.ListEngines, (): readonly ContainerEngineInfo[] =>
      describeEngines(),
    );
    context.handle(
      ContainerChannel.ChooseEngine,
      (_event: IpcMainInvokeEvent, id: unknown): readonly ContainerEngineInfo[] => {
        chooseEngine(typeof id === 'string' && id.length > 0 ? id : null);
        // The socket was opened at activation, so a different engine takes effect on the next launch;
        // the refreshed list is what tells the renderer to say so.
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
        this.watchHandle = engine.watch((event): void =>
          context.send(ContainerChannel.Events, event),
        );
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
   * Closes the event stream. The IPC handlers are removed automatically by the registry's tracker.
   */
  public dispose(): void {
    this.log?.info('disposing containers contribution; closing event stream');
    this.watchHandle?.close();
    this.watchHandle = null;
    this.watchConsumers = 0;
  }
}

/**
 * The singleton containers contribution appended to the `mainContributions` manifest.
 */
export const containersContribution: MainContribution = new ContainersContribution();
