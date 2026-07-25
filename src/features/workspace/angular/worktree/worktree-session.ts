import { computed, inject, Service, Signal, signal, WritableSignal } from '@angular/core';
import {
  WorktreeAddOptions,
  WorktreeCheckoutInfo,
  WorktreeCheckoutStatus,
  WorktreeDescriptor,
  WorktreeOutcome,
  worktreeError,
} from '@shared/api/worktree';
import { Worktrees } from '@shared/angular/services/worktree/worktrees';

/**
 * Holds one directory tab's worktree-container state, provided by the tab's host component so the
 * per-checkout sub-views and the Worktrees panel share it: the container descriptor and per-checkout
 * statuses, the active checkout selection, and the container mutations (add/remove checkout). In an
 * ordinary single-workspace tab the session simply stays uninitialized ({@link isContainer} is
 * false), so consumers need no null-handling — the same panel and view code runs in both modes.
 *
 * The session also tracks which workspace roots the HOST owns (the container root and every checkout
 * root it registered): a sub-view whose root is claimed here must not close it on destroy, because
 * the host's container outlives any one sub-view — most importantly across the in-place promotion
 * transition, where the single workspace view is torn down but its root lives on as the container.
 */
@Service()
export class WorktreeSession {
  /**
   * Holds the worktree bridge client.
   */
  private readonly worktrees: Worktrees = inject(Worktrees);

  /**
   * Holds the container root path, or null while the tab is an ordinary workspace.
   */
  private readonly rootSignal: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds the last-read container descriptor, or null before the first read.
   */
  private readonly descriptorSignal: WritableSignal<WorktreeDescriptor | null> =
    signal<WorktreeDescriptor | null>(null);

  /**
   * Holds the last-read per-checkout statuses, keyed by checkout id.
   */
  private readonly statusSignal: WritableSignal<ReadonlyMap<string, WorktreeCheckoutStatus>> =
    signal<ReadonlyMap<string, WorktreeCheckoutStatus>>(new Map<string, WorktreeCheckoutStatus>());

  /**
   * Holds the id of the checkout the view is scoped to, or null before the container loads.
   */
  private readonly activeIdSignal: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds the operation currently in flight ('add' while a clone runs, 'remove' while a removal
   * runs), or null when idle. The panel disables its mutating controls while set.
   */
  private readonly busySignal: WritableSignal<'add' | 'remove' | null> = signal<
    'add' | 'remove' | null
  >(null);

  /**
   * Holds the workspace roots the host owns (the container root and its opened checkout roots), so
   * sub-views know not to close them on destroy.
   */
  private readonly claimedRoots: Set<string> = new Set<string>();

  /**
   * Gets the container root path, or null while the tab is an ordinary workspace.
   */
  public readonly root: Signal<string | null> = this.rootSignal.asReadonly();

  /**
   * Gets a value indicating whether this tab hosts a worktree container.
   */
  public readonly isContainer: Signal<boolean> = computed(
    (): boolean => this.rootSignal() !== null,
  );

  /**
   * Gets the last-read container descriptor, or null before the first read.
   */
  public readonly descriptor: Signal<WorktreeDescriptor | null> =
    this.descriptorSignal.asReadonly();

  /**
   * Gets the last-read per-checkout statuses, keyed by checkout id.
   */
  public readonly statuses: Signal<ReadonlyMap<string, WorktreeCheckoutStatus>> =
    this.statusSignal.asReadonly();

  /**
   * Gets the id of the checkout the view is scoped to, or null before the container loads.
   */
  public readonly activeId: Signal<string | null> = this.activeIdSignal.asReadonly();

  /**
   * Gets the operation currently in flight, or null when idle.
   */
  public readonly busy: Signal<'add' | 'remove' | null> = this.busySignal.asReadonly();

  /**
   * Gets the active checkout's display label (its alias, else its branch), or null before the
   * container loads.
   */
  public readonly activeLabel: Signal<string | null> = computed((): string | null => {
    const id: string | null = this.activeIdSignal();
    return id === null ? null : this.labelFor(id);
  });

  /**
   * Resolves a checkout's display label: its alias when one is set, else its live branch, else a
   * neutral placeholder. Checkout ids (GUIDs) are never surfaced.
   * @param id The checkout id.
   * @returns Returns the label.
   */
  public labelFor(id: string): string {
    const checkout: WorktreeCheckoutInfo | undefined = this.descriptorSignal()?.checkouts.find(
      (entry: WorktreeCheckoutInfo): boolean => entry.id === id,
    );
    return checkout?.alias ?? this.statusSignal().get(id)?.branch ?? checkout?.branch ?? 'checkout';
  }

  /**
   * Enters container mode: records the container root and descriptor, claims the root as
   * host-owned, and selects the first checkout when none is selected yet.
   * @param root The container root path.
   * @param descriptor The container's descriptor.
   */
  public initialize(root: string, descriptor: WorktreeDescriptor): void {
    this.rootSignal.set(root);
    this.claimedRoots.add(root);
    this.descriptorSignal.set(descriptor);
    if (this.activeIdSignal() === null) {
      this.activeIdSignal.set(descriptor.checkouts[0]?.id ?? null);
    }
    void this.refreshStatus();
  }

  /**
   * Selects the checkout the view scopes to. The host reacts by loading the checkout's sub-view
   * when it has not been shown before.
   * @param id The checkout id to activate.
   */
  public activate(id: string): void {
    this.activeIdSignal.set(id);
  }

  /**
   * Marks a workspace root as host-owned, so the sub-view rooted at it leaves closing to the host.
   * @param root The absolute root path to claim.
   */
  public claimRoot(root: string): void {
    this.claimedRoots.add(root);
  }

  /**
   * Determines whether a workspace root is host-owned.
   * @param root The absolute root path to test.
   * @returns Returns true when the host owns the root's lifecycle.
   */
  public isClaimed(root: string): boolean {
    return this.claimedRoots.has(root);
  }

  /**
   * Gets every claimed root, for the host to close on teardown.
   * @returns Returns the claimed roots.
   */
  public claimed(): readonly string[] {
    return [...this.claimedRoots];
  }

  /**
   * Re-reads the container descriptor and statuses.
   * @returns Returns a promise that resolves once both reads settle.
   */
  public async refresh(): Promise<void> {
    const root: string | null = this.rootSignal();
    if (root === null || this.worktrees.client === undefined) {
      return;
    }
    const descriptor: WorktreeDescriptor | null = await this.worktrees.client.describe(root);
    if (descriptor !== null) {
      this.descriptorSignal.set(descriptor);
    }
    await this.refreshStatus();
  }

  /**
   * Re-reads the per-checkout statuses alone (cheaper than a full refresh).
   * @returns Returns a promise that resolves once the read settles.
   */
  public async refreshStatus(): Promise<void> {
    const root: string | null = this.rootSignal();
    if (root === null || this.worktrees.client === undefined) {
      return;
    }
    const statuses: readonly WorktreeCheckoutStatus[] | null =
      await this.worktrees.client.status(root);
    if (statuses !== null) {
      this.statusSignal.set(
        new Map<string, WorktreeCheckoutStatus>(
          statuses.map((status: WorktreeCheckoutStatus): [string, WorktreeCheckoutStatus] => [
            status.id,
            status,
          ]),
        ),
      );
    }
  }

  /**
   * Adds a checkout — a new full clone — to the container, refreshing the descriptor on success.
   * @param options The branch and alias options.
   * @returns Returns the new checkout's info, or the failure reason.
   */
  public async add(options: WorktreeAddOptions): Promise<WorktreeOutcome<WorktreeCheckoutInfo>> {
    const root: string | null = this.rootSignal();
    if (root === null || this.worktrees.client === undefined) {
      return worktreeError('The tab is not a worktree container.');
    }
    this.busySignal.set('add');
    try {
      const outcome: WorktreeOutcome<WorktreeCheckoutInfo> =
        await this.worktrees.client.addCheckout(root, options);
      if (outcome.ok) {
        await this.refresh();
      }
      return outcome;
    } finally {
      this.busySignal.set(null);
    }
  }

  /**
   * Removes a checkout (its directory goes to the OS trash), refreshing the descriptor on success.
   * @param id The checkout id to remove.
   * @returns Returns a null value on success, or the failure reason.
   */
  public async remove(id: string): Promise<WorktreeOutcome<null>> {
    const root: string | null = this.rootSignal();
    if (root === null || this.worktrees.client === undefined) {
      return worktreeError('The tab is not a worktree container.');
    }
    this.busySignal.set('remove');
    try {
      const outcome: WorktreeOutcome<null> = await this.worktrees.client.removeCheckout(root, id);
      if (outcome.ok) {
        await this.refresh();
      }
      return outcome;
    } finally {
      this.busySignal.set(null);
    }
  }
}
