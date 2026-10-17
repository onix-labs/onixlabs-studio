import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  Signal,
  signal,
  untracked,
  WritableSignal,
} from '@angular/core';
import { Button } from '@shared/angular/components/forms/button/button';
import { ButtonRow } from '@shared/angular/components/forms/button-row/button-row';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { Modal } from '@shared/angular/components/modal/modal';
import { ModalContent } from '@shared/angular/components/modal/modal-content';
import { Log } from '@shared/angular/services/log/log';
import { Notifications } from '@shared/angular/services/notifications/notifications';
import type { WorktreeCheckoutInfo, WorktreeOutcome } from '@shared/api/worktree';
import { WorktreeRepository } from '../worktree-repository';
import { WorktreeSession } from '../worktree-session';

/**
 * The picker value meaning "create a new branch" (a free-text name follows).
 */
const NEW_BRANCH: string = '__new__';

/**
 * The worktree dialogs the Repository panel asks for through {@link WorktreeRepository}: New
 * Worktree, the removal confirmation, and the Convert to Worktrees confirmation. The panel is shared
 * and knows nothing of worktrees' dialogs; it asks, and this — rendered by the directory view — answers.
 */
@Component({
  selector: 'app-worktree-dialogs',
  imports: [Button, ButtonRow, Dropdown, Modal, ModalContent, TextField],
  templateUrl: './worktree-dialogs.html',
  styleUrl: './worktree-dialogs.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorktreeDialogs {
  /**
   * Gets the picker value meaning "create a new branch", exposed for the template.
   */
  protected readonly NEW_BRANCH: string = NEW_BRANCH;

  /**
   * Holds the view's worktrees and the requests the panel has made.
   */
  protected readonly worktrees: WorktreeRepository = inject(WorktreeRepository);

  /**
   * Holds the tab's worktree session, which creates and removes the checkouts.
   */
  private readonly session: WorktreeSession = inject(WorktreeSession);

  /**
   * Holds the notifications a failed creation or removal is reported through.
   */
  private readonly notifications: Notifications = inject(Notifications);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the new branch's name, when a new branch is picked.
   */
  protected readonly addBranch: WritableSignal<string> = signal<string>('');

  /**
   * Holds the optional alias.
   */
  protected readonly addAlias: WritableSignal<string> = signal<string>('');

  /**
   * Holds the branch picker's options: the repository's known branches minus the ones other
   * worktrees hold, then the new-branch entry.
   */
  protected readonly branchOptions: WritableSignal<readonly DropdownOption[]> = signal<
    readonly DropdownOption[]
  >([]);

  /**
   * Holds whether the branch list has been read, so the picker (or its absence) is not drawn on a
   * guess while it loads.
   */
  protected readonly branchesLoaded: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets whether any existing branch is free to take: the picker is only worth showing when it
   * offers a choice beyond a new branch.
   */
  protected readonly hasFreeBranches: Signal<boolean> = computed(
    (): boolean => this.branchOptions().length > 1,
  );

  /**
   * Holds the branch picker's selection: a branch name, or {@link NEW_BRANCH}.
   */
  protected readonly branchPick: WritableSignal<string> = signal<string>(NEW_BRANCH);

  /**
   * Gets whether Create is allowed: an existing branch is picked, or the new branch has a name.
   */
  protected readonly canCreate: Signal<boolean> = computed(
    (): boolean => this.branchPick() !== NEW_BRANCH || this.addBranch().trim().length > 0,
  );

  /**
   * Gets the removal target's label, for the confirmation's title.
   */
  protected readonly removeLabel: Signal<string> = computed((): string => {
    const id: string | null = this.worktrees.removeTarget();
    return id === null ? '' : this.session.labelFor(id);
  });

  /**
   * Initializes a new instance of the {@link WorktreeDialogs} class, resetting the New Worktree
   * dialog and loading its branches each time it is asked for.
   */
  public constructor() {
    effect((): void => {
      if (this.worktrees.addOpen()) {
        untracked((): void => this.prepareAdd());
      }
    });
  }

  /**
   * Resets the New Worktree dialog and loads its branch picker.
   */
  private prepareAdd(): void {
    this.log.debug('workspace.worktrees', 'Open add-checkout prompt');
    this.addBranch.set('');
    this.addAlias.set('');
    this.branchOptions.set([{ value: NEW_BRANCH, label: 'New branch…' }]);
    this.branchPick.set(NEW_BRANCH);
    this.branchesLoaded.set(false);
    void this.session.loadBranches().then((branches: readonly string[]): void => {
      this.branchesLoaded.set(true);
      const taken: ReadonlySet<string> = this.session.takenBranches();
      const available: readonly DropdownOption[] = branches
        .filter((branch: string): boolean => !taken.has(branch))
        .map((branch: string): DropdownOption => ({ value: branch, label: branch }));
      this.branchOptions.set([...available, { value: NEW_BRANCH, label: 'New branch…' }]);
      if (available.length > 0) {
        this.branchPick.set(available[0].value);
      }
    });
  }

  /**
   * Creates the worktree — a new full clone on the chosen branch — and switches to it.
   * @returns Returns a promise that resolves once the clone settles.
   */
  protected async confirmAdd(): Promise<void> {
    if (!this.canCreate()) {
      return;
    }
    const pick: string = this.branchPick();
    const branch: string = pick === NEW_BRANCH ? this.addBranch().trim() : pick;
    const alias: string = this.addAlias().trim();
    this.worktrees.addOpen.set(false);
    this.log.info('workspace.worktrees', `Add checkout on branch ${branch || '(default)'}`, alias);
    const outcome: WorktreeOutcome<WorktreeCheckoutInfo> = await this.session.add({
      branch: branch.length > 0 ? branch : undefined,
      alias: alias.length > 0 ? alias : undefined,
    });
    if (outcome.ok) {
      this.session.activate(outcome.value.id);
      return;
    }
    this.log.error('workspace.worktrees', 'Add checkout failed', outcome.error);
    this.notifications.notify({
      severity: 'error',
      title: 'Could not create the worktree',
      detail: outcome.error,
    });
  }

  /**
   * Closes the New Worktree dialog.
   */
  protected cancelAdd(): void {
    this.worktrees.addOpen.set(false);
  }

  /**
   * Removes the worktree, once confirmed: its directory goes to the Trash.
   * @returns Returns a promise that resolves once the removal settles.
   */
  protected async confirmRemove(): Promise<void> {
    const id: string | null = this.worktrees.removeTarget();
    this.worktrees.removeTarget.set(null);
    if (id === null) {
      return;
    }
    const label: string = this.session.labelFor(id);
    this.log.info('workspace.worktrees', 'Remove checkout', label);
    const outcome: WorktreeOutcome<null> = await this.session.remove(id);
    if (!outcome.ok) {
      this.log.error('workspace.worktrees', 'Remove checkout failed', outcome.error);
      this.notifications.notify({
        severity: 'error',
        title: `Could not remove “${label}”`,
        detail: outcome.error,
      });
    }
  }

  /**
   * Closes the removal confirmation.
   */
  protected cancelRemove(): void {
    this.worktrees.removeTarget.set(null);
  }

  /**
   * Closes the Convert to Worktrees confirmation.
   */
  protected cancelConvert(): void {
    this.worktrees.convertOpen.set(false);
  }
}
