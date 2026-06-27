import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import { ButtonGroup } from '../../../../forms/button-group/button-group';
import { SettingRow } from '../../../../forms/setting-row/setting-row';
import { Toggle } from '../../../../forms/toggle/toggle';
import { AccentColor, ACCENT_COLORS, Theme, ThemeMode } from '../../../../../services/theme/theme';
import {
  ModernUiFeatures,
  RibbonAlignment,
  Settings,
} from '../../../../../services/settings/settings';
import { Display } from '../../../../../services/display/display';
import { Icon } from '../../../../../icons/icon';

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
 * Describes a selectable modern-UI-features option in the appearance settings.
 */
interface ModernUiFeaturesOption {
  /**
   * Gets the mode the option applies.
   */
  readonly value: ModernUiFeatures;

  /**
   * Gets the label shown for the option.
   */
  readonly label: string;
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
  imports: [SettingRow, ButtonGroup, Toggle],
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
   * Holds the settings service backing the ribbon alignment and modern-UI-features controls.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the display service backing the modern-UI-features recommendation and the
   * hardware-acceleration control.
   */
  private readonly display: Display = inject(Display);

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
   * Gets the currently selected modern-UI-features mode.
   */
  protected readonly modernUiFeatures: Signal<ModernUiFeatures> = this.settings.modernUiFeatures;

  /**
   * Gets the modern-UI-features options offered by the selector.
   */
  protected readonly modernUiFeaturesOptions: readonly ModernUiFeaturesOption[] = [
    { value: 'auto', label: 'Auto' },
    { value: 'on', label: 'On' },
    { value: 'off', label: 'Off' },
  ];

  /**
   * Gets the hint describing the modern-UI-features setting and what the automatic mode recommends
   * for this system.
   */
  protected readonly modernUiFeaturesHint: string = this.buildModernUiFeaturesHint();

  /**
   * Gets whether GPU hardware acceleration is enabled.
   */
  protected readonly hardwareAcceleration: Signal<boolean> =
    this.display.hardwareAccelerationEnabled;

  /**
   * Gets whether a hardware-acceleration change is awaiting a relaunch to take effect.
   */
  protected readonly restartRequired: Signal<boolean> = this.display.restartRequired;

  /**
   * Selects the given theme mode.
   * @param mode The theme mode to apply.
   */
  protected selectMode(mode: string): void {
    this.theme.setMode(mode as ThemeMode);
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
  protected selectRibbonAlignment(alignment: string): void {
    this.settings.setRibbonAlignment(alignment as RibbonAlignment);
  }

  /**
   * Selects the given modern-UI-features mode.
   * @param value The mode to apply.
   */
  protected selectModernUiFeatures(value: string): void {
    this.settings.setModernUiFeatures(value as ModernUiFeatures);
  }

  /**
   * Sets whether GPU hardware acceleration is enabled. The change takes effect after a relaunch.
   * @param enabled Whether hardware acceleration should be enabled.
   */
  protected setHardwareAcceleration(enabled: boolean): void {
    this.display.setHardwareAcceleration(enabled);
  }

  /**
   * Relaunches the application so a pending hardware-acceleration change can take effect.
   */
  protected relaunch(): void {
    this.display.relaunch();
  }

  /**
   * Builds the hint for the modern-UI-features setting, naming what the automatic mode recommends for
   * this system (and the detected GPU, when known).
   * @returns Returns the hint text.
   */
  private buildModernUiFeaturesHint(): string {
    const recommended: string = this.display.recommendedModernUi === 'on' ? 'On' : 'Off';
    const gpu: string = this.display.gpuDescription;
    const detail: string = gpu.length > 0 ? ` (${gpu} detected)` : '';
    return (
      'Squircle corners and richer visual effects. Turn off if the interface looks corrupted or ' +
      `sluggish. Recommended for this system: ${recommended}${detail}.`
    );
  }
}
