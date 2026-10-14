import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  OnInit,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import type { AgentItem } from '@shared/angular/services/agent/agent';
import { Button } from '@shared/angular/components/forms/button/button';
import { ButtonRow } from '@shared/angular/components/forms/button-row/button-row';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { MarkdownRenderer } from '@shared/angular/components/markdown-renderer/markdown-renderer';
import {
  PROJECT_LAYOUT_OPTIONS,
  ProjectDestination,
  ProjectLayout,
  ProjectRepository,
} from '@shared/angular/services/new-project/project-destination';
import { WorkspaceProposals } from '@shared/angular/services/workspace-proposals/workspace-proposals';
import { AgentCard } from '../agent-card/agent-card';

/**
 * Offers the user a workspace for the project an agent tab's agent has planned with them (#876): the
 * name, place and repository, as Create Something asks for them, and the handoff the workspace's agent
 * will start from. Create makes it and carries the conversation across; Not Now leaves the plan here.
 */
@Component({
  selector: 'app-agent-workspace-card',
  imports: [AgentCard, Button, ButtonRow, Dropdown, MarkdownRenderer, TextField],
  templateUrl: './agent-workspace-card.html',
  styleUrl: './agent-workspace-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentWorkspaceCard implements OnInit {
  /**
   * Gets the proposal.
   */
  public readonly item: InputSignal<AgentItem> = input.required<AgentItem>();

  /**
   * Holds the agent tab's proposals service, or null when the card is shown where nothing can be made
   * from it — a conversation reopened outside its agent tab.
   */
  private readonly proposals: WorkspaceProposals | null = inject(WorkspaceProposals, {
    optional: true,
  });

  /**
   * Holds where the project goes and what it starts with, asked the way Create Something asks.
   */
  protected readonly destination: ProjectDestination = new ProjectDestination();

  /**
   * Gets the layout choices.
   */
  protected readonly layoutOptions: readonly DropdownOption[] = PROJECT_LAYOUT_OPTIONS;

  /**
   * Holds whether the handoff is shown.
   */
  protected readonly showHandoff: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds whether the workspace is being made.
   */
  protected readonly creating: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds why the last attempt failed, or null.
   */
  protected readonly error: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Gets whether the card can make the workspace from where it is shown.
   */
  protected readonly canCreate: boolean = this.proposals !== null;

  /**
   * Gets whether Create can be pressed: a name, a place, and nothing missing.
   */
  protected readonly ready: Signal<boolean> = computed(
    (): boolean =>
      this.canCreate &&
      !this.creating() &&
      this.destination.location() !== null &&
      this.destination.problem() === null,
  );

  /**
   * Gets the line saying where the project will be made, or what is still missing.
   */
  protected readonly hint: Signal<string> = computed((): string => {
    if (this.destination.name().trim().length > 0) {
      const problem: string | null = this.destination.problem();
      if (problem !== null) {
        return problem;
      }
    }
    const target: string | null = this.destination.target();
    return target === null
      ? 'Choose a name and where the project goes.'
      : `The project is made at ${target}, and the conversation carries on there.`;
  });

  /**
   * Starts with the name the agent suggested, and reads what the machine can offer.
   */
  public ngOnInit(): void {
    this.destination.name.set(this.item().proposalName ?? '');
    this.destination.initialise();
  }

  /**
   * Records the repository picked.
   * @param value The dropdown's value.
   */
  protected setRepository(value: string): void {
    this.destination.setRepository(value === '' ? null : (value as ProjectRepository));
  }

  /**
   * Records the layout picked.
   * @param value The dropdown's value.
   */
  protected setLayout(value: string): void {
    this.destination.layout.set(value === '' ? null : (value as ProjectLayout));
  }

  /**
   * Records the account picked.
   * @param value The dropdown's value.
   */
  protected setAccount(value: string): void {
    this.destination.account.set(value === '' ? null : value);
  }

  /**
   * Makes the workspace, saying why when it cannot be.
   * @returns Resolves once it is made, or has failed.
   */
  protected async create(): Promise<void> {
    if (this.proposals === null || !this.ready()) {
      return;
    }
    this.error.set(null);
    this.creating.set(true);
    try {
      this.error.set(await this.proposals.create(this.item(), this.destination));
    } finally {
      this.creating.set(false);
    }
  }

  /**
   * Puts the proposal aside.
   */
  protected dismiss(): void {
    this.proposals?.dismiss(this.item());
  }
}
