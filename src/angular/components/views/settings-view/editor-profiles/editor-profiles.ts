import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import { Accordion } from '../../../forms/accordion/accordion';
import { Checkbox } from '../../../forms/checkbox/checkbox';
import { Dropdown } from '../../../forms/dropdown/dropdown';
import { LanguageSelect } from '../../../forms/language-select/language-select';
import { NumberField } from '../../../forms/number-field/number-field';
import { SettingRow } from '../../../forms/setting-row/setting-row';
import { Toggle } from '../../../forms/toggle/toggle';
import { EditorProfile, Settings, TextEditorSettings } from '@shared/angular/services/settings/settings';
import {
  ChoiceOption,
  findSection,
  SettingDef,
} from '@shared/angular/services/settings/settings-registry';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';

/**
 * Represents the per-language editor profiles: an override editor whose rows are driven by the same
 * registry metadata as the global editor settings. Each profile may override the settings marked
 * `profileOverridable`, falling back to the global value when it does not.
 *
 * Adding an overridable editor setting to the registry makes it appear here automatically; the
 * per-setting control is chosen from its registry control definition.
 */
@Component({
  selector: 'app-editor-profiles',
  imports: [SettingRow, Toggle, Checkbox, Dropdown, NumberField, Accordion, LanguageSelect, AppIcon],
  templateUrl: './editor-profiles.html',
  styleUrls: ['../sections/section.scss', './editor-profiles.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EditorProfiles {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the settings service the profiles are read from and written to.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Gets the editor profiles.
   */
  protected readonly profiles: Signal<readonly EditorProfile[]> = this.settings.profiles;

  /**
   * Gets the global text editor settings, used as the fallback for un-overridden values.
   */
  private readonly global: Signal<TextEditorSettings> = this.settings.globalTextEditor;

  /**
   * Gets the editor settings that may be overridden per profile, from the registry.
   */
  protected readonly overridable: readonly SettingDef[] = (
    findSection('text-editor')?.settings ?? []
  ).filter((setting: SettingDef): boolean => setting.profileOverridable === true);

  /**
   * Gets the language identifiers offered when assigning languages to a profile.
   */
  protected readonly languageOptions: readonly string[] = [
    'typescript',
    'javascript',
    'json',
    'html',
    'css',
    'scss',
    'markdown',
    'python',
    'rust',
    'go',
    'java',
    'csharp',
    'sql',
    'yaml',
    'shell',
  ];

  /**
   * Creates a new, empty editor profile.
   */
  protected addProfile(): void {
    this.settings.createProfile('New profile', []);
  }

  /**
   * Deletes the given editor profile.
   * @param id The identifier of the profile to delete.
   */
  protected deleteProfile(id: string): void {
    this.settings.deleteProfile(id);
  }

  /**
   * Sets the languages a profile applies to.
   * @param id The identifier of the profile.
   * @param languages The selected language identifiers.
   */
  protected onLanguagesChange(id: string, languages: readonly string[]): void {
    this.settings.updateProfile(id, { languages });
  }

  /**
   * Determines whether a profile overrides a setting.
   * @param profile The profile to inspect.
   * @param key The setting key.
   * @returns Returns true when the profile overrides the setting.
   */
  protected isOverridden(profile: EditorProfile, key: string): boolean {
    return this.profileSettings(profile)[this.fieldOf(key)] !== undefined;
  }

  /**
   * Resolves the effective value of a setting for a profile, falling back to the global value when the
   * profile does not override it.
   * @param profile The profile to resolve for.
   * @param key The setting key.
   * @returns Returns the resolved value.
   */
  protected resolved(profile: EditorProfile, key: string): unknown {
    const field: string = this.fieldOf(key);
    return this.profileSettings(profile)[field] ?? this.globalSettings()[field];
  }

  /**
   * Toggles whether a profile overrides a setting. When enabled the override seeds from the current
   * global value; when disabled the setting falls back to global.
   * @param profile The profile to update.
   * @param key The setting key.
   * @param enabled Whether the override is enabled.
   */
  protected onOverrideToggle(profile: EditorProfile, key: string, enabled: boolean): void {
    const field: string = this.fieldOf(key);
    const next: Record<string, unknown> = { ...this.profileSettings(profile) };
    if (enabled) {
      next[field] = this.globalSettings()[field];
    } else {
      delete next[field];
    }
    this.settings.updateProfile(profile.id, { settings: next });
  }

  /**
   * Sets the overridden value of a setting for a profile.
   * @param profile The profile to update.
   * @param key The setting key.
   * @param value The new value.
   */
  protected onOverrideValue(profile: EditorProfile, key: string, value: unknown): void {
    const next: Record<string, unknown> = {
      ...this.profileSettings(profile),
      [this.fieldOf(key)]: value,
    };
    this.settings.updateProfile(profile.id, { settings: next });
  }

  /**
   * Gets the minimum for a numeric setting's control, or undefined when unbounded or not numeric.
   * @param setting The setting definition.
   * @returns Returns the minimum, or undefined.
   */
  protected numberMin(setting: SettingDef): number | undefined {
    return setting.control.kind === 'number' ? setting.control.min : undefined;
  }

  /**
   * Gets the maximum for a numeric setting's control, or undefined when unbounded or not numeric.
   * @param setting The setting definition.
   * @returns Returns the maximum, or undefined.
   */
  protected numberMax(setting: SettingDef): number | undefined {
    return setting.control.kind === 'number' ? setting.control.max : undefined;
  }

  /**
   * Gets the options for a select setting's control, or an empty list for other controls.
   * @param setting The setting definition.
   * @returns Returns the choice options.
   */
  protected selectOptions(setting: SettingDef): readonly ChoiceOption[] {
    return setting.control.kind === 'select' ? setting.control.options : [];
  }

  /**
   * Extracts the text-editor settings field name from a setting key (the segment after the last dot).
   * @param key The setting key.
   * @returns Returns the field name.
   */
  private fieldOf(key: string): string {
    return key.slice(key.lastIndexOf('.') + 1);
  }

  /**
   * Gets a profile's overrides as a string-indexed record.
   * @param profile The profile.
   * @returns Returns the overrides.
   */
  private profileSettings(profile: EditorProfile): Record<string, unknown> {
    return profile.settings;
  }

  /**
   * Gets the global settings as a string-indexed record.
   * @returns Returns the global settings.
   */
  private globalSettings(): Record<string, unknown> {
    return this.global() as unknown as Record<string, unknown>;
  }
}
