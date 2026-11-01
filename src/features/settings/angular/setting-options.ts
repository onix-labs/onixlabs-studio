import { inject, Service } from '@angular/core';
import { Display } from '@shared/angular/services/display/display';
import { FontCatalog } from '@shared/angular/services/fonts/font-catalog';
import { SETTINGS_BY_KEY } from '@shared/angular/services/settings/settings-registry';
import type {
  ChoiceOption,
  ControlDef,
  SettingDef,
} from '@shared/angular/services/settings/settings-schema';

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
   * Holds the display policy, whose graphics level decides whether squircle corners are offered.
   */
  private readonly display: Display = inject(Display);

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
      case 'application.cornerStyle':
        return this.cornerStyles();
      default:
        return undefined;
    }
  }

  /**
   * Lists the corner styles on offer. Squircles are offered only while the graphics level in force
   * is Full: below it — chosen, or the automatic level on a GPU that renders them badly — they are
   * what the lower level exists to avoid.
   * @returns Returns the corner styles, without Squircle below Full.
   */
  private cornerStyles(): readonly ChoiceOption[] {
    const setting: SettingDef | undefined = SETTINGS_BY_KEY.get('application.cornerStyle');
    const control: ControlDef | undefined = setting?.control;
    const options: readonly ChoiceOption[] = control?.kind === 'select' ? control.options : [];
    return this.display.resolvedGraphicsAcceleration() === 'full'
      ? options
      : options.filter((option: ChoiceOption): boolean => option.value !== 'squircle');
  }
}
