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
import {
  isOverCoreLimit,
  normalizeTags,
  PERSONA_CORE_LINE_LIMIT,
  personaDay,
  personaEntryMatches,
  PersonaLayer,
} from '@shared/api/persona-channels';
import { Button } from '@shared/angular/components/forms/button/button';
import {
  ButtonGroup,
  ButtonGroupOption,
} from '@shared/angular/components/forms/button-group/button-group';
import { ButtonRow } from '@shared/angular/components/forms/button-row/button-row';
import { Chip } from '@shared/angular/components/chip/chip';
import { Modal } from '@shared/angular/components/modal/modal';
import { ModalContent } from '@shared/angular/components/modal/modal-content';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { Textarea } from '@shared/angular/components/forms/textarea/textarea';
import { MarkdownField } from '@shared/angular/components/forms/markdown-field/markdown-field';
import { Toggle } from '@shared/angular/components/forms/toggle/toggle';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { CategoryItem } from '@shared/angular/components/category-list/category-list';
import { Icon } from '@shared/angular/icons/icon';
import { Log } from '@shared/angular/services/log/log';
import { Persona, PersonaEntry } from '@shared/angular/services/persona/persona';
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
 * A tag and how many entries carry it, for the overview's list of tags.
 */
interface TagCount {
  /**
   * Gets the tag.
   */
  readonly tag: string;

  /**
   * Gets how many entries carry it.
   */
  readonly count: number;
}

/**
 * The AI Manager's Persona sub-view (#1514), which replaced Prompt Profiles: what Studio knows about
 * the user, listed in the side panel — the core first, then the memories — and the entry selected
 * edited at full width in the main area. With nothing selected, the main area is an overview: how full
 * the core is, and the tags, each of which narrows the list to its entries.
 *
 * Edits are written as they are made. What the user writes here is locked, so Pete never changes it.
 */
@Component({
  selector: 'app-persona',
  imports: [
    AppIcon,
    Button,
    ButtonGroup,
    ButtonRow,
    Chip,
    MarkdownField,
    Modal,
    ModalContent,
    PromptScopeEditor,
    SettingRow,
    SkillImportModal,
    TextField,
    Textarea,
    Toggle,
  ],
  providers: [SkillImportSession],
  templateUrl: './persona.html',
  styleUrls: ['../library.scss', './persona.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PersonaSection {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the core's line limit, exposed for the template.
   */
  protected readonly coreLimit: number = PERSONA_CORE_LINE_LIMIT;

  /**
   * Gets the choices of layer.
   */
  protected readonly layers: readonly ButtonGroupOption[] = [
    { value: 'core', label: 'Core', icon: Icon.PERSONA_CORE },
    { value: 'memory', label: 'Memory', icon: Icon.PERSONA_MEMORY },
  ];

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
   * Holds the persona.
   */
  protected readonly service: Persona = inject(Persona);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the identifier of the selected entry, or null when none is.
   */
  private readonly selectedId: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds the tags being typed for the selected entry, or null while nothing is being typed; written
   * to the entry when the field is left, so a half-typed tag is not split at every keystroke.
   */
  private readonly tagDraft: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Gets how many entries there are, before the search narrows them.
   */
  protected readonly count: Signal<number> = computed((): number => this.service.entries().length);

  /**
   * Gets whether the enabled core is over its limit.
   */
  protected readonly coreOver: Signal<boolean> = computed(
    (): boolean => this.service.coreLines() > PERSONA_CORE_LINE_LIMIT,
  );

  /**
   * Gets the tags in use, most used first.
   */
  protected readonly tags: Signal<readonly TagCount[]> = computed((): readonly TagCount[] => {
    const counts: Map<string, number> = new Map<string, number>();
    for (const entry of this.service.entries()) {
      for (const tag of entry.tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return [...counts]
      .map(([tag, count]: [string, number]): TagCount => ({ tag, count }))
      .sort((a: TagCount, b: TagCount): number => b.count - a.count || a.tag.localeCompare(b.tag));
  });

  /**
   * Gets the side panel's entries: the core, then the memories, each narrowed by the search, dimmed
   * when switched off and marked when locked.
   */
  protected readonly items: Signal<readonly CategoryItem[]> = computed(
    (): readonly CategoryItem[] => {
      const query: string = this.query();
      const toItem: (entry: PersonaEntry, index: number) => CategoryItem = (
        entry: PersonaEntry,
        index: number,
      ): CategoryItem => ({
        id: entry.id,
        label: entry.name,
        icon: entry.layer === 'core' ? Icon.PERSONA_CORE : Icon.PERSONA_MEMORY,
        muted: !entry.enabled,
        badge: entry.locked ? Icon.LOCK : null,
        badgeLabel: entry.locked ? 'Locked' : '',
        dividerBefore: entry.layer === 'memory' && index === 0 && this.hasVisibleCore(query),
        action: Icon.TRASH_DUOTONE,
        actionLabel: `Delete ${entry.name}`,
      });
      const visible: (entries: readonly PersonaEntry[]) => readonly PersonaEntry[] = (
        entries: readonly PersonaEntry[],
      ): readonly PersonaEntry[] =>
        entries.filter((entry: PersonaEntry): boolean => personaEntryMatches(entry, query));
      return [
        ...visible(this.service.core()).map(toItem),
        ...visible(this.service.memories()).map(toItem),
      ];
    },
  );

  /**
   * Gets the selected entry, or null when none is (or it has been deleted).
   */
  protected readonly selected: Signal<PersonaEntry | null> = computed((): PersonaEntry | null => {
    const id: string | null = this.selectedId();
    return id === null ? null : (this.service.find(id) ?? null);
  });

  /**
   * Gets whether the selected entry is, alone, longer than the whole core may be.
   */
  protected readonly selectedOverLimit: Signal<boolean> = computed((): boolean => {
    const entry: PersonaEntry | null = this.selected();
    return entry !== null && entry.enabled && isOverCoreLimit(entry);
  });

  /**
   * Gets how sure Pete is of the selected entry, in words for its chip.
   */
  protected readonly selectedSureness: Signal<string> = computed(
    (): string => `${Math.round((this.selected()?.confidence ?? 1) * 100)}% sure`,
  );

  /**
   * Gets the selected entry's tags as the field shows them: what is being typed, else the tags.
   */
  protected readonly tagText: Signal<string> = computed(
    (): string => this.tagDraft() ?? this.selected()?.tags.join(', ') ?? '',
  );

  /**
   * Holds the entry waiting on the delete confirmation, or null when none is.
   */
  protected readonly deleteTarget: WritableSignal<PersonaEntry | null> =
    signal<PersonaEntry | null>(null);

  /**
   * Holds the ribbon's handler for this section.
   */
  private readonly commandHandler: AiLibraryCommandHandler = {
    add: (): void => this.add('memory'),
    addCore: (): void => this.add('core'),
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
    commands.register('persona', this.commandHandler);
    inject(DestroyRef).onDestroy((): void => commands.unregister('persona', this.commandHandler));
    this.registerWithSidebar();
  }

  /**
   * Selects an entry.
   * @param id The entry's identifier.
   */
  protected select(id: string): void {
    this.commitTags();
    this.selectedId.set(id);
  }

  /**
   * Narrows the side panel to one tag's entries, through the shared search.
   * @param tag The tag.
   */
  protected showTag(tag: string): void {
    this.sidebar?.query.set(`#${tag}`);
  }

  /**
   * Imports Markdown files into the persona (#1263): each becomes an entry the user wrote, in the core,
   * as a prompt profile did. Asks only about name clashes.
   * @returns Resolves once the import has finished or been cancelled.
   */
  protected async import(): Promise<void> {
    this.notice.set(null);
    const outcome: string | null = await this.importSession.start(null, 'persona');
    if (outcome !== null) {
      this.notice.set(outcome);
    }
  }

  /**
   * Creates an entry and selects it.
   * @param layer Which half of the persona it goes in.
   */
  protected add(layer: PersonaLayer): void {
    this.notice.set(null);
    this.commitTags();
    const created: PersonaEntry = this.service.create({ layer });
    this.selectedId.set(created.id);
    this.log.info('aiManager.persona', `Persona ${layer} entry created`, created.id);
  }

  /**
   * Asks to delete an entry, from the bin on its side panel entry.
   * @param id The entry's identifier.
   */
  protected askDelete(id: string): void {
    this.deleteTarget.set(this.service.find(id) ?? null);
  }

  /**
   * Deletes the entry the confirmation asked about.
   */
  protected confirmDelete(): void {
    const target: PersonaEntry | null = this.deleteTarget();
    this.deleteTarget.set(null);
    if (target !== null) {
      this.log.info('aiManager.persona', 'Persona entry deleted', target.id);
      this.service.delete(target.id);
    }
  }

  /**
   * Keeps the entry the confirmation asked about.
   */
  protected cancelDelete(): void {
    this.deleteTarget.set(null);
  }

  /**
   * Renames an entry. A blank name is kept as it was, because the name heads a core entry's part of
   * the agent's instructions and a nameless section reads as noise.
   * @param id The entry's identifier.
   * @param name The new name.
   */
  protected rename(id: string, name: string): void {
    const trimmed: string = name.trim();
    if (trimmed.length > 0) {
      this.service.update(id, { name: trimmed });
    }
  }

  /**
   * Moves an entry between the core and the memories.
   * @param id The entry's identifier.
   * @param layer The layer picked.
   */
  protected setLayer(id: string, layer: string): void {
    if (layer === 'core' || layer === 'memory') {
      this.service.update(id, { layer });
    }
  }

  /**
   * Sets whether an entry is used.
   * @param id The entry's identifier.
   * @param enabled Whether it is used.
   */
  protected setEnabled(id: string, enabled: boolean): void {
    this.service.update(id, { enabled });
  }

  /**
   * Sets whether an entry is locked against Pete's changes.
   * @param id The entry's identifier.
   * @param locked Whether it is locked.
   */
  protected setLocked(id: string, locked: boolean): void {
    this.service.update(id, { locked });
  }

  /**
   * Sets an entry's scope.
   * @param id The entry's identifier.
   * @param scope The scope.
   */
  protected setScope(id: string, scope: PromptScope): void {
    this.service.update(id, { scope });
  }

  /**
   * Sets an entry's text.
   * @param id The entry's identifier.
   * @param text The text.
   */
  protected setText(id: string, text: string): void {
    this.service.update(id, { text });
  }

  /**
   * Sets an entry's reason.
   * @param id The entry's identifier.
   * @param why The reason.
   */
  protected setWhy(id: string, why: string): void {
    this.service.update(id, { why });
  }

  /**
   * Holds the tags being typed.
   * @param text What the field holds.
   */
  protected typeTags(text: string): void {
    this.tagDraft.set(text);
  }

  /**
   * Writes the tags being typed to the selected entry, once the field is left.
   */
  protected commitTags(): void {
    const draft: string | null = this.tagDraft();
    const entry: PersonaEntry | null = this.selected();
    this.tagDraft.set(null);
    if (draft !== null && entry !== null) {
      this.service.update(entry.id, { tags: normalizeTags(draft.split(',')) });
    }
  }

  /**
   * Confirms an entry Pete learned: it is right, so it is certain and its fading starts again (#1519).
   * @param id The entry's identifier.
   */
  protected confirm(id: string): void {
    this.service.update(id, { confidence: 1, confirmed: personaDay() });
  }

  /**
   * Determines whether any core entry survives the search, so the memories are divided from it.
   * @param query The search text.
   * @returns Returns true when one does.
   */
  private hasVisibleCore(query: string): boolean {
    return this.service
      .core()
      .some((entry: PersonaEntry): boolean => personaEntryMatches(entry, query));
  }

  /**
   * Puts the entries in the AI Manager's sidebar while this section is shown.
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
        this.query().trim().length > 0 ? 'Nothing in the persona matches.' : 'Nothing here yet.',
      ),
    };
    sidebar.register('persona', list);
    inject(DestroyRef).onDestroy((): void => sidebar.unregister(list));
  }
}
