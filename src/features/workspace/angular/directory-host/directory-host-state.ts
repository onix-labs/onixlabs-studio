import { Provider, Service, signal, WritableSignal } from '@angular/core';
import { DirectoryListing } from '@shared/api/workspace-channels';
import { TabScopedProviders } from '@shared/angular/services/tab-scopes/tab-scopes';
import { WorktreeSession } from '@features/workspace/angular/worktree/worktree-session';

/**
 * A checkout sub-view the host has materialised: the checkout id and the root listing its
 * {@link import('../directory-view/directory-view').DirectoryView} was seeded with.
 */
export interface LoadedCheckout {
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
 * Holds what a directory tab has become, for as long as the tab is open: a
 * {@link import('./directory-host').DirectoryHost} is made again when its tab moves to another window
 * (#1587), and the new one carries on from here rather than opening the folder afresh.
 */
@Service({ autoProvided: false })
export class DirectoryHostState {
  /**
   * Holds whether a host has taken the tab's initial folder, so a host made after a move does not
   * look for it again.
   */
  public started: boolean = false;

  /**
   * Holds what the tab renders: nothing (while the opened folder's kind resolves), the single
   * workspace view, or the container's checkout sub-views.
   */
  public readonly phase: WritableSignal<'resolving' | 'single' | 'container'> = signal<
    'resolving' | 'single' | 'container'
  >('resolving');

  /**
   * Holds the single view's root listing, or null for a blank tab (the view shows its
   * open-a-folder prompt).
   */
  public readonly singleListing: WritableSignal<DirectoryListing | null> =
    signal<DirectoryListing | null>(null);

  /**
   * Holds the materialised checkout sub-views, in first-activation order.
   */
  public readonly loaded: WritableSignal<readonly LoadedCheckout[]> = signal<
    readonly LoadedCheckout[]
  >([]);

  /**
   * Holds the agent conversation a promotion carries across, with the worktree whose view takes it
   * over — the one the repository became — or null when there is none.
   */
  public readonly carried: WritableSignal<{
    readonly checkoutId: string;
    readonly conversationId: string;
  } | null> = signal<{ readonly checkoutId: string; readonly conversationId: string } | null>(null);

  /**
   * Holds the single view's announced workspace root, kept for the promotion flow.
   */
  public singleRoot: string | null = null;

  /**
   * Holds the checkout ids currently being materialised, so a re-fired effect never double-loads.
   */
  public readonly loading: Set<string> = new Set<string>();

  /**
   * Holds whether the tab has gone. What the main process answers afterwards must open nothing more,
   * and a root it hands back has nobody left to close it but the call that asked for it.
   */
  public destroyed: boolean = false;

  /**
   * Holds whether a promotion is running. It moves the working copy on disk, so a second click must
   * not start another over the top of it.
   */
  public promoting: boolean = false;
}

/**
 * A directory tab's worktree session and what the tab has become, which a move to another window
 * keeps. (#1587) Each of its workspace views keeps its own services in a scope inside this one (see
 * {@link import('../directory-view/directory-view').WORKSPACE_VIEW_SCOPE}).
 */
export const WORKSPACE_TAB_SCOPE: TabScopedProviders = {
  tokens: [WorktreeSession, DirectoryHostState],
  providers: (): Provider[] => [WorktreeSession, DirectoryHostState],
};
