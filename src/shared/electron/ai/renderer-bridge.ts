import { randomUUID } from 'node:crypto';
import { BrowserWindow, ipcMain, IpcMainEvent } from 'electron';
import type { AiBridgeReply } from '@shared/ai-types';
import { AiChannel } from '@shared/api/ai-channels';

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
   * @returns Returns the capability's result, or rejects on error, timeout, or absent window.
   */
  public request(capability: string, input: unknown): Promise<unknown> {
    const window: BrowserWindow | null = this.windowGetter();
    if (window === null) {
      return Promise.reject(new Error('No window is available to handle the capability request.'));
    }
    const requestId: string = randomUUID();
    return new Promise<unknown>(
      (resolve: (result: unknown) => void, reject: (error: Error) => void): void => {
        const timer: NodeJS.Timeout = setTimeout((): void => {
          this.pending.delete(requestId);
          reject(new Error(`The capability "${capability}" timed out.`));
        }, REQUEST_TIMEOUT_MS);
        this.pending.set(requestId, { resolve, reject, timer });
        window.webContents.send(AiChannel.BridgeRequest, { requestId, capability, input });
      },
    );
  }

  /**
   * Settles the pending request matching a reply.
   * @param reply The renderer's reply.
   */
  private settle(reply: AiBridgeReply): void {
    const pending: PendingRequest | undefined = this.pending.get(reply.requestId);
    if (pending === undefined) {
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(reply.requestId);
    if (reply.ok) {
      pending.resolve(reply.result);
    } else {
      pending.reject(new Error(reply.error ?? 'The capability failed.'));
    }
  }
}
