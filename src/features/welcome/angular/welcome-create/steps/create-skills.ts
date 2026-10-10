import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import type { Skill } from '@shared/api/skill-channels';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Icon } from '@shared/angular/icons/icon';
import { ProjectDraft } from '../project-draft';

/**
 * The New Project wizard's Skills step (#806): the skill library — coding standards, conventions,
 * know-how — searched and chosen for the agent to follow, and a skill imported into it here. A chosen
 * skill's instructions go into the brief every turn of the conversation carries.
 */
@Component({
  selector: 'app-create-skills',
  imports: [AppIcon],
  templateUrl: './create-skills.html',
  styleUrl: './create-steps.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreateSkills {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the draft.
   */
  protected readonly draft: ProjectDraft = inject(ProjectDraft);

  /**
   * Holds the search.
   */
  protected readonly query: WritableSignal<string> = signal<string>('');

  /**
   * Gets the skills matching the search, by name or description, in name order.
   */
  protected readonly skills: Signal<readonly Skill[]> = computed((): readonly Skill[] => {
    const needle: string = this.query().trim().toLowerCase();
    return this.draft
      .availableSkills()
      .filter(
        (skill: Skill): boolean =>
          needle.length === 0 ||
          skill.name.toLowerCase().includes(needle) ||
          skill.description.toLowerCase().includes(needle),
      )
      .slice()
      .sort((a: Skill, b: Skill): number => a.name.localeCompare(b.name));
  });

  /**
   * Updates the search from the input event.
   * @param event The input event carrying the current value.
   */
  protected onQueryInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }
}
