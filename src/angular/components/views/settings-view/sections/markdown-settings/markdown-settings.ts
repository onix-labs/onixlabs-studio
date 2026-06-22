import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import { Dropdown, DropdownOption } from '../../../../forms/dropdown/dropdown';
import { NumberField } from '../../../../forms/number-field/number-field';
import { SettingRow } from '../../../../forms/setting-row/setting-row';
import { TextField } from '../../../../forms/text-field/text-field';
import {
  ImageAlignment,
  ImageSizing,
  MarginSize,
  MarkdownEditorSettings,
  Settings,
} from '../../../../../services/settings/settings';

/**
 * Represents the Markdown editor settings section: fonts, size, margin, and image sizing and alignment.
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
   * Gets the options offered by the container width dropdown.
   */
  protected readonly marginOptions: readonly DropdownOption[] = [
    { value: 'narrow', label: 'Narrow (1024px)' },
    { value: 'medium', label: 'Medium (1440px)' },
    { value: 'wide', label: 'Wide (1600px)' },
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
   * Gets the options offered by the image alignment dropdown.
   */
  protected readonly imageAlignmentOptions: readonly DropdownOption[] = [
    { value: 'left', label: 'Left' },
    { value: 'center', label: 'Center' },
    { value: 'right', label: 'Right' },
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

  /**
   * Sets the image alignment.
   * @param value The selected image alignment.
   */
  protected onImageAlignmentChange(value: string): void {
    this.settings.updateMarkdownEditorSettings({ imageAlignment: value as ImageAlignment });
  }
}
