import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  Signal,
  signal,
  WritableSignal,
} from '@angular/core';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Modal } from '@shared/angular/components/modal/modal';
import { Icon } from '@shared/angular/icons/icon';
import {
  WorktreeCheckoutInfo,
  WorktreeCheckoutStatus,
  WorktreeOutcome,
} from '@shared/api/worktree';
import { WorktreeSession } from '@features/workspace/angular/worktree/worktree-session';

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
  imports: [AppIcon, Modal],
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
   * Scopes the view to a checkout.
   * @param id The checkout id to activate.
   */
  protected onActivate(id: string): void {
    this.session.activate(id);
  }

  /**
   * Opens the add-checkout prompt.
   */
  protected onAdd(): void {
    this.lastError.set(null);
    this.addBranch.set('');
    this.addAlias.set('');
    this.addOpen.set(true);
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
    const branch: string = this.addBranch().trim();
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
