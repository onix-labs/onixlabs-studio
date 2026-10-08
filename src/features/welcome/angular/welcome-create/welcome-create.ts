import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  output,
  OutputEmitterRef,
  Signal,
} from '@angular/core';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Icon } from '@shared/angular/icons/icon';
import { CREATE_STEPS, CreateStep, ProjectDraft } from './project-draft';
import { CreateDetails } from './steps/create-details';
import { CreateOptions } from './steps/create-options';
import { CreateSkills } from './steps/create-skills';
import { CreateStart } from './steps/create-start';
import { CreateSummary } from './steps/create-summary';
import { CreateTechnology } from './technology/create-technology';

/**
 * Describes one step of the wizard as the checklist shows it.
 */
interface CreateStepInfo {
  /**
   * Gets the step.
   */
  readonly id: CreateStep;

  /**
   * Gets its name.
   */
  readonly title: string;

  /**
   * Gets the heading of the step's own page, when it says more than its name.
   */
  readonly heading?: string;

  /**
   * Gets what it asks, under its heading on the step's own page, when its heading does not say it.
   */
  readonly description?: string;
}

/**
 * How a step stands in the checklist: the one shown, filled in, passed without filling in, or not
 * reached yet.
 */
export type CreateStepState = 'current' | 'done' | 'skipped' | 'todo';

/**
 * The welcome screen's Create Something section (#806): a wizard that gathers what the user knows
 * about a new project — what it is, its details, its technology, how it is run — and sends it all to
 * an agent as one first message. No agent takes part until then.
 *
 * Every step is optional: its button says Skip until something is filled in, then Next, and the
 * checklist jumps anywhere. The last step shows the message as it will be sent, and Start sends it — to
 * a workspace Studio makes first when there is a name and a place, or to an agent in its own tab, as the
 * line above the buttons says.
 */
@Component({
  selector: 'app-welcome-create',
  imports: [
    AppIcon,
    CreateStart,
    CreateDetails,
    CreateTechnology,
    CreateOptions,
    CreateSkills,
    CreateSummary,
  ],
  templateUrl: './welcome-create.html',
  styleUrl: './welcome-create.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WelcomeCreate implements OnInit {
  /**
   * Emits once the draft has gone to an agent, so the welcome screen steps aside.
   */
  public readonly opened: OutputEmitterRef<void> = output<void>();

  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the draft, which outlives this view.
   */
  protected readonly draft: ProjectDraft = inject(ProjectDraft);

  /**
   * Gets the steps, in order.
   */
  protected readonly steps: readonly CreateStepInfo[] = [
    {
      id: 'start',
      title: 'Start',
      heading: 'What do you want to build',
    },
    {
      id: 'details',
      title: 'Project Details',
      description:
        'Whatever you already know. With a name and a place, the project is made before the agent starts.',
    },
    {
      id: 'technology',
      title: 'Technology',
      description:
        'Pick what you want to use. Leave it to the agent for anything you are unsure of.',
    },
    {
      id: 'options',
      title: 'Options',
      description: 'How the project is run.',
    },
    {
      id: 'skills',
      title: 'Skills',
      description:
        'Standards, conventions and know-how from your skill library, for the agent to follow.',
    },
    {
      id: 'summary',
      title: 'Summary',
      description: 'This is what the agent receives.',
    },
  ];

  /**
   * Gets the step shown.
   */
  protected readonly current: Signal<CreateStepInfo> = computed(
    (): CreateStepInfo =>
      this.steps.find((step: CreateStepInfo): boolean => step.id === this.draft.step()) ??
      this.steps[0],
  );

  /**
   * Gets whether the step shown is the first.
   */
  protected readonly first: Signal<boolean> = computed(
    (): boolean => this.draft.step() === CREATE_STEPS[0],
  );

  /**
   * Gets whether the step shown is the last, which sends.
   */
  protected readonly last: Signal<boolean> = computed(
    (): boolean => this.draft.step() === CREATE_STEPS[CREATE_STEPS.length - 1],
  );

  /**
   * Gets the main button's words: Skip or Next by whether the step has anything in it, and Start on
   * the last step.
   */
  protected readonly primaryLabel: Signal<string> = computed((): string => {
    if (this.last()) {
      return 'Start';
    }
    return this.draft.touched(this.draft.step()) ? 'Next' : 'Skip';
  });

  /**
   * Gets the line above the buttons on the last step, saying where Start sends the project, or null
   * on the other steps.
   */
  protected readonly destination: Signal<string | null> = computed((): string | null => {
    if (!this.last()) {
      return null;
    }
    return this.draft.toWorkspace()
      ? 'Start makes the project and opens its workspace, with the agent.'
      : 'Start opens the agent in a tab of its own.';
  });

  /**
   * Starts reading what the machine can do, once.
   */
  public ngOnInit(): void {
    this.draft.initialise();
  }

  /**
   * Says how a step stands in the checklist.
   * @param step The step.
   * @returns Returns its state.
   */
  protected stateOf(step: CreateStep): CreateStepState {
    if (step === this.draft.step()) {
      return 'current';
    }
    if (step !== 'summary' && this.draft.touched(step)) {
      return 'done';
    }
    return this.draft.visited().has(step) ? 'skipped' : 'todo';
  }

  /**
   * Gets the checklist's icon for a step.
   * @param step The step.
   * @returns Returns the icon.
   */
  protected iconOf(step: CreateStep): Icon {
    switch (this.stateOf(step)) {
      case 'done':
        return Icon.WELCOME_STEP_DONE;
      case 'skipped':
        return Icon.WELCOME_STEP_SKIPPED;
      default:
        return Icon.WELCOME_STEP_TODO;
    }
  }

  /**
   * Moves on a step, or on the last step sends the draft and steps aside once it has gone.
   * @returns Resolves once the step has moved or the draft has been sent.
   */
  protected async primary(): Promise<void> {
    if (!this.last()) {
      this.draft.move(1);
      return;
    }
    if (await this.draft.send()) {
      this.opened.emit();
    }
  }
}
