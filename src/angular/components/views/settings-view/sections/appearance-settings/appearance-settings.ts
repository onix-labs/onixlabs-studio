import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import { SettingRow } from '../../../../forms/setting-row/setting-row';
import { AccentColor, ACCENT_COLORS, Theme, ThemeMode } from '../../../../../services/theme/theme';
import { RibbonAlignment, Settings } from '../../../../../services/settings/settings';
import { Icon } from '../../../../../icons/icon';
import { AppIcon } from '../../../../shared/icon/app-icon';

/**
 * Describes a selectable ribbon-alignment option in the appearance settings.
 */
interface RibbonAlignmentOption {
  /**
   * Gets the alignment the option applies.
   */
  readonly value: RibbonAlignment;

  /**
   * Gets the label shown for the option.
   */
  readonly label: string;

  /**
   * Gets the icon shown for the option.
   */
  readonly icon: Icon;
}

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
  readonly icon: Icon;
}

/**
 * Represents the Appearance settings section: theme mode and accent colour, bound to the Theme
 * service (the single owner of theme state).
 */
@Component({
  selector: 'app-appearance-settings',
  imports: [SettingRow, AppIcon],
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
   * Holds the settings service backing the ribbon alignment control.
   */
  private readonly settings: Settings = inject(Settings);

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
    { value: 'light', label: 'Light', icon: Icon.THEME_LIGHT },
    { value: 'dark', label: 'Dark', icon: Icon.THEME_DARK },
    { value: 'system', label: 'System', icon: Icon.THEME_SYSTEM },
  ];

  /**
   * Gets the accent colours offered by the picker, in palette order.
   */
  protected readonly accentColors: readonly AccentColor[] = ACCENT_COLORS;

  /**
   * Gets the currently selected ribbon alignment.
   */
  protected readonly ribbonAlignment: Signal<RibbonAlignment> = this.settings.ribbonAlignment;

  /**
   * Gets the ribbon-alignment options offered by the selector.
   */
  protected readonly ribbonAlignmentOptions: readonly RibbonAlignmentOption[] = [
    { value: 'left', label: 'Left', icon: Icon.ALIGN_LEFT },
    { value: 'center', label: 'Center', icon: Icon.ALIGN_CENTER },
    { value: 'right', label: 'Right', icon: Icon.ALIGN_RIGHT },
  ];

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

  /**
   * Selects the given ribbon alignment.
   * @param alignment The ribbon alignment to apply.
   */
  protected selectRibbonAlignment(alignment: RibbonAlignment): void {
    this.settings.setRibbonAlignment(alignment);
  }
}
