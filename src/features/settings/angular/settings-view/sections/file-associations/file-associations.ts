import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { Button } from '@shared/angular/components/forms/button/button';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { Icon } from '@shared/angular/icons/icon';
import {
  FileAssociation,
  fileAssociations,
  withFileAssociation,
  withoutFileAssociation,
} from '@shared/angular/services/monaco/file-associations';
import { LanguageInfo, Monaco } from '@shared/angular/services/monaco/monaco';
import { Settings } from '@shared/angular/services/settings/settings';
import { SETTINGS_BY_KEY } from '@shared/angular/services/settings/settings-registry';
import type { SettingDef } from '@shared/angular/services/settings/settings-schema';

/**
 * Holds the registry's entry for the setting, whose title and description the row shows, so the
 * text is written — and translated — once.
 */
const SETTING: SettingDef | undefined = SETTINGS_BY_KEY.get('textEditor.fileAssociations');

/**
 * One listed association, with the name its language goes by.
 */
interface AssociationRow {
  /**
   * Gets the association.
   */
  readonly association: FileAssociation;

  /**
   * Gets the label read out by its language picker.
   */
  readonly languageLabel: string;

  /**
   * Gets the label read out by its remove button.
   */
  readonly removeLabel: string;
}

/**
 * Represents the File Associations row on Settings › Code › General (#1068): the user's own pattern
 * to language list, which wins over Studio's built-in rules. An entry is added as a file name or
 * pattern and a language picked by name, its language changed in place, and removed per row; the
 * list is a setting, so it travels with Export and Import, and open files follow each change.
 */
@Component({
  selector: 'app-file-associations',
  imports: [Button, Dropdown, SettingRow, TextField],
  templateUrl: './file-associations.html',
  styleUrls: ['../section.scss', './file-associations.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileAssociations {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the row's title.
   */
  protected readonly title: string = SETTING?.title ?? '';

  /**
   * Gets the row's description.
   */
  protected readonly description: string = SETTING?.description ?? '';

  /**
   * Holds the settings the associations are kept in.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the Monaco service, which knows the languages a file can be given.
   */
  private readonly monaco: Monaco = inject(Monaco);

  /**
   * Gets the associations, as the setting holds them.
   */
  protected readonly associations: Signal<readonly FileAssociation[]> = computed(
    (): readonly FileAssociation[] =>
      fileAssociations(this.settings.value('textEditor.fileAssociations')()),
  );

  /**
   * Gets the listed rows.
   */
  protected readonly rows: Signal<readonly AssociationRow[]> = computed(
    (): readonly AssociationRow[] =>
      this.associations().map((association: FileAssociation): AssociationRow => ({
        association,
        languageLabel: $localize`:Accessible label of the language picker of a listed file association:Language for ${association.pattern}:pattern:`,
        removeLabel: $localize`:Accessible label of the button removing a file association:Remove the association for ${association.pattern}:pattern:`,
      })),
  );

  /**
   * Gets the languages on offer, by display name — every language Monaco knows once it has loaded.
   */
  protected readonly languages: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] =>
      this.monaco.associableLanguages().map((language: LanguageInfo): DropdownOption => ({
        value: language.id,
        label: language.name,
      })),
  );

  /**
   * Holds the pattern being typed.
   */
  protected readonly patternDraft: WritableSignal<string> = signal<string>('');

  /**
   * Holds the language picked for the pattern being typed, or empty while none is.
   */
  protected readonly languageDraft: WritableSignal<string> = signal<string>('');

  /**
   * Gets whether the typed association can be added: a pattern and a language are both given.
   */
  protected readonly canAdd: Signal<boolean> = computed(
    (): boolean => this.patternDraft().trim() !== '' && this.languageDraft() !== '',
  );

  /**
   * Initializes a new instance of the {@link FileAssociations} class, loading Monaco once the row is
   * drawn, so the language list offers every language it knows rather than only Studio's own.
   */
  public constructor() {
    afterNextRender((): void => {
      // The list fills in when the load finishes; a failed load leaves Studio's own languages, which
      // the editor logs, so nothing more is owed here.
      void this.monaco.ensureLoaded().catch((): void => undefined);
    });
  }

  /**
   * Adds the typed association and clears the fields. An entry for a pattern already listed is
   * replaced, so a pattern is never answered by two languages.
   */
  protected add(): void {
    if (!this.canAdd()) {
      return;
    }
    this.settings.set(
      'textEditor.fileAssociations',
      withFileAssociation(this.associations(), {
        pattern: this.patternDraft(),
        language: this.languageDraft(),
      }),
    );
    this.patternDraft.set('');
    this.languageDraft.set('');
  }

  /**
   * Gives a listed association another language.
   * @param association The association.
   * @param language The language picked.
   */
  protected changeLanguage(association: FileAssociation, language: string): void {
    this.settings.set(
      'textEditor.fileAssociations',
      this.associations().map((existing: FileAssociation): FileAssociation =>
        existing === association ? { pattern: existing.pattern, language } : existing,
      ),
    );
  }

  /**
   * Removes an association.
   * @param association The association to remove.
   */
  protected remove(association: FileAssociation): void {
    this.settings.set(
      'textEditor.fileAssociations',
      withoutFileAssociation(this.associations(), association.pattern),
    );
  }
}
