import { computed, inject, Service, Signal, signal, WritableSignal } from '@angular/core';
import type {
  WorktreeCheckoutInfo,
  WorktreeCheckoutStatus,
  WorktreeOutcome,
} from '@shared/api/worktree';
import { Notifications } from '@shared/angular/services/notifications/notifications';
import type {
  RepositoryWorktree,
  RepositoryWorktrees,
} from '@shared/angular/services/repository-worktrees/repository-worktrees';
import { WorktreeSession } from './worktree-session';

/**
 * What the view this service serves tells it about itself: which checkout it is, and whether — as a
 * flat repository — it can be converted to worktrees.
 */
export interface WorktreeRepositoryView {
  /**
   * Gets the checkout the view is scoped to, or null for a flat repository's view.
   */
  readonly checkoutId: Signal<string | null>;

  /**
   * Gets a value indicating whether the view's flat repository can be converted to worktrees.
   */
  readonly canConvert: Signal<boolean>;

  /**
   * Converts the view's flat repository to worktrees. Unconfirmed: the caller has already asked.
   */
  convert(): void;
}

/**
 * Serves the Repository panel's worktrees for one directory view: the tab's {@link WorktreeSession}
 * read as worktrees, each with its own branches, and the dialogs that create, remove and convert
 * them (rendered by `WorktreeDialogs`, which reads the requests held here).
 *
 * Provided per view, beside the view's own repository, because "the current worktree" is the
 * checkout THIS view shows. Every checkout of a container keeps a view of its own alive, so the
 * tab's active checkout is not the same fact.
 */
@Service()
export class WorktreeRepository implements RepositoryWorktrees {
  /**
   * Holds the tab's worktree session.
   */
  private readonly session: WorktreeSession = inject(WorktreeSession);

  /**
   * Holds the notifications a failed rename is reported through.
   */
  private readonly notifications: Notifications = inject(Notifications);

  /**
   * Holds what the view has told this service about itself, or null until it binds.
   */
  private readonly view: WritableSignal<WorktreeRepositoryView | null> =
    signal<WorktreeRepositoryView | null>(null);

  /**
   * Holds whether the New Worktree dialog is open.
   */
  public readonly addOpen: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the checkout awaiting removal confirmation, or null while that dialog is closed.
   */
  public readonly removeTarget: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds whether the Convert to Worktrees confirmation is open.
   */
  public readonly convertOpen: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets the worktrees, or null for a flat repository.
   */
  public readonly worktrees: Signal<readonly RepositoryWorktree[] | null> = computed(
    (): readonly RepositoryWorktree[] | null => {
      if (!this.session.isContainer()) {
        return null;
      }
      const current: string | null = this.view()?.checkoutId() ?? this.session.activeId() ?? null;
      const statuses: ReadonlyMap<string, WorktreeCheckoutStatus> = this.session.statuses();
      const duplicates: ReadonlySet<string> = this.session.duplicateBranches();
      return (this.session.descriptor()?.checkouts ?? []).map(
        (checkout: WorktreeCheckoutInfo): RepositoryWorktree => {
          const status: WorktreeCheckoutStatus | undefined = statuses.get(checkout.id);
          const branch: string | null = status?.branch ?? checkout.branch;
          return {
            id: checkout.id,
            label: this.session.labelFor(checkout.id),
            path: checkout.path,
            branch,
            changes: status?.changes ?? null,
            branches: status?.branches ?? [],
            current: checkout.id === current,
            duplicateBranch: branch !== null && duplicates.has(branch),
          };
        },
      );
    },
  );

  /**
   * Gets a value indicating whether a worktree is being created or removed.
   */
  public readonly busy: Signal<boolean> = computed((): boolean => this.session.busy() !== null);

  /**
   * Gets a value indicating whether the view's flat repository can be converted to worktrees.
   */
  public readonly canConvert: Signal<boolean> = computed(
    (): boolean => !this.session.isContainer() && (this.view()?.canConvert() ?? false),
  );

  /**
   * Tells the service which view it serves.
   * @param view The view's description of itself.
   */
  public bind(view: WorktreeRepositoryView): void {
    this.view.set(view);
  }

  /**
   * Scopes the tab to a worktree.
   * @param id The checkout id.
   */
  public activate(id: string): void {
    this.session.activate(id);
  }

  /**
   * Opens the New Worktree dialog.
   */
  public requestAdd(): void {
    this.addOpen.set(true);
  }

  /**
   * Renames a worktree, reporting a failure as a notification.
   * @param id The checkout id.
   * @param name The new name.
   */
  public rename(id: string, name: string): void {
    // A refusal comes back as an outcome; a call that never reached the main process (a build whose
    // main predates the channel) comes back as a rejection. Either way the user is told — a rename
    // that silently does nothing is indistinguishable from one that was never asked for.
    void this.session
      .rename(id, name)
      .then(
        (outcome: WorktreeOutcome<null>): string | null => (outcome.ok ? null : outcome.error),
        (error: unknown): string => (error instanceof Error ? error.message : String(error)),
      )
      .then((failure: string | null): void => {
        if (failure !== null) {
          this.notifications.notify({
            severity: 'error',
            title: 'Could not rename the worktree',
            detail: failure,
          });
        }
      });
  }

  /**
   * Opens the removal confirmation for a worktree — never for the last one.
   * @param id The checkout id.
   */
  public requestRemove(id: string): void {
    if ((this.worktrees()?.length ?? 0) > 1) {
      this.removeTarget.set(id);
    }
  }

  /**
   * Opens the Convert to Worktrees confirmation.
   */
  public requestConvert(): void {
    if (this.canConvert()) {
      this.convertOpen.set(true);
    }
  }

  /**
   * Converts the flat repository to worktrees, once the user has confirmed.
   */
  public convert(): void {
    this.convertOpen.set(false);
    this.view()?.convert();
  }

  /**
   * Re-reads every worktree's status and branches.
   */
  public refresh(): void {
    void this.session.refresh();
  }
}
