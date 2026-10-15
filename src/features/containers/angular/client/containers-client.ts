import { computed, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import { Bridge } from '@shared/api/bridge';
import { ContainerChannel } from '@shared/api/container-channels';
import type { ContainerLogs } from '@shared/api/container-engine-protocol';
import {
  ContainerEngineInfo,
  ContainerStats,
  ContainerSummary,
  ContainerEvent,
  ContainerStatus,
  ImagePullProgress,
  ImageSummary,
  RunContainerRequest,
  VolumeSummary,
} from '@shared/api/container-types';

/**
 * The renderer client for the containers backend contribution (#391): a thin, typed wrapper over the
 * generic {@link Bridge} that names the {@link ContainerChannel} channels so the view never touches
 * `window.bridge` directly. Outside Electron (or before the backend answers) every call degrades to a
 * safe empty result, so callers need no environment checks.
 *
 * It speaks to whichever engine is in effect (#394), and since the engines themselves became plugins
 * (#596) nothing here is Docker-specific at all.
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
   * Reads a container's most recent log lines, through the engine's plugin (#973).
   * @param id The container id.
   * @param tail How many lines, at most.
   * @returns Returns the lines, oldest first; none when they cannot be read.
   */
  public logs(id: string, tail: number): Promise<ContainerLogs> {
    return (
      this.bridge?.invoke<ContainerLogs>(ContainerChannel.Logs, id, tail) ??
      Promise.resolve({ lines: [], truncated: false })
    );
  }

  /**
   * Samples the resource use of running containers (#974).
   * @param ids The container ids.
   * @returns Returns a sample per container that answered.
   */
  public stats(ids: readonly string[]): Promise<ContainerStats[]> {
    return (
      this.bridge?.invoke<ContainerStats[]>(ContainerChannel.Stats, ids) ?? Promise.resolve([])
    );
  }

  /**
   * Lists the volumes (#974).
   * @returns Returns the volume summaries.
   */
  public listVolumes(): Promise<VolumeSummary[]> {
    return (
      this.bridge?.invoke<VolumeSummary[]>(ContainerChannel.ListVolumes) ?? Promise.resolve([])
    );
  }

  /**
   * Removes a volume (#974).
   * @param name The volume's name.
   * @returns Returns true when it was removed.
   */
  public removeVolume(name: string): Promise<boolean> {
    this.log.trace('containers.client', 'IPC remove volume', name);
    return (
      this.bridge?.invoke<boolean>(ContainerChannel.RemoveVolume, name) ?? Promise.resolve(false)
    );
  }

  /**
   * Pauses a container (#974).
   * @param id The container id.
   * @returns Returns true when the engine accepted it.
   */
  public pause(id: string): Promise<boolean> {
    return this.bridge?.invoke<boolean>(ContainerChannel.Pause, id) ?? Promise.resolve(false);
  }

  /**
   * Resumes a paused container (#974).
   * @param id The container id.
   * @returns Returns true when the engine accepted it.
   */
  public unpause(id: string): Promise<boolean> {
    return this.bridge?.invoke<boolean>(ContainerChannel.Unpause, id) ?? Promise.resolve(false);
  }

  /**
   * Restarts a container (#974).
   * @param id The container id.
   * @returns Returns true when the engine accepted it.
   */
  public restart(id: string): Promise<boolean> {
    return this.bridge?.invoke<boolean>(ContainerChannel.Restart, id) ?? Promise.resolve(false);
  }

  /**
   * Removes an image (#974).
   * @param id The image id.
   * @param force Whether to remove it even when a container uses it.
   * @returns Returns true when it was removed.
   */
  public removeImage(id: string, force: boolean = false): Promise<boolean> {
    this.log.trace('containers.client', 'IPC remove image', id);
    return (
      this.bridge?.invoke<boolean>(ContainerChannel.RemoveImage, id, force) ??
      Promise.resolve(false)
    );
  }

  /**
   * Downloads an image (#974); its progress arrives on {@link onPullProgress}.
   * @param reference The image reference.
   * @returns Returns whether it succeeded, and why not.
   */
  public pullImage(reference: string): Promise<{ ok: boolean; error?: string }> {
    this.log.info('containers.client', 'Pulling image', reference);
    return (
      this.bridge?.invoke<{ ok: boolean; error?: string }>(ContainerChannel.PullImage, reference) ??
      Promise.resolve({
        ok: false,
        error: 'Container engines are only available in the desktop app.',
      })
    );
  }

  /**
   * Subscribes to image download progress (#974).
   * @param listener Receives each update.
   * @returns Returns the function that unsubscribes.
   */
  public onPullProgress(listener: (progress: ImagePullProgress) => void): () => void {
    return (
      this.bridge?.on(ContainerChannel.PullProgress, (progress: unknown): void =>
        listener(progress as ImagePullProgress),
      ) ?? ((): void => undefined)
    );
  }

  /**
   * Creates a container from an image and starts it (#974).
   * @param request What to run.
   * @returns Returns the new container's id, or why it could not be run.
   */
  public run(request: RunContainerRequest): Promise<{ id?: string; error?: string }> {
    this.log.info('containers.client', 'Running a container from', request.image);
    return (
      this.bridge?.invoke<{ id?: string; error?: string }>(ContainerChannel.Run, request) ??
      Promise.resolve({ error: 'Container engines are only available in the desktop app.' })
    );
  }

  /**
   * Reports whether the container engine is reachable.
   * @returns Returns the engine status.
   */
  public status(): Promise<ContainerStatus> {
    return (
      this.bridge?.invoke<ContainerStatus>(ContainerChannel.Status) ??
      Promise.resolve({ available: false })
    );
  }

  /**
   * Holds the first engine load, so a caller can wait for it rather than mistaking "not answered yet"
   * for "no engines".
   */
  private readonly firstLoad: Promise<void>;

  /**
   * Initializes the client, loading which container engines are present.
   */
  public constructor() {
    this.firstLoad = this.refreshEngines();
  }

  /**
   * Waits for the first engine list to arrive.
   *
   * The distinction matters because an empty list means two opposite things: before the main process
   * answers it means "not known yet", and after it means "no engine is installed" — which is what the
   * empty state is about to tell the user (#595).
   * @returns Returns a promise that resolves once the engines have been reported at least once.
   */
  public ready(): Promise<void> {
    return this.firstLoad;
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
   * Gets the engine in effect, or null before the main process has reported the engines (and outside
   * Electron, where there are none). The surface uses it to name the engine it is talking to instead of
   * naming one particular engine in its own copy.
   */
  public readonly engineInEffect: Signal<ContainerEngineInfo | null> = computed(
    (): ContainerEngineInfo | null =>
      this.engines().find((engine: ContainerEngineInfo): boolean => engine.inEffect) ?? null,
  );

  /**
   * Gets the engine in effect's command-line tool on this machine, for the operations that are a
   * terminal session — a shell in a container.
   *
   * Null when no engine is in effect or its tool is not installed (#973): Studio no longer downloads
   * one, and guessing at a binary that may not exist would build a command that fails obscurely instead
   * of an operation that is simply not offered.
   * @returns Returns the CLI path, or null.
   */
  public engineCli(): string | null {
    return this.engineInEffect()?.cli ?? null;
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
   * Registers this renderer as a consumer of the backend's event stream, opening it if it was
   * closed. Ref-counted in main: hold one while events are wanted and balance with
   * {@link watchStop}.
   * @returns Returns a promise resolving true when the watch was registered.
   */
  public watchStart(): Promise<boolean> {
    return this.bridge?.invoke<boolean>(ContainerChannel.WatchStart) ?? Promise.resolve(false);
  }

  /**
   * Withdraws one {@link watchStart}; the backend closes the stream when the last consumer leaves.
   * @returns Returns a promise resolving true when the withdrawal was registered.
   */
  public watchStop(): Promise<boolean> {
    return this.bridge?.invoke<boolean>(ContainerChannel.WatchStop) ?? Promise.resolve(false);
  }

  /**
   * Subscribes to the backend's live event push.
   * @param listener Receives each normalised event.
   * @returns Returns an unsubscribe function (a no-op outside Electron).
   */
  public onEvents(listener: (event: ContainerEvent) => void): () => void {
    return (
      this.bridge?.on(ContainerChannel.Events, (...args: unknown[]): void =>
        listener(args[0] as ContainerEvent),
      ) ?? ((): void => undefined)
    );
  }
}
