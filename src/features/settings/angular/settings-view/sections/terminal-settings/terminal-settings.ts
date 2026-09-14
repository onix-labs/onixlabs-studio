import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import { Settings } from '@shared/angular/services/settings/settings';
import {
  SHELL_PICKER_DEFAULT,
  ShellPicker,
} from '@shared/angular/components/forms/shell-picker/shell-picker';

/**
 * Represents the Terminal section of the settings view: the default shell a new terminal starts with.
 *
 * The choice is a bespoke control rather than a generic one because its options are discovered at
 * runtime — the shells installed on the host — so it is rendered by the shared {@link ShellPicker},
 * which every surface offering this choice uses. The value persists through {@link Settings} under
 * `terminal.defaultShell` (an empty string for the system default).
 */
@Component({
  selector: 'app-terminal-settings',
  imports: [SettingRow, ShellPicker],
  templateUrl: './terminal-settings.html',
  styleUrls: ['../section.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TerminalSettingsSection {
  /**
   * Holds the settings service the default shell persists through.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Gets the persisted default shell (the empty string for the system default).
   */
  protected readonly defaultShell: Signal<string> = this.settings.value('terminal.defaultShell');

  /**
   * Persists the chosen default shell.
   * @param value The chosen shell path, or the empty string for the system default.
   */
  protected onChange(value: string): void {
    this.log.info(
      'settings.terminal',
      'Default shell changed',
      value === SHELL_PICKER_DEFAULT ? 'system default' : value,
    );
    this.settings.set('terminal.defaultShell', value);
  }
}
