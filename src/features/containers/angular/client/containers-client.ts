import { inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import { Bridge } from '@shared/api/bridge';
import { ContainerChannel } from '@shared/api/container-channels';
import {
  ContainerEngineInfo,
  ContainerSummary,
  DockerEvent,
  DockerStatus,
  ImageSummary,
} from '@shared/api/docker-types';

/**
 * The renderer client for the containers backend contribution (#391): a thin, typed wrapper over the
 * generic {@link Bridge} that names the {@link ContainerChannel} channels so the view never touches
 * `window.bridge` directly. Outside Electron (or before the backend answers) every call degrades to a
 * safe empty result, so callers need no environment checks.
 *
 * It speaks to whichever engine is in effect (#394), so nothing here is Docker-specific beyond
 * {@link launchDesktop}, which really does launch Docker Desktop.
 */
@Service()
export class ContainersClient {
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
      this.bridge?.invoke<ContainerSummary[]>(ContainerChannel.ListContainers) ??
      Promise.resolve([])
    );
  }

  /**
   * Lists all images.
   * @returns Returns the image summaries, or an empty list when unavailable.
   */
  public listImages(): Promise<ImageSummary[]> {
    return this.bridge?.invoke<ImageSummary[]>(ContainerChannel.ListImages) ?? Promise.resolve([]);
  }

  /**
   * Starts a container.
   * @param id The container id.
   * @returns Returns true when the engine accepted the request.
   */
  public start(id: string): Promise<boolean> {
    this.log.trace('containers.client', 'IPC start container', id);
    return this.bridge?.invoke<boolean>(ContainerChannel.Start, id) ?? Promise.resolve(false);
  }

  /**
   * Stops a container.
   * @param id The container id.
   * @returns Returns true when the engine accepted the request.
   */
  public stop(id: string): Promise<boolean> {
    this.log.trace('containers.client', 'IPC stop container', id);
    return this.bridge?.invoke<boolean>(ContainerChannel.Stop, id) ?? Promise.resolve(false);
  }

  /**
   * Removes a container.
   * @param id The container id.
   * @returns Returns true when the engine accepted the request.
   */
  public remove(id: string): Promise<boolean> {
    this.log.trace('containers.client', 'IPC remove container', id);
    return this.bridge?.invoke<boolean>(ContainerChannel.Remove, id) ?? Promise.resolve(false);
  }

  /**
   * Reports whether the container engine is reachable.
   * @returns Returns the engine status.
   */
  public status(): Promise<DockerStatus> {
    return (
      this.bridge?.invoke<DockerStatus>(ContainerChannel.Status) ??
      Promise.resolve({ available: false })
    );
  }

  /**
   * Initializes the client, loading which container engines are present.
   */
  public constructor() {
    void this.refreshEngines();
  }

  /**
   * Holds the engines the main process reports, refreshed on construction.
   */
  private readonly engines: WritableSignal<readonly ContainerEngineInfo[]> = signal<
    readonly ContainerEngineInfo[]
  >([]);

  /**
   * Gets the container engines: what exists, what is present on this machine, and which is in effect.
   */
  public readonly containerEngines: Signal<readonly ContainerEngineInfo[]> =
    this.engines.asReadonly();

  /**
   * Gets the command-line tool of the engine in effect, for the operations that are a terminal session
   * rather than an API call. Falls back to `docker` before the engines have been reported, which is
   * both the default engine and the overwhelmingly likely answer.
   * @returns Returns the CLI binary name.
   */
  public engineCli(): string {
    return (
      this.engines().find((engine: ContainerEngineInfo): boolean => engine.inEffect)?.cli ??
      'docker'
    );
  }

  /**
   * Reloads the engine list from the main process.
   * @returns Returns a promise that resolves once the list has been reloaded.
   */
  public async refreshEngines(): Promise<void> {
    const engines: readonly ContainerEngineInfo[] =
      (await this.bridge?.invoke<readonly ContainerEngineInfo[]>(ContainerChannel.ListEngines)) ??
      [];
    this.engines.set(engines);
  }

  /**
   * Chooses which container engine to use. The socket is opened at startup, so the change takes effect
   * when Studio next starts.
   * @param engineId The chosen engine, or null to let the highest-priority available one win.
   * @returns Returns a promise that resolves once the choice is stored.
   */
  public async chooseEngine(engineId: string | null): Promise<void> {
    const engines: readonly ContainerEngineInfo[] =
      (await this.bridge?.invoke<readonly ContainerEngineInfo[]>(
        ContainerChannel.ChooseEngine,
        engineId,
      )) ?? [];
    this.engines.set(engines);
  }

  /**
   * Attempts to launch Docker Desktop through the operating system.
   * @returns Returns true when the launch was issued (a no-op returning false outside Electron).
   */
  public launchDesktop(): Promise<boolean> {
    this.log.info('containers.client', 'Launching Docker Desktop');
    return this.bridge?.invoke<boolean>(ContainerChannel.LaunchDesktop) ?? Promise.resolve(false);
  }

  /**
   * Subscribes to the backend's live event push.
   * @param listener Receives each normalised event.
   * @returns Returns an unsubscribe function (a no-op outside Electron).
   */
  public onEvents(listener: (event: DockerEvent) => void): () => void {
    return (
      this.bridge?.on(ContainerChannel.Events, (...args: unknown[]): void =>
        listener(args[0] as DockerEvent),
      ) ?? ((): void => undefined)
    );
  }
}
