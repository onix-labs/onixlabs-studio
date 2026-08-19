import { inject, Service } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import { Bridge } from '@shared/api/bridge';
import { ModelRuntimeChannel } from '@shared/api/model-runtime-channels';
import {
  LocalModel,
  ModelDetails,
  ModelDiskUsage,
  ModelRuntimeStatus,
  RunningModel,
  RuntimeInstallation,
  RuntimeInstallProgress,
} from '@shared/api/model-runtime-types';

/**
 * The renderer client for the local model-runtime backend contribution (#409): a thin, typed wrapper
 * over the generic {@link Bridge} that names the {@link ModelRuntimeChannel} channels so the view never
 * touches `window.bridge` directly. Outside Electron (or before the backend answers) every call
 * degrades to a safe empty result, so callers need no environment checks.
 */
@Service()
export class ModelRuntimes {
  /**
   * Holds the IPC transport, or undefined when running outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Lists the models installed locally.
   * @returns Returns the installed models, or an empty list when unavailable.
   */
  public list(): Promise<LocalModel[]> {
    return this.bridge?.invoke<LocalModel[]>(ModelRuntimeChannel.List) ?? Promise.resolve([]);
  }

  /**
   * Lists the models currently loaded into memory.
   * @returns Returns the running models, or an empty list when unavailable.
   */
  public running(): Promise<RunningModel[]> {
    return this.bridge?.invoke<RunningModel[]>(ModelRuntimeChannel.Running) ?? Promise.resolve([]);
  }

  /**
   * Reads one model's detailed metadata.
   * @param name The fully-qualified model reference.
   * @returns Returns the details, or null when the model is unknown or the runtime is unavailable.
   */
  public show(name: string): Promise<ModelDetails | null> {
    return (
      this.bridge?.invoke<ModelDetails | null>(ModelRuntimeChannel.Show, name) ??
      Promise.resolve(null)
    );
  }

  /**
   * Removes an installed model, deleting its weights.
   * @param name The fully-qualified model reference.
   * @returns Returns true when the runtime accepted the request.
   */
  public remove(name: string): Promise<boolean> {
    this.log.info('model-manager.runtime', 'IPC remove model', name);
    return this.bridge?.invoke<boolean>(ModelRuntimeChannel.Remove, name) ?? Promise.resolve(false);
  }

  /**
   * Reports whether the runtime's server is reachable.
   * @returns Returns the runtime status.
   */
  public status(): Promise<ModelRuntimeStatus> {
    return (
      this.bridge?.invoke<ModelRuntimeStatus>(ModelRuntimeChannel.Status) ??
      Promise.resolve({ available: false })
    );
  }

  /**
   * Reports where the runtime's binary is and how it got there.
   * @returns Returns the installation, or an absent one when unavailable.
   */
  public installation(): Promise<RuntimeInstallation> {
    return (
      this.bridge?.invoke<RuntimeInstallation>(ModelRuntimeChannel.Installation) ??
      Promise.resolve({ kind: 'absent' as const, executable: '', version: '' })
    );
  }

  /**
   * Downloads and installs a Studio-managed copy of the runtime. Subscribe with
   * {@link onInstallProgress} first: the archives are large, so this takes minutes.
   * @returns Returns the resulting installation.
   */
  public install(): Promise<RuntimeInstallation> {
    this.log.info('model-manager.runtime', 'IPC install managed runtime');
    return (
      this.bridge?.invoke<RuntimeInstallation>(ModelRuntimeChannel.Install) ??
      Promise.resolve({ kind: 'absent' as const, executable: '', version: '' })
    );
  }

  /**
   * Subscribes to managed-install progress.
   * @param listener Receives each progress update.
   * @returns Returns an unsubscribe function (a no-op outside Electron).
   */
  public onInstallProgress(listener: (progress: RuntimeInstallProgress) => void): () => void {
    return (
      this.bridge?.on(ModelRuntimeChannel.InstallProgress, (...args: unknown[]): void =>
        listener(args[0] as RuntimeInstallProgress),
      ) ?? ((): void => undefined)
    );
  }

  /**
   * Starts the runtime's server.
   * @returns Returns true once the server answers.
   */
  public start(): Promise<boolean> {
    this.log.info('model-manager.runtime', 'IPC start runtime server');
    return this.bridge?.invoke<boolean>(ModelRuntimeChannel.Start) ?? Promise.resolve(false);
  }

  /**
   * Stops the runtime's server. Only a server Studio started can be stopped.
   * @returns Returns true when a Studio-owned server was stopped.
   */
  public stop(): Promise<boolean> {
    this.log.info('model-manager.runtime', 'IPC stop runtime server');
    return this.bridge?.invoke<boolean>(ModelRuntimeChannel.Stop) ?? Promise.resolve(false);
  }

  /**
   * Reports how much disk the runtime's model store is using.
   * @returns Returns the disk usage.
   */
  public diskUsage(): Promise<ModelDiskUsage> {
    return (
      this.bridge?.invoke<ModelDiskUsage>(ModelRuntimeChannel.DiskUsage) ??
      Promise.resolve({ bytes: 0, path: '' })
    );
  }

  /**
   * Subscribes to the backend's status push, asking it to start polling for as long as the
   * subscription lives. The backend ref-counts these requests, so several open views share one poll.
   * @param listener Receives the status each time it changes.
   * @returns Returns an unsubscribe function that also releases the poll (a no-op outside Electron).
   */
  public watchStatus(listener: (status: ModelRuntimeStatus) => void): () => void {
    if (this.bridge === undefined) {
      return (): void => undefined;
    }
    const off: () => void = this.bridge.on(
      ModelRuntimeChannel.StatusChanged,
      (...args: unknown[]): void => listener(args[0] as ModelRuntimeStatus),
    );
    this.bridge.send(ModelRuntimeChannel.StartWatch);
    return (): void => {
      this.bridge?.send(ModelRuntimeChannel.StopWatch);
      off();
    };
  }
}
