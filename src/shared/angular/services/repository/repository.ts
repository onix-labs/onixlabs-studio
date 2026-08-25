import { computed, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { DirectoryChangeEvent } from '@shared/api/file-channels';
import {
  GitMergeMode,
  GitOperationState,
  RepositoryInfo,
  SourceControlCode,
} from '@shared/api/source-control-channels';
import { DirectoryWatch } from '@shared/angular/services/directory-watch/directory-watch';
import { Log } from '@shared/angular/services/log/log';
import {
  NotificationAction,
  Notifications,
} from '@shared/angular/services/notifications/notifications';
import {
  FileDiff,
  MutationResult,
  PushTarget,
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
type NetworkOperation =
  | 'fetch'
  | 'fetch-remote'
  | 'prune-remote'
  | 'pull'
  | 'push'
  | 'sync'
  | 'push-tags'
  | 'delete-remote-tag';

/**
 * The display labels of the network operations, used in their failure toasts.
 */
const NETWORK_OPERATION_LABELS: Readonly<Record<NetworkOperation, string>> = {
  fetch: 'Fetch',
  'fetch-remote': 'Fetch',
  'prune-remote': 'Prune',
  pull: 'Pull',
  push: 'Push',
  sync: 'Sync',
  'push-tags': 'Push tags',
  'delete-remote-tag': 'Remote tag delete',
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
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the disposer of the bound root's directory watch, or null when no repository is bound.
   */
  private watchDisposer: (() => void) | null = null;

  /**
   * Holds the pending debounced external-refresh timer, or null when none is scheduled.
   */
  private externalRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Holds the strongest refresh kind accumulated for the pending debounce window, or null when none
   * is pending. A burst that touched `.git` needs the full reload (history, refs, stashes); pure
   * working-tree churn needs only a status pass.
   */
  private pendingExternalKind: 'status' | 'full' | null = null;

  /**
   * Holds whether an external refresh is currently running, so bursts can never stack overlapping
   * git processes — on a large working tree a status alone can outlast the debounce window.
   */
  private externalRefreshRunning: boolean = false;

  /**
   * Holds the strongest refresh kind that arrived while a refresh was running, replayed once it
   * finishes, or null when none did.
   */
  private externalDirtyKind: 'status' | 'full' | null = null;

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
   * Holds the paths left conflicted by an unfinished merge or rebase.
   */
  private readonly conflictedSignal: WritableSignal<readonly GitFileChange[]> = signal<
    readonly GitFileChange[]
  >([]);

  /**
   * Holds the multi-step operation the working tree is in the middle of.
   */
  private readonly operationSignal: WritableSignal<GitOperationState> = signal<GitOperationState>({
    kind: null,
  });

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
   * Gets the paths left conflicted by an unfinished merge or rebase.
   */
  public readonly conflicted: Signal<readonly GitFileChange[]> = this.conflictedSignal.asReadonly();

  /**
   * Gets the multi-step operation the working tree is in the middle of, whose kind is null when it is
   * in none.
   */
  public readonly operation: Signal<GitOperationState> = this.operationSignal.asReadonly();

  /**
   * Gets a value indicating whether an operation is in flight — whether, in other words, the working
   * tree is somewhere git expects to be told how to leave.
   */
  public readonly operationInFlight: Signal<boolean> = computed(
    (): boolean => this.operationSignal().kind !== null,
  );

  /**
   * Gets a value indicating whether the operation in flight can be carried on from here: every
   * conflict it raised has been resolved. Continuing with one outstanding is a refusal waiting to
   * happen, so the surfaces offer it only when this holds.
   */
  public readonly canContinueOperation: Signal<boolean> = computed(
    (): boolean => this.operationSignal().kind !== null && this.conflictedSignal().length === 0,
  );

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
   * Gets the total number of changed files in the working tree (staged, unstaged, and conflicted).
   * A conflicted path counts: it is a file the working tree is carrying that the last commit does not
   * have, which is what the tally means, and leaving it out would report a repository mid-merge as
   * having nothing going on.
   */
  public readonly changeCount: Signal<number> = computed(
    (): number =>
      this.stagedSignal().length + this.unstagedSignal().length + this.conflictedSignal().length,
  );

  /**
   * Gets the commit-graph rows: every commit, each resolved to a lane, colour, and the edges that
   * connect it to its parents.
   *
   * The history is history. The working tree used to lead it as a synthetic row, which put the
   * uncommitted changes in two places at once — the checked-out branch already carries them in the
   * Repository panel, which is where they belong, since they belong to the branch they sit on.
   */
  public readonly graph: Signal<readonly GraphNode[]> = computed((): readonly GraphNode[] =>
    this.buildGraph(this.commitsSignal()),
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
    this.log.info('Repository', `Opened repository '${info.name}'`, info.root);
    this.provider = this.providers.create(info.root);
    this.infoSignal.set(info);
    this.selectedNodeSignal.set(WORKING_NODE_ID);
    this.selectedFileSignal.set(null);
    this.watchDisposer?.();
    this.watchDisposer = this.directoryWatch.watch(info.root, (event: DirectoryChangeEvent): void =>
      this.scheduleExternalRefresh(this.classifyBurst(info.root, event)),
    );
    void this.refresh();
  }

  /**
   * Classifies a change burst by the refresh it needs: anything touching `.git` (a commit, a branch
   * switch, new refs) or an overflow needs the full reload; pure working-tree churn only moves the
   * status, so history, refs, and stashes need not be re-read (or their graph rebuilt) for it.
   * @param root The repository root.
   * @param event The change burst.
   * @returns Returns the refresh kind the burst needs.
   */
  private classifyBurst(root: string, event: DirectoryChangeEvent): 'status' | 'full' {
    if (event.overflow) {
      return 'full';
    }
    const gitDirectory: string = `${root.replaceAll('\\', '/')}/.git`;
    const touchesGit: boolean = event.directories.some((directory: string): boolean => {
      const normalized: string = directory.replaceAll('\\', '/');
      return normalized === gitDirectory || normalized.startsWith(`${gitDirectory}/`);
    });
    return touchesGit ? 'full' : 'status';
  }

  /**
   * Schedules a coalesced refresh in response to external on-disk changes, so a burst of changes (a
   * checkout, a build) refreshes the repository once rather than per file. The window is not extended
   * by further events — continuous churn refreshes at this cadence instead of starving — and the
   * strongest kind the window accumulated wins. The application's own git reads never re-enter here:
   * the main process runs them with optional index writes disabled, so a refresh leaves the
   * repository untouched on disk.
   * @param kind The refresh kind the triggering burst needs.
   */
  private scheduleExternalRefresh(kind: 'status' | 'full'): void {
    this.pendingExternalKind =
      kind === 'full' || this.pendingExternalKind === 'full' ? 'full' : 'status';
    if (this.externalRefreshTimer !== null) {
      return;
    }
    this.externalRefreshTimer = setTimeout((): void => {
      this.externalRefreshTimer = null;
      const pending: 'status' | 'full' = this.pendingExternalKind ?? 'status';
      this.pendingExternalKind = null;
      this.log.debug('Repository', `External change refresh (${pending})`, this.infoSignal()?.root);
      void this.runExternalRefresh(pending);
    }, EXTERNAL_REFRESH_DEBOUNCE_MS);
  }

  /**
   * Runs one external refresh at a time: a kind arriving mid-refresh is remembered (strongest wins)
   * and replayed once the running refresh settles, so sustained churn can never pile up concurrent
   * git processes no matter how slow the repository is.
   * @param kind The refresh kind to run.
   * @returns Returns a promise that resolves once the refresh (and any replay) has started settling.
   */
  private async runExternalRefresh(kind: 'status' | 'full'): Promise<void> {
    if (this.externalRefreshRunning) {
      this.externalDirtyKind =
        kind === 'full' || this.externalDirtyKind === 'full' ? 'full' : 'status';
      return;
    }
    this.externalRefreshRunning = true;
    try {
      if (kind === 'full') {
        await this.refresh();
      } else {
        await this.refreshStatus();
      }
    } finally {
      this.externalRefreshRunning = false;
      const dirty: 'status' | 'full' | null = this.externalDirtyKind;
      this.externalDirtyKind = null;
      if (dirty !== null) {
        void this.runExternalRefresh(dirty);
      }
    }
  }

  /**
   * Reloads only the working-tree status (staged and unstaged changes) from the provider — the cheap
   * pass for bursts that touched no `.git` state. A response arriving after the repository was closed
   * or rebound is discarded.
   * @returns Returns a promise that resolves once the status has been reloaded.
   */
  public async refreshStatus(): Promise<void> {
    const provider: SourceControlProvider | null = this.provider;
    if (provider === null) {
      return;
    }
    // The operation state is read on the cheap pass as well as the full one, and deliberately.
    // Resolving a conflict means editing a file, which is pure working-tree churn — so if this pass
    // did not look, the last conflict could be settled and the panel would go on saying the merge was
    // stuck on it until something happened to touch `.git`.
    const [status, operation]: [ParsedStatus, GitOperationState] = await Promise.all([
      provider.getStatus(),
      provider.getOperationState(),
    ]);
    if (this.provider !== provider) {
      return;
    }
    this.stagedSignal.set(status.staged);
    this.unstagedSignal.set(status.unstaged);
    this.conflictedSignal.set(status.conflicted);
    this.operationSignal.set(operation);
  }

  /**
   * Releases the repository, freeing its provider and clearing its data.
   * @returns Returns a promise that resolves once the repository has been released.
   */
  public async close(): Promise<void> {
    this.log.info('Repository', 'Closed repository', this.infoSignal()?.root);
    this.watchDisposer?.();
    this.watchDisposer = null;
    if (this.externalRefreshTimer !== null) {
      clearTimeout(this.externalRefreshTimer);
      this.externalRefreshTimer = null;
    }
    this.pendingExternalKind = null;
    this.externalDirtyKind = null;
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
    this.conflictedSignal.set([]);
    this.operationSignal.set({ kind: null });
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
    this.log.trace('Repository', 'Refreshing repository data', this.infoSignal()?.root);
    try {
      const [status, commits, refs, stashes, operation]: [
        ParsedStatus,
        readonly GitCommit[],
        ParsedRefs,
        readonly GitStash[],
        GitOperationState,
      ] = await Promise.all([
        provider.getStatus(),
        provider.getCommits(LOG_LIMIT),
        provider.getRefs(),
        provider.getStashes(),
        provider.getOperationState(),
      ]);
      // Ignore a response that arrived after the repository was closed or rebound.
      if (this.provider !== provider) {
        return;
      }
      this.stagedSignal.set(status.staged);
      this.unstagedSignal.set(status.unstaged);
      this.conflictedSignal.set(status.conflicted);
      this.operationSignal.set(operation);
      this.commitsSignal.set(commits);
      this.branchesSignal.set(refs.branches);
      this.remotesSignal.set(refs.remotes);
      this.tagsSignal.set(refs.tags);
      this.stashesSignal.set(stashes);
      this.commitFilesSignal.set(new Map<string, readonly GitFileChange[]>());
      this.log.info(
        'Repository',
        `Refreshed (${commits.length} commits, ${status.staged.length} staged, ${status.unstaged.length} unstaged)`,
        this.infoSignal()?.root,
      );
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
    this.log.info('Repository', `Discarding ${paths.length} file(s)`, ...paths);
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
    this.log.trace('Repository', `Staging '${file.path}'`);
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
    this.log.trace('Repository', `Unstaging '${file.path}'`);
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
    this.log.info('Repository', 'Stashing working-tree changes', this.infoSignal()?.root);
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
    this.log.info('Repository', `Checking out branch '${branch}'`, this.infoSignal()?.root);
    const result: MutationResult = await this.mutate(
      (provider: SourceControlProvider): Promise<MutationResult> => provider.checkout(branch),
    );
    if (result.success) {
      this.selectNode(WORKING_NODE_ID);
    }
    return result;
  }

  /**
   * Fetches a pull request's head into a local branch and checks it out.
   *
   * Fetching the forge's own head ref rather than checking out a branch name is what makes this work
   * for a pull request opened from a fork: the contributor's branch exists in their repository, not
   * in this one, so there is no branch of that name here to check out — but the forge publishes the
   * head under a ref on this remote either way.
   *
   * @param remote The remote the pull request's head is published on.
   * @param sourceRef The ref carrying the head (GitHub publishes `refs/pull/N/head`).
   * @param localBranch The local branch to create or update.
   * @returns Returns the outcome.
   */
  public async checkoutRef(
    remote: string,
    sourceRef: string,
    localBranch: string,
  ): Promise<MutationResult> {
    this.log.info('Repository', `Checking out '${sourceRef}' as '${localBranch}'`);
    const fetched: MutationResult = await this.mutate(
      (provider: SourceControlProvider): Promise<MutationResult> =>
        provider.fetchRef(remote, sourceRef, localBranch),
    );
    if (!fetched.success) {
      return fetched;
    }
    return this.checkout(localBranch);
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
    this.log.info('Repository', `Creating branch '${name}' (checkout: ${checkout})`);
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
    this.log.info('Repository', 'Fetching all remotes', this.infoSignal()?.root);
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
    const result: MutationResult = await this.runPull();
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
    const result: MutationResult = await this.runPush();
    this.notifyNetworkOutcome('push', result);
    return result;
  }

  /**
   * Pulls and then pushes the current branch, so a branch that has moved on both sides is squared up
   * in one command rather than two.
   *
   * The pull comes first because the push would be refused otherwise: a branch behind its upstream is
   * exactly what a non-fast-forward rejection is. A pull that fails stops the sync there — pushing on
   * top of a failed merge would publish a half-finished state — and its failure is reported as the
   * sync's, since the sync is what the user asked for.
   *
   * @returns Returns the outcome: the pull's failure when there was one, otherwise the push's.
   */
  public async sync(): Promise<MutationResult> {
    this.log.info('Repository', `Syncing '${this.currentBranch()?.name ?? 'HEAD'}'`);
    const pulled: MutationResult = await this.runPull();
    if (!pulled.success) {
      this.notifyNetworkOutcome('sync', pulled);
      return pulled;
    }
    const pushed: MutationResult = await this.runPush();
    this.notifyNetworkOutcome('sync', pushed);
    return pushed;
  }

  /**
   * Pushes a named branch, then reloads. The outcome raises a toast.
   * @param branch The branch to push.
   * @returns Returns the outcome.
   */
  public async pushBranch(branch: GitBranch): Promise<MutationResult> {
    const result: MutationResult = await this.runPush(branch);
    this.notifyNetworkOutcome('push', result, branch.name);
    return result;
  }

  /**
   * Brings a named branch up to date with its upstream, then reloads. The outcome raises a toast.
   * @param branch The branch to update.
   * @returns Returns the outcome.
   */
  public async pullBranch(branch: GitBranch): Promise<MutationResult> {
    const result: MutationResult = await this.runPull(branch);
    this.notifyNetworkOutcome('pull', result, branch.name);
    return result;
  }

  /**
   * Brings a named branch up to date and then publishes it, then reloads. The outcome raises a toast.
   * @param branch The branch to sync.
   * @returns Returns the outcome.
   */
  public async syncBranch(branch: GitBranch): Promise<MutationResult> {
    this.log.info('Repository', `Syncing '${branch.name}'`);
    const pulled: MutationResult = await this.runPull(branch);
    if (!pulled.success) {
      this.notifyNetworkOutcome('sync', pulled, branch.name);
      return pulled;
    }
    const pushed: MutationResult = await this.runPush(branch);
    this.notifyNetworkOutcome('sync', pushed, branch.name);
    return pushed;
  }

  /**
   * Pulls without reporting the outcome, so a caller doing more than one thing can report once rather
   * than once per step.
   *
   * The checked-out branch is pulled, which merges. Any other branch is fast-forwarded from its
   * upstream instead, because that is the only honest reading of "pull" for a branch you are not on:
   * a merge needs a working tree, and git will not give one to a branch that does not have it. A
   * branch that has diverged cannot be fast-forwarded, and git says so rather than inventing a merge.
   *
   * @param branch The branch to update, or undefined for the checked-out one.
   * @returns Returns the outcome.
   */
  private runPull(branch?: GitBranch): Promise<MutationResult> {
    const target: GitBranch | undefined = branch ?? this.currentBranch();
    if (target === undefined || target.current) {
      this.log.info('Repository', `Pulling '${target?.name ?? 'HEAD'}'`);
      return this.mutate(
        (provider: SourceControlProvider): Promise<MutationResult> => provider.pull(),
      );
    }
    const upstream: { readonly remote: string; readonly branch: string } | null =
      this.splitUpstream(target.upstream);
    if (upstream === null) {
      return Promise.resolve({ success: false, error: `'${target.name}' has no upstream.` });
    }
    this.log.info(
      'Repository',
      `Fast-forwarding '${target.name}' from '${upstream.remote}/${upstream.branch}'`,
    );
    return this.mutate(
      (provider: SourceControlProvider): Promise<MutationResult> =>
        provider.fetchRef(upstream.remote, upstream.branch, target.name),
    );
  }

  /**
   * Pushes without reporting the outcome, claiming the upstream when the branch has none so a
   * freshly-created branch publishes without a separate step.
   * @param branch The branch to push, or undefined for the checked-out one.
   * @returns Returns the outcome.
   */
  private runPush(branch?: GitBranch): Promise<MutationResult> {
    const target: GitBranch | undefined = branch ?? this.currentBranch();
    if (target === undefined) {
      // Detached, with no branch to name. The bare push is the only thing left to mean.
      this.log.info('Repository', 'Pushing HEAD', this.infoSignal()?.root);
      return this.mutate(
        (provider: SourceControlProvider): Promise<MutationResult> => provider.push(),
      );
    }
    const upstream: { readonly remote: string; readonly branch: string } | null =
      this.splitUpstream(target.upstream);
    if (upstream === null) {
      this.log.warn(
        'Repository',
        `Branch '${target.name}' has no upstream; setting to '${this.defaultRemote()}'`,
      );
    }
    const push: PushTarget = {
      remote: upstream?.remote ?? this.defaultRemote(),
      branch: target.name,
      setUpstream: upstream === null,
    };
    this.log.info('Repository', `Pushing '${target.name}'`, this.infoSignal()?.root);
    return this.mutate(
      (provider: SourceControlProvider): Promise<MutationResult> => provider.push(push),
    );
  }

  /**
   * Splits an upstream ref into its remote and branch.
   *
   * Matched against the configured remotes rather than cut at the first slash: both remote names and
   * branch names may contain slashes, so `origin/feature/thing` and a remote literally named
   * `origin/feature` are told apart only by knowing which remotes exist. The longest match wins, for
   * the same reason.
   *
   * When no configured remote matches, the first slash is used after all. A branch that says it has
   * an upstream has one, whatever the remote list currently looks like, and reporting none would send
   * the push off to claim an upstream the branch already had — repointing it silently, which is the
   * one outcome worth going out of the way to avoid.
   *
   * @param upstream The upstream ref, or undefined when the branch has none.
   * @returns Returns the remote and branch, or null when there is no upstream to split.
   */
  private splitUpstream(
    upstream: string | undefined,
  ): { readonly remote: string; readonly branch: string } | null {
    if (upstream === undefined || upstream.length === 0) {
      return null;
    }
    const matches: readonly GitRemote[] = this.remotesSignal()
      .filter((remote: GitRemote): boolean => upstream.startsWith(`${remote.name}/`))
      .sort((left: GitRemote, right: GitRemote): number => right.name.length - left.name.length);
    const remote: GitRemote | undefined = matches[0];
    if (remote !== undefined) {
      return { remote: remote.name, branch: upstream.slice(remote.name.length + 1) };
    }
    const slash: number = upstream.indexOf('/');
    return slash <= 0 || slash === upstream.length - 1
      ? null
      : { remote: upstream.slice(0, slash), branch: upstream.slice(slash + 1) };
  }

  /**
   * Deletes a local branch, then reloads. Destructive; the caller confirms first.
   *
   * An unforced delete git refuses because the branch still holds commits of its own comes back coded
   * rather than merely failed, so the caller can offer to force it. That is a different conversation
   * from any other failure, and the only one with a way past.
   *
   * @param name The branch name.
   * @param force Whether to delete a branch whose commits are not merged anywhere.
   * @returns Returns the outcome.
   */
  public deleteBranch(name: string, force: boolean = false): Promise<MutationResult> {
    this.log.info('Repository', `Deleting branch '${name}'${force ? ' (forced)' : ''}`);
    return this.mutate(
      (provider: SourceControlProvider): Promise<MutationResult> =>
        provider.deleteBranch(name, force),
    );
  }

  /**
   * Renames a local branch, then reloads.
   * @param from The current branch name.
   * @param to The new branch name.
   * @returns Returns the outcome.
   */
  public renameBranch(from: string, to: string): Promise<MutationResult> {
    this.log.info('Repository', `Renaming branch '${from}' to '${to}'`);
    return this.mutate(
      (provider: SourceControlProvider): Promise<MutationResult> => provider.renameBranch(from, to),
    );
  }

  /**
   * Points a local branch's upstream at a remote-tracking branch, then reloads so the row's
   * ahead/behind counts reflect what it now tracks.
   * @param branch The local branch.
   * @param upstream The remote-tracking branch to track.
   * @returns Returns the outcome.
   */
  public setUpstream(branch: string, upstream: string): Promise<MutationResult> {
    this.log.info('Repository', `Setting the upstream of '${branch}' to '${upstream}'`);
    return this.mutate(
      (provider: SourceControlProvider): Promise<MutationResult> =>
        provider.setUpstream(branch, upstream),
    );
  }

  /**
   * Clears a local branch's upstream, then reloads.
   * @param branch The local branch.
   * @returns Returns the outcome.
   */
  public clearUpstream(branch: string): Promise<MutationResult> {
    this.log.info('Repository', `Clearing the upstream of '${branch}'`);
    return this.mutate(
      (provider: SourceControlProvider): Promise<MutationResult> =>
        provider.setUpstream(branch, null),
    );
  }

  /**
   * Merges a branch into the checked-out one, then reloads.
   * @param branch The branch to merge in.
   * @param mode How the merge records its result.
   * @returns Returns the outcome, coded {@link SourceControlCode.Conflicted} when it stopped on
   * conflicts.
   */
  public merge(branch: string, mode: GitMergeMode = 'default'): Promise<MutationResult> {
    this.log.info('Repository', `Merging '${branch}' (${mode})`);
    return this.integrate(
      (provider: SourceControlProvider): Promise<MutationResult> => provider.merge(branch, mode),
    );
  }

  /**
   * Replays the checked-out branch onto another, then reloads. Rewrites history; the caller confirms
   * first.
   * @param onto The branch to replay onto.
   * @returns Returns the outcome, coded {@link SourceControlCode.Conflicted} when it stopped on
   * conflicts.
   */
  public rebase(onto: string): Promise<MutationResult> {
    this.log.info('Repository', `Rebasing onto '${onto}'`);
    return this.integrate(
      (provider: SourceControlProvider): Promise<MutationResult> => provider.rebase(onto),
    );
  }

  /**
   * Carries on the operation in flight, then reloads.
   * @returns Returns the outcome.
   */
  public continueOperation(): Promise<MutationResult> {
    this.log.info('Repository', `Continuing ${this.operationSignal().kind ?? 'nothing'}`);
    return this.integrate(
      (provider: SourceControlProvider): Promise<MutationResult> => provider.continueOperation(),
    );
  }

  /**
   * Skips the commit the operation in flight is stuck on, then reloads.
   * @returns Returns the outcome.
   */
  public skipOperation(): Promise<MutationResult> {
    this.log.warn('Repository', `Skipping a commit of ${this.operationSignal().kind ?? 'nothing'}`);
    return this.integrate(
      (provider: SourceControlProvider): Promise<MutationResult> => provider.skipOperation(),
    );
  }

  /**
   * Abandons the operation in flight, then reloads.
   * @returns Returns the outcome.
   */
  public abortOperation(): Promise<MutationResult> {
    this.log.info('Repository', `Aborting ${this.operationSignal().kind ?? 'nothing'}`);
    return this.integrate(
      (provider: SourceControlProvider): Promise<MutationResult> => provider.abortOperation(),
    );
  }

  /**
   * Runs a merge, rebase, or one of the commands that finishes one, and reloads — whatever the
   * outcome.
   *
   * Two things separate this from {@link Repository.mutate}. It reloads on failure as well as
   * success, because an operation that stopped part-way has still changed the working tree, and a
   * panel showing the state before it ran would be showing a repository that no longer exists. And a
   * stop on conflicts is not reported as an error: git did what it was asked as far as it could and
   * is waiting to be told how to finish, which the panel says for itself. Every other failure still
   * reaches the error surface.
   *
   * @param op Invokes the desired provider operation.
   * @returns Returns the outcome.
   */
  private async integrate(
    op: (provider: SourceControlProvider) => Promise<MutationResult>,
  ): Promise<MutationResult> {
    const provider: SourceControlProvider | null = this.provider;
    if (provider === null) {
      return { success: false, error: 'No repository open' };
    }
    const result: MutationResult = await op(provider);
    const conflicted: boolean = result.code === SourceControlCode.Conflicted;
    if (result.success || conflicted) {
      this.lastErrorSignal.set(null);
    } else {
      this.lastErrorSignal.set(result.error ?? 'The operation failed.');
      this.log.error('Repository', 'Operation failed', result.error ?? 'The operation failed.');
    }
    await this.refresh();
    return result;
  }

  /**
   * Fetches one remote, then reloads. The outcome raises a toast.
   * @param remote The remote to fetch.
   * @returns Returns the outcome.
   */
  public async fetchRemote(remote: string): Promise<MutationResult> {
    this.log.info('Repository', `Fetching remote '${remote}'`);
    const result: MutationResult = await this.mutate(
      (provider: SourceControlProvider): Promise<MutationResult> => provider.fetchRemote(remote),
    );
    this.notifyNetworkOutcome('fetch-remote', result, remote);
    return result;
  }

  /**
   * Prunes one remote's tracking branches that no longer exist on it, then reloads. The outcome
   * raises a toast.
   * @param remote The remote to prune.
   * @returns Returns the outcome.
   */
  public async pruneRemote(remote: string): Promise<MutationResult> {
    this.log.info('Repository', `Pruning remote '${remote}'`);
    const result: MutationResult = await this.mutate(
      (provider: SourceControlProvider): Promise<MutationResult> => provider.pruneRemote(remote),
    );
    this.notifyNetworkOutcome('prune-remote', result, remote);
    return result;
  }

  /**
   * Adds a remote, then reloads so the Remote section shows it.
   * @param name The remote name.
   * @param url The remote URL.
   * @returns Returns the outcome.
   */
  public addRemote(name: string, url: string): Promise<MutationResult> {
    this.log.info('Repository', `Adding remote '${name}'`);
    return this.mutate(
      (provider: SourceControlProvider): Promise<MutationResult> => provider.addRemote(name, url),
    );
  }

  /**
   * Removes a remote, then reloads. Destructive; the caller confirms first.
   * @param name The remote name.
   * @returns Returns the outcome.
   */
  public removeRemote(name: string): Promise<MutationResult> {
    this.log.info('Repository', `Removing remote '${name}'`);
    return this.mutate(
      (provider: SourceControlProvider): Promise<MutationResult> => provider.removeRemote(name),
    );
  }

  /**
   * Checks out a remote-tracking branch as a local branch that tracks it, then reloads.
   *
   * A local branch of that name already existing is not a failure to report — it is the branch the
   * user was asking for. It is checked out instead, which is what they meant and what git would have
   * refused to do under `-b`.
   *
   * @param remoteBranch The remote-tracking branch, as `origin/main`.
   * @param localBranch The local branch to create or check out.
   * @returns Returns the outcome.
   */
  public checkoutTracking(remoteBranch: string, localBranch: string): Promise<MutationResult> {
    const existing: boolean = this.branchesSignal().some(
      (branch: GitBranch): boolean => branch.name === localBranch,
    );
    if (existing) {
      this.log.info(
        'Repository',
        `'${localBranch}' already exists locally; checking it out rather than creating it`,
      );
      return this.checkout(localBranch);
    }
    this.log.info('Repository', `Checking out '${localBranch}' tracking '${remoteBranch}'`);
    return this.mutate(
      (provider: SourceControlProvider): Promise<MutationResult> =>
        provider.checkoutTracking(remoteBranch, localBranch),
    );
  }

  /**
   * Creates a tag at a commit, then reloads so the Tags section shows it.
   * @param name The tag name.
   * @param commit The commit to tag; defaults to the current head.
   * @param message The annotation message, or undefined for a lightweight tag. An annotated tag is
   * what a release wants — it is an object in its own right, carrying its author, date and message.
   * @returns Returns the outcome.
   */
  public createTag(
    name: string,
    commit: string = 'HEAD',
    message?: string,
  ): Promise<MutationResult> {
    this.log.info(
      'Repository',
      `Creating ${message === undefined ? 'lightweight' : 'annotated'} tag '${name}' at ${commit}`,
    );
    return this.mutate(
      (provider: SourceControlProvider): Promise<MutationResult> =>
        provider.createTag(name, commit, message),
    );
  }

  /**
   * Deletes a local tag, then reloads. Destructive; the caller confirms first. Deleting a tag that
   * has been pushed does not delete it on the remote, so this is local-only.
   * @param name The tag name.
   * @returns Returns the outcome.
   */
  public deleteTag(name: string): Promise<MutationResult> {
    this.log.info('Repository', `Deleting tag '${name}'`);
    return this.mutate(
      (provider: SourceControlProvider): Promise<MutationResult> => provider.deleteTag(name),
    );
  }

  /**
   * Deletes a tag on a remote and then locally, so the tag is gone everywhere rather than in one
   * place and not the other.
   *
   * The remote goes first deliberately. A remote delete is the step that can fail — the network, the
   * credential, a protected ref — and doing it first means a failure leaves the local tag exactly
   * where it was, with nothing lost and the retry obvious. The other order would delete the tag from
   * under the user, leave it standing on the remote, and show a panel that disagrees with the forge.
   *
   * @param name The tag name.
   * @param remote The remote to delete on; defaults to the first configured remote.
   * @returns Returns the outcome — the remote failure when there was one, otherwise the local delete.
   */
  public async deleteTagEverywhere(name: string, remote?: string): Promise<MutationResult> {
    const target: string = remote ?? this.defaultRemote();
    this.log.info('Repository', `Deleting tag '${name}' on '${target}' and locally`);
    const remoteResult: MutationResult = await this.mutate(
      (provider: SourceControlProvider): Promise<MutationResult> =>
        provider.deleteRemoteTag(target, name),
    );
    this.notifyNetworkOutcome('delete-remote-tag', remoteResult, `tag ${name} on ${target}`);
    if (!remoteResult.success) {
      return remoteResult;
    }
    return this.deleteTag(name);
  }

  /**
   * Pushes one tag to a remote. The outcome raises a toast — a tag push can fail on authentication
   * as readily as any other network operation, and must not do so silently.
   * @param name The tag name.
   * @param remote The remote to push to; defaults to the first configured remote.
   * @returns Returns the outcome.
   */
  public async pushTag(name: string, remote?: string): Promise<MutationResult> {
    const target: string = remote ?? this.defaultRemote();
    this.log.info('Repository', `Pushing tag '${name}' to '${target}'`);
    const result: MutationResult = await this.mutate(
      (provider: SourceControlProvider): Promise<MutationResult> => provider.pushTag(target, name),
    );
    this.notifyNetworkOutcome('push-tags', result, `tag ${name}`);
    return result;
  }

  /**
   * Pushes every local tag to a remote. The outcome raises a toast.
   * @param remote The remote to push to; defaults to the first configured remote.
   * @returns Returns the outcome.
   */
  public async pushAllTags(remote?: string): Promise<MutationResult> {
    const target: string = remote ?? this.defaultRemote();
    this.log.info('Repository', `Pushing all tags to '${target}'`);
    const result: MutationResult = await this.mutate(
      (provider: SourceControlProvider): Promise<MutationResult> => provider.pushAllTags(target),
    );
    this.notifyNetworkOutcome('push-tags', result, 'all tags');
    return result;
  }

  /**
   * Gets the remote to act on when the caller names none: the first configured one, or `origin` for a
   * repository that has no remotes at all — where the push will fail and say so, which is a better
   * answer than refusing locally for a repository that may well have just been given one.
   * @returns Returns the remote name.
   */
  private defaultRemote(): string {
    return this.remotesSignal()[0]?.name ?? 'origin';
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
    } else {
      this.log.error('Repository', 'Mutation failed', result.error ?? 'The operation failed.');
    }
    return result;
  }

  /**
   * Raises a toast for a network operation's outcome. Success and failure share a coalescing key, so
   * a retried operation's fresh outcome replaces the stale toast instead of stacking beside it.
   * @param operation The finished operation.
   * @param result The operation's outcome.
   */
  private notifyNetworkOutcome(
    operation: NetworkOperation,
    result: MutationResult,
    subject?: string,
  ): void {
    if (result.success) {
      this.notifyNetworkSuccess(operation, subject);
    } else {
      this.notifyNetworkFailure(operation, result.error);
    }
  }

  /**
   * Raises the transient toast reporting a successful network operation.
   * @param operation The finished operation.
   * @param subject What was pushed, for an operation whose object varies from call to call — one
   * named tag or all of them. The branch-shaped operations name the branch themselves.
   */
  private notifyNetworkSuccess(operation: NetworkOperation, subject?: string): void {
    // The branch-shaped operations can name a branch other than the checked-out one, so a supplied
    // subject wins: a toast reading "Pushed main" for a push of `develop` would be a lie.
    const branch: string = subject ?? this.currentBranch()?.name ?? 'HEAD';
    const titles: Readonly<Record<NetworkOperation, string>> = {
      fetch: 'Fetched all remotes',
      'fetch-remote': `Fetched ${subject ?? 'the remote'}`,
      'prune-remote': `Pruned ${subject ?? 'the remote'}`,
      pull: `Pulled ${branch}`,
      push: `Pushed ${branch}`,
      sync: `Synced ${branch}`,
      'push-tags': `Pushed ${subject ?? 'tags'}`,
      'delete-remote-tag': `Deleted ${subject ?? 'the tag'}`,
    };
    this.notifications.notify({
      // Fetching and pruning report rather than celebrate: neither changes anything the user wrote.
      severity: operation.startsWith('fetch') || operation === 'prune-remote' ? 'info' : 'success',
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
    this.log.info('Repository', `Committed to '${branch}'`, this.infoSignal()?.root);
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
    this.log.debug('Repository', `Loaded ${files.length} file(s) for commit ${commit.shortHash}`);
    this.commitFilesSignal.update(
      (
        current: ReadonlyMap<string, readonly GitFileChange[]>,
      ): ReadonlyMap<string, readonly GitFileChange[]> =>
        new Map<string, readonly GitFileChange[]>(current).set(hash, files),
    );
  }

  /**
   * Builds the commit-graph rows from the history, assigning each commit a lane and resolving the
   * edges to its parents.
   * @param commits The commit history, newest first.
   * @returns Returns the ordered graph rows.
   */
  private buildGraph(commits: readonly GitCommit[]): readonly GraphNode[] {
    const placement: Map<string, { lane: number; color: string }> = this.assignLanes(commits);
    const rowOf: Map<string, number> = new Map<string, number>(
      commits.map((commit: GitCommit, index: number): [string, number] => [commit.hash, index]),
    );

    return commits.map((commit: GitCommit, index: number): GraphNode => {
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
        row: index,
        lane: place.lane,
        color: place.color,
        commit,
        refs: commit.refs,
        edges,
      };
    });
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
