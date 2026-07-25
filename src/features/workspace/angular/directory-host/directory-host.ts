import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  InputSignal,
  OnDestroy,
  OnInit,
  Signal,
  signal,
  untracked,
  WritableSignal,
} from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import { DirectoryListing, WorkspaceChannel } from '@shared/api/workspace-channels';
import { WorkspaceKind, WorktreeDescriptor, WorktreeOutcome } from '@shared/api/worktree';
import { Workspaces } from '@shared/angular/services/workspaces/workspaces';
import { Worktrees } from '@shared/angular/services/worktree/worktrees';
import { DirectoryView } from '@features/workspace/angular/directory-view/directory-view';
import { WorktreeSession } from '@features/workspace/angular/worktree/worktree-session';

/**
 * A checkout sub-view the host has materialised: the checkout id and the root listing its
 * {@link DirectoryView} was seeded with.
 */
interface LoadedCheckout {
  /**
   * Gets the checkout id.
   */
  readonly id: string;

  /**
   * Gets the checkout's root listing.
   */
  readonly listing: DirectoryListing;
}

/**
 * Hosts one directory tab and decides what it is. An ordinary folder or repository renders a single
 * {@link DirectoryView} exactly as before; a worktree container renders one kept-alive sub-view per
 * visited checkout — the same mount-all/hide-inactive mechanics the app tabs use, one level down —
 * so switching checkouts is purely visual and every checkout keeps its documents, terminals, agent
 * conversation, and debugger state. Checkout sub-views are created lazily on first activation.
 *
 * The host owns the container-level lifecycle: kind resolution on open, the in-place promotion
 * transition (the single view is torn down and rebuilt as the first checkout's container), lazy
 * checkout loading (registering each checkout as a workspace root), and closing every root it
 * claimed when the tab goes away.
 */
@Component({
  selector: 'app-directory-host',
  imports: [DirectoryView],
  templateUrl: './directory-host.html',
  styleUrl: './directory-host.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [WorktreeSession],
})
export class DirectoryHost implements OnInit, OnDestroy {
  /**
   * Gets the owning tab's id.
   */
  public readonly tabId: InputSignal<string> = input.required<string>();

  /**
   * Gets a value indicating whether the host belongs to the active tab.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Holds this tab's worktree session, provided here so the sub-views and the Worktrees panel
   * share it.
   */
  protected readonly session: WorktreeSession = inject(WorktreeSession);

  /**
   * Holds the worktree bridge client.
   */
  private readonly worktrees: Worktrees = inject(Worktrees);

  /**
   * Holds the global registry that hands off the tab's initial folder.
   */
  private readonly workspaces: Workspaces = inject(Workspaces);

  /**
   * Holds the generic transport for the workspace listing/close calls the host makes directly (it
   * owns no {@link import('@shared/angular/services/workspace/workspace').Workspace} instance of
   * its own — those are per-view).
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Holds what the tab currently renders: nothing (while the opened folder's kind resolves), the
   * single workspace view, or the container's checkout sub-views.
   */
  protected readonly phase: WritableSignal<'resolving' | 'single' | 'container'> = signal<
    'resolving' | 'single' | 'container'
  >('resolving');

  /**
   * Holds the single view's root listing, or null for a blank tab (the view shows its
   * open-a-folder prompt).
   */
  protected readonly singleListing: WritableSignal<DirectoryListing | null> =
    signal<DirectoryListing | null>(null);

  /**
   * Holds the materialised checkout sub-views, in first-activation order.
   */
  protected readonly loaded: WritableSignal<readonly LoadedCheckout[]> = signal<
    readonly LoadedCheckout[]
  >([]);

  /**
   * Gets whether the active checkout's sub-view is still materialising (its listing is being read),
   * so the template can show a brief placeholder instead of an empty area.
   */
  protected readonly loadingActive: Signal<boolean> = computed((): boolean => {
    const active: string | null = this.session.activeId();
    return (
      this.phase() === 'container' &&
      active !== null &&
      !this.loaded().some((entry: LoadedCheckout): boolean => entry.id === active)
    );
  });

  /**
   * Holds the single view's announced workspace root, kept for the promotion flow.
   */
  private singleRoot: string | null = null;

  /**
   * Holds the checkout ids currently being materialised, so a re-fired effect never double-loads.
   */
  private readonly loading: Set<string> = new Set<string>();

  /**
   * Holds the stable promote action handed to the single view (and through it to the ribbon).
   */
  protected readonly promoteAction: () => void = (): void => {
    void this.promote();
  };

  /**
   * Initializes a new instance of the {@link DirectoryHost} class, wiring the container effects:
   * lazy sub-view materialisation, active-checkout fallback when the active one is removed,
   * unloading removed checkouts, and status refresh on tab activation.
   */
  public constructor() {
    // Materialise a checkout's sub-view the first time it becomes the active selection.
    effect((): void => {
      const id: string | null = this.session.activeId();
      if (id === null || this.phase() !== 'container') {
        return;
      }
      if (this.loaded().some((entry: LoadedCheckout): boolean => entry.id === id)) {
        return;
      }
      untracked((): void => void this.loadCheckout(id));
    });

    // When the active checkout disappears from the registry (it was removed), fall back to the
    // first remaining one so the tab never points at nothing.
    effect((): void => {
      const descriptor: WorktreeDescriptor | null = this.session.descriptor();
      if (descriptor === null || this.phase() !== 'container') {
        return;
      }
      const active: string | null = this.session.activeId();
      const present: boolean =
        active !== null && descriptor.checkouts.some((checkout): boolean => checkout.id === active);
      if (present) {
        return;
      }
      const first: string | undefined = descriptor.checkouts[0]?.id;
      if (first !== undefined) {
        untracked((): void => this.session.activate(first));
      }
    });

    // Unload sub-views whose checkouts were removed: destroying the sub-view tears its state down,
    // and the host closes the checkout's workspace root (the sub-view's root is host-claimed).
    effect((): void => {
      const descriptor: WorktreeDescriptor | null = this.session.descriptor();
      if (descriptor === null) {
        return;
      }
      const ids: ReadonlySet<string> = new Set<string>(
        descriptor.checkouts.map((checkout): string => checkout.id),
      );
      const stale: readonly LoadedCheckout[] = this.loaded().filter(
        (entry: LoadedCheckout): boolean => !ids.has(entry.id),
      );
      if (stale.length === 0) {
        return;
      }
      untracked((): void => {
        this.loaded.set(
          this.loaded().filter((entry: LoadedCheckout): boolean => ids.has(entry.id)),
        );
        for (const entry of stale) {
          void this.closeRoot(entry.listing.path);
        }
      });
    });

    // Catch up the panel's statuses whenever the container tab is brought back to the front.
    effect((): void => {
      if (this.isActive() && this.session.isContainer()) {
        untracked((): void => void this.session.refreshStatus());
      }
    });
  }

  /**
   * Adopts the tab's stashed initial folder, resolving what it is before any view is created — a
   * container must never flash open as a plain folder.
   */
  public ngOnInit(): void {
    const initial: DirectoryListing | undefined = this.workspaces.takeInitial(this.tabId());
    if (initial === undefined) {
      this.phase.set('single');
      return;
    }
    void this.adopt(initial);
  }

  /**
   * Closes every workspace root the host claimed (the container root and its opened checkouts);
   * sub-views leave those to the host.
   */
  public ngOnDestroy(): void {
    for (const root of this.session.claimed()) {
      void this.closeRoot(root);
    }
  }

  /**
   * Resolves an opened folder's kind and enters the matching mode.
   * @param listing The folder's root listing.
   * @returns Returns a promise that resolves once the mode is entered.
   */
  private async adopt(listing: DirectoryListing): Promise<void> {
    const kind: WorkspaceKind | null = (await this.worktrees.client?.resolve(listing.path)) ?? null;
    if (kind === 'worktree' && (await this.enterContainer(listing.path))) {
      return;
    }
    this.singleListing.set(listing);
    this.phase.set('single');
  }

  /**
   * Enters container mode over an already-registered container root.
   * @param root The container root path.
   * @returns Returns true when the container was described and entered.
   */
  private async enterContainer(root: string): Promise<boolean> {
    const descriptor: WorktreeDescriptor | null =
      (await this.worktrees.client?.describe(root)) ?? null;
    if (descriptor === null) {
      return false;
    }
    this.session.claimRoot(root);
    this.session.initialize(root, descriptor);
    this.phase.set('container');
    return true;
  }

  /**
   * Receives the single view's root announcements: remembered for the promote flow, and checked in
   * case a folder opened in-view turns out to be a worktree container (the welcome path resolves
   * before the view exists; the in-view open-folder dialog cannot).
   * @param root The announced root, or null when the view has no folder.
   */
  protected onSingleRoot(root: string | null): void {
    this.singleRoot = root;
    if (root === null || this.phase() !== 'single') {
      return;
    }
    void this.maybeAdoptContainer(root);
  }

  /**
   * Rebuilds the tab as a container when the single view's folder proves to be one.
   * @param root The single view's root.
   * @returns Returns a promise that resolves once the check (and any transition) settles.
   */
  private async maybeAdoptContainer(root: string): Promise<void> {
    const kind: WorkspaceKind | null = (await this.worktrees.client?.resolve(root)) ?? null;
    if (kind !== 'worktree' || this.phase() !== 'single') {
      return;
    }
    // Claim BEFORE the single view is destroyed, so its teardown releases local state only and the
    // root stays open for the container.
    this.session.claimRoot(root);
    if (await this.enterContainer(root)) {
      this.singleListing.set(null);
    }
  }

  /**
   * Promotes the single view's repository, in place, into a worktree container, then rebuilds the
   * tab around the container: the single view (whose documents point at now-moved paths) is torn
   * down, and the old working copy carries on as the first checkout.
   * @returns Returns a promise that resolves once the promotion settles.
   */
  private async promote(): Promise<void> {
    const root: string | null = this.singleRoot;
    if (root === null || this.phase() !== 'single' || this.worktrees.client === undefined) {
      return;
    }
    const outcome: WorktreeOutcome<WorktreeDescriptor> = await this.worktrees.client.promote(root);
    if (!outcome.ok) {
      console.error(`Promotion failed: ${outcome.error}`);
      return;
    }
    this.session.claimRoot(root);
    this.session.initialize(root, outcome.value);
    this.phase.set('container');
    this.singleListing.set(null);
  }

  /**
   * Materialises a checkout's sub-view: registers the checkout as a workspace root, claims it as
   * host-owned, and reads its root listing.
   * @param id The checkout id.
   * @returns Returns a promise that resolves once the sub-view's listing is ready (or the load
   * failed and the checkout stays unmaterialised).
   */
  private async loadCheckout(id: string): Promise<void> {
    const root: string | null = this.session.root();
    if (root === null || this.worktrees.client === undefined || this.loading.has(id)) {
      return;
    }
    this.loading.add(id);
    try {
      const opened: WorktreeOutcome<string> = await this.worktrees.client.openCheckout(root, id);
      if (!opened.ok) {
        console.error(`Opening the checkout failed: ${opened.error}`);
        return;
      }
      this.session.claimRoot(opened.value);
      const listing: DirectoryListing | null = await this.readListing(opened.value);
      if (listing === null) {
        return;
      }
      if (!this.loaded().some((entry: LoadedCheckout): boolean => entry.id === id)) {
        this.loaded.set([...this.loaded(), { id, listing }]);
      }
    } finally {
      this.loading.delete(id);
    }
  }

  /**
   * Reads a directory's listing over the bridge.
   * @param path The absolute directory path.
   * @returns Returns the listing, or null when unavailable.
   */
  private readListing(path: string): Promise<DirectoryListing | null> {
    return (
      this.bridge?.invoke<DirectoryListing | null>(WorkspaceChannel.ReadDirectory, path) ??
      Promise.resolve(null)
    );
  }

  /**
   * Closes a workspace root in the main process.
   * @param path The absolute root path.
   * @returns Returns a promise that resolves once the root is closed.
   */
  private closeRoot(path: string): Promise<void> {
    return this.bridge?.invoke<void>(WorkspaceChannel.CloseFolder, path) ?? Promise.resolve();
  }
}
