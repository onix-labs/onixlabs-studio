import { ChangeDetectionStrategy, Component, inject, signal, WritableSignal } from '@angular/core';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { OverlayScrollbar } from '@shared/angular/components/overlay-scrollbar/overlay-scrollbar';
import { Icon } from '@shared/angular/icons/icon';
import { ProjectDraft } from '../project-draft';
import {
  PROJECT_TEMPLATE_GROUPS,
  PROJECT_TEMPLATES,
  ProjectTemplate,
  ProjectTemplateGroup,
  ProjectTemplateGroupId,
} from '../project-templates';

/**
 * The New Project wizard's Start step (#806): what is being built — a template, or the user's own
 * words when none fits. Choosing one clears the other. The templates are grouped in an accordion, one
 * group open at a time; the group holding the chosen template opens first.
 */
@Component({
  selector: 'app-create-start',
  imports: [AppIcon, OverlayScrollbar],
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
   * Gets the template groups, in order.
   */
  protected readonly groups: readonly ProjectTemplateGroup[] = PROJECT_TEMPLATE_GROUPS;

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
   * Gets a group's templates.
   * @param group The group.
   * @returns Returns them, in order.
   */
  protected templatesIn(group: ProjectTemplateGroupId): readonly ProjectTemplate[] {
    return PROJECT_TEMPLATES.filter(
      (template: ProjectTemplate): boolean => template.group === group,
    );
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
   * Records the user's own description from the input event.
   * @param event The input event carrying the current value.
   */
  protected onIdeaInput(event: Event): void {
    this.draft.describe((event.target as HTMLInputElement).value);
  }
}
