import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import { Dropdown, DropdownOption } from '../../../../forms/dropdown/dropdown';
import { NumberField } from '../../../../forms/number-field/number-field';
import { SettingRow } from '../../../../forms/setting-row/setting-row';
import { TextField } from '../../../../forms/text-field/text-field';
import {
  ImageSizing,
  MarginSize,
  MarkdownEditorSettings,
  Settings,
} from '../../../../../services/settings/settings';

/**
 * Represents the Markdown editor settings section: fonts, size, margin and image sizing.
 */
@Component({
  selector: 'app-markdown-settings',
  imports: [SettingRow, TextField, NumberField, Dropdown],
  templateUrl: './markdown-settings.html',
  styleUrl: '../section.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkdownSettings {
  /**
   * Holds the settings service the controls are bound to.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Gets the markdown editor settings.
   */
  protected readonly markdown: Signal<MarkdownEditorSettings> = this.settings.markdownEditor;

  /**
   * Gets the options offered by the margin size dropdown.
   */
  protected readonly marginOptions: readonly DropdownOption[] = [
    { value: 'narrow', label: 'Narrow' },
    { value: 'medium', label: 'Medium' },
    { value: 'wide', label: 'Wide' },
    { value: 'full-width', label: 'Full width' },
  ];

  /**
   * Gets the options offered by the image sizing dropdown.
   */
  protected readonly imageSizingOptions: readonly DropdownOption[] = [
    { value: 'fixed', label: 'Fixed' },
    { value: 'sizable', label: 'Sizable' },
  ];

  /**
   * Sets the body-text font family.
   * @param value The entered font family.
   */
  protected onFontFamilyChange(value: string): void {
    this.settings.updateMarkdownEditorSettings({ fontFamily: value });
  }

  /**
   * Sets the monospace font family.
   * @param value The entered monospace font family.
   */
  protected onMonospaceFontFamilyChange(value: string): void {
    this.settings.updateMarkdownEditorSettings({ monospaceFontFamily: value });
  }

  /**
   * Sets the base font size.
   * @param value The entered font size.
   */
  protected onFontSizeChange(value: number): void {
    this.settings.updateMarkdownEditorSettings({ fontSize: value });
  }

  /**
   * Sets the document margin size.
   * @param value The selected margin size.
   */
  protected onMarginSizeChange(value: string): void {
    this.settings.updateMarkdownEditorSettings({ marginSize: value as MarginSize });
  }

  /**
   * Sets the image sizing behaviour.
   * @param value The selected image sizing behaviour.
   */
  protected onImageSizingChange(value: string): void {
    this.settings.updateMarkdownEditorSettings({ imageSizing: value as ImageSizing });
  }
}
