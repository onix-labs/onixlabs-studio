import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import type { Skill } from '@shared/api/skill-channels';
import { CategoryList } from '@shared/angular/components/category-list/category-list';
import { Accordion } from '@shared/angular/components/forms/accordion/accordion';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { Icon } from '@shared/angular/icons/icon';
import {
  AiManagerNavigation,
  AiManagerSection,
} from '@shared/angular/services/ai-manager-navigation/ai-manager-navigation';
import {
  PromptProfile,
  PromptProfiles,
} from '@shared/angular/services/prompt-profiles/prompt-profiles';
import { Skills } from '@shared/angular/services/skills/skills';
import { AiManagerSidebarList, AiManagerSidebarState } from './ai-manager-sidebar-state';

/**
 * One section heading in the sidebar.
 */
interface SidebarSection {
  /**
   * Gets the section.
   */
  readonly id: AiManagerSection;

  /**
   * Gets its heading.
   */
  readonly label: string;

  /**
   * Gets its icon.
   */
  readonly icon: Icon;

  /**
   * Gets how many entries it holds (or, while searching, match), or null when it does not say.
   */
  readonly count: number | null;
}

/**
 * The AI Manager's sidebar: one search over everything, then Local Models, Prompt Profiles and Skills
 * as accordions, one open at a time. Opening a section shows it in the main area and gives the ribbon
 * its groups — the job the ribbon's View group used to do. While searching, a library section with no
 * matches steps aside.
 */
@Component({
  selector: 'app-ai-manager-sidebar',
  imports: [Accordion, CategoryList, TextField],
  templateUrl: './ai-manager-sidebar.html',
  styleUrl: './ai-manager-sidebar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiManagerSidebar {
  /**
   * Holds the sidebar's state: the search and the shown section's list.
   */
  protected readonly state: AiManagerSidebarState = inject(AiManagerSidebarState);

  /**
   * Holds which section is shown.
   */
  private readonly navigation: AiManagerNavigation = inject(AiManagerNavigation);

  /**
   * Holds the prompt profiles, counted on their heading.
   */
  private readonly profiles: PromptProfiles = inject(PromptProfiles);

  /**
   * Holds the skills, counted on their heading.
   */
  private readonly skills: Skills = inject(Skills);

  /**
   * Gets the open section, or null when none is: the section shown, which every showing of the AI
   * Manager starts without unless it was opened at one.
   */
  protected readonly open: Signal<AiManagerSection | null> = this.navigation.section;

  /**
   * Gets the sections to list, with their counts; while searching, a library section with no matches
   * is left out unless it is the one open.
   */
  protected readonly sections: Signal<readonly SidebarSection[]> = computed(
    (): readonly SidebarSection[] => {
      const query: string = this.state.query().trim().toLowerCase();
      const matches: (name: string) => boolean = (name: string): boolean =>
        query.length === 0 || name.toLowerCase().includes(query);
      const profiles: number = this.profiles
        .profiles()
        .filter((profile: PromptProfile): boolean => matches(profile.name)).length;
      const skills: number = this.skills
        .skills()
        .filter((skill: Skill): boolean => matches(skill.name)).length;
      const all: readonly SidebarSection[] = [
        { id: 'models', label: 'Local Models', icon: Icon.AI_MODELS, count: null },
        { id: 'profiles', label: 'Prompt Profiles', icon: Icon.AI_PROFILES, count: profiles },
        { id: 'skills', label: 'Skills', icon: Icon.AI_SKILLS, count: skills },
      ];
      return all.filter(
        (section: SidebarSection): boolean =>
          query.length === 0 || section.count !== 0 || section.id === this.open(),
      );
    },
  );

  /**
   * Gets the list of the open section, when it has registered one.
   */
  protected readonly list: Signal<AiManagerSidebarList | null> = computed(
    (): AiManagerSidebarList | null => {
      const registered: { section: AiManagerSection; list: AiManagerSidebarList } | null =
        this.state.list();
      return registered !== null && registered.section === this.open() ? registered.list : null;
    },
  );

  /**
   * Opens or closes a section: opening one shows it (and closes the others); closing the open one
   * leaves the overview.
   * @param section The section.
   * @param expanded Whether it was opened.
   */
  protected setExpanded(section: AiManagerSection, expanded: boolean): void {
    if (expanded) {
      this.navigation.show(section);
    } else if (this.open() === section) {
      this.navigation.collapse();
    }
  }
}
