import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { GLOBAL_SCOPE, PromptScope } from '@shared/api/ai-types';
import { Skill, SkillDraft, SkillSaveResult } from '@shared/api/skill-channels';
import { Button } from '@shared/angular/components/forms/button/button';
import { ButtonRow } from '@shared/angular/components/forms/button-row/button-row';
import { Modal } from '@shared/angular/components/modal/modal';
import { ModalContent } from '@shared/angular/components/modal/modal-content';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { MarkdownField } from '@shared/angular/components/forms/markdown-field/markdown-field';
import { Textarea } from '@shared/angular/components/forms/textarea/textarea';
import { Toggle } from '@shared/angular/components/forms/toggle/toggle';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Panel } from '@shared/angular/components/panel-layout/panel';
import { PanelLayout } from '@shared/angular/components/panel-layout/panel-layout';
import { CategoryItem, CategoryList } from '@shared/angular/components/category-list/category-list';
import { PanelEdge } from '@shared/angular/components/panel-layout/panel-types';
import { Icon } from '@shared/angular/icons/icon';
import { OPEN_IN_FILE_SYSTEM_LABEL } from '@shared/angular/services/shell/shell-labels';
import { Log } from '@shared/angular/services/log/log';
import { Skills } from '@shared/angular/services/skills/skills';
import {
  AiLibraryCommandHandler,
  AiLibraryCommands,
} from '../ai-library-commands/ai-library-commands';
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
 * The AI Manager's Skills sub-view (#301, #948): the user's skill library — folders of `SKILL.md`
 * under Studio's user-data path, listed to agents by name and description and loaded on demand —
 * listed in its side panel, with the one selected edited at full width in the main area.
 *
 * Unlike the prompt profiles, a skill is on disk and a save can be refused — a name that is not a
 * valid folder name, a description the model could not act on — so edits are held as a draft and
 * committed with a Save button rather than written on every keystroke. The disk stays the truth:
 * every save and delete re-reads the library, and Refresh re-reads it for a user editing beside
 * Studio.
 */
@Component({
  selector: 'app-skill-library',
  imports: [
    AppIcon,
    Button,
    ButtonRow,
    CategoryList,
    MarkdownField,
    Modal,
    ModalContent,
    Panel,
    PanelLayout,
    PromptScopeEditor,
    SettingRow,
    TextField,
    Textarea,
    Toggle,
  ],
  templateUrl: './skill-library.html',
  styleUrl: '../library.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SkillLibrarySection {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the edges the side panel may sit on: only its own, since it is part of the sub-view.
   */
  protected readonly sideEdges: readonly PanelEdge[] = ['left'];

  /**
   * Holds the side panel's search text.
   */
  protected readonly query: WritableSignal<string> = signal<string>('');

  /**
   * Gets the label for showing a skill's folder in the file system.
   */
  protected readonly openInFileSystemLabel: string = OPEN_IN_FILE_SYSTEM_LABEL;

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
   * Holds the key of the selected row, or null when none is.
   */
  private readonly selectedKey: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds the outcome of the last import, shown beneath the toolbar until the next action.
   */
  protected readonly notice: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds a counter for temporary keys.
   */
  private sequence: number = 0;

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
   * Gets the side panel's entries: the skills whose name matches the search, stored ones first and
   * then the unsaved, dimmed when switched off and flagged when the file cannot be offered.
   */
  protected readonly items: Signal<readonly CategoryItem[]> = computed(
    (): readonly CategoryItem[] => {
      const text: string = this.query().trim().toLowerCase();
      return this.rows()
        .filter(
          (row: SkillRow): boolean =>
            text.length === 0 || this.nameOf(row).toLowerCase().includes(text),
        )
        .map((row: SkillRow): CategoryItem => ({
          id: row.key,
          label: this.nameOf(row),
          icon: Icon.AI_SKILLS,
          muted: !row.draft.enabled,
          badge: row.stored?.problem ? Icon.WARNING_FILL : null,
          badgeLabel: row.stored?.problem ? 'Not offered to agents' : undefined,
          action: Icon.TRASH_DUOTONE,
          actionLabel: `Delete ${this.nameOf(row)}`,
        }));
    },
  );

  /**
   * Gets the selected row, or null when none is (or it has gone).
   */
  protected readonly selected: Signal<SkillRow | null> = computed(
    (): SkillRow | null =>
      this.rows().find((row: SkillRow): boolean => row.key === this.selectedKey()) ?? null,
  );

  /**
   * Holds the skill waiting on the delete confirmation, or null when none is.
   */
  protected readonly deleteTarget: WritableSignal<SkillRow | null> = signal<SkillRow | null>(null);

  /**
   * Holds the ribbon's handler for this section.
   */
  private readonly commandHandler: AiLibraryCommandHandler = {
    add: (): void => this.add(),
    importFrom: (): void => void this.import(),
  };

  /**
   * Initializes the section, registering it with the ribbon while it is shown.
   */
  public constructor() {
    const commands: AiLibraryCommands = inject(AiLibraryCommands);
    commands.register('skills', this.commandHandler);
    inject(DestroyRef).onDestroy((): void => commands.unregister('skills', this.commandHandler));
  }

  /**
   * Gets the name a skill is listed by: its stored name, its draft's, or a placeholder for a new one.
   * @param row The row.
   * @returns Returns the name.
   */
  protected nameOf(row: SkillRow): string {
    return row.stored?.name ?? (row.draft.name || 'New skill');
  }

  /**
   * Selects a row.
   * @param key The row's key.
   */
  protected select(key: string): void {
    this.selectedKey.set(key);
  }

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
    this.selectedKey.set(key);
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
    // The library was re-read on save; the row now shows the stored form, so the draft is dropped. The
    // stored row is keyed by its name, which a new skill or a rename has just changed.
    this.dropRow(row.key);
    if (this.selectedKey() === row.key) {
      this.selectedKey.set(draft.name);
    }
    this.log.info('aiManager.skills', `Skill saved '${draft.name}'`);
  }

  /**
   * Discards a row's draft, or removes an unsaved row.
   * @param row The row.
   */
  protected revert(row: SkillRow): void {
    this.dropRow(row.key);
  }

  /**
   * Asks to delete a skill, from the bin on its side panel entry.
   * @param key The row's key.
   */
  protected askDelete(key: string): void {
    this.deleteTarget.set(this.rows().find((row: SkillRow): boolean => row.key === key) ?? null);
  }

  /**
   * Deletes the skill the confirmation asked about: its folder when stored, its draft either way.
   * @returns Resolves once the folder is gone.
   */
  protected async confirmDelete(): Promise<void> {
    const target: SkillRow | null = this.deleteTarget();
    this.deleteTarget.set(null);
    if (target !== null) {
      await this.remove(target);
    }
  }

  /**
   * Keeps the skill the confirmation asked about.
   */
  protected cancelDelete(): void {
    this.deleteTarget.set(null);
  }

  /**
   * Deletes a skill: its folder when it is stored, and its draft either way.
   * @param row The row.
   * @returns Resolves once the folder is gone.
   */
  protected async remove(row: SkillRow): Promise<void> {
    this.dropRow(row.key);
    if (row.stored !== null) {
      await this.skills.delete(row.stored.name);
      this.log.info('aiManager.skills', `Skill deleted '${row.stored.name}'`);
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
    this.selectedKey.set(result.skill?.name ?? null);
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
