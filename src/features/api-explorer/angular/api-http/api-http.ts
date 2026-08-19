import { inject, Service } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import { Bridge } from '@shared/api/bridge';
import { ApiClientChannel } from '@shared/api/api-client-channels';
import { HttpOutcome, ResolvedHttpRequest } from '@shared/api/api-client-types';

/**
 * The renderer client for the API Explorer's request engine: a thin, typed wrapper over the generic
 * {@link Bridge} that names the {@link ApiClientChannel} channels, so no panel touches
 * `window.bridge` directly.
 *
 * Outside Electron — the browser-served development build, and every unit test — there is no engine,
 * so a send degrades to a failure outcome rather than throwing. Callers therefore need no environment
 * check: they render the failure they would render for a refused connection.
 */
@Service()
export class ApiHttp {
  /**
   * Holds the IPC transport, or undefined when running outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Performs one resolved request.
   * @param request The request to perform.
   * @returns Returns a promise resolving the outcome; it never rejects.
   */
  public send(request: ResolvedHttpRequest): Promise<HttpOutcome> {
    this.log.debug('api-explorer.http', 'Sending request', {
      id: request.id,
      method: request.method,
    });
    return (
      this.bridge?.invoke<HttpOutcome>(ApiClientChannel.Send, request) ??
      Promise.resolve({
        kind: 'failure',
        id: request.id,
        message: 'The request engine is unavailable outside the desktop application.',
        cancelled: false,
        durationMs: 0,
      })
    );
  }

  /**
   * Aborts an in-flight request. Harmless when the request has already finished.
   * @param id The identifier of the request to abort.
   */
  public cancel(id: string): void {
    this.log.debug('api-explorer.http', 'Cancelling request', { id });
    this.bridge?.send(ApiClientChannel.Cancel, id);
  }
}
