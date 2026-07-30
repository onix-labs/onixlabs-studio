import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  Signal,
  signal,
  WritableSignal,
} from '@angular/core';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { ListRow, ListView } from '@shared/angular/components/list-view/list-view';
import { Modal } from '@shared/angular/components/modal/modal';
import { ModalContent } from '@shared/angular/components/modal/modal-content';
import { Button } from '@shared/angular/components/forms/button/button';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { Icon } from '@shared/angular/icons/icon';
import {
  WorktreeCheckoutInfo,
  WorktreeCheckoutStatus,
  WorktreeOutcome,
} from '@shared/api/worktree';
import { WorktreeSession } from '@features/workspace/angular/worktree/worktree-session';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';

/**
 * The Worktrees panel: the container tab's overview and switcher. One row per checkout — labelled by
 * alias or branch, never by its GUID directory — with its live status (clean or changed, ahead and
 * behind), plus the inert Orchestrator row reserved for the coordinating agent of a later phase.
 * Clicking a row scopes the ENTIRE view to that checkout (a purely visual switch — the hidden
 * sub-views stay alive); the footer adds a checkout (a new full clone) and each row can be removed
 * explicitly, its directory going to the OS trash after confirmation.
 */
@Component({
  selector: 'app-worktrees-panel',
  imports: [TextField, Button, AppIcon, Dropdown, ListView, Modal, ModalContent],
  templateUrl: './worktrees-panel.html',
  styleUrl: './worktrees-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorktreesPanel {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the dock panel descriptor this body renders. Set by the dock outlet, which binds it on every
   * projected panel component; unused here because the dock chrome renders the title.
   */
  public readonly panel: InputSignal<DockPanel> = input.required<DockPanel>();

  /**
   * Gets the synthetic row id of the inert Orchestrator entry.
   */
  protected readonly ORCHESTRATOR_ID: string = 'orchestrator';

  /**
   * Gets the picker value that means "create a new branch" (a free-text name follows).
   */
  protected readonly NEW_BRANCH: string = '__new__';

  /**
   * Holds the tab's worktree session: the container state this panel presents and mutates.
   */
  protected readonly session: WorktreeSession = inject(WorktreeSession);

  /**
   * Gets the registered checkouts in registration order.
   */
  protected readonly checkouts: Signal<readonly WorktreeCheckoutInfo[]> = computed(
    (): readonly WorktreeCheckoutInfo[] => this.session.descriptor()?.checkouts ?? [],
  );

  /**
   * Gets the active checkout id, or null before the container loads.
   */
  protected readonly activeId: Signal<string | null> = this.session.activeId;

  /**
   * Gets the list rows: the inert Orchestrator entry, then one row per checkout. The shared list
   * view owns the row chrome (hover, selection accent, keyboard activation).
   */
  protected readonly listRows: Signal<readonly ListRow[]> = computed((): readonly ListRow[] => [
    { id: this.ORCHESTRATOR_ID, data: null },
    ...this.checkouts().map(
      (checkout: WorktreeCheckoutInfo): ListRow => ({ id: checkout.id, data: checkout }),
    ),
  ]);

  /**
   * Gets whether a container mutation (a clone or a removal) is in flight.
   */
  protected readonly busy: Signal<boolean> = computed((): boolean => this.session.busy() !== null);

  /**
   * Gets whether removal is allowed: the last remaining checkout cannot be removed, so a container
   * never becomes empty from the panel.
   */
  protected readonly canRemove: Signal<boolean> = computed(
    (): boolean => this.checkouts().length > 1,
  );

  /**
   * Holds whether the add-checkout prompt is open.
   */
  protected readonly addOpen: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the add prompt's branch field.
   */
  protected readonly addBranch: WritableSignal<string> = signal<string>('');

  /**
   * Holds the add prompt's alias field.
   */
  protected readonly addAlias: WritableSignal<string> = signal<string>('');

  /**
   * Holds the branch picker's options: the repository's known branches minus the ones other
   * checkouts hold, plus the new-branch entry.
   */
  protected readonly branchOptions: WritableSignal<readonly DropdownOption[]> = signal<
    readonly DropdownOption[]
  >([]);

  /**
   * Holds the branch picker's selection: a branch name, or {@link NEW_BRANCH}.
   */
  protected readonly branchPick: WritableSignal<string> = signal<string>('__new__');

  /**
   * Gets whether the Create action is allowed: an existing branch is picked, or the new-branch
   * name is non-empty.
   */
  protected readonly canCreate: Signal<boolean> = computed(
    (): boolean => this.branchPick() !== this.NEW_BRANCH || this.addBranch().trim().length > 0,
  );

  /**
   * Holds the error of the last failed mutation, shown inline until the next attempt.
   */
  protected readonly lastError: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds the checkout id awaiting removal confirmation, or null when the confirm is closed.
   */
  protected readonly removeTarget: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Gets the removal target's display label, for the confirm prompt.
   */
  protected readonly removeLabel: Signal<string> = computed((): string => {
    const id: string | null = this.removeTarget();
    return id === null ? '' : this.session.labelFor(id);
  });

  /**
   * Resolves a checkout's display label (alias, else branch).
   * @param id The checkout id.
   * @returns Returns the label.
   */
  protected labelOf(id: string): string {
    return this.session.labelFor(id);
  }

  /**
   * Resolves a checkout's branch subtitle: the live branch when an alias hides it, else empty (the
   * label already shows the branch).
   * @param id The checkout id.
   * @returns Returns the subtitle, or an empty string.
   */
  protected branchOf(id: string): string {
    const checkout: WorktreeCheckoutInfo | undefined = this.checkouts().find(
      (entry: WorktreeCheckoutInfo): boolean => entry.id === id,
    );
    if (checkout?.alias === undefined) {
      return '';
    }
    return this.session.statuses().get(id)?.branch ?? checkout.branch ?? '';
  }

  /**
   * Resolves a checkout's agent state for the activity glyph: running, idle, or null when the
   * checkout has not been materialised yet (no sub-view, so no agent).
   * @param id The checkout id.
   * @returns Returns the agent state, or null.
   */
  protected agentStateOf(id: string): 'running' | 'idle' | null {
    const running: Signal<boolean> | undefined = this.session.agentActivity().get(id);
    if (running === undefined) {
      return null;
    }
    return running() ? 'running' : 'idle';
  }

  /**
   * Determines whether a checkout shares its branch with another checkout — the Studio-level
   * collision warning (full clones mean git itself no longer refuses the same branch twice).
   * @param id The checkout id.
   * @returns Returns true when another checkout is on the same branch.
   */
  protected isDuplicateBranch(id: string): boolean {
    const branch: string | null = this.session.statuses().get(id)?.branch ?? null;
    return branch !== null && this.session.duplicateBranches().has(branch);
  }

  /**
   * Resolves a checkout's status text: clean or the changed-entry count, plus ahead/behind when
   * either is non-zero.
   * @param id The checkout id.
   * @returns Returns the status text, or an empty string while unknown.
   */
  protected statusOf(id: string): string {
    const status: WorktreeCheckoutStatus | undefined = this.session.statuses().get(id);
    if (status === undefined) {
      return '';
    }
    const parts: string[] = [];
    if (status.changes !== null) {
      parts.push(status.changes === 0 ? 'Clean' : `${status.changes} changed`);
    }
    if ((status.ahead ?? 0) > 0 || (status.behind ?? 0) > 0) {
      parts.push(`↑${status.ahead ?? 0} ↓${status.behind ?? 0}`);
    }
    return parts.join(' · ');
  }

  /**
   * Activates the clicked row's checkout; the Orchestrator entry is inert until its phase lands.
   * @param row The clicked list row.
   */
  protected onRowClick(row: ListRow): void {
    if (row.id !== this.ORCHESTRATOR_ID) {
      this.session.activate(row.id);
    }
  }

  /**
   * Opens the add-checkout prompt, loading the branch picker's options: the repository's known
   * branches minus the ones other checkouts hold, plus the new-branch entry.
   */
  protected onAdd(): void {
    this.lastError.set(null);
    this.addBranch.set('');
    this.addAlias.set('');
    this.branchOptions.set([{ value: this.NEW_BRANCH, label: 'New branch…' }]);
    this.branchPick.set(this.NEW_BRANCH);
    this.addOpen.set(true);
    void this.session.loadBranches().then((branches: readonly string[]): void => {
      const taken: ReadonlySet<string> = this.session.takenBranches();
      const available: readonly DropdownOption[] = branches
        .filter((branch: string): boolean => !taken.has(branch))
        .map((branch: string): DropdownOption => ({ value: branch, label: branch }));
      this.branchOptions.set([...available, { value: this.NEW_BRANCH, label: 'New branch…' }]);
      if (available.length > 0) {
        this.branchPick.set(available[0].value);
      }
    });
  }

  /**
   * Reads the branch picker's selection.
   * @param value The picked value.
   */
  protected onBranchPick(value: string): void {
    this.branchPick.set(value);
  }

  /**
   * Reads the branch field.
   * @param event The input event.
   */
  protected onBranchInput(event: Event): void {
    this.addBranch.set((event.target as HTMLInputElement).value);
  }

  /**
   * Reads the alias field.
   * @param event The input event.
   */
  protected onAliasInput(event: Event): void {
    this.addAlias.set((event.target as HTMLInputElement).value);
  }

  /**
   * Confirms the add prompt: clones a new checkout (switched to the branch when one was given) and
   * scopes the view to it on success.
   * @returns Returns a promise that resolves once the clone settles.
   */
  protected async confirmAdd(): Promise<void> {
    if (!this.canCreate()) {
      return;
    }
    const pick: string = this.branchPick();
    const branch: string = pick === this.NEW_BRANCH ? this.addBranch().trim() : pick;
    const alias: string = this.addAlias().trim();
    this.addOpen.set(false);
    const outcome: WorktreeOutcome<WorktreeCheckoutInfo> = await this.session.add({
      branch: branch.length > 0 ? branch : undefined,
      alias: alias.length > 0 ? alias : undefined,
    });
    if (outcome.ok) {
      this.session.activate(outcome.value.id);
    } else {
      this.lastError.set(outcome.error);
    }
  }

  /**
   * Cancels the add prompt.
   */
  protected cancelAdd(): void {
    this.addOpen.set(false);
  }

  /**
   * Opens the removal confirm for a checkout.
   * @param id The checkout id.
   * @param event The click event, stopped so the row does not also activate.
   */
  protected onRemove(id: string, event: Event): void {
    event.stopPropagation();
    this.lastError.set(null);
    this.removeTarget.set(id);
  }

  /**
   * Confirms the removal: the checkout's directory goes to the OS trash and the registry updates.
   * @returns Returns a promise that resolves once the removal settles.
   */
  protected async confirmRemove(): Promise<void> {
    const id: string | null = this.removeTarget();
    this.removeTarget.set(null);
    if (id === null) {
      return;
    }
    const outcome: WorktreeOutcome<null> = await this.session.remove(id);
    if (!outcome.ok) {
      this.lastError.set(outcome.error);
    }
  }

  /**
   * Cancels the removal confirm.
   */
  protected cancelRemove(): void {
    this.removeTarget.set(null);
  }

  /**
   * Re-reads the container's descriptor and statuses.
   */
  protected onRefresh(): void {
    void this.session.refresh();
  }
}
