import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { ShellInfo } from '@shared/api/terminal-channels';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import { Settings } from '@shared/angular/services/settings/settings';
import { TerminalShells } from '@shared/angular/services/terminal-shells/terminal-shells';

/**
 * Holds the setting value that means "use the main process's resolved default shell".
 */
const SYSTEM_DEFAULT: string = '';

/**
 * Represents the Terminal section of the settings view: the default shell a new terminal starts with.
 *
 * The choice is a bespoke dropdown rather than a generic control because its options are discovered at
 * runtime — the shells installed on the host, supplied by {@link TerminalShells} — with a leading
 * "System default" entry that leaves the choice to the main process. The value persists through
 * {@link Settings} under `terminal.defaultShell` (an empty string for the system default).
 */
@Component({
  selector: 'app-terminal-settings',
  imports: [SettingRow, Dropdown],
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
   * Holds the installed-shells provider populating the dropdown.
   */
  private readonly terminalShells: TerminalShells = inject(TerminalShells);

  /**
   * Gets the dropdown options: a leading "System default" entry followed by each installed shell.
   */
  protected readonly shellOptions: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] => [
      { value: SYSTEM_DEFAULT, label: 'System default' },
      ...this.terminalShells
        .shells()
        .map((shell: ShellInfo): DropdownOption => ({ value: shell.path, label: shell.name })),
    ],
  );

  /**
   * Gets the persisted default shell (the empty string for the system default).
   */
  protected readonly defaultShell: Signal<string> = this.settings.value('terminal.defaultShell');

  /**
   * Persists the chosen default shell.
   * @param value The chosen shell path, or the empty string for the system default.
   */
  protected onChange(value: string): void {
    this.settings.set('terminal.defaultShell', value);
  }
}
