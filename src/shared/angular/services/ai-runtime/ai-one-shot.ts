import { inject, Service } from '@angular/core';
import { AiEvent, AiProviderId, AgentSurface } from '@shared/api/ai-types';
import { Log } from '@shared/angular/services/log/log';
import { AiRuntime } from './ai-runtime';

/**
 * What a one-shot request asks for.
 */
export interface AiOneShotRequest {
  /**
   * Gets the provider to run through.
   */
  readonly providerId: AiProviderId;

  /**
   * Gets the model, or empty for the provider's default.
   */
  readonly model: string;

  /**
   * Gets the prompt.
   */
  readonly prompt: string;

  /**
   * Gets the surface the run is attributed to, which decides the skills it is offered.
   */
  readonly surface: AgentSurface;

  /**
   * Gets how long the run may take before it is aborted.
   */
  readonly timeoutMs: number;

  /**
   * Gets a signal that aborts the run, or undefined.
   */
  readonly signal?: AbortSignal;
}

/**
 * What a one-shot run produced: its text, or why there is none.
 */
export type AiOneShotResult =
  { readonly text: string; readonly error: null } | { readonly text: null; readonly error: string };

/**
 * Runs one unattended model turn and hands back its text (#1263) — the commit-message generator's
 * pattern, for callers that need a whole answer rather than a conversation. The run is read-only chat:
 * any tool permission it asks for is denied, so it can never sit waiting on a prompt nobody sees.
 */
@Service()
export class AiOneShot {
  /**
   * Holds the agent runtime.
   */
  private readonly runtime: AiRuntime = inject(AiRuntime);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Gets whether runs are possible here at all.
   */
  public readonly isAvailable: boolean = this.runtime.isAvailable;

  /**
   * Runs one turn.
   * @param request What to run.
   * @returns Returns the text, or why there is none.
   */
  public complete(request: AiOneShotRequest): Promise<AiOneShotResult> {
    if (!this.runtime.isAvailable) {
      return Promise.resolve({ text: null, error: 'AI is only available in the desktop app.' });
    }
    if (request.signal?.aborted === true) {
      return Promise.resolve({ text: null, error: 'Cancelled.' });
    }
    return new Promise<AiOneShotResult>((resolve: (result: AiOneShotResult) => void): void => {
      let text: string = '';
      let settled: boolean = false;
      let dispose: () => void = (): void => undefined;
      const requestId: string = this.runtime.run(request.providerId, request.prompt, {
        mode: 'chat',
        surface: request.surface,
        model: request.model,
      });
      const finish: (result: AiOneShotResult) => void = (result: AiOneShotResult): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        dispose();
        request.signal?.removeEventListener('abort', onAbort);
        resolve(result);
      };
      const onAbort: () => void = (): void => {
        this.runtime.abort(requestId);
        finish({ text: null, error: 'Cancelled.' });
      };
      const timer: ReturnType<typeof setTimeout> = setTimeout((): void => {
        this.log.warn('AiOneShot', 'Run timed out; aborting', requestId);
        this.runtime.abort(requestId);
        finish({ text: null, error: 'The AI took too long to answer.' });
      }, request.timeoutMs);
      request.signal?.addEventListener('abort', onAbort);
      dispose = this.runtime.onEvent((event: AiEvent): void => {
        if (event.requestId !== requestId) {
          return;
        }
        if (event.kind === 'text') {
          text += event.delta;
          return;
        }
        if (event.kind === 'permission') {
          this.runtime.respondPermission(event.permissionId, false);
          return;
        }
        if (event.kind === 'status' && event.state !== 'started') {
          finish(
            event.state === 'completed'
              ? { text, error: null }
              : { text: null, error: event.detail || `The run ended '${event.state}'.` },
          );
        }
      });
    });
  }
}
