import type { IpcMainInvokeEvent } from 'electron';
import { DockerChannel } from '@shared/api/docker-channels';
import { ContributionContext, MainContribution } from '../main-contribution';
import { PermissionId } from '../permissions/permission';
import { DockerSocket } from '../permissions/brokers/docker-socket';
import { launchDockerDesktop } from './docker-desktop';
import { DockerEngine } from './docker-engine';
import { DockerStreamHandle } from './docker-transport';

/**
 * The Docker Engine backend contribution — the first real {@link MainContribution}. It requests the
 * `docker.socket` permission through the P2 broker, exposes the container/image operations over the
 * {@link DockerChannel} IPC channels, and pushes engine events to the renderer as they happen. It is
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
   * Resolves the socket permission, wires the operation channels, and starts the event push.
   * @param context The contribution context.
   */
  public activate(context: ContributionContext): void {
    // Throws PermissionDeniedError when the broker refuses; the registry isolates that (the feature
    // simply does not activate) rather than letting it abort startup.
    const socket: DockerSocket = context.permission<DockerSocket>('docker.socket');
    const engine: DockerEngine = new DockerEngine(socket);

    context.handle(DockerChannel.ListContainers, (): Promise<unknown> => engine.listContainers());
    context.handle(DockerChannel.ListImages, (): Promise<unknown> => engine.listImages());
    context.handle(
      DockerChannel.Start,
      (_event: IpcMainInvokeEvent, id: unknown): Promise<boolean> => engine.start(String(id)),
    );
    context.handle(
      DockerChannel.Stop,
      (_event: IpcMainInvokeEvent, id: unknown): Promise<boolean> => engine.stop(String(id)),
    );
    context.handle(
      DockerChannel.Remove,
      (_event: IpcMainInvokeEvent, id: unknown): Promise<boolean> => engine.remove(String(id)),
    );
    context.handle(DockerChannel.Status, (): Promise<unknown> => engine.status());
    context.handle(DockerChannel.LaunchDesktop, (): Promise<boolean> => launchDockerDesktop());

    this.watchHandle = engine.watch((event): void => context.send(DockerChannel.Events, event));
  }

  /**
   * Closes the event stream. The IPC handlers are removed automatically by the registry's tracker.
   */
  public dispose(): void {
    this.watchHandle?.close();
    this.watchHandle = null;
  }
}

/**
 * The singleton Docker contribution appended to the `mainContributions` manifest.
 */
export const dockerContribution: MainContribution = new DockerContribution();
