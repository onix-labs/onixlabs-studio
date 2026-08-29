import * as path from 'node:path';
import { app } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { ModelRuntimeChannel } from '@shared/api/model-runtime-channels';
import {
  ModelPullProgress,
  ModelRuntimeStatus,
  RuntimeInstallProgress,
} from '@shared/api/model-runtime-types';
import { CatalogQuery } from '@shared/api/model-catalog-types';
import { resolveOllamaOrigin } from '../../ai/ollama-endpoint';
import { ContributionContext, MainContribution } from '../main-contribution';
import { CuratedCatalogSource } from './curated-catalog-source';
import { HubFetch, HubResponse, HuggingFaceCatalogSource } from './huggingface-catalog-source';
import { ModelCatalog } from './model-catalog';
import { ModelRuntime } from './model-runtime';
import { OllamaProvisioner } from './ollama-provisioner';
import { OllamaRuntime } from './ollama-runtime';

/**
 * How often, in milliseconds, the runtime's status is polled while a consumer is watching.
 */
const POLL_INTERVAL_MS: number = 3_000;

/**
 * The local model-runtime backend contribution — the AI Model Manager's main-process half (#409). It
 * exposes one {@link ModelRuntime}'s read operations over the {@link ModelRuntimeChannel} channels and
 * pushes server-status changes to the renderer. It declares no permissions: talking to a local HTTP
 * server needs none.
 *
 * Unlike the Docker contribution, this cannot subscribe to an engine event stream, because Ollama has
 * no equivalent of `/events`. Status is therefore *polled* — but only while a view is watching
 * (ref-counted, as the System Monitor does with sampling), and an event is pushed only when the status
 * actually changes, so an idle manager tab costs nothing and a closed one costs nothing at all.
 */
export class ModelRuntimeContribution implements MainContribution {
  /**
   * The stable contribution id and IPC channel namespace.
   */
  public readonly id: string = 'model-runtime';

  /**
   * The runtime this contribution serves, once activated. Ollama today; the manager's runtime-agnostic
   * slot means a second implementation is a swap in {@link factory}, not a rewrite upstream.
   */
  private runtime: ModelRuntime | null = null;

  /**
   * The active status-poll interval, or null when idle.
   */
  private timer: ReturnType<typeof setInterval> | null = null;

  /**
   * The number of renderer consumers currently watching the status.
   */
  private consumers: number = 0;

  /**
   * The last status pushed to the renderer, so only genuine changes are pushed. Null before the first
   * poll completes.
   */
  private lastStatus: ModelRuntimeStatus | null = null;

  /**
   * Whether a poll is in flight, so a slow or hung server cannot let polls overlap.
   */
  private polling: boolean = false;

  /**
   * The contribution context, held so polls can push to the renderer. Null until activated.
   */
  private context: ContributionContext | null = null;

  /**
   * The abort controllers of in-flight pulls, keyed by model reference, so a cancel can find the pull
   * it belongs to (mirroring how {@link import('../../ai/ai-manager').AiManager} keys runs by request
   * id). A model can only be pulled once at a time, so its reference is a sufficient key.
   */
  private readonly pulls: Map<string, AbortController> = new Map<string, AbortController>();

  /**
   * The catalogue of models available to install. Built at activation alongside the runtime.
   */
  private catalog: ModelCatalog | null = null;

  /**
   * Builds the catalogue at activation.
   */
  private readonly catalogFactory: () => ModelCatalog;

  /**
   * Builds the runtime at activation. Deferred rather than constructed eagerly because the production
   * runtime resolves its install directory from `app.getPath('userData')`, which is only available once
   * the app is ready — and this module is imported by the contributions manifest long before that.
   */
  private readonly factory: () => ModelRuntime;

  /**
   * Initializes a new instance of the {@link ModelRuntimeContribution} class.
   * @param runtime The runtime to serve; when omitted, the production Ollama runtime is built at
   * activation.
   * @param catalog The catalogue to serve; when omitted, the production catalogue is built at
   * activation.
   */
  public constructor(runtime?: ModelRuntime, catalog?: ModelCatalog) {
    this.factory = runtime === undefined ? defaultRuntime : (): ModelRuntime => runtime;
    this.catalogFactory = catalog === undefined ? defaultCatalog : (): ModelCatalog => catalog;
  }

  /**
   * Wires the operation channels and the watch requests. Polling itself does not begin until a
   * consumer asks for it.
   * @param context The contribution context.
   */
  public activate(context: ContributionContext): void {
    this.context = context;
    const runtime: ModelRuntime = this.factory();
    this.runtime = runtime;
    const catalog: ModelCatalog = this.catalogFactory();
    this.catalog = catalog;

    context.handle(ModelRuntimeChannel.Describe, (): { id: string; displayName: string } => ({
      id: runtime.id,
      displayName: runtime.displayName,
    }));
    context.handle(ModelRuntimeChannel.List, (): Promise<unknown> => runtime.list());
    context.handle(ModelRuntimeChannel.Running, (): Promise<unknown> => runtime.running());
    context.handle(ModelRuntimeChannel.Status, (): Promise<unknown> => runtime.status());
    context.handle(
      ModelRuntimeChannel.Show,
      (_event: IpcMainInvokeEvent, name: unknown): Promise<unknown> => runtime.show(String(name)),
    );
    context.handle(
      ModelRuntimeChannel.Remove,
      (_event: IpcMainInvokeEvent, name: unknown): Promise<boolean> => runtime.remove(String(name)),
    );

    context.handle(ModelRuntimeChannel.Installation, (): Promise<unknown> =>
      runtime.installation(),
    );
    context.handle(ModelRuntimeChannel.Install, (): Promise<unknown> =>
      runtime.install((progress: RuntimeInstallProgress): void =>
        context.send(ModelRuntimeChannel.InstallProgress, progress),
      ),
    );
    context.handle(ModelRuntimeChannel.Start, (): Promise<boolean> => runtime.start());
    context.handle(ModelRuntimeChannel.Stop, (): Promise<boolean> => runtime.stop());
    context.handle(ModelRuntimeChannel.DiskUsage, (): Promise<unknown> => runtime.diskUsage());

    context.handle(
      ModelRuntimeChannel.Pull,
      (_event: IpcMainInvokeEvent, name: unknown): Promise<boolean> =>
        this.pull(runtime, context, String(name)),
    );
    context.handle(
      ModelRuntimeChannel.CancelPull,
      (_event: IpcMainInvokeEvent, name: unknown): boolean => this.cancelPull(String(name)),
    );
    context.handle(
      ModelRuntimeChannel.SearchCatalog,
      (_event: IpcMainInvokeEvent, query: unknown): Promise<unknown> =>
        catalog.search(query as CatalogQuery),
    );

    context.on(ModelRuntimeChannel.StartWatch, (): void => this.addConsumer());
    context.on(ModelRuntimeChannel.StopWatch, (): void => this.removeConsumer());

    context.log.info(
      `model runtime contribution active; serving '${runtime.id}', awaiting status watchers`,
    );
  }

  /**
   * Stops polling and drops the context. The IPC handlers are removed automatically by the registry.
   */
  public dispose(): void {
    this.context?.log.info('disposing model runtime contribution; stopping status poll');
    this.stopPolling();
    // In-flight pulls hold an open connection to the server; abort them before it goes away.
    for (const controller of this.pulls.values()) {
      controller.abort();
    }
    this.pulls.clear();
    // A server Studio started is Studio's to clean up; one the user started is left running.
    this.runtime?.dispose?.();
    this.runtime = null;
    this.catalog = null;
    this.context = null;
    this.consumers = 0;
    this.lastStatus = null;
  }

  /**
   * Runs one pull, holding its abort controller for the duration so a cancel can reach it.
   * @param runtime The runtime to pull through.
   * @param context The context to push progress on.
   * @param name The model reference to pull.
   * @returns Returns true when the model finished downloading.
   */
  private async pull(
    runtime: ModelRuntime,
    context: ContributionContext,
    name: string,
  ): Promise<boolean> {
    // A second pull of a model already being pulled would race the first for the same weights; the
    // caller is told the request was not accepted rather than being silently joined to the existing one.
    if (this.pulls.has(name)) {
      context.log.warn(`refusing a duplicate pull of '${name}'; one is already in flight`);
      return false;
    }

    const controller: AbortController = new AbortController();
    this.pulls.set(name, controller);
    context.log.info(`pulling model '${name}'`);
    try {
      return await runtime.pull(
        name,
        (progress: ModelPullProgress): void =>
          context.send(ModelRuntimeChannel.PullProgress, progress),
        controller.signal,
      );
    } finally {
      this.pulls.delete(name);
    }
  }

  /**
   * Cancels an in-flight pull.
   * @param name The model reference whose pull to cancel.
   * @returns Returns true when there was a pull to cancel.
   */
  private cancelPull(name: string): boolean {
    const controller: AbortController | undefined = this.pulls.get(name);
    if (controller === undefined) {
      return false;
    }
    this.context?.log.info(`cancelling the pull of '${name}'`);
    controller.abort();
    return true;
  }

  /**
   * Adds a watcher, starting the poll when it is the first.
   */
  private addConsumer(): void {
    this.consumers += 1;
    if (this.timer === null) {
      this.startPolling();
    }
  }

  /**
   * Removes a watcher, stopping the poll when it was the last.
   */
  private removeConsumer(): void {
    this.consumers = Math.max(0, this.consumers - 1);
    if (this.consumers === 0) {
      this.stopPolling();
    }
  }

  /**
   * Starts the status poll, taking one reading immediately so a newly-opened view does not wait a full
   * interval to learn whether the server is up.
   */
  private startPolling(): void {
    this.lastStatus = null;
    void this.poll();
    this.timer = setInterval((): void => void this.poll(), POLL_INTERVAL_MS);
  }

  /**
   * Stops the status poll.
   */
  private stopPolling(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Reads the runtime status and pushes it when it differs from the last one pushed. Skips the tick
   * when the previous read is still outstanding.
   */
  private async poll(): Promise<void> {
    const runtime: ModelRuntime | null = this.runtime;
    if (this.polling || runtime === null) {
      return;
    }
    this.polling = true;
    try {
      const status: ModelRuntimeStatus = await runtime.status();
      if (!sameStatus(this.lastStatus, status)) {
        this.lastStatus = status;
        this.context?.log.info(
          `runtime '${runtime.id}' status changed: ${status.available ? `available (${status.version ?? 'unknown version'})` : 'unavailable'}`,
        );
        this.context?.send(ModelRuntimeChannel.StatusChanged, status);
      }
    } finally {
      this.polling = false;
    }
  }
}

/**
 * Compares two runtime statuses, treating a null previous status as different from anything so the
 * first reading is always pushed. Exported for unit testing.
 * @param previous The previously pushed status, or null when none has been.
 * @param next The status just read.
 * @returns Returns true when the two are equivalent.
 */
export function sameStatus(previous: ModelRuntimeStatus | null, next: ModelRuntimeStatus): boolean {
  return (
    previous !== null && previous.available === next.available && previous.version === next.version
  );
}

/**
 * Builds the production runtime: Ollama at the environment's configured origin, with managed installs
 * kept under the user-data directory alongside the provisioned language servers.
 * @returns Returns the runtime.
 */
function defaultRuntime(): ModelRuntime {
  return new OllamaRuntime(
    resolveOllamaOrigin(process.env),
    undefined,
    new OllamaProvisioner(path.join(app.getPath('userData'), 'model-runtimes', 'ollama')),
  );
}

/**
 * Builds the production catalogue: the offline curated list first, then the Hugging Face Hub. Order
 * matters — the curated entry for a model wins over a raw Hub repo for the same reference.
 * @returns Returns the catalogue.
 */
function defaultCatalog(): ModelCatalog {
  const http: HubFetch = (url: string, init?: { signal?: AbortSignal }): Promise<HubResponse> =>
    fetch(url, init);
  return new ModelCatalog([new CuratedCatalogSource(), new HuggingFaceCatalogSource(http)]);
}

/**
 * The singleton model-runtime contribution appended to the `mainContributions` manifest.
 */
export const modelRuntimeContribution: MainContribution = new ModelRuntimeContribution();
