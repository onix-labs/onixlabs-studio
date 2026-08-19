import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import { ApiClientChannel } from '@shared/api/api-client-channels';
import { HttpFailure, HttpOutcome, ResolvedHttpRequest } from '@shared/api/api-client-types';
import { ContributionContext, MainContribution } from '../main-contribution';

/**
 * The largest response body read into memory, in bytes. A request that returns more than this is
 * truncated rather than allowed to exhaust the main process — the API Explorer is for inspecting
 * responses, not for downloading files, and a 32 MiB ceiling is far above any payload a person reads.
 */
const MAX_BODY_BYTES: number = 32 * 1024 * 1024;

/**
 * The methods that never carry a request body, whatever the editor holds. Sending one is a protocol
 * error rather than a preference, so the engine drops it instead of passing it on.
 */
const BODYLESS_METHODS: ReadonlySet<string> = new Set<string>(['GET', 'HEAD']);

/**
 * The API Explorer's main-process half: it performs one resolved request and reports the outcome.
 *
 * It runs here rather than in the renderer because the renderer is a browser context — CORS would
 * apply to every call, forbidden headers such as `Host`, `Origin` and `Cookie` could not be set, and a
 * redirect chain could not be observed. None of that constrains the main process, so what the user
 * types is what goes on the wire. It declares no permissions: outbound HTTP is not a privileged
 * resource in Studio's broker, and the URL is the user's own.
 *
 * The engine holds no domain state. It knows nothing of collections, environments, variables or
 * history — the renderer resolves all of that and hands over a finished {@link ResolvedHttpRequest}.
 * The only state here is the set of in-flight aborts, so a send can be cancelled.
 */
export class ApiClientContribution implements MainContribution {
  /**
   * The stable contribution id and IPC channel namespace.
   */
  public readonly id: string = 'api-client';

  /**
   * The abort controllers of in-flight requests, keyed by request id, so a cancel can find the send it
   * belongs to. A request is in flight at most once at a time, so its id is a sufficient key.
   */
  private readonly inFlight: Map<string, AbortController> = new Map<string, AbortController>();

  /**
   * Wires the send and cancel channels.
   * @param context The surface the contribution reaches the application through.
   */
  public activate(context: ContributionContext): void {
    context.handle(
      ApiClientChannel.Send,
      (_event: IpcMainInvokeEvent, ...args: unknown[]): Promise<HttpOutcome> =>
        this.send(args[0] as ResolvedHttpRequest, context),
    );

    context.on(ApiClientChannel.Cancel, (_event: IpcMainEvent, ...args: unknown[]): void => {
      const id: string = args[0] as string;
      this.inFlight.get(id)?.abort();
      context.log.info('Cancelled request', { id });
    });

    context.log.info('API client engine ready');
  }

  /**
   * Aborts every in-flight request, so a closed view or a quitting application leaves no socket open.
   */
  public dispose(): void {
    for (const controller of this.inFlight.values()) {
      controller.abort();
    }
    this.inFlight.clear();
  }

  /**
   * Performs one request and reports its outcome.
   *
   * This never rejects. A refused connection, an unresolvable host, a timeout and a cancellation are
   * all ordinary results in this view — the user is probing an API and expects to be shown what
   * happened, not to have a dialog thrown at them — so every path resolves to an {@link HttpOutcome}
   * and the renderer has one shape to render.
   * @param request The resolved request to perform.
   * @param context The contribution context, for logging.
   * @returns Returns a promise resolving the outcome of the send.
   */
  private async send(
    request: ResolvedHttpRequest,
    context: ContributionContext,
  ): Promise<HttpOutcome> {
    const controller: AbortController = new AbortController();
    this.inFlight.set(request.id, controller);
    const timeout: ReturnType<typeof setTimeout> = setTimeout((): void => {
      controller.abort(new Error(`Timed out after ${request.timeoutMs}ms`));
    }, request.timeoutMs);
    const started: number = performance.now();

    try {
      context.log.info('Sending request', { method: request.method, url: request.url });
      const response: Response = await fetch(request.url, {
        method: request.method,
        headers: { ...request.headers },
        body: BODYLESS_METHODS.has(request.method) ? null : request.body,
        redirect: request.followRedirects ? 'follow' : 'manual',
        signal: controller.signal,
      });
      const firstByteMs: number = performance.now() - started;
      const buffer: ArrayBuffer = await response.arrayBuffer();
      const totalMs: number = performance.now() - started;
      const bytes: Uint8Array = new Uint8Array(buffer);
      const body: string = new TextDecoder().decode(bytes.subarray(0, MAX_BODY_BYTES));

      return {
        kind: 'response',
        id: request.id,
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        body,
        sizeBytes: bytes.byteLength,
        finalUrl: response.url === '' ? request.url : response.url,
        redirected: response.redirected,
        timings: { firstByteMs, totalMs },
      };
    } catch (error: unknown) {
      return this.toFailure(request, error, performance.now() - started, context);
    } finally {
      clearTimeout(timeout);
      this.inFlight.delete(request.id);
    }
  }

  /**
   * Converts a thrown transport error into a failure outcome, separating a cancellation from a genuine
   * error: the user aborting a send is not a fault and is reported as such.
   * @param request The request that failed.
   * @param error The thrown value.
   * @param durationMs How long the attempt took, in milliseconds.
   * @param context The contribution context, for logging.
   * @returns Returns the failure outcome.
   */
  private toFailure(
    request: ResolvedHttpRequest,
    error: unknown,
    durationMs: number,
    context: ContributionContext,
  ): HttpFailure {
    const aborted: boolean = error instanceof Error && error.name === 'AbortError';
    const message: string = this.describe(error);
    if (aborted) {
      context.log.info('Request aborted', { url: request.url, message });
    } else {
      context.log.warn('Request failed', { url: request.url, message });
    }
    return { kind: 'failure', id: request.id, message, cancelled: aborted, durationMs };
  }

  /**
   * Renders a thrown value as a message fit to show the user. Node's fetch reports the useful detail —
   * `ECONNREFUSED`, `ENOTFOUND`, a TLS failure — on the error's cause rather than its message, so the
   * cause is unwrapped rather than reporting the uniformly useless "fetch failed".
   * @param error The thrown value.
   * @returns Returns the message to show.
   */
  private describe(error: unknown): string {
    if (!(error instanceof Error)) {
      return String(error);
    }
    const cause: unknown = (error as { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message !== '') {
      return cause.message;
    }
    return error.message;
  }
}

/**
 * The API Explorer backend contribution instance registered in the main manifest.
 */
export const apiClientContribution: ApiClientContribution = new ApiClientContribution();
