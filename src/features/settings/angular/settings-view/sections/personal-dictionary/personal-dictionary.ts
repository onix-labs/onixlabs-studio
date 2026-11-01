import { ChangeDetectionStrategy, Component, inject, signal, WritableSignal } from '@angular/core';
import { Button } from '@shared/angular/components/forms/button/button';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { Icon } from '@shared/angular/icons/icon';
import { Spelling } from '@shared/angular/services/spelling/spelling';

/**
 * Represents the Personal Dictionary row on Markdown › General: the words never marked as misspelled,
 * in Markdown review or in any text box. Words are added one at a time and removed per row; the list
 * is a setting, so it travels with Export and Import.
 */
@Component({
  selector: 'app-personal-dictionary',
  imports: [Button, SettingRow, TextField],
  templateUrl: './personal-dictionary.html',
  styleUrls: ['../section.scss', './personal-dictionary.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PersonalDictionary {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the app's spell checking, which owns the dictionary.
   */
  protected readonly spelling: Spelling = inject(Spelling);

  /**
   * Holds the word being typed.
   */
  protected readonly draft: WritableSignal<string> = signal<string>('');

  /**
   * Adds the typed word and clears the field. A word already in the dictionary, or more than one
   * word, is not added.
   */
  protected add(): void {
    if (this.spelling.addWord(this.draft())) {
      this.draft.set('');
    }
  }

  /**
   * Removes a word.
   * @param word The word to remove.
   */
  protected remove(word: string): void {
    this.spelling.removeWord(word);
  }
}
