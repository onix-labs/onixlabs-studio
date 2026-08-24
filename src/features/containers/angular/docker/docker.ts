import { inject, Service } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import { Bridge } from '@shared/api/bridge';
import { DockerChannel } from '@shared/api/docker-channels';
import {
  ContainerSummary,
  DockerEvent,
  DockerStatus,
  ImageSummary,
} from '@shared/api/docker-types';

/**
 * The renderer client for the Docker backend contribution (#391): a thin, typed wrapper over the
 * generic {@link Bridge} that names the {@link DockerChannel} channels so the view never touches
 * `window.bridge` directly. Outside Electron (or before the backend answers) every call degrades to a
 * safe empty result, so callers need no environment checks.
 */
@Service()
export class Docker {
  /**
   * Holds the IPC transport, or undefined when running outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Lists all containers, running and stopped.
   * @returns Returns the container summaries, or an empty list when unavailable.
   */
  public listContainers(): Promise<ContainerSummary[]> {
    return (
      this.bridge?.invoke<ContainerSummary[]>(DockerChannel.ListContainers) ?? Promise.resolve([])
    );
  }

  /**
   * Lists all images.
   * @returns Returns the image summaries, or an empty list when unavailable.
   */
  public listImages(): Promise<ImageSummary[]> {
    return this.bridge?.invoke<ImageSummary[]>(DockerChannel.ListImages) ?? Promise.resolve([]);
  }

  /**
   * Starts a container.
   * @param id The container id.
   * @returns Returns true when the daemon accepted the request.
   */
  public start(id: string): Promise<boolean> {
    this.log.trace('containers.docker', 'IPC start container', id);
    return this.bridge?.invoke<boolean>(DockerChannel.Start, id) ?? Promise.resolve(false);
  }

  /**
   * Stops a container.
   * @param id The container id.
   * @returns Returns true when the daemon accepted the request.
   */
  public stop(id: string): Promise<boolean> {
    this.log.trace('containers.docker', 'IPC stop container', id);
    return this.bridge?.invoke<boolean>(DockerChannel.Stop, id) ?? Promise.resolve(false);
  }

  /**
   * Removes a container.
   * @param id The container id.
   * @returns Returns true when the daemon accepted the request.
   */
  public remove(id: string): Promise<boolean> {
    this.log.trace('containers.docker', 'IPC remove container', id);
    return this.bridge?.invoke<boolean>(DockerChannel.Remove, id) ?? Promise.resolve(false);
  }

  /**
   * Reports whether the Docker daemon is reachable.
   * @returns Returns the daemon status.
   */
  public status(): Promise<DockerStatus> {
    return (
      this.bridge?.invoke<DockerStatus>(DockerChannel.Status) ??
      Promise.resolve({ available: false })
    );
  }

  /**
   * Attempts to launch Docker Desktop through the operating system.
   * @returns Returns true when the launch was issued (a no-op returning false outside Electron).
   */
  public launchDesktop(): Promise<boolean> {
    this.log.info('containers.docker', 'Launching Docker Desktop');
    return this.bridge?.invoke<boolean>(DockerChannel.LaunchDesktop) ?? Promise.resolve(false);
  }

  /**
   * Subscribes to the backend's live event push.
   * @param listener Receives each normalised event.
   * @returns Returns an unsubscribe function (a no-op outside Electron).
   */
  public onEvents(listener: (event: DockerEvent) => void): () => void {
    return (
      this.bridge?.on(DockerChannel.Events, (...args: unknown[]): void =>
        listener(args[0] as DockerEvent),
      ) ?? ((): void => undefined)
    );
  }
}
