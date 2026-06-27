import { Service } from '@angular/core';
import { RepositoryInfo } from '../../../shared/studio-api';

/**
 * Hands a newly-opened repository to its source-control tab. When a repository is opened, its
 * resolved root is stashed here keyed by the new tab's id; the tab's view consumes it once on init.
 * This is the repository twin of {@link import('../workspaces/workspaces').Workspaces}.
 */
@Service()
export class Repositories {
  /**
   * Holds the pending repository for each source-control tab, keyed by tab id, until its view consumes
   * it.
   */
  private readonly pending: Map<string, RepositoryInfo> = new Map<string, RepositoryInfo>();

  /**
   * Stashes the repository a source-control tab should open with.
   * @param tabId The identifier of the tab.
   * @param info The opened repository's metadata.
   */
  public setInitial(tabId: string, info: RepositoryInfo): void {
    this.pending.set(tabId, info);
  }

  /**
   * Consumes the repository for a source-control tab, if any, clearing it so it is used once.
   * @param tabId The identifier of the tab.
   * @returns Returns the repository, or undefined when none was stashed.
   */
  public takeInitial(tabId: string): RepositoryInfo | undefined {
    const info: RepositoryInfo | undefined = this.pending.get(tabId);
    this.pending.delete(tabId);
    return info;
  }
}
