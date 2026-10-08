import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { OverlayScrollbar } from '@shared/angular/components/overlay-scrollbar/overlay-scrollbar';
import { Icon } from '@shared/angular/icons/icon';
import { ProjectDraft } from '../project-draft';
import { PROJECT_TEMPLATES, ProjectTemplate } from '../project-templates';

/**
 * The New Project wizard's Start step (#806): what is being built — a template, or the user's own
 * words when none fits. Choosing one clears the other.
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
   * Gets the templates.
   */
  protected readonly templates: readonly ProjectTemplate[] = PROJECT_TEMPLATES;

  /**
   * Records the user's own description from the input event.
   * @param event The input event carrying the current value.
   */
  protected onIdeaInput(event: Event): void {
    this.draft.describe((event.target as HTMLInputElement).value);
  }
}
