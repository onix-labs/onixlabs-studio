import type { IpcMainInvokeEvent } from 'electron';
import { ModelRuntimeChannel } from '@shared/api/model-runtime-channels';
import { ModelRuntimeStatus } from '@shared/api/model-runtime-types';
import { resolveOllamaOrigin } from '../../ai/ollama-endpoint';
import { ContributionContext, MainContribution } from '../main-contribution';
import { ModelRuntime } from './model-runtime';
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
   * The runtime this contribution serves. Ollama today; the manager's runtime-agnostic slot means a
   * second implementation is a swap here, not a rewrite upstream.
   */
  private readonly runtime: ModelRuntime;

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
   * Initializes a new instance of the {@link ModelRuntimeContribution} class.
   * @param runtime The runtime to serve; defaults to Ollama at the environment's configured origin.
   */
  public constructor(runtime?: ModelRuntime) {
    this.runtime = runtime ?? new OllamaRuntime(resolveOllamaOrigin(process.env));
  }

  /**
   * Wires the operation channels and the watch requests. Polling itself does not begin until a
   * consumer asks for it.
   * @param context The contribution context.
   */
  public activate(context: ContributionContext): void {
    this.context = context;

    context.handle(ModelRuntimeChannel.List, (): Promise<unknown> => this.runtime.list());
    context.handle(ModelRuntimeChannel.Running, (): Promise<unknown> => this.runtime.running());
    context.handle(ModelRuntimeChannel.Status, (): Promise<unknown> => this.runtime.status());
    context.handle(
      ModelRuntimeChannel.Show,
      (_event: IpcMainInvokeEvent, name: unknown): Promise<unknown> =>
        this.runtime.show(String(name)),
    );
    context.handle(
      ModelRuntimeChannel.Remove,
      (_event: IpcMainInvokeEvent, name: unknown): Promise<boolean> =>
        this.runtime.remove(String(name)),
    );

    context.on(ModelRuntimeChannel.StartWatch, (): void => this.addConsumer());
    context.on(ModelRuntimeChannel.StopWatch, (): void => this.removeConsumer());

    context.log.info(
      `model runtime contribution active; serving '${this.runtime.id}', awaiting status watchers`,
    );
  }

  /**
   * Stops polling and drops the context. The IPC handlers are removed automatically by the registry.
   */
  public dispose(): void {
    this.context?.log.info('disposing model runtime contribution; stopping status poll');
    this.stopPolling();
    this.context = null;
    this.consumers = 0;
    this.lastStatus = null;
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
    if (this.polling) {
      return;
    }
    this.polling = true;
    try {
      const status: ModelRuntimeStatus = await this.runtime.status();
      if (!sameStatus(this.lastStatus, status)) {
        this.lastStatus = status;
        this.context?.log.info(
          `runtime '${this.runtime.id}' status changed: ${status.available ? `available (${status.version ?? 'unknown version'})` : 'unavailable'}`,
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
 * The singleton model-runtime contribution appended to the `mainContributions` manifest.
 */
export const modelRuntimeContribution: MainContribution = new ModelRuntimeContribution();
