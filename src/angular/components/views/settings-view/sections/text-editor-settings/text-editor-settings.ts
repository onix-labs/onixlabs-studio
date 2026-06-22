import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import { Accordion } from '../../../../forms/accordion/accordion';
import { Checkbox } from '../../../../forms/checkbox/checkbox';
import { Dropdown, DropdownOption } from '../../../../forms/dropdown/dropdown';
import { LanguageSelect } from '../../../../forms/language-select/language-select';
import { NumberField } from '../../../../forms/number-field/number-field';
import { SettingRow } from '../../../../forms/setting-row/setting-row';
import { TextField } from '../../../../forms/text-field/text-field';
import { Toggle } from '../../../../forms/toggle/toggle';
import {
  CurrentLineHighlightStyle,
  CursorBlinkingStyle,
  CursorSmoothCaretAnimation,
  EditorProfile,
  Settings,
  TextEditorSettings,
} from '../../../../../services/settings/settings';
import { Icon } from '../../../../../icons/icon';
import { AppIcon } from '../../../../shared/icon/app-icon';

/**
 * Identifies a boolean text editor setting that can be overridden per profile.
 */
type BooleanSettingKey = 'showLineNumbers' | 'showMinimap' | 'wordWrap' | 'stickyScroll';

/**
 * Describes a boolean text editor setting offered as a toggle and a per-profile override.
 */
interface BooleanSetting {
  /**
   * Gets the settings key the entry controls.
   */
  readonly key: BooleanSettingKey;

  /**
   * Gets the label shown for the entry.
   */
  readonly label: string;

  /**
   * Gets the description shown beneath the label.
   */
  readonly description: string;
}

/**
 * Represents the Text Editor settings section: global settings plus per-language profiles whose
 * per-setting overrides fall back to the global value.
 */
@Component({
  selector: 'app-text-editor-settings',
  imports: [
    SettingRow,
    Toggle,
    Checkbox,
    Dropdown,
    TextField,
    NumberField,
    Accordion,
    LanguageSelect,
    AppIcon,
  ],
  templateUrl: './text-editor-settings.html',
  styleUrls: ['../section.scss', './text-editor-settings.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TextEditorSettingsSection {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the settings service the controls are bound to.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Gets the global text editor settings.
   */
  protected readonly global: Signal<TextEditorSettings> = this.settings.globalTextEditor;

  /**
   * Gets the editor profiles.
   */
  protected readonly profiles: Signal<readonly EditorProfile[]> = this.settings.profiles;

  /**
   * Gets the boolean settings offered as toggles and per-profile overrides.
   */
  protected readonly booleanSettings: readonly BooleanSetting[] = [
    {
      key: 'showLineNumbers',
      label: 'Line numbers',
      description: 'Show line numbers in the gutter.',
    },
    { key: 'showMinimap', label: 'Minimap', description: 'Show the minimap overview.' },
    { key: 'wordWrap', label: 'Word wrap', description: 'Wrap long lines.' },
    { key: 'stickyScroll', label: 'Sticky scroll', description: 'Pin the current scope context.' },
  ];

  /**
   * Gets the options offered by the current-line-highlight dropdown.
   */
  protected readonly highlightOptions: readonly DropdownOption[] = [
    { value: 'outline', label: 'Outline' },
    { value: 'filled', label: 'Filled' },
  ];

  /**
   * Gets the options offered by the cursor-blinking dropdown.
   */
  protected readonly cursorBlinkingOptions: readonly DropdownOption[] = [
    { value: 'blink', label: 'Blink' },
    { value: 'smooth', label: 'Smooth' },
    { value: 'phase', label: 'Phase' },
    { value: 'expand', label: 'Expand' },
    { value: 'solid', label: 'Solid (no blink)' },
  ];

  /**
   * Gets the options offered by the smooth-caret-animation dropdown.
   */
  protected readonly cursorSmoothCaretAnimationOptions: readonly DropdownOption[] = [
    { value: 'off', label: 'Off' },
    { value: 'on', label: 'On' },
    { value: 'explicit', label: 'Explicit (only on jumps)' },
  ];

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
   * Sets a boolean global text editor setting.
   * @param key The setting to set.
   * @param value The new value.
   */
  protected onGlobalToggle(key: BooleanSettingKey, value: boolean): void {
    this.settings.updateTextEditorSettings({ [key]: value });
  }

  /**
   * Sets the global current-line-highlight style.
   * @param value The selected highlight style.
   */
  protected onHighlightChange(value: string): void {
    this.settings.updateTextEditorSettings({
      currentLineHighlight: value as CurrentLineHighlightStyle,
    });
  }

  /**
   * Sets the global cursor blinking style.
   * @param value The selected blinking style.
   */
  protected onCursorBlinkingChange(value: string): void {
    this.settings.updateTextEditorSettings({
      cursorBlinking: value as CursorBlinkingStyle,
    });
  }

  /**
   * Sets the global smooth caret animation mode.
   * @param value The selected animation mode.
   */
  protected onCursorSmoothCaretAnimationChange(value: string): void {
    this.settings.updateTextEditorSettings({
      cursorSmoothCaretAnimation: value as CursorSmoothCaretAnimation,
    });
  }

  /**
   * Sets the global editor font family.
   * @param value The entered font family.
   */
  protected onFontFamilyChange(value: string): void {
    this.settings.updateTextEditorSettings({ fontFamily: value });
  }

  /**
   * Sets the global editor font size.
   * @param value The entered font size.
   */
  protected onFontSizeChange(value: number): void {
    this.settings.updateTextEditorSettings({ fontSize: value });
  }

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
   * Determines whether a profile overrides a boolean setting.
   * @param profile The profile to inspect.
   * @param key The setting to inspect.
   * @returns Returns true when the profile overrides the setting; otherwise, false.
   */
  protected isOverridden(profile: EditorProfile, key: BooleanSettingKey): boolean {
    return profile.settings[key] !== undefined;
  }

  /**
   * Resolves the effective value of a boolean setting for a profile, falling back to the global
   * value when the profile does not override it.
   * @param profile The profile to resolve for.
   * @param key The setting to resolve.
   * @returns Returns the resolved boolean value.
   */
  protected resolvedValue(profile: EditorProfile, key: BooleanSettingKey): boolean {
    return profile.settings[key] ?? this.global()[key];
  }

  /**
   * Toggles whether a profile overrides a boolean setting. When enabled the override seeds from the
   * current global value; when disabled the setting falls back to global.
   * @param profile The profile to update.
   * @param key The setting to toggle.
   * @param enabled Whether the override is enabled.
   */
  protected onOverrideToggle(
    profile: EditorProfile,
    key: BooleanSettingKey,
    enabled: boolean,
  ): void {
    const next: Record<string, unknown> = { ...profile.settings };
    if (enabled) {
      next[key] = this.global()[key];
    } else {
      delete next[key];
    }
    this.settings.updateProfile(profile.id, { settings: next });
  }

  /**
   * Sets the overridden value of a boolean setting for a profile.
   * @param profile The profile to update.
   * @param key The setting to set.
   * @param value The new value.
   */
  protected onOverrideValue(profile: EditorProfile, key: BooleanSettingKey, value: boolean): void {
    this.settings.updateProfile(profile.id, {
      settings: { ...profile.settings, [key]: value },
    });
  }
}
