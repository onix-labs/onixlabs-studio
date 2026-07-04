import { inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import type { AiClient } from '@shared/api/ai-channels';
import type { AiAuthStatus, AiVerifyResult } from '@shared/api/ai-types';
import { Ai } from '@shared/angular/services/ai/ai';

/**
 * The status reported when the agent bridge is unavailable (outside Electron — served as a plain web
 * app or under unit tests).
 */
const UNAVAILABLE_STATUS: AiAuthStatus = {
  source: 'none',
  available: false,
  hasStoredKey: false,
  detail: 'The AI agent is only available when running inside Studio.',
};

/**
 * Renderer-side wrapper around the agent auth operations (the {@link Ai} client over `window.bridge`).
 *
 * It surfaces the current {@link AiAuthStatus} as a signal and forwards key-management and
 * verification requests to the main process. The API key never crosses the bridge — only status,
 * configuration, and verification calls do. Outside Electron every operation degrades to a safe
 * unavailable result so callers never throw.
 */
@Service()
export class AiAuth {
  /**
   * Holds the agent client, or undefined when running outside Electron.
   */
  private readonly api: AiClient | undefined = inject(Ai).client;

  /**
   * Holds the latest known authentication status.
   */
  private readonly statusSignal: WritableSignal<AiAuthStatus> =
    signal<AiAuthStatus>(UNAVAILABLE_STATUS);

  /**
   * Gets the latest known authentication status.
   */
  public readonly status: Signal<AiAuthStatus> = this.statusSignal.asReadonly();

  /**
   * Gets a value indicating whether a real agent bridge is available (i.e. running in Electron).
   */
  public readonly isAvailable: boolean = this.api !== undefined;

  /**
   * Refreshes and returns the current authentication status.
   * @returns Returns the resolved {@link AiAuthStatus}.
   */
  public async refresh(): Promise<AiAuthStatus> {
    const status: AiAuthStatus = (await this.api?.getAuthStatus()) ?? UNAVAILABLE_STATUS;
    this.statusSignal.set(status);
    return status;
  }

  /**
   * Stores a user-supplied API key and updates the status.
   * @param key The Anthropic API key to store.
   * @returns Returns the updated {@link AiAuthStatus}.
   */
  public async setApiKey(key: string): Promise<AiAuthStatus> {
    const status: AiAuthStatus = (await this.api?.setApiKey(key)) ?? UNAVAILABLE_STATUS;
    this.statusSignal.set(status);
    return status;
  }

  /**
   * Clears any stored API key and updates the status.
   * @returns Returns the updated {@link AiAuthStatus}.
   */
  public async clearApiKey(): Promise<AiAuthStatus> {
    const status: AiAuthStatus = (await this.api?.clearApiKey()) ?? UNAVAILABLE_STATUS;
    this.statusSignal.set(status);
    return status;
  }

  /**
   * Runs a minimal agent turn to confirm authentication works end-to-end.
   * @returns Returns the {@link AiVerifyResult}.
   */
  public verifyAuthentication(): Promise<AiVerifyResult> {
    return (
      this.api?.verifyAuthentication() ??
      Promise.resolve({ ok: false, detail: UNAVAILABLE_STATUS.detail })
    );
  }
}
