import { inject, Service } from '@angular/core';
import { Display } from '@shared/angular/services/display/display';
import { SETTINGS_BY_KEY } from '@shared/angular/services/settings/settings-registry';
import type { SettingDef } from '@shared/angular/services/settings/settings-schema';

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
   * Holds the display service backing the graphics-acceleration recommendation.
   */
  private readonly display: Display = inject(Display);

  /**
   * Resolves the dynamic description for a setting key, or undefined when the registry's static
   * description should be used.
   * @param key The setting key.
   * @returns Returns the dynamic description, or undefined.
   */
  public resolve(key: string): string | undefined {
    if (key === 'display.graphicsAcceleration') {
      return this.graphicsAccelerationHint();
    }
    return undefined;
  }

  /**
   * Builds the graphics-acceleration hint, naming what the automatic mode resolves to on this system
   * (and the detected GPU, when known). Appended to the registry's static description rather than
   * replacing it, so the levels stay explained while the machine-specific part is added.
   * @returns Returns the hint text.
   */
  private graphicsAccelerationHint(): string {
    const level: string =
      this.display.recommendedGraphicsAcceleration === 'full' ? 'Full' : 'Limited';
    const gpu: string = this.display.gpuDescription;
    const detail: string = gpu.length > 0 ? ` (${gpu} detected)` : '';
    const setting: SettingDef | undefined = SETTINGS_BY_KEY.get('display.graphicsAcceleration');
    return `${setting?.description ?? ''} Automatic resolves to ${level} on this system${detail}.`;
  }
}
