import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { GLOBAL_SCOPE, PromptScope } from '@shared/api/ai-types';
import { Skill, SkillDraft, SkillSaveResult } from '@shared/api/skill-channels';
import { Accordion } from '@shared/angular/components/forms/accordion/accordion';
import { Button } from '@shared/angular/components/forms/button/button';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { Textarea } from '@shared/angular/components/forms/textarea/textarea';
import { Toggle } from '@shared/angular/components/forms/toggle/toggle';
import { Icon } from '@shared/angular/icons/icon';
import { Log } from '@shared/angular/services/log/log';
import { Skills } from '@shared/angular/services/skills/skills';
import { PromptScopeEditor } from '../prompt-scope-editor/prompt-scope-editor';

/**
 * A skill as the editor holds it: what is on disk, the draft being edited, and the state of the last
 * save. A skill not yet on disk has no stored form.
 */
export interface SkillRow {
  /**
   * Gets the key the row is tracked by: the stored name, or a temporary id for a new skill.
   */
  readonly key: string;

  /**
   * Gets the skill as stored, or null for one not yet saved.
   */
  readonly stored: Skill | null;

  /**
   * Gets the draft being edited.
   */
  readonly draft: SkillDraft;

  /**
   * Gets the reason the last save was refused, or null.
   */
  readonly error: string | null;

  /**
   * Gets whether a save is in flight.
   */
  readonly saving: boolean;
}

/**
 * Edits the user's skill library (#301): folders of `SKILL.md` under Studio's user-data path, listed
 * to agents by name and description and loaded on demand.
 *
 * Unlike the prompt profiles, a skill is on disk and a save can be refused — a name that is not a
 * valid folder name, a description the model could not act on — so edits are held as a draft and
 * committed with a Save button rather than written on every keystroke. The disk stays the truth:
 * every save and delete re-reads the library, and Refresh re-reads it for a user editing beside
 * Studio.
 */
@Component({
  selector: 'app-skill-library',
  imports: [Accordion, Button, SettingRow, TextField, Textarea, Toggle, PromptScopeEditor],
  templateUrl: './skill-library.html',
  styleUrls: ['../sections/section.scss', './skill-library.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SkillLibrarySettings {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the skill service.
   */
  private readonly skills: Skills = inject(Skills);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the drafts, keyed by row key. A stored skill with no entry here is shown as stored.
   */
  private readonly drafts: WritableSignal<ReadonlyMap<string, SkillRow>> = signal<
    ReadonlyMap<string, SkillRow>
  >(new Map<string, SkillRow>());

  /**
   * Holds the key of the row created most recently, so it opens expanded.
   */
  protected readonly justCreated: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds the outcome of the last import, shown beneath the toolbar until the next action.
   */
  protected readonly notice: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds a counter for temporary keys.
   */
  private sequence: number = 0;

  /**
   * Gets whether the library is being read.
   */
  protected readonly loading: Signal<boolean> = this.skills.loading;

  /**
   * Gets the rows: every stored skill (with its draft when one is being edited), then the unsaved
   * new skills in creation order.
   */
  protected readonly rows: Signal<readonly SkillRow[]> = computed((): readonly SkillRow[] => {
    const drafts: ReadonlyMap<string, SkillRow> = this.drafts();
    const stored: readonly SkillRow[] = this.skills
      .skills()
      .map((skill: Skill): SkillRow => drafts.get(skill.name) ?? this.rowOf(skill));
    const fresh: readonly SkillRow[] = [...drafts.values()].filter(
      (row: SkillRow): boolean => row.stored === null,
    );
    return [...stored, ...fresh];
  });

  /**
   * Starts a new, unsaved skill.
   */
  protected add(): void {
    this.sequence += 1;
    const key: string = `new-${this.sequence}`;
    const row: SkillRow = {
      key,
      stored: null,
      draft: {
        name: '',
        description: '',
        scope: GLOBAL_SCOPE,
        enabled: true,
        body: '',
      },
      error: null,
      saving: false,
    };
    this.setRow(row);
    this.justCreated.set(key);
    this.notice.set(null);
  }

  /**
   * Updates a row's draft.
   * @param row The row.
   * @param patch The fields to change.
   */
  protected edit(row: SkillRow, patch: Partial<SkillDraft>): void {
    this.setRow({ ...row, draft: { ...row.draft, ...patch }, error: null });
  }

  /**
   * Sets a row's scope.
   * @param row The row.
   * @param scope The scope.
   */
  protected setScope(row: SkillRow, scope: PromptScope): void {
    this.edit(row, { scope });
  }

  /**
   * Determines whether a row's draft differs from what is stored.
   * @param row The row.
   * @returns Returns true when there is something to save.
   */
  protected isDirty(row: SkillRow): boolean {
    if (row.stored === null) {
      return true;
    }
    const stored: SkillDraft = this.draftOf(row.stored);
    return JSON.stringify(stored) !== JSON.stringify(row.draft);
  }

  /**
   * Saves a row's draft.
   * @param row The row.
   * @returns Resolves once the library has answered.
   */
  protected async save(row: SkillRow): Promise<void> {
    this.setRow({ ...row, saving: true, error: null });
    const draft: SkillDraft = {
      ...row.draft,
      name: row.draft.name.trim().toLowerCase(),
      ...(row.stored === null ? {} : { previousName: row.stored.name }),
    };
    const result: SkillSaveResult = await this.skills.save(draft);
    if (result.error !== null) {
      this.setRow({ ...row, draft, saving: false, error: result.error });
      return;
    }
    // The library was re-read on save; the row now shows the stored form, so the draft is dropped.
    this.dropRow(row.key);
    if (row.stored === null) {
      this.justCreated.set(draft.name);
    }
    this.log.info('settings.skills', `Skill saved '${draft.name}'`);
  }

  /**
   * Discards a row's draft, or removes an unsaved row.
   * @param row The row.
   */
  protected revert(row: SkillRow): void {
    this.dropRow(row.key);
  }

  /**
   * Deletes a stored skill.
   * @param row The row.
   * @returns Resolves once the folder is gone.
   */
  protected async remove(row: SkillRow): Promise<void> {
    this.dropRow(row.key);
    if (row.stored !== null) {
      await this.skills.delete(row.stored.name);
      this.log.info('settings.skills', `Skill deleted '${row.stored.name}'`);
    }
  }

  /**
   * Reveals a stored skill's folder.
   * @param row The row.
   */
  protected reveal(row: SkillRow): void {
    if (row.stored !== null) {
      void this.skills.reveal(row.stored.name);
    }
  }

  /**
   * Opens the library folder.
   */
  protected openLibrary(): void {
    void this.skills.openLibrary();
  }

  /**
   * Re-reads the library.
   */
  protected refresh(): void {
    this.notice.set(null);
    void this.skills.reload();
  }

  /**
   * Imports a skill through the platform dialog.
   * @returns Resolves once the dialog has closed and the library answered.
   */
  protected async import(): Promise<void> {
    const result: SkillSaveResult | null = await this.skills.import();
    if (result === null) {
      return;
    }
    if (result.error !== null) {
      this.notice.set(result.error);
      return;
    }
    this.notice.set(`Imported "${result.skill?.name ?? 'skill'}".`);
    this.justCreated.set(result.skill?.name ?? null);
  }

  /**
   * Builds the row for a stored skill with no draft.
   * @param skill The stored skill.
   * @returns Returns the row.
   */
  private rowOf(skill: Skill): SkillRow {
    return {
      key: skill.name,
      stored: skill,
      draft: this.draftOf(skill),
      error: null,
      saving: false,
    };
  }

  /**
   * Reads the editable fields of a stored skill.
   * @param skill The stored skill.
   * @returns Returns the draft.
   */
  private draftOf(skill: Skill): SkillDraft {
    return {
      name: skill.name,
      description: skill.description,
      scope: skill.scope,
      enabled: skill.enabled,
      body: skill.body,
    };
  }

  /**
   * Stores a row's draft.
   * @param row The row.
   */
  private setRow(row: SkillRow): void {
    this.drafts.update((drafts: ReadonlyMap<string, SkillRow>): ReadonlyMap<string, SkillRow> => {
      const next: Map<string, SkillRow> = new Map<string, SkillRow>(drafts);
      next.set(row.key, row);
      return next;
    });
  }

  /**
   * Removes a row's draft.
   * @param key The row key.
   */
  private dropRow(key: string): void {
    this.drafts.update((drafts: ReadonlyMap<string, SkillRow>): ReadonlyMap<string, SkillRow> => {
      const next: Map<string, SkillRow> = new Map<string, SkillRow>(drafts);
      next.delete(key);
      return next;
    });
  }
}
