import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  Signal,
  signal,
  WritableSignal,
} from '@angular/core';
import { PromptScope } from '@shared/api/ai-types';
import { Button } from '@shared/angular/components/forms/button/button';
import { ButtonRow } from '@shared/angular/components/forms/button-row/button-row';
import { Modal } from '@shared/angular/components/modal/modal';
import { ModalContent } from '@shared/angular/components/modal/modal-content';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { MarkdownField } from '@shared/angular/components/forms/markdown-field/markdown-field';
import { Toggle } from '@shared/angular/components/forms/toggle/toggle';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { CategoryItem } from '@shared/angular/components/category-list/category-list';
import { Icon } from '@shared/angular/icons/icon';
import { Log } from '@shared/angular/services/log/log';
import {
  PromptProfile,
  PromptProfiles,
} from '@shared/angular/services/prompt-profiles/prompt-profiles';
import {
  AiLibraryCommandHandler,
  AiLibraryCommands,
} from '../ai-library-commands/ai-library-commands';
import { PromptScopeEditor } from '../prompt-scope-editor/prompt-scope-editor';
import {
  AiManagerSidebarList,
  AiManagerSidebarState,
} from '../ai-manager-sidebar/ai-manager-sidebar-state';
import { SkillImportModal } from '../skill-import/skill-import-modal';
import { SkillImportSession } from '../skill-import/skill-import-session';

/**
 * The AI Manager's Prompt Profiles sub-view (#300, #948): the user's profiles listed in its side
 * panel, and the one selected edited at full width in the main area, as a mail client shows a
 * message. A profile is standing instructions, part of the agent's brief in every conversation its
 * scope matches; edits are written as they are made.
 */
@Component({
  selector: 'app-prompt-profiles',
  imports: [
    AppIcon,
    Button,
    ButtonRow,
    MarkdownField,
    Modal,
    ModalContent,
    PromptScopeEditor,
    SettingRow,
    SkillImportModal,
    TextField,
    Toggle,
  ],
  providers: [SkillImportSession],
  templateUrl: './prompt-profiles.html',
  styleUrl: '../library.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PromptProfilesSection {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the AI Manager's sidebar, which lists this section's entries and owns the search; absent
   * outside the AI Manager view.
   */
  private readonly sidebar: AiManagerSidebarState | null = inject(AiManagerSidebarState, {
    optional: true,
  });

  /**
   * Gets the sidebar's search text, which narrows the entries.
   */
  protected readonly query: Signal<string> = this.sidebar?.query ?? signal<string>('').asReadonly();

  /**
   * Holds the profiles service.
   */
  private readonly service: PromptProfiles = inject(PromptProfiles);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the identifier of the selected profile, or null when none is.
   */
  private readonly selectedId: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Gets how many profiles there are, before the search narrows them.
   */
  protected readonly count: Signal<number> = computed((): number => this.service.profiles().length);

  /**
   * Gets the side panel's entries: the profiles whose name matches the search, in the user's order,
   * dimmed when switched off.
   */
  protected readonly items: Signal<readonly CategoryItem[]> = computed(
    (): readonly CategoryItem[] => {
      const text: string = this.query().trim().toLowerCase();
      return this.service
        .profiles()
        .filter(
          (profile: PromptProfile): boolean =>
            text.length === 0 || profile.name.toLowerCase().includes(text),
        )
        .map((profile: PromptProfile): CategoryItem => ({
          id: profile.id,
          label: profile.name,
          icon: Icon.AI_PROFILES,
          muted: !profile.enabled,
          action: Icon.TRASH_DUOTONE,
          actionLabel: `Delete ${profile.name}`,
        }));
    },
  );

  /**
   * Gets the selected profile, or null when none is (or it has been deleted).
   */
  protected readonly selected: Signal<PromptProfile | null> = computed(
    (): PromptProfile | null =>
      this.service
        .profiles()
        .find((profile: PromptProfile): boolean => profile.id === this.selectedId()) ?? null,
  );

  /**
   * Holds the profile waiting on the delete confirmation, or null when none is.
   */
  protected readonly deleteTarget: WritableSignal<PromptProfile | null> =
    signal<PromptProfile | null>(null);

  /**
   * Holds the ribbon's handler for this section.
   */
  private readonly commandHandler: AiLibraryCommandHandler = {
    add: (): void => this.add(),
    importFrom: (): void => void this.import(),
  };

  /**
   * Holds the import session the import dialogs show.
   */
  private readonly importSession: SkillImportSession = inject(SkillImportSession);

  /**
   * Holds the outcome of the last import, shown above the editor until the next action.
   */
  protected readonly notice: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Initializes the section, registering it with the ribbon while it is shown.
   */
  public constructor() {
    const commands: AiLibraryCommands = inject(AiLibraryCommands);
    commands.register('profiles', this.commandHandler);
    inject(DestroyRef).onDestroy((): void => commands.unregister('profiles', this.commandHandler));
    this.registerWithSidebar();
  }

  /**
   * Puts the profiles in the AI Manager's sidebar while this section is shown.
   */
  private registerWithSidebar(): void {
    const sidebar: AiManagerSidebarState | null = this.sidebar;
    if (sidebar === null) {
      return;
    }
    const list: AiManagerSidebarList = {
      items: this.items,
      selectedId: computed((): string | null => this.selected()?.id ?? null),
      select: (id: string): void => this.select(id),
      action: (id: string): void => this.askDelete(id),
      emptyText: computed((): string =>
        this.query().trim().length > 0 ? 'No profiles match.' : 'No profiles yet.',
      ),
    };
    sidebar.register('profiles', list);
    inject(DestroyRef).onDestroy((): void => sidebar.unregister(list));
  }

  /**
   * Selects a profile.
   * @param id The profile's identifier.
   */
  protected select(id: string): void {
    this.selectedId.set(id);
  }

  /**
   * Imports prompt profiles from Markdown files, a folder of them or an export the user picks
   * (#1263), asking only about name clashes.
   * @returns Resolves once the import has finished or been cancelled.
   */
  protected async import(): Promise<void> {
    this.notice.set(null);
    const outcome: string | null = await this.importSession.start(null, 'profiles');
    if (outcome !== null) {
      this.notice.set(outcome);
    }
  }

  /**
   * Creates a new profile and selects it.
   */
  protected add(): void {
    this.notice.set(null);
    const created: PromptProfile = this.service.create();
    this.selectedId.set(created.id);
    this.log.info('aiManager.promptProfiles', 'Prompt profile created', created.id);
  }

  /**
   * Asks to delete a profile, from the bin on its side panel entry.
   * @param id The profile's identifier.
   */
  protected askDelete(id: string): void {
    this.deleteTarget.set(
      this.service.profiles().find((profile: PromptProfile): boolean => profile.id === id) ?? null,
    );
  }

  /**
   * Deletes the profile the confirmation asked about.
   */
  protected confirmDelete(): void {
    const target: PromptProfile | null = this.deleteTarget();
    this.deleteTarget.set(null);
    if (target !== null) {
      this.log.info('aiManager.promptProfiles', 'Prompt profile deleted', target.id);
      this.service.delete(target.id);
    }
  }

  /**
   * Keeps the profile the confirmation asked about.
   */
  protected cancelDelete(): void {
    this.deleteTarget.set(null);
  }

  /**
   * Renames a profile. A blank name is kept as it was, because the name heads the profile's section
   * in the composed instructions and a nameless section reads as noise.
   * @param id The profile's identifier.
   * @param name The new name.
   */
  protected rename(id: string, name: string): void {
    const trimmed: string = name.trim();
    if (trimmed.length > 0) {
      this.service.update(id, { name: trimmed });
    }
  }

  /**
   * Sets whether a profile is used.
   * @param id The profile's identifier.
   * @param enabled Whether it is used.
   */
  protected setEnabled(id: string, enabled: boolean): void {
    this.service.update(id, { enabled });
  }

  /**
   * Sets a profile's scope.
   * @param id The profile's identifier.
   * @param scope The scope.
   */
  protected setScope(id: string, scope: PromptScope): void {
    this.service.update(id, { scope });
  }

  /**
   * Sets a profile's instructions.
   * @param id The profile's identifier.
   * @param instructions The text.
   */
  protected setInstructions(id: string, instructions: string): void {
    this.service.update(id, { instructions });
  }
}
