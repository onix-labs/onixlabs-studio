import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Icon } from '@shared/angular/icons/icon';
import { ProjectDraft } from '../project-draft';
import {
  matchesTemplate,
  PROJECT_TEMPLATE_GROUPS,
  PROJECT_TEMPLATES,
  ProjectTemplate,
  ProjectTemplateGroup,
  ProjectTemplateGroupId,
} from '../project-templates';

/**
 * The New Project wizard's Start step (#806): what is being built — a template, or the user's own
 * words when none fits. Choosing one clears the other. The templates are grouped in an accordion, one
 * group open at a time; the group holding the chosen template opens first. A search shows every group
 * with a match, open, and hides the rest.
 */
@Component({
  selector: 'app-create-start',
  imports: [AppIcon],
  templateUrl: './create-start.html',
  styleUrl: './create-steps.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreateStart {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the draft.
   */
  protected readonly draft: ProjectDraft = inject(ProjectDraft);

  /**
   * Holds the template search.
   */
  protected readonly query: WritableSignal<string> = signal<string>('');

  /**
   * Gets whether a search is narrowing the templates.
   */
  protected readonly searching: Signal<boolean> = computed(
    (): boolean => this.query().trim().length > 0,
  );

  /**
   * Gets the templates matching the search: all of them when there is none.
   */
  private readonly matching: Signal<readonly ProjectTemplate[]> = computed(
    (): readonly ProjectTemplate[] => {
      const needle: string = this.query().trim().toLowerCase();
      return PROJECT_TEMPLATES.filter((template: ProjectTemplate): boolean =>
        matchesTemplate(template, needle),
      );
    },
  );

  /**
   * Gets the groups to show, in order: every group, or while searching only those with a match.
   */
  protected readonly groups: Signal<readonly ProjectTemplateGroup[]> = computed(
    (): readonly ProjectTemplateGroup[] =>
      PROJECT_TEMPLATE_GROUPS.filter(
        (group: ProjectTemplateGroup): boolean => this.templatesIn(group.id).length > 0,
      ),
  );

  /**
   * Holds the group open, or null when all are closed. Starts on the chosen template's group, or the
   * first.
   */
  protected readonly openGroup: WritableSignal<ProjectTemplateGroupId | null> =
    signal<ProjectTemplateGroupId | null>(
      this.draft.template()?.group ?? PROJECT_TEMPLATE_GROUPS[0].id,
    );

  /**
   * Opens a group, closing the one open, or closes it when it is the one open.
   * @param group The group.
   */
  protected toggleGroup(group: ProjectTemplateGroupId): void {
    this.openGroup.update((open: ProjectTemplateGroupId | null): ProjectTemplateGroupId | null =>
      open === group ? null : group,
    );
  }

  /**
   * Gets a group's templates that match the search.
   * @param group The group.
   * @returns Returns them, in order.
   */
  protected templatesIn(group: ProjectTemplateGroupId): readonly ProjectTemplate[] {
    return this.matching().filter((template: ProjectTemplate): boolean => template.group === group);
  }

  /**
   * Gets whether a group shows its templates: the one open, or every one while searching.
   * @param group The group.
   * @returns Returns true when it does.
   */
  protected isOpen(group: ProjectTemplateGroupId): boolean {
    return this.searching() || this.openGroup() === group;
  }

  /**
   * Gets whether the chosen template is in a group, so the group can say so while it is closed.
   * @param group The group.
   * @returns Returns true when it is.
   */
  protected pickedIn(group: ProjectTemplateGroupId): boolean {
    return this.draft.template()?.group === group;
  }

  /**
   * Updates the search from the input event.
   * @param event The input event carrying the current value.
   */
  protected onQueryInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  /**
   * Records the user's own description from the input event.
   * @param event The input event carrying the current value.
   */
  protected onIdeaInput(event: Event): void {
    this.draft.describe((event.target as HTMLTextAreaElement).value);
  }
}
