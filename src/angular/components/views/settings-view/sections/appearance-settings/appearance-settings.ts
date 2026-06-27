import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import { SettingRow } from '../../../../forms/setting-row/setting-row';
import { Toggle } from '../../../../forms/toggle/toggle';
import { SettingsSection } from '../../settings-section/settings-section';
import { Display } from '../../../../../services/display/display';

/**
 * Represents the Appearance settings section. The accent colour, theme mode, ribbon alignment and
 * modern-UI-features controls render from the registry through {@link SettingsSection} (bound to the
 * Theme and Settings services). Hardware acceleration stays bespoke here: it is a startup-only,
 * Electron-bridged preference whose change requires a relaunch, which does not fit the generic
 * label-plus-control row model.
 */
@Component({
  selector: 'app-appearance-settings',
  imports: [SettingsSection, SettingRow, Toggle],
  templateUrl: './appearance-settings.html',
  styleUrls: ['../section.scss', './appearance-settings.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppearanceSettings {
  /**
   * Holds the display service backing the hardware-acceleration control.
   */
  private readonly display: Display = inject(Display);

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
}
