import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import { SettingRow } from '../../../../forms/setting-row/setting-row';
import { AccentColor, ACCENT_COLORS, Theme, ThemeMode } from '../../../../../services/theme/theme';

/**
 * Describes a selectable theme-mode option in the appearance settings.
 */
interface ThemeModeOption {
  /**
   * Gets the theme mode the option applies.
   */
  readonly value: ThemeMode;

  /**
   * Gets the label shown for the option.
   */
  readonly label: string;

  /**
   * Gets the icon shown for the option.
   */
  readonly icon: string;
}

/**
 * Represents the Appearance settings section: theme mode and accent colour, bound to the Theme
 * service (the single owner of theme state).
 */
@Component({
  selector: 'app-appearance-settings',
  imports: [SettingRow],
  templateUrl: './appearance-settings.html',
  styleUrls: ['../section.scss', './appearance-settings.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppearanceSettings {
  /**
   * Holds the theme service the controls are bound to.
   */
  private readonly theme: Theme = inject(Theme);

  /**
   * Gets the currently selected theme mode.
   */
  protected readonly mode: Signal<ThemeMode> = this.theme.mode;

  /**
   * Gets the currently selected accent colour.
   */
  protected readonly accent: Signal<AccentColor> = this.theme.accent;

  /**
   * Gets the theme-mode options offered by the selector.
   */
  protected readonly modeOptions: readonly ThemeModeOption[] = [
    { value: 'light', label: 'Light', icon: 'ti ti-sun' },
    { value: 'dark', label: 'Dark', icon: 'ti ti-moon' },
    { value: 'system', label: 'System', icon: 'ti ti-device-desktop' },
  ];

  /**
   * Gets the accent colours offered by the picker, in palette order.
   */
  protected readonly accentColors: readonly AccentColor[] = ACCENT_COLORS;

  /**
   * Selects the given theme mode.
   * @param mode The theme mode to apply.
   */
  protected selectMode(mode: ThemeMode): void {
    this.theme.setMode(mode);
  }

  /**
   * Selects the given accent colour.
   * @param accent The accent colour to apply.
   */
  protected selectAccent(accent: AccentColor): void {
    this.theme.setAccent(accent);
  }
}
