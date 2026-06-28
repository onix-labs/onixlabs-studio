import { DOCUMENT, effect, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import type { DisplayApi } from '../../../shared/studio-api';
import { ModernUiFeatures, Settings } from '../settings/settings';

/**
 * Represents the owner of the document's GPU-rendering display policy.
 *
 * It resolves the user's "modern UI features" choice against the GPU-derived recommendation reported
 * by the main process, and applies the result to the document root by an effect: when the modern
 * features are off, the `data-corners='round'` and `data-reduced-gpu` attributes the SCSS switches on
 * are set, falling the UI back to plain rounded corners and reduced decorative effects; when on, they
 * are removed. It also mediates the hardware-acceleration preference, which can only change after a
 * relaunch.
 *
 * Outside Electron (where `window.studio` is undefined) the recommendation is "full effects" and
 * hardware acceleration reports enabled, so the browser-served build behaves as before.
 */
@Service()
export class Display {
  /**
   * Holds the document the display policy is applied to.
   */
  private readonly document: Document = inject(DOCUMENT);

  /**
   * Holds the settings service backing the modern-UI-features choice.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the display bridge exposed by the main process, or undefined outside Electron.
   */
  private readonly api: DisplayApi | undefined = window.studio?.display;

  /**
   * Gets whether the display bridge is available (true when running inside Electron). Hardware
   * acceleration can only be changed when it is.
   */
  public readonly isAvailable: boolean = this.api !== undefined;

  /**
   * Holds whether the active GPU is flagged as likely to render the heavier effects poorly. Used to
   * resolve the automatic mode and to label the recommendation in the settings hint.
   */
  public readonly recommendReducedEffects: boolean =
    this.api?.gpuRendering.recommendReducedEffects ?? false;

  /**
   * Holds a human-readable description of the active GPU for the settings hint, or an empty string
   * when it could not be identified.
   */
  public readonly gpuDescription: string = this.api?.gpuRendering.description ?? '';

  /**
   * Holds whether GPU hardware acceleration is enabled for this launch (the persisted preference).
   */
  private readonly hardwareAccelerationSignal: WritableSignal<boolean> = signal<boolean>(
    this.api?.hardwareAccelerationEnabled ?? true,
  );

  /**
   * Holds whether a hardware-acceleration change is pending a relaunch to take effect.
   */
  private readonly restartRequiredSignal: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets the modern-UI-features mode that the automatic setting resolves to, for the settings hint.
   */
  public readonly recommendedModernUi: 'on' | 'off' = this.recommendReducedEffects ? 'off' : 'on';

  /**
   * Gets whether GPU hardware acceleration is enabled (the persisted preference; a change applies
   * only after a relaunch).
   */
  public readonly hardwareAccelerationEnabled: Signal<boolean> =
    this.hardwareAccelerationSignal.asReadonly();

  /**
   * Gets whether a hardware-acceleration change is awaiting a relaunch.
   */
  public readonly restartRequired: Signal<boolean> = this.restartRequiredSignal.asReadonly();

  /**
   * Applies the resolved display policy to the document root whenever the modern-UI-features choice
   * changes.
   */
  public constructor() {
    effect((): void => {
      this.applyDisplayPolicy(this.settings.modernUiFeatures());
    });
  }

  /**
   * Persists the hardware-acceleration preference and flags that a relaunch is needed for it to take
   * effect. A no-op outside Electron.
   * @param enabled Whether hardware acceleration should be enabled on the next launch.
   */
  public setHardwareAcceleration(enabled: boolean): void {
    this.hardwareAccelerationSignal.set(enabled);
    this.restartRequiredSignal.set(enabled !== (this.api?.hardwareAccelerationEnabled ?? true));
    void this.api?.setHardwareAcceleration(enabled);
  }

  /**
   * Relaunches the application so a pending hardware-acceleration change can take effect.
   */
  public relaunch(): void {
    this.api?.relaunch();
  }

  /**
   * Resolves the modern-UI-features choice against the GPU recommendation and toggles the document
   * attributes the SCSS uses to fall back to plain rounded corners and reduced effects.
   * @param mode The modern-UI-features mode to apply.
   */
  private applyDisplayPolicy(mode: ModernUiFeatures): void {
    const reduceEffects: boolean =
      mode === 'off' ? true : mode === 'on' ? false : this.recommendReducedEffects;
    const root: HTMLElement = this.document.documentElement;

    if (reduceEffects) {
      root.setAttribute('data-corners', 'round');
      root.setAttribute('data-reduced-gpu', 'true');
    } else {
      root.removeAttribute('data-corners');
      root.removeAttribute('data-reduced-gpu');
    }
  }
}
