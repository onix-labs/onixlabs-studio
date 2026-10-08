import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { ProjectDraft } from '../project-draft';
import { PROJECT_OPTIONS, ProjectOption, ProjectOptionChoice } from '../project-templates';

/**
 * Describes one option as the step offers it.
 */
interface OfferedOption {
  /**
   * Gets the option.
   */
  readonly option: ProjectOption;

  /**
   * Gets its dropdown choices, led by leaving it to the conversation.
   */
  readonly choices: readonly DropdownOption[];
}

/**
 * The New Project wizard's Options step (#806): how the project is run — containers, continuous
 * integration, work tracking, licence — and the library's skills the agent should follow. Each is
 * optional; one left unanswered is not mentioned.
 */
@Component({
  selector: 'app-create-options',
  imports: [Dropdown],
  templateUrl: './create-options.html',
  styleUrl: './create-steps.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreateOptions {
  /**
   * Holds the draft.
   */
  protected readonly draft: ProjectDraft = inject(ProjectDraft);

  /**
   * Gets the options, each with its choices.
   */
  protected readonly offered: readonly OfferedOption[] = PROJECT_OPTIONS.map(
    (option: ProjectOption): OfferedOption => ({
      option,
      choices: [
        { value: '', label: 'Not decided' },
        ...option.choices.map((choice: ProjectOptionChoice): DropdownOption => ({
          value: choice.value,
          label: choice.label,
        })),
      ],
    }),
  );
}
