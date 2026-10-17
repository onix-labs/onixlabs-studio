import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ProjectDraft } from '../project-draft';

/**
 * The New Project wizard's Summary step (#806): the first message exactly as the agent will receive
 * it, and where it goes — so sending it holds no surprises.
 */
@Component({
  selector: 'app-create-summary',
  templateUrl: './create-summary.html',
  styleUrl: './create-steps.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreateSummary {
  /**
   * Holds the draft.
   */
  protected readonly draft: ProjectDraft = inject(ProjectDraft);
}
