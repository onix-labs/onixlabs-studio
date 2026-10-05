import type {
  VersionControlCapability,
  VersionControlExecutableChoice,
  VersionControlExecutableMode,
  VcsMergeMode,
  VcsOperationKind,
  VcsOperationState,
  VersionControlOp,
  VersionControlResponse,
  VcsParams,
} from './version-control-protocol';

// The source-control slice of the IPC contract (#816). The renderer's SourceControl client and the
// main process's VersionControlManager both name their channels from here, carried over the generic
// window.bridge transport.
//
// The renderer asks the version-control protocol's questions about a repository it has opened; the
// main process's host decides which plugin answers, confines every request to an open repository or
// workspace, and refuses what the plugin does not support. Answers arrive typed — nothing on this side
// of the seam parses a tool's output.

/**
 * Names the source-control IPC channels. Every one is a request/response `invoke`.
 */
export enum SourceControlChannel {
  /**
   * Opens the repository containing a folder, registering its root so requests may act on it.
   */
  ResolveRepository = 'source-control:resolve-repository',

  /**
   * Releases an opened repository.
   */
  CloseRepository = 'source-control:close-repository',

  /**
   * Asks the plugin serving an opened repository to perform one of the protocol's repository
   * operations.
   */
  Request = 'source-control:request',

  /**
   * Gets what the plugin serving an opened repository can do, so a surface offers only that.
   */
  Describe = 'source-control:describe',

  /**
   * Lists the contributed version-control plugins and how each is configured, for Settings.
   */
  ListPlugins = 'source-control:list-plugins',

  /**
   * Sets which tool a version-control plugin runs, restarting it so the choice takes effect.
   */
  SetExecutable = 'source-control:set-executable',
}

/**
 * Describes what the plugin serving a repository can do.
 */
export interface RepositoryCapabilities {
  /**
   * Gets the serving plugin's identifier.
   */
  readonly pluginId: string;

  /**
   * Gets the serving plugin's display name, such as `Git`.
   */
  readonly displayName: string;

  /**
   * Gets the optional capabilities both the plugin's manifest declared and its handshake confirmed.
   */
  readonly capabilities: readonly VersionControlCapability[];
}

/**
 * Describes a contributed version-control plugin, as Settings shows it.
 */
export interface VersionControlPluginInfo {
  /**
   * Gets the plugin's identifier.
   */
  readonly id: string;

  /**
   * Gets the plugin's display name.
   */
  readonly displayName: string;

  /**
   * Gets whether the plugin's payload is installed.
   */
  readonly installed: boolean;

  /**
   * Gets where the plugin's tool may come from, empty when there is no choice.
   */
  readonly executableModes: readonly VersionControlExecutableMode[];

  /**
   * Gets the user's choice, or null for the plugin's default.
   */
  readonly executable: VersionControlExecutableChoice | null;

  /**
   * Gets the tool's version as the running plugin reported it, or null when it could not be run.
   */
  readonly toolVersion: string | null;

  /**
   * Gets why the plugin or its tool cannot be used, when it cannot.
   */
  readonly problem?: string;
}

/**
 * Describes an opened repository: its resolved root path and display name.
 */
export interface RepositoryInfo {
  /**
   * Gets the repository's absolute root path.
   */
  readonly root: string;

  /**
   * Gets the repository's display name (its root folder's base name).
   */
  readonly name: string;
}

/**
 * Names the failures a caller answers differently from any other, so it never has to tell one refusal
 * from another by reading a tool's prose. The values are the protocol's error codes.
 */
export enum SourceControlCode {
  /**
   * An unforced branch delete refused because the branch still holds commits of its own.
   */
  BranchNotMerged = 'branch-not-merged',

  /**
   * An operation that stopped on conflicts. Not an error in the ordinary sense: it did what it was
   * asked as far as it could, and is waiting to be told how to finish.
   */
  Conflicted = 'conflicted',

  /**
   * A continue asked of a squash merge, which is finished by committing the staged result.
   */
  SquashCommitRequired = 'squash-commit-required',

  /**
   * An operation command asked of a working tree that is in the middle of nothing.
   */
  NoOperation = 'no-operation',

  /**
   * A skip asked of an operation that has no notion of skipping.
   */
  SkipUnsupported = 'skip-unsupported',
}

/**
 * Specifies how a merge records its result. The protocol's {@link VcsMergeMode}, under the name the
 * renderer already uses.
 */
export type GitMergeMode = VcsMergeMode;

/**
 * Names a multi-step operation a working tree can be left in the middle of.
 */
export type GitOperationKind = VcsOperationKind;

/**
 * Describes the multi-step operation a repository is in the middle of.
 */
export type GitOperationState = VcsOperationState;

/**
 * Describes the source-control client the renderer reaches the main process through.
 */
export interface SourceControlClient {
  /**
   * Opens the repository containing a folder.
   * @param directory The absolute folder path to resolve from.
   * @returns Returns the repository, or null when the folder is in none an installed plugin knows.
   */
  resolveRepository(directory: string): Promise<RepositoryInfo | null>;

  /**
   * Releases an opened repository.
   * @param root The repository root.
   * @returns Returns a promise that resolves once it has been released.
   */
  closeRepository(root: string): Promise<void>;

  /**
   * Asks the plugin serving an opened repository to perform an operation on it.
   * @param root The repository root.
   * @param op The operation.
   * @param params The operation's parameters.
   * @returns Returns the plugin's answer, or the host's refusal.
   */
  request<Op extends VersionControlOp>(
    root: string,
    op: Op,
    params: VcsParams<Op>,
  ): Promise<VersionControlResponse<Op>>;

  /**
   * Gets what the plugin serving an opened repository can do.
   * @param root The repository root.
   * @returns Returns the capabilities, or null when no plugin can be asked.
   */
  describe(root: string): Promise<RepositoryCapabilities | null>;

  /**
   * Lists the contributed version-control plugins and how each is configured.
   * @returns Returns the plugins.
   */
  listPlugins(): Promise<readonly VersionControlPluginInfo[]>;

  /**
   * Sets which tool a plugin runs, restarting it.
   * @param pluginId The plugin.
   * @param executable The choice, or null for the plugin's default.
   * @returns Returns the plugin as configured afterwards, or null when the choice was refused.
   */
  setExecutable(
    pluginId: string,
    executable: VersionControlExecutableChoice | null,
  ): Promise<VersionControlPluginInfo | null>;
}
