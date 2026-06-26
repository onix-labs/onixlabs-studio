import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import { Dropdown, DropdownOption } from '../../../../forms/dropdown/dropdown';
import { NumberField } from '../../../../forms/number-field/number-field';
import { SettingRow } from '../../../../forms/setting-row/setting-row';
import { Toggle } from '../../../../forms/toggle/toggle';
import { DefaultDocumentType, Settings } from '../../../../../services/settings/settings';

/**
 * Represents the Application settings section: default document type and undo history size.
 */
@Component({
  selector: 'app-application-settings',
  imports: [SettingRow, Dropdown, NumberField, Toggle],
  templateUrl: './application-settings.html',
  styleUrl: '../section.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApplicationSettings {
  /**
   * Holds the settings service the controls are bound to.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Gets the default document type for new documents.
   */
  protected readonly defaultDocumentType: Signal<DefaultDocumentType> =
    this.settings.defaultDocumentType;

  /**
   * Gets the undo stack size.
   */
  protected readonly undoStackSize: Signal<number> = this.settings.undoStackSize;

  /**
   * Gets a value indicating whether the title strip shows the quick-action launcher buttons.
   */
  protected readonly showLauncherActions: Signal<boolean> = this.settings.showLauncherActions;

  /**
   * Gets the options offered by the default document type dropdown.
   */
  protected readonly documentTypeOptions: readonly DropdownOption[] = [
    { value: 'code', label: 'Code' },
    { value: 'markdown', label: 'Markdown' },
  ];

  /**
   * Sets the default document type.
   * @param value The selected document type.
   */
  protected onDefaultDocumentTypeChange(value: string): void {
    this.settings.setDefaultDocumentType(value as DefaultDocumentType);
  }

  /**
   * Sets the undo stack size.
   * @param value The entered undo stack size.
   */
  protected onUndoStackSizeChange(value: number): void {
    this.settings.setUndoStackSize(value);
  }

  /**
   * Sets whether the title strip shows the quick-action launcher buttons.
   * @param value True to show the launcher buttons; false to show the welcome button.
   */
  protected onShowLauncherActionsChange(value: boolean): void {
    this.settings.setShowLauncherActions(value);
  }
}
