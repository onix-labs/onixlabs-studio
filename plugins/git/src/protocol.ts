// The version-control protocol, as the Git plugin speaks it.
//
// Deliberately a copy rather than an import of the application's `@shared/api`: the plugin is a
// separate program whose contract with Studio is the protocol, not shared TypeScript. A third-party
// version-control plugin would write these from the documented protocol, and a first-party one reaching
// into `src/` would make itself unextractable and let a change in the app break a shipped plugin
// unnoticed. The same rule the harness plugins follow (`plugins/*-harness/src/protocol.ts`).
//
// Transport: newline-delimited JSON over standard streams. One request per line on stdin, one response
// per line on stdout, correlated by `id`. Every answer is typed; nothing on Studio's side parses git.

/**
 * Holds the protocol version this build speaks. A plugin announcing a different major version is
 * refused rather than spoken to: one that misreads a request does something to the user's repository
 * other than what they asked, and that is worse than doing nothing.
 */
// 1.1 (#806) adds the `init` request and its capability, so a new project can start with a repository
// of its own. An addition, so a 1.0 host still understands this plugin.
export const VERSION_CONTROL_PROTOCOL_VERSION: string = '1.1';

/**
 * Names one optional capability a version-control plugin can advertise.
 *
 * Everything not listed here — status, history, diffs, commit, branches — every version-control system
 * has, so a plugin is not asked to declare it. A capability absent from a plugin's handshake means the
 * UI does not offer the corresponding affordance at all, and the host refuses its operations without
 * asking the plugin: a control not offered is a gap, where one offered and unhonoured is a control
 * that lies.
 */
export type VersionControlCapability =
  /**
   * A staging area between the working tree and a commit (git's index). Subversion has none, so a
   * plugin without it commits the working tree's changes directly.
   */
  | 'stagingArea'

  /**
   * Shelving uncommitted changes and bringing them back.
   */
  | 'stash'

  /**
   * Named, immovable references to commits.
   */
  | 'tags'

  /**
   * Named remote repositories: fetch, pull, push, and tracking branches.
   */
  | 'remotes'

  /**
   * Merging one branch into another, including stopping on conflicts and being told how to finish.
   */
  | 'merge'

  /**
   * Replaying a branch onto another. Rewrites history.
   */
  | 'rebase'

  /**
   * Copying a repository from a URL into a new directory.
   */
  | 'clone'

  /**
   * Making a new, empty repository in a directory (1.1, #806).
   */
  | 'init'

  /**
   * Making extra, independent checkouts of one repository side by side, for parallel work — what a
   * worktree container (#351) and an agent team's workers (#808) are built on.
   */
  | 'parallelCheckouts'

  /**
   * Reading and setting the user's global committer identity.
   */
  | 'identity';

/**
 * Lists every optional capability. Closed on purpose, like a decoder's formats: a capability is the join
 * between what a plugin says and what a surface checks, so a misspelled one would not fail — it would
 * silently never be offered.
 */
export const VERSION_CONTROL_CAPABILITIES: readonly VersionControlCapability[] = [
  'stagingArea',
  'stash',
  'tags',
  'remotes',
  'merge',
  'rebase',
  'clone',
  'init',
  'parallelCheckouts',
  'identity',
];

/**
 * Names where a plugin's tool comes from, which the user chooses in Settings exactly as they choose the
 * Claude provider's executable.
 *
 * - `installed`: the tool found on the machine (on the `PATH`).
 * - `bundled`: a copy the plugin ships in its own payload.
 * - `custom`: an absolute path the user gives.
 */
export type VersionControlExecutableMode = 'installed' | 'bundled' | 'custom';

/**
 * Lists where a plugin's tool may come from.
 */
export const VERSION_CONTROL_EXECUTABLE_MODES: readonly VersionControlExecutableMode[] = [
  'installed',
  'bundled',
  'custom',
];

/**
 * Describes the user's choice of which tool a plugin runs.
 */
export interface VersionControlExecutableChoice {
  /**
   * Gets where the tool comes from.
   */
  readonly mode: VersionControlExecutableMode;

  /**
   * Gets the absolute path used when the mode is `custom`, empty otherwise.
   */
  readonly path: string;
}

/**
 * Describes how a change affects a file.
 */
export type VcsChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'conflicted';

/**
 * Describes one changed file, as a plugin reports it.
 *
 * Only what the version-control system knows. What the renderer adds for display — the file's
 * language, the loaded contents of either side — is the renderer's business and never crosses the wire.
 */
export interface VcsFileChange {
  /**
   * Gets the path relative to the repository root, with forward slashes.
   */
  readonly path: string;

  /**
   * Gets the path before a rename, when the change is one.
   */
  readonly previousPath?: string;

  /**
   * Gets how the change affects the file.
   */
  readonly status: VcsChangeStatus;

  /**
   * Gets the number of lines added, or 0 when unknown.
   */
  readonly additions: number;

  /**
   * Gets the number of lines removed, or 0 when unknown.
   */
  readonly deletions: number;

  /**
   * Gets whether the file is not yet tracked at all.
   */
  readonly untracked?: boolean;
}

/**
 * Describes a repository's working-tree status.
 */
export interface VcsStatus {
  /**
   * Gets the current branch name, or null when no branch is checked out (a detached head).
   */
  readonly branch: string | null;

  /**
   * Gets the upstream branch name, or null when there is none.
   */
  readonly upstream: string | null;

  /**
   * Gets the number of commits ahead of the upstream.
   */
  readonly ahead: number;

  /**
   * Gets the number of commits behind the upstream.
   */
  readonly behind: number;

  /**
   * Gets the staged changes. Always empty from a plugin without `stagingArea`.
   */
  readonly staged: readonly VcsFileChange[];

  /**
   * Gets the changes not yet staged (or, without a staging area, every change), including untracked
   * files.
   */
  readonly unstaged: readonly VcsFileChange[];

  /**
   * Gets the paths left conflicted by an unfinished operation. Kept apart from the other two: a
   * conflicted path is not a change waiting to be committed, and cannot be committed as it stands.
   */
  readonly conflicted: readonly VcsFileChange[];

  /**
   * Gets the paths the version-control system ignores, relative to the repository root with forward
   * slashes — a whole ignored directory as one entry ending in `/` (#860). Optional: a plugin that does
   * not report them, or a system with no ignore rules, leaves it out, and nothing is shown as ignored.
   */
  readonly ignored?: readonly string[];
}

/**
 * Names the kind of a reference decorating a commit.
 */
export type VcsRefKind = 'head' | 'branch' | 'remote' | 'tag';

/**
 * Describes a reference decorating a commit.
 */
export interface VcsRef {
  /**
   * Gets the reference's display name.
   */
  readonly name: string;

  /**
   * Gets the kind of reference.
   */
  readonly kind: VcsRefKind;
}

/**
 * Describes one commit in the history.
 *
 * The date is absolute; how long ago it was is the renderer's to phrase, since a plugin cannot know
 * when the answer will be read.
 */
export interface VcsCommit {
  /**
   * Gets the full commit identifier.
   */
  readonly hash: string;

  /**
   * Gets the abbreviated identifier shown in lists.
   */
  readonly shortHash: string;

  /**
   * Gets the first line of the message.
   */
  readonly summary: string;

  /**
   * Gets the rest of the message, empty when there is none.
   */
  readonly body: string;

  /**
   * Gets the author's name.
   */
  readonly author: string;

  /**
   * Gets the author's email address.
   */
  readonly email: string;

  /**
   * Gets the author date, ISO 8601.
   */
  readonly isoDate: string;

  /**
   * Gets the parent commit identifiers, first parent first.
   */
  readonly parents: readonly string[];

  /**
   * Gets the references pointing at this commit.
   */
  readonly refs: readonly VcsRef[];
}

/**
 * Describes a local branch.
 */
export interface VcsBranch {
  /**
   * Gets the branch name.
   */
  readonly name: string;

  /**
   * Gets whether the branch is checked out.
   */
  readonly current: boolean;

  /**
   * Gets the upstream branch, when one is set.
   */
  readonly upstream?: string;

  /**
   * Gets the number of commits ahead of the upstream.
   */
  readonly ahead: number;

  /**
   * Gets the number of commits behind the upstream.
   */
  readonly behind: number;

  /**
   * Gets the identifier of the commit the branch points at.
   */
  readonly tip: string;
}

/**
 * Describes a branch on a remote.
 */
export interface VcsRemoteBranch {
  /**
   * Gets the branch name, without the remote's prefix.
   */
  readonly name: string;

  /**
   * Gets the identifier of the commit it points at.
   */
  readonly commit: string;
}

/**
 * Describes a named remote repository.
 */
export interface VcsRemote {
  /**
   * Gets the remote's name.
   */
  readonly name: string;

  /**
   * Gets the remote's URL.
   */
  readonly url: string;

  /**
   * Gets the remote's branches, as last fetched.
   */
  readonly branches: readonly VcsRemoteBranch[];
}

/**
 * Describes a tag.
 */
export interface VcsTag {
  /**
   * Gets the tag name.
   */
  readonly name: string;

  /**
   * Gets the identifier of the commit it names.
   */
  readonly commit: string;
}

/**
 * Describes a repository's references, read together because every surface showing one shows the rest.
 */
export interface VcsRefs {
  /**
   * Gets the local branches.
   */
  readonly branches: readonly VcsBranch[];

  /**
   * Gets the remotes and their branches. Empty from a plugin without `remotes`.
   */
  readonly remotes: readonly VcsRemote[];

  /**
   * Gets the tags. Empty from a plugin without `tags`.
   */
  readonly tags: readonly VcsTag[];
}

/**
 * Describes a shelved set of changes.
 */
export interface VcsStash {
  /**
   * Gets the stash's position, newest first, which is how it is named back to the plugin.
   */
  readonly index: number;

  /**
   * Gets the stash's message.
   */
  readonly message: string;

  /**
   * Gets the branch the stash was made on.
   */
  readonly branch: string;

  /**
   * Gets the files the stash changes.
   */
  readonly files: readonly VcsFileChange[];
}

/**
 * Specifies how a merge records its result.
 *
 * - `default`: fast-forward where possible, otherwise a merge commit.
 * - `no-ff`: always a merge commit.
 * - `squash`: apply and stage the changes without committing or recording a merge.
 */
export type VcsMergeMode = 'default' | 'no-ff' | 'squash';

/**
 * Names a multi-step operation a working tree can be left in the middle of. `squash-merge` is apart from
 * `merge` because it records no merge to continue or abort.
 */
export type VcsOperationKind = 'merge' | 'squash-merge' | 'rebase' | 'cherry-pick' | 'revert';

/**
 * Describes the multi-step operation a repository is in the middle of.
 */
export interface VcsOperationState {
  /**
   * Gets the operation in flight, or null when there is none.
   */
  readonly kind: VcsOperationKind | null;

  /**
   * Gets what the operation is working towards, as a person reads it, when the tool names it.
   */
  readonly target?: string;

  /**
   * Gets the branch being replayed, for a rebase.
   */
  readonly branch?: string;

  /**
   * Gets the number of the commit being applied, for an operation that replays several.
   */
  readonly step?: number;

  /**
   * Gets the total number of commits to apply, for an operation that replays several.
   */
  readonly total?: number;
}

/**
 * Names which version of a file to read.
 *
 * - `working`: the file on disk, as it is now.
 * - `index`: the staged version (only from a plugin with `stagingArea`).
 * - `head`: the version in the checked-out commit.
 * - `commit`: the version in a given commit.
 * - `ours`: our side of a conflicted file — the version the working tree was on when an operation
 *   stopped on conflicts. What a conflicted file is compared against, since it has no single staged
 *   version to compare with.
 *
 * Read through the plugin even for the working tree: the plugin is confined to the repository, and a
 * repository need not be an open workspace Studio's own file access would allow.
 */
export type VcsFileVersion =
  | { readonly kind: 'working' }
  | { readonly kind: 'index' }
  | { readonly kind: 'head' }
  | { readonly kind: 'commit'; readonly hash: string }
  | { readonly kind: 'ours' };

/**
 * Describes the user's committer identity.
 */
export interface VcsIdentity {
  /**
   * Gets the name, or empty when unset.
   */
  readonly name: string;

  /**
   * Gets the email address, or empty when unset.
   */
  readonly email: string;
}

/**
 * Describes where a push goes, when not to the branch's upstream.
 */
export interface VcsPushTarget {
  /**
   * Gets the remote to push to.
   */
  readonly remote: string;

  /**
   * Gets the remote branch to push to.
   */
  readonly branch: string;

  /**
   * Gets whether to record the target as the branch's upstream.
   */
  readonly setUpstream: boolean;
}

/**
 * Names why an operation did not simply succeed, for the outcomes a surface handles differently from a
 * plain failure.
 *
 * - `conflicted`: stopped on conflicts. Not a failure: the tool did what it could and waits to be told
 *   how to finish, so the caller refreshes and shows the conflicts.
 * - `branch-not-merged`: an unforced branch delete refused because the branch holds unmerged commits.
 * - `squash-commit-required`: a continue asked of a squash merge, which is finished by committing.
 * - `no-operation`: an operation command asked of a working tree in the middle of nothing.
 * - `skip-unsupported`: a skip asked of an operation that cannot skip.
 * - `unsupported`: the operation needs a capability the plugin did not advertise. The host answers this
 *   itself, without asking the plugin.
 * - `refused`: the host would not send the request — a root that is not open, or a malformed request.
 */
export type VcsErrorCode =
  | 'conflicted'
  | 'branch-not-merged'
  | 'squash-commit-required'
  | 'no-operation'
  | 'skip-unsupported'
  | 'unsupported'
  | 'refused';

/**
 * Describes what a plugin says it is, in answer to `initialize`.
 */
export interface VersionControlDescription {
  /**
   * Gets the protocol version the plugin speaks.
   */
  readonly protocol: string;

  /**
   * Gets the optional capabilities the plugin supports. The host intersects these with what the
   * manifest declared: a manifest is a promise, and this is the plugin itself answering.
   */
  readonly capabilities: readonly VersionControlCapability[];

  /**
   * Gets the version of the tool the plugin runs, as the tool reports it (for example
   * `git version 2.45.1`), or null when the tool could not be found. What the setup wizard shows.
   */
  readonly toolVersion: string | null;

  /**
   * Gets why the tool could not be used, when `toolVersion` is null — what the user is told to fix.
   */
  readonly problem?: string;
}

/**
 * Lists every request, its parameters, and what a successful answer carries.
 *
 * One table rather than a union written out by hand, so a request's parameters and its result are
 * declared together and the host's `request` is typed by the operation's name.
 */
export interface VersionControlOperations {
  /**
   * The handshake: sent once, immediately after the process starts.
   */
  readonly initialize: {
    readonly params: {
      readonly protocol: string;
      readonly executable: VersionControlExecutableChoice | null;
    };
    readonly result: VersionControlDescription;
  };

  /**
   * Finds the root of the repository containing a path, or null when the path is in none.
   */
  readonly resolveRoot: {
    readonly params: { readonly path: string };
    readonly result: { readonly root: string | null };
  };

  readonly status: { readonly params: Empty; readonly result: VcsStatus };
  readonly operationState: { readonly params: Empty; readonly result: VcsOperationState };
  readonly log: {
    readonly params: { readonly limit: number };
    readonly result: readonly VcsCommit[];
  };
  readonly refs: { readonly params: Empty; readonly result: VcsRefs };
  readonly stashes: { readonly params: Empty; readonly result: readonly VcsStash[] };
  readonly commitFiles: {
    readonly params: { readonly hash: string };
    readonly result: readonly VcsFileChange[];
  };

  /**
   * Reads a version of a file. `content` is null when the file does not exist in that version.
   */
  readonly readFile: {
    readonly params: { readonly path: string; readonly version: VcsFileVersion };
    readonly result: { readonly content: string | null };
  };

  readonly discard: { readonly params: Paths; readonly result: Done };
  readonly stage: { readonly params: Paths; readonly result: Done };
  readonly unstage: { readonly params: Paths; readonly result: Done };
  readonly commit: { readonly params: { readonly message: string }; readonly result: Done };

  readonly stash: { readonly params: Empty; readonly result: Done };
  readonly stashApply: { readonly params: StashIndex; readonly result: Done };
  readonly stashPop: { readonly params: StashIndex; readonly result: Done };
  readonly stashDrop: { readonly params: StashIndex; readonly result: Done };

  readonly checkout: { readonly params: { readonly branch: string }; readonly result: Done };
  readonly createBranch: {
    readonly params: { readonly name: string; readonly checkout: boolean };
    readonly result: Done;
  };
  readonly deleteBranch: {
    readonly params: { readonly name: string; readonly force: boolean };
    readonly result: Done;
  };
  readonly renameBranch: {
    readonly params: { readonly from: string; readonly to: string };
    readonly result: Done;
  };
  readonly setUpstream: {
    readonly params: { readonly branch: string; readonly upstream: string | null };
    readonly result: Done;
  };

  readonly fetch: { readonly params: Empty; readonly result: Done };
  readonly fetchRef: {
    readonly params: {
      readonly remote: string;
      readonly sourceRef: string;
      readonly localBranch: string;
    };
    readonly result: Done;
  };
  readonly pull: { readonly params: Empty; readonly result: Done };
  readonly push: {
    readonly params: { readonly target: VcsPushTarget | null };
    readonly result: Done;
  };
  readonly fetchRemote: { readonly params: RemoteName; readonly result: Done };
  readonly pruneRemote: { readonly params: RemoteName; readonly result: Done };
  readonly addRemote: {
    readonly params: { readonly name: string; readonly url: string };
    readonly result: Done;
  };
  readonly removeRemote: { readonly params: { readonly name: string }; readonly result: Done };
  readonly checkoutTracking: {
    readonly params: { readonly remoteBranch: string; readonly localBranch: string };
    readonly result: Done;
  };

  readonly merge: {
    readonly params: { readonly branch: string; readonly mode: VcsMergeMode };
    readonly result: Done;
  };
  readonly rebase: { readonly params: { readonly onto: string }; readonly result: Done };
  readonly operationContinue: { readonly params: Empty; readonly result: Done };
  readonly operationSkip: { readonly params: Empty; readonly result: Done };
  readonly operationAbort: { readonly params: Empty; readonly result: Done };

  readonly createTag: {
    readonly params: { readonly name: string; readonly commit: string; readonly message?: string };
    readonly result: Done;
  };
  readonly deleteTag: { readonly params: { readonly name: string }; readonly result: Done };
  readonly deleteRemoteTag: {
    readonly params: { readonly remote: string; readonly name: string };
    readonly result: Done;
  };
  readonly pushTag: {
    readonly params: { readonly remote: string; readonly name: string };
    readonly result: Done;
  };
  readonly pushAllTags: { readonly params: RemoteName; readonly result: Done };

  /**
   * Copies a repository into a new directory, optionally checking out a branch (created from the
   * default branch when `createBranch` is set). The directory must not exist yet.
   */
  readonly clone: {
    readonly params: {
      readonly url: string;
      readonly directory: string;
      readonly branch?: string;
      readonly createBranch?: boolean;
    };
    readonly result: Done;
  };

  /**
   * Makes a new, empty repository in a directory, creating the directory if it does not exist yet
   * (1.1, #806). Gated by `init`.
   */
  readonly init: {
    readonly params: { readonly directory: string };
    readonly result: Done;
  };

  readonly getIdentity: { readonly params: Empty; readonly result: VcsIdentity };
  readonly setIdentity: { readonly params: VcsIdentity; readonly result: Done };
}

/**
 * Names one request.
 */
export type VersionControlOp = keyof VersionControlOperations;

/**
 * Gets the parameters of a request.
 */
export type VcsParams<Op extends VersionControlOp> = VersionControlOperations[Op]['params'];

/**
 * Gets what a successful answer to a request carries.
 */
export type VcsResult<Op extends VersionControlOp> = VersionControlOperations[Op]['result'];

/**
 * Parameters of a request that takes none.
 */
type Empty = Readonly<Record<string, never>>;

/**
 * Parameters naming repository-relative paths.
 */
interface Paths {
  readonly paths: readonly string[];
}

/**
 * Parameters naming a stash by position.
 */
interface StashIndex {
  readonly index: number;
}

/**
 * Parameters naming a remote.
 */
interface RemoteName {
  readonly remote: string;
}

/**
 * The result of an operation that only succeeds or fails.
 */
type Done = Readonly<Record<string, never>>;

/**
 * The requests that act on a repository, named in `root`, which the host checks against the open
 * repositories and workspace roots before the plugin ever sees it. The renderer may send only these.
 */
export const VCS_REPOSITORY_OPS: readonly VersionControlOp[] = [
  'status',
  'operationState',
  'log',
  'refs',
  'stashes',
  'commitFiles',
  'readFile',
  'discard',
  'stage',
  'unstage',
  'commit',
  'stash',
  'stashApply',
  'stashPop',
  'stashDrop',
  'checkout',
  'createBranch',
  'deleteBranch',
  'renameBranch',
  'setUpstream',
  'fetch',
  'fetchRef',
  'pull',
  'push',
  'fetchRemote',
  'pruneRemote',
  'addRemote',
  'removeRemote',
  'checkoutTracking',
  'merge',
  'rebase',
  'operationContinue',
  'operationSkip',
  'operationAbort',
  'createTag',
  'deleteTag',
  'deleteRemoteTag',
  'pushTag',
  'pushAllTags',
];

/**
 * The requests that act on no repository.
 */
export const VCS_GLOBAL_OPS: readonly VersionControlOp[] = [
  'initialize',
  'resolveRoot',
  'clone',
  'init',
  'getIdentity',
  'setIdentity',
];

/**
 * The requests that only read. Identical concurrent reads are answered by one request — several
 * surfaces watch the same repository and a burst of file changes makes them all ask at once.
 */
export const VCS_READ_OPS: readonly VersionControlOp[] = [
  'resolveRoot',
  'status',
  'operationState',
  'log',
  'refs',
  'stashes',
  'commitFiles',
  'readFile',
  'getIdentity',
];

/**
 * The requests that reach another machine, which may take as long as a network does.
 */
export const VCS_NETWORK_OPS: readonly VersionControlOp[] = [
  'fetch',
  'fetchRef',
  'pull',
  'push',
  'fetchRemote',
  'pruneRemote',
  'deleteRemoteTag',
  'pushTag',
  'pushAllTags',
  'clone',
];

/**
 * The capability each optional request needs. A request absent from this table needs none.
 */
export const VCS_OP_CAPABILITY: Readonly<
  Partial<Record<VersionControlOp, VersionControlCapability>>
> = {
  stage: 'stagingArea',
  unstage: 'stagingArea',
  stash: 'stash',
  stashApply: 'stash',
  stashPop: 'stash',
  stashDrop: 'stash',
  fetch: 'remotes',
  fetchRef: 'remotes',
  pull: 'remotes',
  push: 'remotes',
  fetchRemote: 'remotes',
  pruneRemote: 'remotes',
  addRemote: 'remotes',
  removeRemote: 'remotes',
  checkoutTracking: 'remotes',
  setUpstream: 'remotes',
  merge: 'merge',
  rebase: 'rebase',
  createTag: 'tags',
  deleteTag: 'tags',
  deleteRemoteTag: 'tags',
  pushTag: 'tags',
  pushAllTags: 'tags',
  clone: 'clone',
  init: 'init',
  getIdentity: 'identity',
  setIdentity: 'identity',
};

/**
 * Describes a request sent to a plugin.
 */
export interface VersionControlRequest<Op extends VersionControlOp = VersionControlOp> {
  /**
   * Gets the request correlation identifier.
   */
  readonly id: number;

  /**
   * Gets the operation requested.
   */
  readonly op: Op;

  /**
   * Gets the absolute repository root the request acts on, absent for a global request.
   */
  readonly root?: string;

  /**
   * Gets the operation's parameters.
   */
  readonly params: VcsParams<Op>;
}

/**
 * Describes a plugin's answer to a request: the result on success, or the reason it failed.
 */
export type VersionControlResponse<Op extends VersionControlOp = VersionControlOp> =
  | {
      /**
       * Gets the correlation identifier of the request this answers.
       */
      readonly id: number;

      /**
       * Discriminates the success case.
       */
      readonly ok: true;

      /**
       * Gets the operation's result.
       */
      readonly result: VcsResult<Op>;
    }
  | {
      /**
       * Gets the correlation identifier of the request this answers.
       */
      readonly id: number;

      /**
       * Discriminates the failure case.
       */
      readonly ok: false;

      /**
       * Gets a human-readable reason the request failed, suitable for showing to the user.
       */
      readonly error: string;

      /**
       * Gets the reason's code, when the outcome is one a surface handles differently from a plain
       * failure.
       */
      readonly code?: VcsErrorCode;
    };

/**
 * Determines whether a plugin's announced protocol version is compatible with this build's: the same
 * major version. A plugin may add minor capability without Studio knowing; a major difference means
 * the two disagree about what a request means.
 * @param announced The version the plugin announced.
 * @returns Returns true when the plugin may be spoken to.
 */
export function isCompatibleVersionControlProtocol(announced: unknown): boolean {
  if (typeof announced !== 'string' || !/^\d+(\.\d+)*$/.test(announced)) {
    return false;
  }
  const major: (version: string) => string = (version: string): string => version.split('.')[0];
  return major(announced) === major(VERSION_CONTROL_PROTOCOL_VERSION);
}

/**
 * Determines whether a value is a known optional capability.
 * @param value The candidate.
 * @returns Returns true when the value names a capability.
 */
export function isVersionControlCapability(value: unknown): value is VersionControlCapability {
  return (
    typeof value === 'string' && (VERSION_CONTROL_CAPABILITIES as readonly string[]).includes(value)
  );
}
