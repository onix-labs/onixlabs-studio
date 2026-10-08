import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Icon } from '@shared/angular/icons/icon';
import { ProjectAccount, ProjectDraft, ProjectLayout, ProjectRepository } from '../project-draft';

/**
 * The New Project wizard's Project Details step (#806): a summary of the project, its name, where it
 * goes, its repository, and supporting documents for the agent to read. A name and a place mean the
 * project is made as a workspace before the agent starts.
 */
@Component({
  selector: 'app-create-details',
  imports: [AppIcon, Dropdown],
  templateUrl: './create-details.html',
  styleUrl: './create-steps.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreateDetails {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the draft.
   */
  protected readonly draft: ProjectDraft = inject(ProjectDraft);

  /**
   * Gets the repository choices the installed plugins can make: none always; a local one with a
   * version-control plugin that can make one; a hosted one — made by the code host, then cloned — with
   * a hosting plugin as well.
   */
  protected readonly repositoryOptions: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] => [
      { value: 'none', label: 'No Repository' },
      ...(this.draft.canVersion() && this.draft.canInit()
        ? [{ value: 'local', label: 'Local Repository' }]
        : []),
      ...(this.draft.canVersion() && this.draft.canHost()
        ? [
            { value: 'public', label: 'Public Repository' },
            { value: 'private', label: 'Private Repository' },
          ]
        : []),
    ],
  );

  /**
   * Gets the account choices.
   */
  protected readonly accountOptions: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] =>
      this.draft.accounts().map((account: ProjectAccount): DropdownOption => ({
        value: account.id,
        label: `${account.login} (${account.provider})`,
      })),
  );

  /**
   * Gets the layout choices, the same as cloning's.
   */
  protected readonly layoutOptions: readonly DropdownOption[] = [
    { value: 'flat', label: 'Flat Repository' },
    { value: 'worktree', label: 'Worktree Repository' },
  ];

  /**
   * Gets the line under the name and place saying where the agent will start.
   */
  protected readonly destination: Signal<string> = computed((): string =>
    this.draft.toWorkspace() && this.draft.target() !== null
      ? `The project is made at ${this.draft.target()}, and the agent starts in it.`
      : 'Without a name, the agent starts in its own tab, and you choose where the project goes later.',
  );

  /**
   * Records the summary from the input event.
   * @param event The input event carrying the current value.
   */
  protected onSummaryInput(event: Event): void {
    this.draft.summary.set((event.target as HTMLTextAreaElement).value);
  }

  /**
   * Records the name from the input event.
   * @param event The input event carrying the current value.
   */
  protected onNameInput(event: Event): void {
    this.draft.name.set((event.target as HTMLInputElement).value);
  }

  /**
   * Records the repository picked.
   * @param value The picked value.
   */
  protected setRepository(value: string): void {
    this.draft.setRepository(isRepository(value) ? value : null);
  }

  /**
   * Records the account picked.
   * @param value The picked value.
   */
  protected setAccount(value: string): void {
    this.draft.account.set(
      this.draft.accounts().some((account: ProjectAccount): boolean => account.id === value)
        ? value
        : null,
    );
  }

  /**
   * Records the layout picked.
   * @param value The picked value.
   */
  protected setLayout(value: string): void {
    this.draft.layout.set(isLayout(value) ? value : null);
  }
}

/**
 * Determines whether a value names a repository choice.
 * @param value The value.
 * @returns Returns true when it does.
 */
function isRepository(value: string): value is ProjectRepository {
  return value === 'none' || value === 'local' || value === 'public' || value === 'private';
}

/**
 * Determines whether a value names a layout.
 * @param value The value.
 * @returns Returns true when it does.
 */
function isLayout(value: string): value is ProjectLayout {
  return value === 'flat' || value === 'worktree';
}
