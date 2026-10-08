import { inject, Service } from '@angular/core';
import { DirectoryListing } from '@shared/api/workspace-channels';
import { Log } from '@shared/angular/services/log/log';

/**
 * Describes how a new workspace's agent starts (#806): a conversation that opens on a line in Studio's
 * voice, carrying a brief every turn of it is given.
 */
export interface WorkspaceAgentStart {
  /**
   * Gets the line the conversation opens on.
   */
  readonly opening: string;

  /**
   * Gets the standing instructions every turn of the conversation carries.
   */
  readonly brief: string;
}

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
   * Holds the pending agent start for each directory tab, keyed by tab id, until its view consumes it.
   */
  private readonly agentStarts: Map<string, WorkspaceAgentStart> = new Map<
    string,
    WorkspaceAgentStart
  >();

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

  /**
   * Stashes how a directory tab's agent should start: used once, when its view first opens.
   * @param tabId The directory tab's id.
   * @param start How the agent starts.
   */
  public setAgentStart(tabId: string, start: WorkspaceAgentStart): void {
    this.agentStarts.set(tabId, start);
    this.log.debug('Workspaces', `Stashed an agent start for tab '${tabId}'`);
  }

  /**
   * Consumes the agent start for a directory tab, if any, clearing it so it is used once.
   * @param tabId The directory tab's id.
   * @returns Returns the stashed start, or undefined when none was stashed.
   */
  public takeAgentStart(tabId: string): WorkspaceAgentStart | undefined {
    const start: WorkspaceAgentStart | undefined = this.agentStarts.get(tabId);
    this.agentStarts.delete(tabId);
    return start;
  }
}
