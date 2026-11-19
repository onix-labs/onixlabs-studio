import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { Button } from '@shared/angular/components/forms/button/button';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { Icon } from '@shared/angular/icons/icon';
import { Settings } from '@shared/angular/services/settings/settings';
import {
  DEFAULT_FILE_NESTING_RULES,
  FileNestingRule,
  fileNestingRules,
} from '@shared/angular/services/workspace/file-nesting';

/**
 * Represents the File Nesting row on Workspaces › Explorers: the rules that decide which files gather
 * others beneath them when an explorer nests files. A rule is added as a parent pattern and its child
 * patterns, and removed per row; the list is a setting, so it travels with Export and Import.
 */
@Component({
  selector: 'app-file-nesting-rules',
  imports: [Button, SettingRow, TextField],
  templateUrl: './file-nesting-rules.html',
  styleUrls: ['../section.scss', './file-nesting-rules.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileNestingRules {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the settings the rules are kept in.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Gets the rules, as the setting holds them.
   */
  protected readonly rules: Signal<readonly FileNestingRule[]> = computed(
    (): readonly FileNestingRule[] =>
      fileNestingRules(this.settings.value('workspaces.fileNesting')()),
  );

  /**
   * Gets whether the rules are the ones File Nesting starts with, when there is nothing to restore.
   */
  protected readonly isDefault: Signal<boolean> = computed((): boolean => {
    const rules: readonly FileNestingRule[] = this.rules();
    return (
      rules.length === DEFAULT_FILE_NESTING_RULES.length &&
      rules.every(
        (rule: FileNestingRule, index: number): boolean =>
          rule.parent === DEFAULT_FILE_NESTING_RULES[index].parent &&
          rule.children === DEFAULT_FILE_NESTING_RULES[index].children,
      )
    );
  });

  /**
   * Holds the parent pattern being typed.
   */
  protected readonly parentDraft: WritableSignal<string> = signal<string>('');

  /**
   * Holds the child patterns being typed.
   */
  protected readonly childrenDraft: WritableSignal<string> = signal<string>('');

  /**
   * Gets whether the typed rule can be added: both patterns are given.
   */
  protected readonly canAdd: Signal<boolean> = computed(
    (): boolean => this.parentDraft().trim() !== '' && this.childrenDraft().trim() !== '',
  );

  /**
   * Adds the typed rule and clears the fields. A rule for a parent pattern already listed replaces
   * it, so a pattern is never answered by two rules.
   */
  protected add(): void {
    if (!this.canAdd()) {
      return;
    }
    const rule: FileNestingRule = {
      parent: this.parentDraft().trim(),
      children: this.childrenDraft().trim(),
    };
    const others: readonly FileNestingRule[] = this.rules().filter(
      (existing: FileNestingRule): boolean => existing.parent !== rule.parent,
    );
    this.settings.set('workspaces.fileNesting', [...others, rule]);
    this.parentDraft.set('');
    this.childrenDraft.set('');
  }

  /**
   * Removes a rule.
   * @param rule The rule to remove.
   */
  protected remove(rule: FileNestingRule): void {
    this.settings.set(
      'workspaces.fileNesting',
      this.rules().filter((existing: FileNestingRule): boolean => existing !== rule),
    );
  }

  /**
   * Puts back the rules File Nesting starts with.
   */
  protected restoreDefaults(): void {
    this.settings.set('workspaces.fileNesting', DEFAULT_FILE_NESTING_RULES);
  }
}
