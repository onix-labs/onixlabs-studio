import { inject, Service } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import {
  WorkspaceKind,
  WorktreeAddOptions,
  WorktreeCheckoutInfo,
  WorktreeCheckoutStatus,
  WorktreeDescriptor,
  WorktreeOutcome,
} from '@shared/api/worktree';
import { WorktreeChannel, WorktreeClient } from '@shared/api/worktree-channels';
import { Log } from '@shared/angular/services/log/log';

/**
 * Builds a {@link WorktreeClient} that forwards each operation to its {@link WorktreeChannel} over
 * the generic transport. Kept as a free function so the client is assembled from a non-null bridge,
 * without per-call presence checks.
 * @param bridge The generic transport to forward over.
 * @returns Returns the client bound to the bridge.
 */
function createClient(bridge: Bridge): WorktreeClient {
  return {
    resolve: (target: string): Promise<WorkspaceKind | null> =>
      bridge.invoke(WorktreeChannel.Resolve, target),
    describe: (root: string): Promise<WorktreeDescriptor | null> =>
      bridge.invoke(WorktreeChannel.Describe, root),
    promote: (root: string): Promise<WorktreeOutcome<WorktreeDescriptor>> =>
      bridge.invoke(WorktreeChannel.Promote, root),
    addCheckout: (
      root: string,
      options: WorktreeAddOptions,
    ): Promise<WorktreeOutcome<WorktreeCheckoutInfo>> =>
      bridge.invoke(WorktreeChannel.AddCheckout, root, options),
    removeCheckout: (root: string, id: string): Promise<WorktreeOutcome<null>> =>
      bridge.invoke(WorktreeChannel.RemoveCheckout, root, id),
    openCheckout: (root: string, id: string): Promise<WorktreeOutcome<string>> =>
      bridge.invoke(WorktreeChannel.OpenCheckout, root, id),
    status: (root: string): Promise<readonly WorktreeCheckoutStatus[] | null> =>
      bridge.invoke(WorktreeChannel.Status, root),
    branches: (root: string): Promise<readonly string[] | null> =>
      bridge.invoke(WorktreeChannel.Branches, root),
  };
}

/**
 * Represents the renderer-side client for the worktree-container capability. It wraps the generic
 * {@link Bridge} transport, exposing the typed {@link WorktreeClient} operations under
 * {@link Worktrees.client}.
 *
 * When the application runs outside Electron (served as a plain web app or under unit tests) the
 * bridge is absent and {@link Worktrees.client} is undefined, so consumers treat every directory as
 * an ordinary workspace.
 */
@Service()
export class Worktrees {
  /**
   * Gets the worktree operations, or undefined when running outside Electron.
   */
  public readonly client: WorktreeClient | undefined = window.bridge
    ? createClient(window.bridge)
    : undefined;

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Initializes a new instance of the {@link Worktrees} class.
   */
  public constructor() {
    this.log.trace('Worktrees', `Worktree client ${this.client ? 'available' : 'unavailable'}`);
  }
}
