import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import { Checkbox } from '@shared/angular/components/forms/checkbox/checkbox';
import { Dropdown } from '@shared/angular/components/forms/dropdown/dropdown';
import { NumberField } from '@shared/angular/components/forms/number-field/number-field';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import { Toggle } from '@shared/angular/components/forms/toggle/toggle';
import {
  PartialTextEditorSettings,
  Settings,
  TextEditorSettings,
} from '@shared/angular/services/settings/settings';
import { findSection } from '@shared/angular/services/settings/settings-registry';
import {
  ChoiceOption,
  ControlDef,
  SettingDef,
} from '@shared/angular/services/settings/settings-schema';

/**
 * A text editor settings field name, as overridden per language.
 */
type EditorField = keyof TextEditorSettings;

/**
 * Edits one language's overrides of the global text editor settings: the Editor half of a Language
 * Providers page. Rows are driven by the same registry metadata as the global editor settings — every
 * setting marked `profileOverridable` gets a row with an Override tick and the setting's own control,
 * disabled until the override is on. An overridden setting falls back to the global value the moment
 * its override is cleared, so nothing here can strand a language on a stale value.
 */
@Component({
  selector: 'app-language-editor-overrides',
  imports: [Checkbox, Dropdown, NumberField, SettingRow, Toggle],
  templateUrl: './language-editor-overrides.html',
  styleUrl: './language-editor-overrides.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LanguageEditorOverrides {
  /**
   * Gets the Monaco language identifier whose overrides are edited.
   */
  public readonly language: InputSignal<string> = input.required<string>();

  /**
   * Gets the language's display name, for the heading.
   */
  public readonly languageName: InputSignal<string> = input.required<string>();

  /**
   * Holds the settings service the overrides are read from and written to.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Gets the editor settings that may be overridden per language, from the registry.
   */
  protected readonly overridable: readonly SettingDef[] = (
    findSection('text-editor')?.settings ?? []
  ).filter((setting: SettingDef): boolean => setting.profileOverridable === true);

  /**
   * Gets this language's overrides, or an empty set when it has none.
   */
  private readonly own: Signal<PartialTextEditorSettings> = computed(
    (): PartialTextEditorSettings => this.settings.languageOverrides()[this.language()] ?? {},
  );

  /**
   * Determines whether a setting is overridden for this language.
   * @param setting The setting definition.
   * @returns Returns true when the language carries its own value.
   */
  protected isOverridden(setting: SettingDef): boolean {
    return this.own()[this.fieldOf(setting)] !== undefined;
  }

  /**
   * Resolves the effective value of a setting for this language: its override, or the global value.
   * @param setting The setting definition.
   * @returns Returns the resolved value.
   */
  protected resolved(setting: SettingDef): unknown {
    const field: EditorField = this.fieldOf(setting);
    return this.own()[field] ?? this.settings.globalTextEditor()[field];
  }

  /**
   * Turns a setting's override on or off. Turning it on seeds the override from the current global
   * value, so the control shows what the language already had; turning it off returns to global.
   * @param setting The setting definition.
   * @param enabled Whether the override is on.
   */
  protected onOverrideToggle(setting: SettingDef, enabled: boolean): void {
    const field: EditorField = this.fieldOf(setting);
    if (enabled) {
      this.settings.setLanguageOverride(
        this.language(),
        field,
        this.settings.globalTextEditor()[field],
      );
    } else {
      this.settings.clearLanguageOverride(this.language(), field);
    }
  }

  /**
   * Resolves a setting's effective value as the string a dropdown exchanges, so a numeric pick (tab
   * size, line height) matches its option.
   * @param setting The setting definition.
   * @returns Returns the resolved value as a string.
   */
  protected resolvedString(setting: SettingDef): string {
    return String(this.resolved(setting));
  }

  /**
   * Sets the overridden value of a setting for this language, coercing a numeric dropdown's string
   * pick back to a number so the stored value keeps its type.
   * @param setting The setting definition.
   * @param value The value picked or entered in the control.
   */
  protected onOverrideValue(setting: SettingDef, value: unknown): void {
    const control: ControlDef = setting.control;
    const coerced: unknown =
      control.kind === 'select' && control.valueType === 'number' && typeof value === 'string'
        ? Number(value)
        : value;
    this.settings.setLanguageOverride(
      this.language(),
      this.fieldOf(setting),
      coerced as TextEditorSettings[EditorField],
    );
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
   * Extracts the text editor settings field a registry key names (the segment after the last dot).
   * @param setting The setting definition.
   * @returns Returns the field name.
   */
  private fieldOf(setting: SettingDef): EditorField {
    return setting.key.slice(setting.key.lastIndexOf('.') + 1) as EditorField;
  }
}
