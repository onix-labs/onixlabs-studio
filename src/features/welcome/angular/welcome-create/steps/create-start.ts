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
import { OverlayScrollbar } from '@shared/angular/components/overlay-scrollbar/overlay-scrollbar';
import { Icon } from '@shared/angular/icons/icon';
import { ProjectDraft } from '../project-draft';
import { matchesTemplate, PROJECT_TEMPLATES, ProjectTemplate } from '../project-templates';

/**
 * The New Project wizard's Start step (#806): what is being built — a template, found by search, or
 * the user's own words when none fits. Choosing one clears the other.
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
   * Holds the template search.
   */
  protected readonly query: WritableSignal<string> = signal<string>('');

  /**
   * Gets the templates matching the search.
   */
  protected readonly templates: Signal<readonly ProjectTemplate[]> = computed(
    (): readonly ProjectTemplate[] => {
      const needle: string = this.query().trim().toLowerCase();
      return PROJECT_TEMPLATES.filter((template: ProjectTemplate): boolean =>
        matchesTemplate(template, needle),
      );
    },
  );

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
