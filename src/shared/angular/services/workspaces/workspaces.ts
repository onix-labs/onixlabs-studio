import { inject, Service } from '@angular/core';
import { DirectoryListing } from '@shared/api/workspace-channels';
import { Log } from '@shared/angular/services/log/log';

/**
 * Bridges opening a directory to the workspace instance that hosts it. Each directory tab is its own
 * IDE instance with its own scoped state; when a folder is opened, its root listing is stashed here
 * under the new tab's id, and the owning tab's view consumes it once on init to seed its scoped
 * workspace. This is the only global seam between the shell and the per-instance workspaces.
 */
@Service()
export class Workspaces {
  /**
   * Holds the pending root listing for each directory tab, keyed by tab id, until its view consumes it.
   */
  private readonly pending: Map<string, DirectoryListing> = new Map<string, DirectoryListing>();

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Stashes the initial root listing a directory tab should open with.
   * @param tabId The directory tab's id.
   * @param listing The root directory listing to seed the workspace with.
   */
  public setInitial(tabId: string, listing: DirectoryListing): void {
    this.pending.set(tabId, listing);
    this.log.debug('Workspaces', `Stashed initial listing for tab '${tabId}'`, listing.path);
  }

  /**
   * Consumes the initial root listing for a directory tab, if any, clearing it so it is used once.
   * @param tabId The directory tab's id.
   * @returns Returns the stashed listing, or undefined when none was stashed.
   */
  public takeInitial(tabId: string): DirectoryListing | undefined {
    const listing: DirectoryListing | undefined = this.pending.get(tabId);
    this.pending.delete(tabId);
    return listing;
  }
}
