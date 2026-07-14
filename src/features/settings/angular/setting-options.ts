import { inject, Service } from '@angular/core';
import { FontCatalog } from '@shared/angular/services/fonts/font-catalog';
import type { ChoiceOption } from '@shared/angular/services/settings/settings-schema';

/**
 * Resolves dynamic options for settings whose choices depend on runtime state, keyed by setting key. A
 * setting without dynamic options falls back to the static `options` declared on its registry control.
 *
 * This mirrors {@link import('./setting-descriptions').SettingDescriptions}: it keeps the
 * service-specific logic (here, the installed-font enumeration) out of the registry and the renderer.
 */
@Service()
export class SettingOptions {
  /**
   * Holds the catalog of installed fonts backing the font pickers.
   */
  private readonly fonts: FontCatalog = inject(FontCatalog);

  /**
   * Resolves the dynamic options for a setting key, or undefined when the registry's static options
   * should be used.
   * @param key The setting key.
   * @returns Returns the dynamic options, or undefined.
   */
  public resolve(key: string): readonly ChoiceOption[] | undefined {
    switch (key) {
      case 'textEditor.global.fontFamily':
      case 'markdownEditor.monospaceFontFamily':
        return this.fonts.monospaceFonts();
      case 'markdownEditor.fontFamily':
        return this.fonts.sansFonts();
      default:
        return undefined;
    }
  }
}
