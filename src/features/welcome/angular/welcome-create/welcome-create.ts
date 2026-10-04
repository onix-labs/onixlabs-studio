import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { Log } from '@shared/angular/services/log/log';
import { Studio } from '@shared/angular/services/studio/studio';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { TooltipTrigger } from '@shared/angular/components/tooltip/tooltip-trigger';

/**
 * Describes one stage of the project wizard, shown on its rail.
 */
interface WizardStage {
  /**
   * Gets the stage's name.
   */
  readonly title: string;

  /**
   * Gets a line saying what happens in it.
   */
  readonly hint: string;
}

/**
 * Describes an example project: a starting description the user can take and edit.
 */
interface ExampleProject {
  /**
   * Gets the example's name.
   */
  readonly title: string;

  /**
   * Gets a line describing it.
   */
  readonly summary: string;

  /**
   * Gets its icon.
   */
  readonly icon: Icon;

  /**
   * Gets the description it puts in the box: what a user might have typed for it.
   */
  readonly description: string;
}

/**
 * The welcome screen's Create Something section: "I want AI to help me design and build something".
 * A guided flow — describe, plan, configure, generate, open — rather than an empty New Project.
 *
 * ⚠️ Only the first stage is built: a description can be written, or started from an example, but
 * nothing generates a plan yet, and the screen says so rather than appearing to try. The rail shows
 * the whole flow so the shape of the feature is visible while it is designed.
 */
@Component({
  selector: 'app-welcome-create',
  imports: [AppIcon, TooltipTrigger],
  templateUrl: './welcome-create.html',
  styleUrl: './welcome-create.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WelcomeCreate {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Gets the Generate Plan shortcut as the platform writes it.
   */
  protected readonly shortcut: string = inject(Studio).platform === 'darwin' ? '⌘↵' : 'Ctrl+↵';

  /**
   * Gets the wizard's stages, in order.
   */
  protected readonly stages: readonly WizardStage[] = [
    { title: 'Describe', hint: 'Tell us what you want to build' },
    { title: 'Plan', hint: 'Review and refine the design' },
    { title: 'Configure', hint: 'Choose technologies and options' },
    { title: 'Generate', hint: 'Create the project structure' },
    { title: 'Open', hint: 'Start working in your new project' },
  ];

  /**
   * Gets the example projects.
   */
  protected readonly examples: readonly ExampleProject[] = [
    {
      title: 'AI Agent Service',
      summary: 'An AI-powered service with plugin support and MCP tools.',
      icon: Icon.WELCOME_EXAMPLE_AGENT,
      description:
        'Build an AI agent service that answers questions about our documentation, exposes its tools over MCP, and can be extended with plugins.',
    },
    {
      title: 'Data Platform',
      summary: 'Relational and graph data services behind an API.',
      icon: Icon.WELCOME_EXAMPLE_DATA,
      description:
        'Create a data service with a REST API over a relational database and a graph database, with authentication and an admin dashboard.',
    },
    {
      title: 'Workflow Automation',
      summary: 'Distributed workflows across services and agents.',
      icon: Icon.WELCOME_EXAMPLE_WORKFLOW,
      description:
        'Build a workflow automation platform that runs multi-step jobs across services and AI agents, with retries and a live status view.',
    },
    {
      title: 'Web Application',
      summary: 'A modern web app with AI built in.',
      icon: Icon.WELCOME_EXAMPLE_WEB,
      description:
        'Make a web application where users upload documents and ask questions about them, with accounts, search and an AI assistant.',
    },
    {
      title: 'Service Mesh Node',
      summary: 'A microservice with discovery and telemetry.',
      icon: Icon.WELCOME_EXAMPLE_SERVICE,
      description:
        'Create a microservice that registers itself for service discovery, exposes health and metrics, and traces its requests.',
    },
    {
      title: 'From a Template',
      summary: 'Start from a project template and adapt it.',
      icon: Icon.WELCOME_EXAMPLE_TEMPLATE,
      description: '',
    },
  ];

  /**
   * Holds the stage the wizard is on, counting from 0.
   */
  protected readonly stage: WritableSignal<number> = signal<number>(0);

  /**
   * Holds the user's description of what they want to build.
   */
  protected readonly description: WritableSignal<string> = signal<string>('');

  /**
   * Holds a value indicating whether the user asked for a plan, so the screen can say plainly that
   * generation is not built yet.
   */
  protected readonly requested: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets a value indicating whether there is a description to plan from.
   */
  protected readonly canGenerate: Signal<boolean> = computed(
    (): boolean => this.description().trim().length > 0,
  );

  /**
   * Updates the description from the input event.
   * @param event The input event carrying the current value.
   */
  protected onInput(event: Event): void {
    this.description.set((event.target as HTMLTextAreaElement).value);
    this.requested.set(false);
  }

  /**
   * Starts the description from an example, for the user to adapt.
   * @param example The example.
   */
  protected useExample(example: ExampleProject): void {
    if (example.description.length === 0) {
      this.log.info('welcome', 'Project templates are not available yet');
      return;
    }
    this.log.debug('welcome', `Example project "${example.title}" chosen`);
    this.description.set(example.description);
    this.requested.set(false);
  }

  /**
   * Asks for a plan. Nothing generates one yet, so this records the request and the screen says so.
   */
  protected generate(): void {
    if (!this.canGenerate()) {
      return;
    }
    this.log.info('welcome', 'Project plan requested (generation is not built yet)');
    this.requested.set(true);
  }

  /**
   * Handles a key in the description: ⌘↵ on macOS, Ctrl+↵ elsewhere, asks for the plan.
   * @param event The keyboard event.
   */
  protected onKeydown(event: KeyboardEvent): void {
    const modifier: boolean = this.shortcut.startsWith('⌘') ? event.metaKey : event.ctrlKey;
    if (event.key === 'Enter' && modifier) {
      event.preventDefault();
      this.generate();
    }
  }
}
