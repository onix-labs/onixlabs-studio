import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import { Dropdown, DropdownOption } from '../../../../forms/dropdown/dropdown';
import { SettingRow } from '../../../../forms/setting-row/setting-row';
import { FileExplorerExpandAll, Settings } from '../../../../../services/settings/settings';

/**
 * Represents the Workspaces settings section: how the File Explorer's directory tree behaves.
 */
@Component({
  selector: 'app-workspaces-settings',
  imports: [SettingRow, Dropdown],
  templateUrl: './workspaces-settings.html',
  styleUrl: '../section.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspacesSettings {
  /**
   * Holds the settings service the controls are bound to.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Gets how the File Explorer's "Expand All" behaves.
   */
  protected readonly fileExplorerExpandAll: Signal<FileExplorerExpandAll> =
    this.settings.fileExplorerExpandAll;

  /**
   * Gets the options offered by the "Expand All" dropdown.
   */
  protected readonly expandAllOptions: readonly DropdownOption[] = [
    { value: 'loaded-only', label: 'Loaded folders only' },
    { value: 'entire-tree', label: 'Entire tree' },
  ];

  /**
   * Sets how the File Explorer's "Expand All" behaves.
   * @param value The selected expand-all behavior.
   */
  protected onExpandAllChange(value: string): void {
    this.settings.setFileExplorerExpandAll(value as FileExplorerExpandAll);
  }
}
