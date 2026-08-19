import { inject, Service } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import { Bridge } from '@shared/api/bridge';
import { ModelRuntimeChannel } from '@shared/api/model-runtime-channels';
import {
  LocalModel,
  ModelDetails,
  ModelRuntimeStatus,
  RunningModel,
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
