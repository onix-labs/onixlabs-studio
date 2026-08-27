import type { IpcMainInvokeEvent } from 'electron';
import { ContainerChannel } from '@shared/api/container-channels';
import { ContainerEngineInfo } from '@shared/api/docker-types';
import { ContributionContext, MainContribution } from '../main-contribution';
import { PermissionId } from '../permissions/permission';
import { DockerSocket } from '../permissions/brokers/docker-socket';
import { launchDockerDesktop } from './docker-desktop';
import { ContainerEngine, ContainerEngineDescriptor } from './container-engine';
import { DockerEngine } from './docker-engine';
import { chooseEngine, describeEngines, selectedEngine } from './engine-selection';
import { DockerStreamHandle } from './docker-transport';

/**
 * The Docker Engine backend contribution — the first real {@link MainContribution}. It requests the
 * `docker.socket` permission through the P2 broker, exposes the container/image operations over the
 * {@link ContainerChannel} IPC channels, and pushes engine events to the renderer as they happen. It is
 * registered by appending it to the `mainContributions` manifest — no other `main.ts` change — which
 * is the north-star this whole seam exists to prove.
 */
export class DockerContribution implements MainContribution {
  /**
   * The stable contribution id and IPC channel namespace.
   */
  public readonly id: string = 'docker';

  /**
   * The privileged permissions this contribution declares — just the engine socket.
   */
  public readonly permissions: readonly PermissionId[] = ['docker.socket'];

  /**
   * The open event stream, held so it can be closed on disposal. Null until activated.
   */
  private watchHandle: DockerStreamHandle | null = null;

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
    const socket: DockerSocket = context.permission<DockerSocket>('docker.socket');
    const descriptor: ContainerEngineDescriptor = selectedEngine();
    context.log.info(
      `activating with the ${descriptor.displayName} engine; socket resolved at ${socket.path}`,
    );
    // Docker and Podman both serve the Docker Engine API, so one client speaks to either; the engine
    // in effect decides only which socket was opened above and which CLI the surface drives.
    const engine: ContainerEngine = new DockerEngine(socket);

    context.handle(ContainerChannel.ListContainers, (): Promise<unknown> => engine.listContainers());
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

    this.watchHandle = engine.watch((event): void => context.send(ContainerChannel.Events, event));
    context.log.info('docker contribution active; channels wired, event watch started');
  }

  /**
   * Closes the event stream. The IPC handlers are removed automatically by the registry's tracker.
   */
  public dispose(): void {
    this.log?.info('disposing docker contribution; closing event stream');
    this.watchHandle?.close();
    this.watchHandle = null;
  }
}

/**
 * The singleton Docker contribution appended to the `mainContributions` manifest.
 */
export const dockerContribution: MainContribution = new DockerContribution();
