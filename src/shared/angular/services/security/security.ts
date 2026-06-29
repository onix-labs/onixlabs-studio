import { Service, signal, Signal, WritableSignal } from '@angular/core';
import type { ImageSourcePolicy, SecurityApi } from '@shared/security-types';

/**
 * Renderer-side wrapper around the security bridge exposed on `window.studio.security`.
 *
 * It surfaces the active {@link ImageSourcePolicy} as a signal and forwards changes to the main
 * process, which owns and enforces the Content-Security-Policy. Outside Electron the bridge is absent
 * and every operation degrades to a safe no-op reporting the safest policy.
 */
@Service()
export class Security {
  /**
   * Holds the security bridge, or undefined when running outside Electron.
   */
  private readonly api: SecurityApi | undefined = window.studio?.security;

  /**
   * Holds the latest known image-source policy.
   */
  private readonly policy: WritableSignal<ImageSourcePolicy> = signal<ImageSourcePolicy>('local');

  /**
   * Gets the active image-source policy.
   */
  public readonly imagePolicy: Signal<ImageSourcePolicy> = this.policy.asReadonly();

  /**
   * Gets a value indicating whether a real security bridge is available (i.e. running in Electron).
   */
  public readonly isAvailable: boolean = this.api !== undefined;

  /**
   * Initialises the service, loading the active policy from the main process.
   */
  public constructor() {
    void this.refresh();
  }

  /**
   * Refreshes and returns the active image-source policy.
   * @returns Returns the resolved {@link ImageSourcePolicy}.
   */
  public async refresh(): Promise<ImageSourcePolicy> {
    const policy: ImageSourcePolicy = (await this.api?.getImagePolicy()) ?? 'local';
    this.policy.set(policy);
    return policy;
  }

  /**
   * Sets the image-source policy, persisting it through the main process. The change takes effect the
   * next time the window loads.
   * @param policy The policy to apply.
   * @returns Returns the stored {@link ImageSourcePolicy}.
   */
  public async setImagePolicy(policy: ImageSourcePolicy): Promise<ImageSourcePolicy> {
    const stored: ImageSourcePolicy = (await this.api?.setImagePolicy(policy)) ?? this.policy();
    this.policy.set(stored);
    return stored;
  }
}
