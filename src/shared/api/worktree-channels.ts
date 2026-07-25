import {
  WorkspaceKind,
  WorktreeAddOptions,
  WorktreeCheckoutInfo,
  WorktreeCheckoutStatus,
  WorktreeDescriptor,
  WorktreeOutcome,
} from './worktree';

/**
 * Names the worktree-container IPC channels: resolving what kind of thing a directory is, describing
 * a container's live checkout state, and the container mutations (promote, add checkout, remove
 * checkout). The renderer's worktree service and the main-process worktree manager name their
 * channels from here, over the generic {@link import('./bridge').Bridge} transport; the payload types
 * live in {@link import('./worktree')}, which is platform-neutral.
 *
 * Confinement mirrors the workspace surfaces: `Resolve` is honoured only for paths the user has
 * opened through a dialog before (trusted paths) or paths within an open root, and every other
 * channel requires its container root to be an open workspace root — the renderer cannot inspect or
 * mutate directories the user never opened.
 */
export enum WorktreeChannel {
  /**
   * Resolves what a directory is — container, workspace, or plain folder (invoke).
   */
  Resolve = 'worktree:resolve',

  /**
   * Describes a container's origin and live checkout states (invoke).
   */
  Describe = 'worktree:describe',

  /**
   * Promotes an open repository workspace, in place, into a worktree container (invoke).
   */
  Promote = 'worktree:promote',

  /**
   * Adds a checkout to a container — a new full clone of the container's origin (invoke).
   */
  AddCheckout = 'worktree:add-checkout',

  /**
   * Removes a registered checkout, sending its directory to the OS trash (invoke).
   */
  RemoveCheckout = 'worktree:remove-checkout',

  /**
   * Registers a container's checkout directory as an open workspace root, so the per-checkout view
   * can use the root-confined surfaces (studio persistence, git, watchers) exactly like an
   * ordinarily-opened workspace (invoke).
   */
  OpenCheckout = 'worktree:open-checkout',

  /**
   * Reads every registered checkout's lightweight status — branch, changed-entry count, and
   * ahead/behind — for the Worktrees panel (invoke).
   */
  Status = 'worktree:status',

  /**
   * Reads the repository's known branch names (local and remote, deduplicated) from an existing
   * checkout, for the New Worktree branch picker (invoke).
   */
  Branches = 'worktree:branches',
}

/**
 * The renderer-facing worktree surface, implemented over the bridge against the main-process
 * worktree manager. Methods return null (or a failed outcome) rather than throwing when a path is
 * unconfined, so callers treat denial exactly like absence.
 */
export interface WorktreeClient {
  /**
   * Resolves what a directory is. Honoured for trusted (previously dialog-opened) paths and paths
   * within an open root.
   * @param target The absolute directory path.
   * @returns Returns the kind, or null when the path is denied or unreadable.
   */
  resolve(target: string): Promise<WorkspaceKind | null>;

  /**
   * Describes an open container root's origin and live checkout states.
   * @param root The container root, which must be an open workspace root.
   * @returns Returns the descriptor, or null when the root is not open or not a container.
   */
  describe(root: string): Promise<WorktreeDescriptor | null>;

  /**
   * Promotes an open repository workspace, in place, into a worktree container: the entire prior
   * contents move into the first checkout directory and the container configuration is seeded.
   * @param root The repository workspace root, which must be an open workspace root.
   * @returns Returns the promoted container's descriptor, or the failure reason.
   */
  promote(root: string): Promise<WorktreeOutcome<WorktreeDescriptor>>;

  /**
   * Adds a checkout to an open container root: a new full clone of the container's origin (or of an
   * existing sibling checkout for a local-only container), optionally switched to a branch.
   * @param root The container root, which must be an open workspace root.
   * @param options The branch and alias options.
   * @returns Returns the new checkout's info, or the failure reason.
   */
  addCheckout(
    root: string,
    options: WorktreeAddOptions,
  ): Promise<WorktreeOutcome<WorktreeCheckoutInfo>>;

  /**
   * Removes a registered checkout from an open container root, sending its directory to the OS
   * trash and updating the registry.
   * @param root The container root, which must be an open workspace root.
   * @param id The checkout id to remove.
   * @returns Returns a null value on success, or the failure reason.
   */
  removeCheckout(root: string, id: string): Promise<WorktreeOutcome<null>>;

  /**
   * Registers a checkout's directory as an open workspace root, returning its absolute path.
   * @param root The container root, which must be an open workspace root.
   * @param id The registered checkout id to open.
   * @returns Returns the checkout's absolute path, or the failure reason.
   */
  openCheckout(root: string, id: string): Promise<WorktreeOutcome<string>>;

  /**
   * Reads every registered checkout's lightweight status.
   * @param root The container root, which must be an open workspace root.
   * @returns Returns the statuses in registration order, or null when the root is not open or not
   * a container.
   */
  status(root: string): Promise<readonly WorktreeCheckoutStatus[] | null>;

  /**
   * Reads the repository's known branch names (local and remote, deduplicated and sorted) from an
   * existing checkout.
   * @param root The container root, which must be an open workspace root.
   * @returns Returns the branch names, or null when the root is not open, not a container, or has
   * no existing checkout to read from.
   */
  branches(root: string): Promise<readonly string[] | null>;
}
