import { computed, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { RepositoryInfo } from '@shared/api/source-control-channels';
import { DirectoryWatch } from '@shared/angular/services/directory-watch/directory-watch';
import {
  NotificationAction,
  Notifications,
} from '@shared/angular/services/notifications/notifications';
import {
  FileDiff,
  MutationResult,
  SourceControlProvider,
} from '../source-control/source-control-provider';
import { ParsedRefs, ParsedStatus } from '../source-control/git-output';
import { SourceControlProviders } from '../source-control/source-control-providers';
import {
  GitBranch,
  GitCommit,
  GitFileChange,
  GitRemote,
  GitStash,
  GitTag,
  GraphNode,
} from './repository-data';

/**
 * Identifies the synthetic graph node that represents the uncommitted working tree, sitting above the
 * first real commit so staged and unstaged changes have a selectable row in the history graph.
 */
export const WORKING_NODE_ID: string = 'working';

/**
 * The number of commits the history loads for a repository.
 */
const LOG_LIMIT: number = 500;

/**
 * How long, in milliseconds, external on-disk changes are debounced before the repository refreshes,
 * so a burst (a checkout, a build touching many files) refreshes once rather than per file.
 */
const EXTERNAL_REFRESH_DEBOUNCE_MS: number = 500;

/**
 * Specifies the network operations whose outcomes raise a notification toast.
 */
type NetworkOperation = 'fetch' | 'pull' | 'push';

/**
 * The display labels of the network operations, used in their failure toasts.
 */
const NETWORK_OPERATION_LABELS: Readonly<Record<NetworkOperation, string>> = {
  fetch: 'Fetch',
  pull: 'Pull',
  push: 'Push',
};

/**
 * The lane colours, cycled by lane index, that tint the commit-graph edges and nodes. Drawn from the
 * accent palette in `_variables.scss` so the graph reads as part of the application's colour world.
 */
const LANE_COLORS: readonly string[] = ['#5073b8', '#07b39b', '#ef4e7b', '#f79533', '#a166ab'];

/**
 * Holds a lane's expected next commit while the lane-assignment pass walks the history, or null when
 * the lane is free. Indexed by lane number.
 */
type LaneSlots = (string | null)[];

/**
 * Represents the model of a single opened repository surfaced by the source-control view: its
 * branches, remotes, tags, stashes, and commit history, together with the working-tree changes and
 * the user's current selection (commit and file) that drives the detail and diff panes.
 *
 * The data is read from a {@link SourceControlProvider} (git today) bound to the repository's root,
 * and local mutations (stage, unstage, commit, stash) are written back through it. The model is
 * scoped per source-control tab (provided by the view), so several repositories can be open at once.
 * Network operations (push, pull, fetch) arrive in a later slice.
 */
@Service()
export class Repository {
  /**
   * Holds the provider factory used to create a backend for an opened repository root.
   */
  private readonly providers: SourceControlProviders = inject(SourceControlProviders);

  /**
   * Holds the directory-watch service the bound root is subscribed to, so changes made to the working
   * tree (or the repository itself) outside the application refresh the model.
   */
  private readonly directoryWatch: DirectoryWatch = inject(DirectoryWatch);

  /**
   * Holds the application-wide notification store network-operation and commit outcomes are raised
   * to, so they surface as toasts wherever the operation was started from.
   */
  private readonly notifications: Notifications = inject(Notifications);

  /**
   * Holds the disposer of the bound root's directory watch, or null when no repository is bound.
   */
  private watchDisposer: (() => void) | null = null;

  /**
   * Holds the pending debounced external-refresh timer, or null when none is scheduled.
   */
  private externalRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Holds the active provider, or null when no repository is bound.
   */
  private provider: SourceControlProvider | null = null;

  /**
   * Holds the bound repository's metadata, or null when none is bound.
   */
  private readonly infoSignal: WritableSignal<RepositoryInfo | null> =
    signal<RepositoryInfo | null>(null);

  /**
   * Holds a value indicating whether the repository's data is currently loading.
   */
  private readonly loadingSignal: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the local branches.
   */
  private readonly branchesSignal: WritableSignal<readonly GitBranch[]> = signal<
    readonly GitBranch[]
  >([]);

  /**
   * Holds the configured remotes.
   */
  private readonly remotesSignal: WritableSignal<readonly GitRemote[]> = signal<
    readonly GitRemote[]
  >([]);

  /**
   * Holds the tags.
   */
  private readonly tagsSignal: WritableSignal<readonly GitTag[]> = signal<readonly GitTag[]>([]);

  /**
   * Holds the stashes, newest first.
   */
  private readonly stashesSignal: WritableSignal<readonly GitStash[]> = signal<readonly GitStash[]>(
    [],
  );

  /**
   * Holds the commit history, newest first.
   */
  private readonly commitsSignal: WritableSignal<readonly GitCommit[]> = signal<
    readonly GitCommit[]
  >([]);

  /**
   * Holds the staged working-tree changes.
   */
  private readonly stagedSignal: WritableSignal<readonly GitFileChange[]> = signal<
    readonly GitFileChange[]
  >([]);

  /**
   * Holds the unstaged working-tree changes.
   */
  private readonly unstagedSignal: WritableSignal<readonly GitFileChange[]> = signal<
    readonly GitFileChange[]
  >([]);

  /**
   * Holds the lazily-loaded files of each commit, keyed by commit hash.
   */
  private readonly commitFilesSignal: WritableSignal<
    ReadonlyMap<string, readonly GitFileChange[]>
  > = signal<ReadonlyMap<string, readonly GitFileChange[]>>(
    new Map<string, readonly GitFileChange[]>(),
  );

  /**
   * Holds the identifier of the selected graph node (a commit hash or {@link WORKING_NODE_ID}), or
   * null when nothing is selected.
   */
  private readonly selectedNodeSignal: WritableSignal<string | null> = signal<string | null>(
    WORKING_NODE_ID,
  );

  /**
   * Holds the path of the selected file within the selected node, or null to fall back to the node's
   * first file.
   */
  private readonly selectedFileSignal: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds the draft commit message bound to the commit panel and used by the commit action.
   */
  private readonly commitMessageSignal: WritableSignal<string> = signal<string>('');

  /**
   * Holds the error message of the most recent failed operation, or null when the last operation
   * succeeded or the message was dismissed. The source-control view surfaces it as a notice.
   */
  private readonly lastErrorSignal: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Gets the bound repository's metadata, or null when none is bound.
   */
  public readonly info: Signal<RepositoryInfo | null> = this.infoSignal.asReadonly();

  /**
   * Gets a value indicating whether a repository is bound.
   */
  public readonly isBound: Signal<boolean> = computed((): boolean => this.infoSignal() !== null);

  /**
   * Gets a value indicating whether the repository's data is loading.
   */
  public readonly loading: Signal<boolean> = this.loadingSignal.asReadonly();

  /**
   * Gets the repository's display name, or an empty string when none is bound.
   */
  public readonly repoName: Signal<string> = computed((): string => this.infoSignal()?.name ?? '');

  /**
   * Gets the local branches.
   */
  public readonly branches: Signal<readonly GitBranch[]> = this.branchesSignal.asReadonly();

  /**
   * Gets the configured remotes.
   */
  public readonly remotes: Signal<readonly GitRemote[]> = this.remotesSignal.asReadonly();

  /**
   * Gets the tags.
   */
  public readonly tags: Signal<readonly GitTag[]> = this.tagsSignal.asReadonly();

  /**
   * Gets the stashes, newest first.
   */
  public readonly stashes: Signal<readonly GitStash[]> = this.stashesSignal.asReadonly();

  /**
   * Gets the commit history, newest first.
   */
  public readonly commits: Signal<readonly GitCommit[]> = this.commitsSignal.asReadonly();

  /**
   * Gets the staged working-tree changes.
   */
  public readonly staged: Signal<readonly GitFileChange[]> = this.stagedSignal.asReadonly();

  /**
   * Gets the unstaged working-tree changes.
   */
  public readonly unstaged: Signal<readonly GitFileChange[]> = this.unstagedSignal.asReadonly();

  /**
   * Gets the identifier of the selected graph node, or null when nothing is selected.
   */
  public readonly selectedNodeId: Signal<string | null> = this.selectedNodeSignal.asReadonly();

  /**
   * Gets the current branch, or undefined when the head is detached or no repository is bound.
   */
  public readonly currentBranch: Signal<GitBranch | undefined> = computed(
    (): GitBranch | undefined =>
      this.branchesSignal().find((branch: GitBranch): boolean => branch.current),
  );

  /**
   * Gets the total number of changed files in the working tree (staged and unstaged).
   */
  public readonly changeCount: Signal<number> = computed(
    (): number => this.stagedSignal().length + this.unstagedSignal().length,
  );

  /**
   * Gets the commit-graph rows: the optional working-tree node followed by every commit, each
   * resolved to a lane, colour, and the edges that connect it to its parents.
   */
  public readonly graph: Signal<readonly GraphNode[]> = computed((): readonly GraphNode[] =>
    this.buildGraph(this.commitsSignal(), this.changeCount() > 0),
  );

  /**
   * Gets the selected commit, or null when the working tree (or nothing) is selected.
   */
  public readonly selectedCommit: Signal<GitCommit | null> = computed((): GitCommit | null => {
    const id: string | null = this.selectedNodeSignal();
    if (id === null || id === WORKING_NODE_ID) {
      return null;
    }
    return this.commitsSignal().find((commit: GitCommit): boolean => commit.hash === id) ?? null;
  });

  /**
   * Gets the changed files for the selected node: the selected commit's lazily-loaded files, or the
   * merged working tree (staged then unstaged) when the working node is selected.
   */
  public readonly selectedFiles: Signal<readonly GitFileChange[]> = computed(
    (): readonly GitFileChange[] => {
      const id: string | null = this.selectedNodeSignal();
      if (id === WORKING_NODE_ID) {
        return [...this.stagedSignal(), ...this.unstagedSignal()];
      }
      if (id === null) {
        return [];
      }
      return this.commitFilesSignal().get(id) ?? [];
    },
  );

  /**
   * Gets the file whose diff is shown, defaulting to the first file of the selected node when no file
   * has been explicitly chosen.
   */
  public readonly selectedFile: Signal<GitFileChange | null> = computed(
    (): GitFileChange | null => {
      const files: readonly GitFileChange[] = this.selectedFiles();
      if (files.length === 0) {
        return null;
      }
      const path: string | null = this.selectedFileSignal();
      return files.find((file: GitFileChange): boolean => file.path === path) ?? files[0];
    },
  );

  /**
   * Gets a value indicating whether the working-tree node is selected.
   */
  public readonly isWorkingSelected: Signal<boolean> = computed(
    (): boolean => this.selectedNodeSignal() === WORKING_NODE_ID,
  );

  /**
   * Gets the draft commit message.
   */
  public readonly commitMessage: Signal<string> = this.commitMessageSignal.asReadonly();

  /**
   * Gets the error message of the most recent failed operation, or null when there is none to show.
   */
  public readonly lastError: Signal<string | null> = this.lastErrorSignal.asReadonly();

  /**
   * Binds the repository to an opened root, creating its provider, loading its data, and watching the
   * root so on-disk changes made outside the application keep the status current.
   * @param info The opened repository's metadata.
   */
  public bind(info: RepositoryInfo): void {
    this.provider = this.providers.create(info.root);
    this.infoSignal.set(info);
    this.selectedNodeSignal.set(WORKING_NODE_ID);
    this.selectedFileSignal.set(null);
    this.watchDisposer?.();
    this.watchDisposer = this.directoryWatch.watch(info.root, (): void =>
      this.scheduleExternalRefresh(),
    );
    void this.refresh();
  }

  /**
   * Schedules a coalesced refresh in response to external on-disk changes, so a burst of changes (a
   * checkout, a build) refreshes the repository once rather than per file. The window is not extended
   * by further events — continuous churn refreshes at this cadence instead of starving. The
   * application's own git reads never re-enter here: the main process runs them with optional index
   * writes disabled, so a refresh leaves the repository untouched on disk.
   */
  private scheduleExternalRefresh(): void {
    if (this.externalRefreshTimer !== null) {
      return;
    }
    this.externalRefreshTimer = setTimeout((): void => {
      this.externalRefreshTimer = null;
      void this.refresh();
    }, EXTERNAL_REFRESH_DEBOUNCE_MS);
  }

  /**
   * Releases the repository, freeing its provider and clearing its data.
   * @returns Returns a promise that resolves once the repository has been released.
   */
  public async close(): Promise<void> {
    this.watchDisposer?.();
    this.watchDisposer = null;
    if (this.externalRefreshTimer !== null) {
      clearTimeout(this.externalRefreshTimer);
      this.externalRefreshTimer = null;
    }
    const provider: SourceControlProvider | null = this.provider;
    this.provider = null;
    this.infoSignal.set(null);
    this.branchesSignal.set([]);
    this.remotesSignal.set([]);
    this.tagsSignal.set([]);
    this.stashesSignal.set([]);
    this.commitsSignal.set([]);
    this.stagedSignal.set([]);
    this.unstagedSignal.set([]);
    this.commitFilesSignal.set(new Map<string, readonly GitFileChange[]>());
    this.commitMessageSignal.set('');
    await (provider?.close() ?? Promise.resolve());
  }

  /**
   * Reloads the repository's status, history, refs, and stashes from the provider.
   * @returns Returns a promise that resolves once the data has been reloaded.
   */
  public async refresh(): Promise<void> {
    const provider: SourceControlProvider | null = this.provider;
    if (provider === null) {
      return;
    }
    this.loadingSignal.set(true);
    try {
      const [status, commits, refs, stashes]: [
        ParsedStatus,
        readonly GitCommit[],
        ParsedRefs,
        readonly GitStash[],
      ] = await Promise.all([
        provider.getStatus(),
        provider.getCommits(LOG_LIMIT),
        provider.getRefs(),
        provider.getStashes(),
      ]);
      // Ignore a response that arrived after the repository was closed or rebound.
      if (this.provider !== provider) {
        return;
      }
      this.stagedSignal.set(status.staged);
      this.unstagedSignal.set(status.unstaged);
      this.commitsSignal.set(commits);
      this.branchesSignal.set(refs.branches);
      this.remotesSignal.set(refs.remotes);
      this.tagsSignal.set(refs.tags);
      this.stashesSignal.set(stashes);
      this.commitFilesSignal.set(new Map<string, readonly GitFileChange[]>());
    } finally {
      if (this.provider === provider) {
        this.loadingSignal.set(false);
      }
    }
  }

  /**
   * Selects a graph node (a commit hash or {@link WORKING_NODE_ID}), resetting the file selection and
   * lazily loading the commit's files the first time it is selected.
   * @param nodeId The identifier of the node to select.
   */
  public selectNode(nodeId: string): void {
    this.selectedNodeSignal.set(nodeId);
    this.selectedFileSignal.set(null);
    if (nodeId !== WORKING_NODE_ID && !this.commitFilesSignal().has(nodeId)) {
      void this.loadCommitFiles(nodeId);
    }
  }

  /**
   * Selects a file within the selected node, driving the diff surface.
   * @param path The path of the file to select.
   */
  public selectFile(path: string): void {
    this.selectedFileSignal.set(path);
  }

  /**
   * Loads the two sides of a changed file's diff through the provider.
   * @param file The changed file.
   * @returns Returns the diff content (empty when no repository is bound).
   */
  public loadDiff(file: GitFileChange): Promise<FileDiff> {
    return (
      this.provider?.getFileDiff(file) ??
      Promise.resolve({ original: file.original, modified: file.modified })
    );
  }

  /**
   * Sets the draft commit message.
   * @param message The new draft message.
   */
  public setCommitMessage(message: string): void {
    this.commitMessageSignal.set(message);
  }

  /**
   * Discards a single file's uncommitted changes — restoring a tracked file to `HEAD`, deleting an
   * untracked one — then reloads. Destructive; the caller confirms first.
   * @param file The file whose changes are discarded.
   * @returns Returns the outcome.
   */
  public discard(file: GitFileChange): Promise<MutationResult> {
    return this.discardFiles([file]);
  }

  /**
   * Discards several files' uncommitted changes in one command — restoring tracked files to `HEAD`,
   * deleting untracked ones — then reloads once. Destructive; the caller confirms first. Discarding
   * nothing succeeds without touching the provider, so a caller need not guard an empty selection.
   * @param files The files whose changes are discarded.
   * @returns Returns the outcome.
   */
  public discardFiles(files: readonly GitFileChange[]): Promise<MutationResult> {
    if (files.length === 0) {
      return Promise.resolve({ success: true });
    }
    const paths: readonly string[] = files.map((file: GitFileChange): string => file.path);
    return this.mutate(
      (provider: SourceControlProvider): Promise<MutationResult> => provider.discard(paths),
    );
  }

  /**
   * Clears the surfaced error from the most recent operation.
   */
  public dismissError(): void {
    this.lastErrorSignal.set(null);
  }

  /**
   * Stages a single changed file, then reloads.
   * @param file The file to stage.
   * @returns Returns the outcome.
   */
  public stage(file: GitFileChange): Promise<MutationResult> {
    return this.mutate(
      (provider: SourceControlProvider): Promise<MutationResult> => provider.stage([file.path]),
    );
  }

  /**
   * Stages every change, then reloads.
   * @returns Returns the outcome.
   */
  public stageAll(): Promise<MutationResult> {
    return this.mutate(
      (provider: SourceControlProvider): Promise<MutationResult> => provider.stage([]),
    );
  }

  /**
   * Unstages a single changed file, then reloads.
   * @param file The file to unstage.
   * @returns Returns the outcome.
   */
  public unstage(file: GitFileChange): Promise<MutationResult> {
    return this.mutate(
      (provider: SourceControlProvider): Promise<MutationResult> => provider.unstage([file.path]),
    );
  }

  /**
   * Unstages every change, then reloads.
   * @returns Returns the outcome.
   */
  public unstageAll(): Promise<MutationResult> {
    return this.mutate(
      (provider: SourceControlProvider): Promise<MutationResult> => provider.unstage([]),
    );
  }

  /**
   * Commits the staged changes with the draft message, clearing the draft on success, then reloads.
   * A successful commit raises a toast offering to push it.
   * @returns Returns the outcome.
   */
  public async commit(): Promise<MutationResult> {
    const result: MutationResult = await this.mutate(
      (provider: SourceControlProvider): Promise<MutationResult> =>
        provider.commit(this.commitMessageSignal()),
    );
    if (result.success) {
      this.commitMessageSignal.set('');
      this.notifyCommitted();
    }
    return result;
  }

  /**
   * Commits exactly the given files with the draft message: the index is reset, the files are staged
   * (adding any untracked ones), and the result is committed. The draft is cleared on success and a
   * toast offers to push the commit. A failure part-way leaves the index reflecting the attempted
   * selection; the surfaced error explains what failed and a refresh keeps the panel truthful.
   * @param paths The repository-relative paths to commit; must not be empty.
   * @returns Returns the outcome.
   */
  public async commitFiles(paths: readonly string[]): Promise<MutationResult> {
    const result: MutationResult = await this.performCommitFiles(paths);
    if (result.success) {
      this.notifyCommitted();
    }
    return result;
  }

  /**
   * Commits exactly the given files with the draft message, then pushes the current branch. The push
   * only runs when the commit succeeded, and only the push outcome raises a toast — offering to push
   * a commit already being pushed would be noise.
   * @param paths The repository-relative paths to commit; must not be empty.
   * @returns Returns the outcome of the push, or of the commit when it failed.
   */
  public async commitAndPushFiles(paths: readonly string[]): Promise<MutationResult> {
    const committed: MutationResult = await this.performCommitFiles(paths);
    if (!committed.success) {
      return committed;
    }
    return this.push();
  }

  /**
   * Runs the selective commit shared by {@link commitFiles} and {@link commitAndPushFiles}: the
   * index is reset, the files are staged (adding any untracked ones), the result is committed, and
   * the draft is cleared on success.
   * @param paths The repository-relative paths to commit; must not be empty.
   * @returns Returns the outcome.
   */
  private async performCommitFiles(paths: readonly string[]): Promise<MutationResult> {
    if (paths.length === 0) {
      return { success: false, error: 'No files are selected to commit' };
    }
    const result: MutationResult = await this.mutate(
      async (provider: SourceControlProvider): Promise<MutationResult> => {
        const reset: MutationResult = await provider.unstage([]);
        if (!reset.success) {
          return reset;
        }
        const add: MutationResult = await provider.stage([...paths]);
        if (!add.success) {
          return add;
        }
        return provider.commit(this.commitMessageSignal());
      },
    );
    if (result.success) {
      this.commitMessageSignal.set('');
    }
    return result;
  }

  /**
   * Stashes the working-tree changes, then reloads.
   * @returns Returns the outcome.
   */
  public stash(): Promise<MutationResult> {
    return this.mutate(
      (provider: SourceControlProvider): Promise<MutationResult> => provider.stash(),
    );
  }

  /**
   * Checks out an existing branch, then reloads and selects the working tree.
   * @param branch The branch name.
   * @returns Returns the outcome.
   */
  public async checkout(branch: string): Promise<MutationResult> {
    const result: MutationResult = await this.mutate(
      (provider: SourceControlProvider): Promise<MutationResult> => provider.checkout(branch),
    );
    if (result.success) {
      this.selectNode(WORKING_NODE_ID);
    }
    return result;
  }

  /**
   * Restores a stash onto the working tree, keeping it on the stack, then reloads and selects the
   * working tree so the restored changes are what the user is looking at.
   * @param index The stack index of the stash (0 is the most recent).
   * @returns Returns the outcome.
   */
  public applyStash(index: number): Promise<MutationResult> {
    return this.restoreStash(
      (provider: SourceControlProvider): Promise<MutationResult> => provider.applyStash(index),
    );
  }

  /**
   * Restores a stash onto the working tree and drops it from the stack, then reloads and selects the
   * working tree.
   * @param index The stack index of the stash (0 is the most recent).
   * @returns Returns the outcome.
   */
  public popStash(index: number): Promise<MutationResult> {
    return this.restoreStash(
      (provider: SourceControlProvider): Promise<MutationResult> => provider.popStash(index),
    );
  }

  /**
   * Deletes a stash without restoring it, then reloads. Destructive; the caller confirms first.
   * @param index The stack index of the stash (0 is the most recent).
   * @returns Returns the outcome.
   */
  public dropStash(index: number): Promise<MutationResult> {
    return this.mutate(
      (provider: SourceControlProvider): Promise<MutationResult> => provider.dropStash(index),
    );
  }

  /**
   * Runs a stash restore, selecting the working tree on success: the point of restoring a stash is to
   * work on what it brought back, so the panel follows the changes rather than leaving the user on
   * whatever commit they had selected.
   * @param restore The restore operation to run.
   * @returns Returns the outcome.
   */
  private async restoreStash(
    restore: (provider: SourceControlProvider) => Promise<MutationResult>,
  ): Promise<MutationResult> {
    const result: MutationResult = await this.mutate(restore);
    if (result.success) {
      this.selectNode(WORKING_NODE_ID);
    }
    return result;
  }

  /**
   * Creates a branch at the current head, optionally checking it out, then reloads.
   * @param name The new branch name.
   * @param checkout Whether to check the new branch out; when false the current branch stays checked
   * out and only the branch list changes.
   * @returns Returns the outcome.
   */
  public createBranch(name: string, checkout: boolean = true): Promise<MutationResult> {
    return this.mutate(
      (provider: SourceControlProvider): Promise<MutationResult> =>
        provider.createBranch(name, checkout),
    );
  }

  /**
   * Fetches all remotes, then reloads so ahead/behind and remote refs update. The outcome raises a
   * toast.
   * @returns Returns the outcome.
   */
  public async fetch(): Promise<MutationResult> {
    const result: MutationResult = await this.mutate(
      (provider: SourceControlProvider): Promise<MutationResult> => provider.fetch(),
    );
    this.notifyNetworkOutcome('fetch', result);
    return result;
  }

  /**
   * Pulls the current branch from its upstream, then reloads. The outcome raises a toast.
   * @returns Returns the outcome.
   */
  public async pull(): Promise<MutationResult> {
    const result: MutationResult = await this.mutate(
      (provider: SourceControlProvider): Promise<MutationResult> => provider.pull(),
    );
    this.notifyNetworkOutcome('pull', result);
    return result;
  }

  /**
   * Pushes the current branch, then reloads. A branch with no upstream is pushed with its upstream
   * set to the first configured remote (defaulting to `origin`), so a freshly-created branch publishes
   * without a separate step. The outcome raises a toast.
   * @returns Returns the outcome.
   */
  public async push(): Promise<MutationResult> {
    const branch: GitBranch | undefined = this.currentBranch();
    const setUpstream: { readonly remote: string; readonly branch: string } | undefined =
      branch !== undefined && branch.upstream === undefined
        ? { remote: this.remotesSignal()[0]?.name ?? 'origin', branch: branch.name }
        : undefined;
    const result: MutationResult = await this.mutate(
      (provider: SourceControlProvider): Promise<MutationResult> => provider.push(setUpstream),
    );
    this.notifyNetworkOutcome('push', result);
    return result;
  }

  /**
   * Runs a mutating operation against the provider and reloads the repository on success.
   * @param op Invokes the desired provider mutation.
   * @returns Returns the outcome (a failure when no repository is bound).
   */
  private async mutate(
    op: (provider: SourceControlProvider) => Promise<MutationResult>,
  ): Promise<MutationResult> {
    const provider: SourceControlProvider | null = this.provider;
    if (provider === null) {
      return { success: false, error: 'No repository open' };
    }
    const result: MutationResult = await op(provider);
    this.lastErrorSignal.set(result.success ? null : (result.error ?? 'The operation failed.'));
    if (result.success) {
      await this.refresh();
    }
    return result;
  }

  /**
   * Raises a toast for a network operation's outcome. Success and failure share a coalescing key, so
   * a retried operation's fresh outcome replaces the stale toast instead of stacking beside it.
   * @param operation The finished operation.
   * @param result The operation's outcome.
   */
  private notifyNetworkOutcome(operation: NetworkOperation, result: MutationResult): void {
    if (result.success) {
      this.notifyNetworkSuccess(operation);
    } else {
      this.notifyNetworkFailure(operation, result.error);
    }
  }

  /**
   * Raises the transient toast reporting a successful network operation.
   * @param operation The finished operation.
   */
  private notifyNetworkSuccess(operation: NetworkOperation): void {
    const branch: string = this.currentBranch()?.name ?? 'HEAD';
    const titles: Readonly<Record<NetworkOperation, string>> = {
      fetch: 'Fetched all remotes',
      pull: `Pulled ${branch}`,
      push: `Pushed ${branch}`,
    };
    this.notifications.notify({
      severity: operation === 'fetch' ? 'info' : 'success',
      title: titles[operation],
      detail: this.repoName(),
      key: this.notificationKey(operation),
    });
  }

  /**
   * Raises the sticky error toast reporting a failed network operation, so an auth or conflict
   * failure never vanishes silently — whichever surface the operation was started from.
   * @param operation The failed operation.
   * @param error The failure detail, when the provider supplied one.
   */
  private notifyNetworkFailure(operation: NetworkOperation, error: string | undefined): void {
    const label: string = NETWORK_OPERATION_LABELS[operation];
    const repo: string = this.repoName();
    this.notifications.notify({
      severity: 'error',
      title: repo === '' ? `${label} failed` : `${label} failed — ${repo}`,
      detail: error,
      key: this.notificationKey(operation),
    });
  }

  /**
   * Raises the toast reporting a successful commit, offering to push it when the repository has a
   * remote to push to.
   */
  private notifyCommitted(): void {
    const branch: string = this.currentBranch()?.name ?? 'HEAD';
    const actions: readonly NotificationAction[] =
      this.remotesSignal().length > 0 ? [{ label: 'Push', run: (): void => void this.push() }] : [];
    this.notifications.notify({
      severity: 'success',
      title: `Committed to ${branch}`,
      detail: this.repoName(),
      actions,
      key: this.notificationKey('commit'),
    });
  }

  /**
   * Builds an operation's toast-coalescing key, scoped to the bound root so several open
   * repositories never coalesce each other's outcomes.
   * @param operation The operation the key identifies.
   * @returns Returns the coalescing key.
   */
  private notificationKey(operation: string): string {
    return `source-control:${operation}:${this.infoSignal()?.root ?? ''}`;
  }

  /**
   * Loads a commit's files from the provider and caches them.
   * @param hash The commit hash.
   * @returns Returns a promise that resolves once the files have been loaded.
   */
  private async loadCommitFiles(hash: string): Promise<void> {
    const provider: SourceControlProvider | null = this.provider;
    const commit: GitCommit | undefined = this.commitsSignal().find(
      (candidate: GitCommit): boolean => candidate.hash === hash,
    );
    if (provider === null || commit === undefined) {
      return;
    }
    const files: GitFileChange[] = await provider.getCommitFiles(commit);
    if (this.provider !== provider) {
      return;
    }
    this.commitFilesSignal.update(
      (
        current: ReadonlyMap<string, readonly GitFileChange[]>,
      ): ReadonlyMap<string, readonly GitFileChange[]> =>
        new Map<string, readonly GitFileChange[]>(current).set(hash, files),
    );
  }

  /**
   * Builds the commit-graph rows from the history, assigning each commit a lane and resolving the
   * edges to its parents. When the working tree is dirty, a synthetic node is prepended on the tip's
   * lane so uncommitted changes are selectable in the graph.
   * @param commits The commit history, newest first.
   * @param hasWorking Whether the working tree has changes worth a node.
   * @returns Returns the ordered graph rows.
   */
  private buildGraph(commits: readonly GitCommit[], hasWorking: boolean): readonly GraphNode[] {
    const placement: Map<string, { lane: number; color: string }> = this.assignLanes(commits);
    const rowOffset: number = hasWorking ? 1 : 0;
    const rowOf: Map<string, number> = new Map<string, number>(
      commits.map((commit: GitCommit, index: number): [string, number] => [
        commit.hash,
        index + rowOffset,
      ]),
    );

    const nodes: GraphNode[] = commits.map((commit: GitCommit, index: number): GraphNode => {
      const place: { lane: number; color: string } = placement.get(commit.hash) ?? {
        lane: 0,
        color: LANE_COLORS[0],
      };
      const edges: GraphNode['edges'] = commit.parents
        .map((parentHash: string): GraphNode['edges'][number] | null => {
          const parentRow: number | undefined = rowOf.get(parentHash);
          const parentPlace: { lane: number; color: string } | undefined =
            placement.get(parentHash);
          if (parentRow === undefined || parentPlace === undefined) {
            return null;
          }
          return { toRow: parentRow, toLane: parentPlace.lane, color: parentPlace.color };
        })
        .filter(
          (edge: GraphNode['edges'][number] | null): edge is GraphNode['edges'][number] =>
            edge !== null,
        );

      return {
        id: commit.hash,
        kind: 'commit',
        row: index + rowOffset,
        lane: place.lane,
        color: place.color,
        commit,
        refs: commit.refs,
        edges,
      };
    });

    if (!hasWorking) {
      return nodes;
    }

    const tip: GraphNode | undefined = nodes[0];
    const workingNode: GraphNode = {
      id: WORKING_NODE_ID,
      kind: 'working',
      row: 0,
      lane: tip?.lane ?? 0,
      color: tip?.color ?? LANE_COLORS[0],
      commit: null,
      refs: [],
      edges: tip === undefined ? [] : [{ toRow: tip.row, toLane: tip.lane, color: tip.color }],
    };
    return [workingNode, ...nodes];
  }

  /**
   * Assigns each commit a lane and colour using the standard descending-history sweep: a commit takes
   * the lane that expects it (or a fresh lane), its first parent inherits that lane, and any further
   * parents (a merge) open new lanes.
   * @param commits The commit history, newest first.
   * @returns Returns a map of commit hash to its lane and colour.
   */
  private assignLanes(commits: readonly GitCommit[]): Map<string, { lane: number; color: string }> {
    const placement: Map<string, { lane: number; color: string }> = new Map<
      string,
      { lane: number; color: string }
    >();
    const lanes: LaneSlots = [];

    const allocate: (hash: string) => number = (hash: string): number => {
      const free: number = lanes.indexOf(null);
      if (free !== -1) {
        lanes[free] = hash;
        return free;
      }
      lanes.push(hash);
      return lanes.length - 1;
    };

    for (const commit of commits) {
      let lane: number = lanes.indexOf(commit.hash);
      if (lane === -1) {
        lane = allocate(commit.hash);
      }
      for (let other: number = 0; other < lanes.length; other++) {
        if (other !== lane && lanes[other] === commit.hash) {
          lanes[other] = null;
        }
      }
      placement.set(commit.hash, { lane, color: LANE_COLORS[lane % LANE_COLORS.length] });

      const [first, ...rest]: readonly string[] = commit.parents;
      lanes[lane] = first ?? null;
      for (const parent of rest) {
        if (!lanes.includes(parent)) {
          allocate(parent);
        }
      }
    }

    return placement;
  }
}
