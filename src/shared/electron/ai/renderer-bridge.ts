import { randomUUID } from 'node:crypto';
import { BrowserWindow, ipcMain, IpcMainEvent, WebContents } from 'electron';
import type { AiBridgeReply, AiBridgeScope } from '@shared/api/ai-types';
import { AiChannel } from '@shared/api/ai-channels';
import { logger } from '../logger';

/**
 * Holds how long (ms) to wait for the renderer to answer a capability request before failing.
 */
const REQUEST_TIMEOUT_MS: number = 15_000;

/**
 * Tracks one outstanding capability request awaiting the renderer's reply.
 */
interface PendingRequest {
  /**
   * Resolves the request with the capability's result.
   */
  readonly resolve: (result: unknown) => void;

  /**
   * Rejects the request with an error.
   */
  readonly reject: (error: Error) => void;

  /**
   * Holds the timeout that fails the request if the renderer never answers.
   */
  readonly timer: NodeJS.Timeout;

  /**
   * Removes the listeners that fail the request when its window goes away.
   */
  readonly detach: () => void;
}

/**
 * Lets the main process call in-app capabilities that live in the renderer (reading or writing the
 * live editor, etc.). It sends a correlation-identified request to the window and resolves the
 * matching reply, failing the request if the renderer does not answer in time. This is the transport
 * the agent's in-app tools (#142) and permission prompts build on; capabilities register on the
 * renderer side ({@link import('../../angular/services/ai-runtime/ai-runtime').AiRuntime}).
 */
export class RendererBridge {
  /**
   * Holds the function returning the window capability requests are sent to.
   */
  private readonly windowGetter: () => BrowserWindow | null;

  /**
   * Holds the in-flight requests, keyed by correlation id.
   */
  private readonly pending: Map<string, PendingRequest> = new Map<string, PendingRequest>();

  /**
   * Initializes a new instance of the {@link RendererBridge} class.
   * @param windowGetter A function that returns the window to send capability requests to.
   */
  public constructor(windowGetter: () => BrowserWindow | null) {
    this.windowGetter = windowGetter;
  }

  /**
   * Registers the IPC listener that settles requests when the renderer replies.
   */
  public register(): void {
    logger.trace('RendererBridge.register', 'Registered bridge-reply IPC listener');
    ipcMain.on(AiChannel.BridgeReply, (_event: IpcMainEvent, reply: unknown): void => {
      if (this.isReply(reply)) {
        this.settle(reply);
      }
    });
  }

  /**
   * Narrows an untrusted IPC payload to a {@link AiBridgeReply}.
   * @param value The payload from the renderer.
   * @returns Returns true when the payload has the required shape.
   */
  private isReply(value: unknown): value is AiBridgeReply {
    if (value === null || typeof value !== 'object') {
      return false;
    }
    const record: Record<string, unknown> = value as Record<string, unknown>;
    return typeof record['requestId'] === 'string' && typeof record['ok'] === 'boolean';
  }

  /**
   * Invokes an in-app capability in the renderer and resolves with its result.
   * @param capability The capability name.
   * @param input The capability input.
   * @param timeoutMs How long to wait for the reply before failing; defaults to
   * {@link REQUEST_TIMEOUT_MS}. A long-running capability (e.g. running a file and awaiting its exit)
   * passes a larger value so it is not cut short by the default.
   * @param scope The run the request comes from, stamped by the caller from the run's own request so
   * the renderer resolves the agent's own workspace rather than the focused one.
   * @returns Returns the capability's result, or rejects on error, timeout, or absent window.
   */
  public request(
    capability: string,
    input: unknown,
    timeoutMs: number = REQUEST_TIMEOUT_MS,
    scope?: AiBridgeScope,
  ): Promise<unknown> {
    const window: BrowserWindow | null = this.windowGetter();
    if (window === null || window.isDestroyed() || window.webContents.isDestroyed()) {
      logger.warn('RendererBridge.request', `No window available for capability "${capability}"`);
      return Promise.reject(new Error('No window is available to handle the capability request.'));
    }
    const requestId: string = randomUUID();
    logger.trace('RendererBridge.request', `Dispatching capability "${capability}" (${requestId})`);
    return new Promise<unknown>(
      (resolve: (result: unknown) => void, reject: (error: Error) => void): void => {
        const contents: WebContents = window.webContents;
        // A window that closes, or a renderer that crashes, will never reply: fail the request at
        // once rather than leaving the run waiting out the whole timeout for an answer that cannot come.
        const onGone: () => void = (): void => {
          this.fail(
            requestId,
            `The window closed before the capability "${capability}" could answer.`,
          );
        };
        contents.once('destroyed', onGone);
        contents.once('render-process-gone', onGone);
        const detach: () => void = (): void => {
          contents.removeListener('destroyed', onGone);
          contents.removeListener('render-process-gone', onGone);
        };
        const timer: NodeJS.Timeout = setTimeout((): void => {
          this.fail(requestId, `The capability "${capability}" timed out.`);
        }, timeoutMs);
        this.pending.set(requestId, { resolve, reject, timer, detach });
        window.webContents.send(AiChannel.BridgeRequest, {
          requestId,
          capability,
          input,
          ...(scope === undefined ? {} : { scope }),
        });
      },
    );
  }

  /**
   * Fails a pending request without a reply — it timed out, or its window went away.
   * @param requestId The request's correlation id.
   * @param message The error the request is rejected with.
   */
  private fail(requestId: string, message: string): void {
    const pending: PendingRequest | undefined = this.take(requestId);
    if (pending === undefined) {
      return;
    }
    logger.error('RendererBridge.fail', `${message} (${requestId})`);
    pending.reject(new Error(message));
  }

  /**
   * Removes a pending request and releases its timer and window listeners, so it settles once.
   * @param requestId The request's correlation id.
   * @returns Returns the request, or undefined when it has already settled.
   */
  private take(requestId: string): PendingRequest | undefined {
    const pending: PendingRequest | undefined = this.pending.get(requestId);
    if (pending === undefined) {
      return undefined;
    }
    clearTimeout(pending.timer);
    pending.detach();
    this.pending.delete(requestId);
    return pending;
  }

  /**
   * Settles the pending request matching a reply.
   * @param reply The renderer's reply.
   */
  private settle(reply: AiBridgeReply): void {
    const pending: PendingRequest | undefined = this.take(reply.requestId);
    if (pending === undefined) {
      return;
    }
    if (reply.ok) {
      logger.trace('RendererBridge.settle', `Capability reply resolved (${reply.requestId})`);
      pending.resolve(reply.result);
    } else {
      logger.error(
        'RendererBridge.settle',
        `Capability reply failed (${reply.requestId})`,
        new Error(reply.error ?? 'The capability failed.'),
      );
      pending.reject(new Error(reply.error ?? 'The capability failed.'));
    }
  }
}
