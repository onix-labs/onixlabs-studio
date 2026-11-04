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
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { Toggle } from '@shared/angular/components/forms/toggle/toggle';
import {
  PartialTextEditorSettings,
  Settings,
  TextEditorSettings,
} from '@shared/angular/services/settings/settings';
import { codeSettings, findSection } from '@shared/angular/services/settings/settings-registry';
import { LspSettings } from '@shared/angular/services/lsp-settings/lsp-settings';
import type { LspServerSummary } from '@shared/api/lsp-channels';
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
 * Names the code settings page whose overridable settings a block of overrides shows.
 */
export type CodeOverrideSection = 'code-appearance' | 'code-editing';

/**
 * Names each block's code settings pages as the user sees them, for the line saying where the global
 * values live.
 */
const SECTION_NAMES: Readonly<Record<CodeOverrideSection, string>> = {
  'code-appearance': 'Code › Appearance and Code › Guides and Highlights',
  'code-editing': 'Code › Editing and Code › Saving',
};

/**
 * Lists the registry sections each block of overrides draws from. A language's Appearance section
 * covers how its code looks, which the global settings spread over two pages.
 */
const SECTION_IDS: Readonly<Record<CodeOverrideSection, readonly string[]>> = {
  'code-appearance': ['code-appearance', 'code-highlighting'],
  'code-editing': ['code-editing', 'code-saving'],
};

/**
 * The key of the brace-style setting, which only a language server that takes it can honour.
 */
const BRACE_STYLE_KEY: string = 'textEditor.global.braceStyle';

/**
 * The keys of the per-language settings a project's `.editorconfig` can decide.
 */
const EDITOR_CONFIG_KEYS: ReadonlySet<string> = new Set<string>([
  'textEditor.global.tabSize',
  'textEditor.global.insertSpaces',
  'textEditor.global.detectIndentation',
  'textEditor.global.rulers',
  'textEditor.global.trimTrailingWhitespace',
  'textEditor.global.insertFinalNewline',
  'textEditor.global.addByteOrderMark',
]);

/**
 * Edits one language's overrides of the code settings: the Appearance or Editing section of a
 * language's page under Code › Languages. Rows are driven by the same registry metadata as the global editor settings — every
 * setting marked `profileOverridable` gets a row with an Override tick and the setting's own control,
 * disabled until the override is on. An overridden setting falls back to the global value the moment
 * its override is cleared, so nothing here can strand a language on a stale value.
 */
@Component({
  selector: 'app-language-editor-overrides',
  imports: [Checkbox, Dropdown, NumberField, SettingRow, TextField, Toggle],
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
   * Gets the code settings page whose overridable settings are shown, or undefined for all of them.
   */
  public readonly section: InputSignal<CodeOverrideSection | undefined> = input<
    CodeOverrideSection | undefined
  >(undefined);

  /**
   * Holds the settings service the overrides are read from and written to.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the language-server settings, read for whether this language's server takes a brace style.
   */
  private readonly lspSettings: LspSettings = inject(LspSettings);

  /**
   * Gets the settings that may be overridden per language, from the registry: those of the chosen
   * page, or every code setting.
   */
  protected readonly overridable: Signal<readonly SettingDef[]> = computed(
    (): readonly SettingDef[] => {
      const section: CodeOverrideSection | undefined = this.section();
      const settings: readonly SettingDef[] =
        section === undefined
          ? codeSettings()
          : SECTION_IDS[section].flatMap(
              (id: string): readonly SettingDef[] => findSection(id)?.settings ?? [],
            );
      return settings.filter((setting: SettingDef): boolean => setting.profileOverridable === true);
    },
  );

  /**
   * Gets where the global values of the shown settings live, for the line explaining the Override
   * tick; undefined when every code setting is shown.
   */
  protected readonly globalPage: Signal<string | undefined> = computed((): string | undefined => {
    const section: CodeOverrideSection | undefined = this.section();
    return section === undefined ? undefined : SECTION_NAMES[section];
  });

  /**
   * Gets a value indicating whether the server serving this language honours a brace style. Only some
   * do yet; the setting stays overridable everywhere, but says so where it would do nothing.
   */
  private readonly takesBraceStyle: Signal<boolean> = computed((): boolean => {
    const server: string | null = this.lspSettings.serverForLanguage(this.language());
    return this.lspSettings
      .catalogue()
      .some(
        (summary: LspServerSummary): boolean =>
          summary.id === server && summary.takesBraceStyle === true,
      );
  });

  /**
   * Gets the description shown for a setting: its own, plus a note where this language's server
   * cannot honour it yet.
   * @param setting The setting.
   * @returns Returns the description.
   */
  protected describe(setting: SettingDef): string {
    const note: string =
      EDITOR_CONFIG_KEYS.has(setting.key) && this.settings.get('textEditor.honourEditorConfig')
        ? ' Set by .editorconfig for the files one covers.'
        : '';
    return setting.key === BRACE_STYLE_KEY && !this.takesBraceStyle()
      ? `${setting.description} Not supported by this language's server yet.`
      : `${setting.description}${note}`;
  }

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
   * Gets the placeholder for a text setting's control, or an empty string for other controls.
   * @param setting The setting definition.
   * @returns Returns the placeholder.
   */
  protected textPlaceholder(setting: SettingDef): string {
    return setting.control.kind === 'text' ? (setting.control.placeholder ?? '') : '';
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
