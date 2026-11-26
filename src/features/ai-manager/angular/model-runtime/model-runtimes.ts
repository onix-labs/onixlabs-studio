import { inject, Service } from '@angular/core';
import { Settings } from '@shared/angular/services/settings/settings';
import { Log } from '@shared/angular/services/log/log';
import { Notifications } from '@shared/angular/services/notifications/notifications';
import { Bridge } from '@shared/api/bridge';
import { CatalogQuery, CatalogResult } from '@shared/api/model-catalog-types';
import { ModelRuntimeChannel } from '@shared/api/model-runtime-channels';
import {
  LocalModel,
  ModelDetails,
  ModelDiskUsage,
  ModelPullProgress,
  ModelRuntimeInfo,
  ModelRuntimeStatus,
  RunningModel,
  RuntimeInstallation,
  RuntimeInstallProgress,
} from '@shared/api/model-runtime-types';
import { ModelNotificationType } from './model-notification-types';

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
   * Holds the settings, which say where a catalogue search looks and how much it brings back.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the notification store a finished download or runtime install is reported to (#1491).
   */
  private readonly notifications: Notifications = inject(Notifications);

  /**
   * Holds the models whose pull the user asked to cancel, so its end is not reported as a failure.
   */
  private readonly cancelling: Set<string> = new Set<string>();

  /**
   * Identifies the runtime being served, so the view can name it rather than assuming one.
   * @returns Returns the runtime's identity, or a neutral placeholder when unavailable.
   */
  public describe(): Promise<ModelRuntimeInfo> {
    return (
      this.bridge?.invoke<ModelRuntimeInfo>(ModelRuntimeChannel.Describe) ??
      Promise.resolve({ id: '', displayName: 'Model runtime' })
    );
  }

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
   * Searches the catalogue of models available to install. An empty search returns the curated list,
   * so the view opens on something browsable.
   * @param text The free-text search.
   * @param limit The most results to return per source; the user's Results per Source when omitted.
   * @returns Returns the matching models, and any sources that failed.
   */
  public searchCatalog(text: string, limit?: number): Promise<CatalogResult> {
    const query: CatalogQuery = {
      text,
      limit: limit ?? this.settings.get('aiManager.resultsPerSource'),
      huggingFace: this.settings.get('aiManager.searchHuggingFace'),
    };
    return (
      this.bridge?.invoke<CatalogResult>(ModelRuntimeChannel.SearchCatalog, query) ??
      Promise.resolve({ models: [], failedSources: [] })
    );
  }

  /**
   * Downloads a model's weights. Subscribe with {@link onPullProgress} first: the returned promise
   * stays outstanding for the whole pull, which can be many minutes.
   * @param name The model reference to pull.
   * @returns Returns true when the model finished downloading.
   */
  public async pull(name: string): Promise<boolean> {
    this.log.info('model-manager.runtime', 'IPC pull model', name);
    if (this.bridge === undefined) {
      return false;
    }
    // Followed for the pull's last word: whether it was cancelled, and why it failed.
    let last: ModelPullProgress | null = null;
    const unfollow: () => void = this.onPullProgress((progress: ModelPullProgress): void => {
      if (progress.model === name) {
        last = progress;
      }
    });
    this.cancelling.delete(name);
    try {
      const pulled: boolean = await this.bridge.invoke<boolean>(ModelRuntimeChannel.Pull, name);
      this.notifyPulled(name, pulled, last);
      return pulled;
    } finally {
      unfollow();
      this.cancelling.delete(name);
    }
  }

  /**
   * Reports how a pull ended (#1491): "{model} downloaded", or "Couldn't download {model}" with the
   * reason, which stays until dismissed. A pull the user cancelled raises nothing.
   * @param name The model reference.
   * @param pulled Whether it finished downloading.
   * @param last The pull's last progress update, or null when none arrived.
   */
  private notifyPulled(name: string, pulled: boolean, last: ModelPullProgress | null): void {
    if (pulled) {
      this.notifications.notify({
        severity: 'success',
        title: `${name} downloaded`,
        key: `model-pull:${name}`,
        type: ModelNotificationType.PullFinished,
        desktop: true,
      });
      return;
    }
    if (this.cancelling.has(name) || last?.stage === 'cancelled') {
      return;
    }
    this.notifications.notify({
      severity: 'error',
      title: `Couldn't download ${name}`,
      ...(last?.error === undefined ? {} : { detail: last.error }),
      key: `model-pull:${name}`,
      sticky: true,
      type: ModelNotificationType.PullFailed,
      desktop: true,
    });
  }

  /**
   * Cancels an in-flight pull.
   * @param name The model reference whose pull to cancel.
   * @returns Returns true when there was a pull to cancel.
   */
  public cancelPull(name: string): Promise<boolean> {
    this.log.info('model-manager.runtime', 'IPC cancel pull', name);
    this.cancelling.add(name);
    return (
      this.bridge?.invoke<boolean>(ModelRuntimeChannel.CancelPull, name) ?? Promise.resolve(false)
    );
  }

  /**
   * Subscribes to pull progress. Updates carry the model they concern, so one subscription serves any
   * number of concurrent pulls.
   * @param listener Receives each progress update.
   * @returns Returns an unsubscribe function (a no-op outside Electron).
   */
  public onPullProgress(listener: (progress: ModelPullProgress) => void): () => void {
    return (
      this.bridge?.on(ModelRuntimeChannel.PullProgress, (...args: unknown[]): void =>
        listener(args[0] as ModelPullProgress),
      ) ?? ((): void => undefined)
    );
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
  public async install(): Promise<RuntimeInstallation> {
    this.log.info('model-manager.runtime', 'IPC install managed runtime');
    if (this.bridge === undefined) {
      return { kind: 'absent', executable: '', version: '' };
    }
    // Followed for why an install failed: the result alone only says nothing was installed.
    let last: RuntimeInstallProgress | null = null;
    const unfollow: () => void = this.onInstallProgress(
      (progress: RuntimeInstallProgress): void => {
        last = progress;
      },
    );
    try {
      const installation: RuntimeInstallation = await this.bridge.invoke<RuntimeInstallation>(
        ModelRuntimeChannel.Install,
      );
      this.notifyInstalled(installation, last);
      return installation;
    } finally {
      unfollow();
    }
  }

  /**
   * Reports how a runtime install ended (#1491): installed, with its version, or failed, with the
   * reason, which stays until dismissed.
   * @param installation The resulting installation.
   * @param last The install's last progress update, or null when none arrived.
   */
  private notifyInstalled(
    installation: RuntimeInstallation,
    last: RuntimeInstallProgress | null,
  ): void {
    if (installation.kind !== 'absent' && last?.stage !== 'failed') {
      this.notifications.notify({
        severity: 'success',
        title: 'Model runtime installed',
        ...(installation.version === '' ? {} : { detail: `Version ${installation.version}` }),
        key: 'model-runtime-install',
        type: ModelNotificationType.InstallFinished,
        desktop: true,
      });
      return;
    }
    this.notifications.notify({
      severity: 'error',
      title: "Couldn't install the model runtime",
      ...(last?.error === undefined ? {} : { detail: last.error }),
      key: 'model-runtime-install',
      sticky: true,
      type: ModelNotificationType.InstallFailed,
      desktop: true,
    });
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
