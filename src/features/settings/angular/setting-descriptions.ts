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
 *
 * Two resolutions are offered, differing only in which static text the dynamic part is layered onto:
 * the full description for the settings view, and the condensed one for the setup wizard. The
 * machine-specific part is the same either way, because it is usually the most useful thing on the
 * screen and shortening must not be what drops it.
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
    return this.dynamic(key, SETTINGS_BY_KEY.get(key)?.description ?? '');
  }

  /**
   * Resolves the dynamic description built on the setting's condensed text, for a surface that has
   * less room than the settings view. Falls back to the full text for a setting that states no
   * condensed one.
   * @param key The setting key.
   * @returns Returns the dynamic description, or undefined when the setting has none.
   */
  public resolveConcise(key: string): string | undefined {
    const setting: SettingDef | undefined = SETTINGS_BY_KEY.get(key);
    return this.dynamic(key, setting?.shortDescription ?? setting?.description ?? '');
  }

  /**
   * Builds the dynamic description for a setting, on top of the static text the caller chose.
   * @param key The setting key.
   * @param base The static description the hint is appended to.
   * @returns Returns the dynamic description, or undefined when the setting has none.
   */
  private dynamic(key: string, base: string): string | undefined {
    if (key === 'display.graphicsAcceleration') {
      return this.graphicsAccelerationHint(base);
    }
    return undefined;
  }

  /**
   * Builds the graphics-acceleration hint, naming what the automatic mode resolves to on this system
   * (and the detected GPU, when known). Appended to the static description rather than replacing it,
   * so the levels stay explained while the machine-specific part is added.
   * @param base The static description the hint is appended to.
   * @returns Returns the hint text.
   */
  private graphicsAccelerationHint(base: string): string {
    const level: string =
      this.display.recommendedGraphicsAcceleration === 'full' ? 'Full' : 'Limited';
    const gpu: string = this.display.gpuDescription;
    const detail: string = gpu.length > 0 ? ` (${gpu} detected)` : '';
    return `${base} Automatic resolves to ${level} on this system${detail}.`;
  }
}
