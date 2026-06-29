import { inject, Service } from '@angular/core';
import { Display } from '@shared/angular/services/display/display';

/**
 * Resolves dynamic descriptions for settings whose help text depends on runtime state, keyed by
 * setting key. A setting without a dynamic description falls back to the static text in the registry.
 *
 * This is the F4 seam: like {@link import('./setting-bindings').SettingBindings}, it keeps the
 * service-specific logic (here, the GPU-derived modern-UI hint) out of the registry and the renderer.
 */
@Service()
export class SettingDescriptions {
  /**
   * Holds the display service backing the modern-UI-features recommendation.
   */
  private readonly display: Display = inject(Display);

  /**
   * Resolves the dynamic description for a setting key, or undefined when the registry's static
   * description should be used.
   * @param key The setting key.
   * @returns Returns the dynamic description, or undefined.
   */
  public resolve(key: string): string | undefined {
    if (key === 'appearance.modernUiFeatures') {
      return this.modernUiHint();
    }
    return undefined;
  }

  /**
   * Builds the modern-UI-features hint, naming what the automatic mode recommends for this system
   * (and the detected GPU, when known).
   * @returns Returns the hint text.
   */
  private modernUiHint(): string {
    const recommended: string = this.display.recommendedModernUi === 'on' ? 'On' : 'Off';
    const gpu: string = this.display.gpuDescription;
    const detail: string = gpu.length > 0 ? ` (${gpu} detected)` : '';
    return (
      'Squircle corners and richer visual effects. Turn off if the interface looks corrupted or ' +
      `sluggish. Recommended for this system: ${recommended}${detail}.`
    );
  }
}
