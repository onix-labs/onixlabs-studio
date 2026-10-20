import { computed, effect, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import {
  DetectedRepository,
  RepositoryCapabilities,
  RepositoryInfo,
  SourceControlClient,
} from '@shared/api/source-control-channels';
import type { VcsIgnoreRule, VersionControlCapability } from '@shared/api/version-control-protocol';
import { VersionControlPrompt } from '@shared/angular/services/plugins/version-control-prompt';
import { RepositoryTrust } from '@shared/angular/services/repository-trust/repository-trust';
import { Log } from '@shared/angular/services/log/log';
import { DirectoryWatch } from '@shared/angular/services/directory-watch/directory-watch';
import { SourceControl } from '@shared/angular/services/source-control/source-control';
import { GitFileChange } from '@shared/angular/services/repository/repository-data';
import {
  MutationResult,
  ParsedStatus,
  SourceControlProvider,
} from '@shared/angular/services/source-control/source-control-provider';
import { SourceControlProviders } from '@shared/angular/services/source-control/source-control-providers';
import { Workspace } from '@shared/angular/services/workspace/workspace';
import type { TreeRow } from '@shared/angular/components/tree-view/tree-view';

/**
 * How long, in milliseconds, external on-disk changes are debounced before the workspace git status
 * refreshes, so a burst (a checkout, a build) refreshes once rather than per file.
 */
const EXTERNAL_REFRESH_DEBOUNCE_MS: number = 500;

/**
 * Names how version control sees a path in the explorers (#860):
 *
 * - `untracked` — new, and not under version control.
 * - `added` — new, and added to version control (staged); it stays added until committed, even when
 *   edited again since.
 * - `modified` — changed, renamed or deleted.
 * - `conflicted` — left conflicted by an unfinished merge or rebase.
 * - `ignored` — excluded by the ignore rules.
 * - `contains` — a folder with any of the first four somewhere beneath it.
 */
export type ExplorerScmState =
  'untracked' | 'added' | 'modified' | 'conflicted' | 'ignored' | 'contains';

/**
 * Normalises a filesystem path for use as a status-map key: forward slashes and no trailing slash, so
 * git's forward-slash paths and the tree's OS-separator paths compare equal on every platform.
 * @param value The path to normalise.
 * @returns Returns the normalised path.
 */
function normalize(value: string): string {
  const slashed: string = value.replace(/\\/g, '/');
  return slashed.length > 1 && slashed.endsWith('/') ? slashed.slice(0, -1) : slashed;
}

/**
 * Provides lightweight git status for the workspace (directory) tab: it resolves the open folder's
 * git repository, reads its working-tree status, and exposes a per-path status lookup the File and
 * Solution explorers decorate their nodes with. It reuses the same {@link SourceControlProvider} as
 * the source-control tab (the git operations are reference-counted in the main process, so a workspace
 * tab and a source-control tab can hold the same repository at once).
 *
 * Scoped per directory tab (provided by the directory view).
 */
@Service()
export class WorkspaceGit {
  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the git bridge, or undefined when running outside Electron.
   */
  private readonly api: SourceControlClient | undefined = inject(SourceControl).client;

  /**
   * Holds the per-tab workspace whose open folder is tracked.
   */
  private readonly workspace: Workspace = inject(Workspace);

  /**
   * Holds the provider factory used to read the resolved repository.
   */
  private readonly providers: SourceControlProviders = inject(SourceControlProviders);

  /**
   * Holds the directory watcher used to keep the status (and branch) current when the working tree or
   * `.git/HEAD` change on disk — for example an agent creating or switching a branch.
   */
  private readonly directoryWatch: DirectoryWatch = inject(DirectoryWatch);

  /**
   * Holds the prompt that offers a version-control plugin when the folder is a repository nothing
   * installed can read.
   */
  private readonly versionControlPrompt: VersionControlPrompt = inject(VersionControlPrompt);

  /**
   * Holds the trust question every repository is asked before version control first runs in it.
   */
  private readonly trust: RepositoryTrust = inject(RepositoryTrust);

  /**
   * Holds whether a version-control plugin was installed at the last binding, so installing one
   * re-resolves a folder that resolved to nothing before.
   */
  private pluginInstalled: boolean | undefined = undefined;

  /**
   * Holds the disposer of the bound root's directory watch, or null when no repository is bound.
   */
  private watchDisposer: (() => void) | null = null;

  /**
   * Holds the pending debounced external-refresh timer, or null when none is scheduled.
   */
  private externalRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Holds whether an external refresh is currently running, so change bursts can never stack
   * overlapping `git status` crawls of a large working tree.
   */
  private externalRefreshRunning: boolean = false;

  /**
   * Holds whether another burst arrived while a refresh was running, so one replay follows it.
   */
  private externalRefreshDirty: boolean = false;

  /**
   * Holds the provider bound to the resolved repository root, or null when the folder is not a
   * repository.
   */
  private provider: SourceControlProvider | null = null;

  /**
   * Holds the resolved repository root (held in the main process), or null when none is bound.
   */
  private boundRoot: string | null = null;

  /**
   * Holds how the workspace folder, as the explorers hold it, maps onto its real path when the two
   * differ — a folder opened through a symlink (#862) — or null when they do not.
   */
  private pathAlias: { readonly from: string; readonly to: string } | null = null;

  /**
   * Holds the last workspace folder a resolve was attempted for, so the resolve runs once per folder.
   */
  private lastWorkspaceRoot: string | null | undefined = undefined;

  /**
   * Holds each path's own state — changed, untracked or ignored files, and directories reported
   * whole (an untracked or ignored directory) — keyed by normalised absolute path.
   */
  private readonly pathState: WritableSignal<ReadonlyMap<string, ExplorerScmState>> = signal<
    ReadonlyMap<string, ExplorerScmState>
  >(new Map<string, ExplorerScmState>());

  /**
   * Holds the directories reported whole — untracked or ignored — whose state everything beneath them
   * shares, keyed by normalised absolute path.
   */
  private readonly wholeDirs: WritableSignal<ReadonlyMap<string, ExplorerScmState>> = signal<
    ReadonlyMap<string, ExplorerScmState>
  >(new Map<string, ExplorerScmState>());

  /**
   * Holds the normalised absolute paths of directories that contain a change.
   */
  private readonly changedDirs: WritableSignal<ReadonlySet<string>> = signal<ReadonlySet<string>>(
    new Set<string>(),
  );

  /**
   * Holds the normalised absolute paths of files whose changes Revert can take back to `HEAD`: edited
   * or deleted, and nothing else (#1042). An added or renamed file is not among them, since restoring
   * it from `HEAD` would delete it, and Revert must only ever undo edits.
   */
  private readonly revertable: WritableSignal<ReadonlySet<string>> = signal<ReadonlySet<string>>(
    new Set<string>(),
  );

  /**
   * Holds the capabilities the bound repository's plugin confirmed, or null until they are known —
   * which offers none of the commands that need one, so a plugin too old to have them is never asked.
   */
  private readonly capabilities: WritableSignal<ReadonlySet<VersionControlCapability> | null> =
    signal<ReadonlySet<VersionControlCapability> | null>(null);

  /**
   * Holds the current branch, or null when detached or not a repository.
   */
  private readonly branchSignal: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds whether a repository is currently bound.
   */
  private readonly boundSignal: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the root of a repository the user has not trusted, or null when the folder is no such
   * repository: either it is trusted and bound, or it is not a repository at all.
   */
  private readonly restrictedRoot: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Gets the current branch, or null when detached or the folder is not a repository.
   */
  public readonly branch: Signal<string | null> = this.branchSignal.asReadonly();

  /**
   * Gets a value indicating whether the open folder is a git repository the user trusts, so that
   * version control runs in it.
   */
  public readonly isRepository: Signal<boolean> = this.boundSignal.asReadonly();

  /**
   * Gets a value indicating whether the open folder is a repository the user has not trusted, so
   * version control is kept out of it and the panels say so.
   */
  public readonly isRestricted: Signal<boolean> = computed(
    (): boolean => this.restrictedRoot() !== null,
  );

  /**
   * Wires the effect that resolves and reads git status when the open folder changes.
   */
  public constructor() {
    effect((): void => {
      const root: string | null = this.workspace.root()?.path ?? null;
      const installed: boolean = this.versionControlPrompt.isInstalled();
      if (this.pluginInstalled !== undefined && installed !== this.pluginInstalled) {
        // A plugin arrived (or left): the folder must be resolved again, not skipped as unchanged.
        this.lastWorkspaceRoot = undefined;
      }
      this.pluginInstalled = installed;
      void this.bindTo(root);
    });
  }

  /**
   * Gets how version control sees a path (#860). Its own state wins; failing that, the state of an
   * untracked or ignored directory it lies in; failing that, `contains` for a folder with changes
   * beneath it; otherwise null — unchanged.
   * @param path The absolute file or directory path.
   * @returns Returns the state, or null when unchanged.
   */
  public stateFor(path: string): ExplorerScmState | null {
    const key: string = this.realKey(path);
    const own: ExplorerScmState | undefined = this.pathState().get(key);
    if (own !== undefined) {
      return own;
    }
    const whole: ReadonlyMap<string, ExplorerScmState> = this.wholeDirs();
    if (whole.size > 0) {
      let current: string = key;
      for (
        let slash: number = current.lastIndexOf('/');
        slash > 0;
        slash = current.lastIndexOf('/')
      ) {
        current = current.slice(0, slash);
        const inherited: ExplorerScmState | undefined = whole.get(current);
        if (inherited !== undefined) {
          return inherited;
        }
      }
    }
    return this.changedDirs().has(key) ? 'contains' : null;
  }

  /**
   * Reloads the working-tree status from the bound repository.
   * @returns Returns a promise that resolves once the status has been reloaded.
   */
  public async refresh(): Promise<void> {
    const provider: SourceControlProvider | null = this.provider;
    if (provider === null) {
      return;
    }
    const status: ParsedStatus = await provider.getStatus();
    if (this.provider !== provider || this.boundRoot === null) {
      return;
    }
    const states: Map<string, ExplorerScmState> = new Map<string, ExplorerScmState>();
    const whole: Map<string, ExplorerScmState> = new Map<string, ExplorerScmState>();
    const dirs: Set<string> = new Set<string>();
    const root: string = normalize(this.boundRoot);
    const record: (path: string, state: ExplorerScmState, changes: boolean) => void = (
      path: string,
      state: ExplorerScmState,
      changes: boolean,
    ): void => {
      const absolute: string = normalize(`${root}/${path}`);
      states.set(absolute, state);
      // A directory reported whole (`dir/`) colours everything beneath it.
      if (path.endsWith('/')) {
        whole.set(absolute, state);
      }
      if (changes) {
        this.addAncestors(absolute, root, dirs);
      }
    };
    // Staged first: a file added to version control stays added until it is committed, even once it
    // has been edited again since — so a later worktree change does not demote it to modified.
    for (const change of status.staged) {
      record(change.path, change.status === 'added' ? 'added' : 'modified', true);
    }
    for (const change of status.unstaged) {
      const state: ExplorerScmState = scmStateOf(change);
      if (states.get(normalize(`${root}/${change.path}`)) !== 'added' || state === 'untracked') {
        record(change.path, state, true);
      }
    }
    for (const change of status.conflicted) {
      record(change.path, 'conflicted', true);
    }
    // Ignored paths are not changes: they grey out, but no folder turns info because of one.
    for (const path of status.ignored ?? []) {
      record(path, 'ignored', false);
    }
    this.pathState.set(states);
    this.wholeDirs.set(whole);
    this.changedDirs.set(dirs);
    this.revertable.set(revertableKeys(root, status, states));
    this.branchSignal.set(status.branch);
  }

  /**
   * Gets whether a path can be added to version control: the folder is a repository and the path is
   * untracked (#860).
   * @param path The absolute file or folder path.
   * @returns Returns true when the context menu offers to add it.
   */
  public canAddToVersionControl(path: string): boolean {
    return this.provider !== null && this.stateFor(path) === 'untracked';
  }

  /**
   * Gets whether a path has a diff the explorers offer to show: the folder is a repository and the path
   * is modified. Only modified — a new file's diff is the whole file, and a conflict is resolved in the
   * Repository panel rather than read here.
   * @param path The absolute file path.
   * @returns Returns true when the context menu offers Show Differences.
   */
  public canShowDiff(path: string): boolean {
    return this.provider !== null && this.stateFor(path) === 'modified';
  }

  /**
   * Adds an untracked file or folder to version control (#860) — stages it, the ignore rules still
   * applying to a folder's contents — and reads the status again, so the row turns from untracked to
   * added. Nothing is ever added unasked: this is the only way a new path becomes tracked.
   * @param path The absolute file or folder path.
   * @returns Returns the outcome.
   */
  public addToVersionControl(path: string): Promise<MutationResult> {
    return this.mutate(
      'Adding to version control',
      [path],
      (provider: SourceControlProvider, relative: readonly string[]): Promise<MutationResult> =>
        provider.stage(relative),
    );
  }

  /**
   * Gets the files Revert would take back to `HEAD` for a path (#1042): the file itself when it is
   * edited or deleted, or every such file beneath a folder. Never an added, renamed, untracked or
   * conflicted file — reverting those would delete work rather than undo an edit.
   * @param path The absolute file or folder path.
   * @returns Returns the files' normalised absolute paths, empty when there is nothing to revert.
   */
  public revertableFiles(path: string): readonly string[] {
    if (this.provider === null) {
      return [];
    }
    const key: string = this.realKey(path);
    const revertable: ReadonlySet<string> = this.revertable();
    if (revertable.has(key)) {
      return [key];
    }
    return [...revertable].filter((candidate: string): boolean => candidate.startsWith(`${key}/`));
  }

  /**
   * Takes files back to `HEAD`, index and working tree, and reads the status again (#1042). The files
   * are named one by one, never as a folder: a folder handed to the version-control system would also
   * take its untracked files with it. Destructive; the caller confirms first.
   * @param files The files' absolute paths, as {@link revertableFiles} gives them.
   * @returns Returns the outcome.
   */
  public revert(files: readonly string[]): Promise<MutationResult> {
    const revertable: ReadonlySet<string> = this.revertable();
    if (files.length === 0 || files.some((file: string): boolean => !revertable.has(file))) {
      return Promise.resolve({ success: false, error: 'Only edited files can be reverted.' });
    }
    return this.mutate(
      'Reverting',
      files,
      (provider: SourceControlProvider, relative: readonly string[]): Promise<MutationResult> =>
        provider.discard(relative),
    );
  }

  /**
   * Gets whether a path was added to version control and not yet committed, so the context menu offers
   * to take that back (#1042).
   * @param path The absolute file path.
   * @returns Returns true when the context menu offers Undo Add.
   */
  public canUndoAdd(path: string): boolean {
    return this.provider !== null && this.stateFor(path) === 'added';
  }

  /**
   * Takes an added path back out of version control, the reverse of {@link addToVersionControl}: it
   * is unstaged, and turns untracked again with its contents untouched (#1042).
   * @param path The absolute file path.
   * @returns Returns the outcome.
   */
  public undoAdd(path: string): Promise<MutationResult> {
    return this.mutate(
      'Undoing add',
      [path],
      (provider: SourceControlProvider, relative: readonly string[]): Promise<MutationResult> =>
        provider.unstage(relative),
    );
  }

  /**
   * Gets whether a path is conflicted, so the context menu offers to mark it resolved (#1042).
   * @param path The absolute file path.
   * @returns Returns true when the context menu offers Mark Resolved.
   */
  public isConflicted(path: string): boolean {
    return this.provider !== null && this.stateFor(path) === 'conflicted';
  }

  /**
   * Marks a conflicted file resolved, which is what staging it means: the version now on disk becomes
   * the one it carries — exactly what the Repository panel's Mark Resolved does (#1042).
   * @param path The absolute file path.
   * @returns Returns the outcome.
   */
  public markResolved(path: string): Promise<MutationResult> {
    return this.mutate(
      'Marking resolved',
      [path],
      (provider: SourceControlProvider, relative: readonly string[]): Promise<MutationResult> =>
        provider.stage(relative),
    );
  }

  /**
   * Gets whether an untracked path can be added to the ignore list: the plugin can, and the path is
   * untracked (#1043).
   * @param path The absolute file or folder path.
   * @returns Returns true when the context menu offers Ignore.
   */
  public canIgnore(path: string): boolean {
    return this.supports('ignore') && this.stateFor(path) === 'untracked';
  }

  /**
   * Adds a path — or, given an extension, every file with it — to the ignore list, and reads the
   * status again so the row turns ignored (#1043).
   * @param path The absolute file or folder path the command was chosen on.
   * @param extension The extension, without the dot, to ignore everywhere; omitted for the path itself.
   * @returns Returns the outcome.
   */
  public ignore(path: string, extension?: string): Promise<MutationResult> {
    return this.mutate(
      'Ignoring',
      [path],
      (provider: SourceControlProvider, relative: readonly string[]): Promise<MutationResult> => {
        const rule: VcsIgnoreRule =
          extension === undefined
            ? { kind: 'path', path: relative[0] }
            : { kind: 'extension', extension };
        return provider.ignore([rule]);
      },
    );
  }

  /**
   * Gets whether a path can be taken out of version control: the plugin can, the path lies inside the
   * repository (never the root itself), and it is tracked — unchanged, edited, or a folder holding
   * changes. An untracked, added, ignored or conflicted path has nothing to stop (#1043).
   * @param path The absolute file or folder path.
   * @returns Returns true when the context menu offers Stop Tracking.
   */
  public canStopTracking(path: string): boolean {
    const root: string | null = this.boundRoot === null ? null : normalize(this.boundRoot);
    if (!this.supports('stopTracking') || root === null) {
      return false;
    }
    if (!this.realKey(path).startsWith(`${root}/`)) {
      return false;
    }
    const state: ExplorerScmState | null = this.stateFor(path);
    return state === null || state === 'modified' || state === 'contains';
  }

  /**
   * Takes a path out of version control, leaving it on disk, and reads the status again so the row
   * turns untracked — from where it can be ignored (#1043).
   * @param path The absolute file or folder path.
   * @returns Returns the outcome.
   */
  public stopTracking(path: string): Promise<MutationResult> {
    return this.mutate(
      'Stopping tracking',
      [path],
      (provider: SourceControlProvider, relative: readonly string[]): Promise<MutationResult> =>
        provider.stopTracking(relative),
    );
  }

  /**
   * Gets the path the history narrows to for a row: repository-relative, with forward slashes — when
   * the plugin can read one path's history and the path has any (#1044). An untracked, ignored or
   * newly added path has no commits yet, and the root's history is the whole history.
   * @param path The absolute file or folder path.
   * @returns Returns the repository-relative path, or null when Show History does not apply.
   */
  public historyPathOf(path: string): string | null {
    const root: string | null = this.boundRoot === null ? null : normalize(this.boundRoot);
    const key: string = this.realKey(path);
    if (!this.supports('pathHistory') || root === null || !key.startsWith(`${root}/`)) {
      return null;
    }
    const state: ExplorerScmState | null = this.stateFor(path);
    return state === 'untracked' || state === 'ignored' || state === 'added'
      ? null
      : key.slice(root.length + 1);
  }

  /**
   * Trusts the restricted repository, after which the folder is bound and read like any other. The
   * way back in for a user who did not trust the repository when first asked.
   * @returns Returns a promise that resolves once the folder has been bound.
   */
  public async trustRepository(): Promise<void> {
    const root: string | null = this.restrictedRoot();
    if (root === null || !(await this.trust.trust(root))) {
      return;
    }
    this.restrictedRoot.set(null);
    // Resolve the folder again rather than reusing the earlier answer: the earlier resolve was
    // released when the repository was refused.
    this.lastWorkspaceRoot = undefined;
    await this.bindTo(this.workspace.root()?.path ?? null);
  }

  /**
   * Releases the bound repository and clears the status. Called by the directory view on teardown.
   */
  public dispose(): void {
    this.release();
  }

  /**
   * Resolves the repository for a workspace folder and reads its status, rebinding when the folder
   * changes. A folder that is not a repository clears the status.
   * @param workspaceRoot The open folder path, or null when no folder is open.
   * @returns Returns a promise that resolves once the binding has settled.
   */
  private async bindTo(workspaceRoot: string | null): Promise<void> {
    if (workspaceRoot === this.lastWorkspaceRoot) {
      return;
    }
    this.lastWorkspaceRoot = workspaceRoot;

    if (workspaceRoot === null) {
      this.release();
      return;
    }
    const info: RepositoryInfo | null = await (this.api?.resolveRepository(workspaceRoot) ??
      Promise.resolve(null));
    // The folder changed again while resolving; the newer call owns the binding.
    if (this.lastWorkspaceRoot !== workspaceRoot) {
      if (info !== null) {
        void this.api?.closeRepository(info.root);
      }
      return;
    }
    if (info === null) {
      this.release();
      await this.offerPlugin(workspaceRoot);
      return;
    }
    // Nothing reads the repository until the user has said they trust it: its own settings can name
    // commands the tool runs on its first look. The main process refuses every read until then; this
    // is where the question is put, and where a refusal is shown rather than silently read as "not a
    // repository".
    if (!(await this.trust.ensureTrusted(info))) {
      void this.api?.closeRepository(info.root);
      if (this.lastWorkspaceRoot !== workspaceRoot) {
        return;
      }
      this.release();
      this.restrictedRoot.set(info.root);
      this.log.info(
        'source-control',
        'Repository is not trusted; version control stays off',
        info.root,
      );
      return;
    }
    if (this.lastWorkspaceRoot !== workspaceRoot) {
      void this.api?.closeRepository(info.root);
      return;
    }
    if (this.boundRoot !== info.root) {
      this.release();
      this.boundRoot = info.root;
      this.pathAlias =
        info.realDirectory === undefined ||
        normalize(info.realDirectory) === normalize(workspaceRoot)
          ? null
          : { from: normalize(workspaceRoot), to: normalize(info.realDirectory) };
      this.provider = this.providers.create(info.root);
      this.boundSignal.set(true);
      this.log.debug('source-control', 'Bound workspace git repository', info.root);
      void this.loadCapabilities(info.root);
      // Watch the repository so an on-disk branch switch or working-tree change (e.g. an agent
      // creating and working from a new branch) refreshes the status and branch live, without needing
      // the tab to be re-activated — which is what Mission Control's per-column branch reads.
      this.watchDisposer = this.directoryWatch.watch(info.root, (): void =>
        this.scheduleExternalRefresh(),
      );
    } else {
      // Same root resolved again (the resolve incremented the main-process count); balance it.
      void this.api?.closeRepository(info.root);
    }
    await this.refresh();
  }

  /**
   * Offers a version-control plugin when a folder that resolved to no repository is in fact one that
   * no installed plugin can read — so a missing plugin is said, rather than looking like a plain folder.
   * @param workspaceRoot The folder.
   * @returns Returns a promise that settles once the folder has been checked.
   */
  private async offerPlugin(workspaceRoot: string): Promise<void> {
    const detected: DetectedRepository | null = (await this.api?.detect(workspaceRoot)) ?? null;
    if (this.lastWorkspaceRoot !== workspaceRoot) {
      return;
    }
    if (detected !== null && !detected.installed) {
      this.log.info('source-control', `${workspaceRoot} needs the ${detected.displayName} plugin`);
      this.versionControlPrompt.offer(detected);
    }
  }

  /**
   * Schedules a coalesced refresh in response to external on-disk changes, so a burst of changes (a
   * checkout, a build) refreshes once rather than per file. The app's own git reads never re-enter
   * here: the main process runs them with optional index writes disabled, so a refresh leaves the
   * repository untouched on disk.
   */
  private scheduleExternalRefresh(): void {
    if (this.externalRefreshTimer !== null) {
      return;
    }
    this.externalRefreshTimer = setTimeout((): void => {
      this.externalRefreshTimer = null;
      void this.runExternalRefresh();
    }, EXTERNAL_REFRESH_DEBOUNCE_MS);
  }

  /**
   * Runs one external refresh at a time: a tick arriving mid-refresh sets a dirty flag replayed once
   * the running refresh settles, so sustained churn can never pile up concurrent status reads no
   * matter how slow the working tree is to crawl.
   * @returns Returns a promise that resolves once the refresh (and any replay) has started settling.
   */
  private async runExternalRefresh(): Promise<void> {
    if (this.externalRefreshRunning) {
      this.externalRefreshDirty = true;
      return;
    }
    this.externalRefreshRunning = true;
    try {
      await this.refresh();
    } finally {
      this.externalRefreshRunning = false;
      if (this.externalRefreshDirty) {
        this.externalRefreshDirty = false;
        void this.runExternalRefresh();
      }
    }
  }

  /**
   * Releases the bound repository in the main process and clears all status.
   */
  private release(): void {
    this.watchDisposer?.();
    this.watchDisposer = null;
    if (this.externalRefreshTimer !== null) {
      clearTimeout(this.externalRefreshTimer);
      this.externalRefreshTimer = null;
    }
    if (this.boundRoot !== null) {
      void this.api?.closeRepository(this.boundRoot);
      this.boundRoot = null;
    }
    this.provider = null;
    this.pathAlias = null;
    this.boundSignal.set(false);
    this.restrictedRoot.set(null);
    this.pathState.set(new Map<string, ExplorerScmState>());
    this.wholeDirs.set(new Map<string, ExplorerScmState>());
    this.changedDirs.set(new Set<string>());
    this.revertable.set(new Set<string>());
    this.capabilities.set(null);
    this.branchSignal.set(null);
  }

  /**
   * Gets whether the bound repository's plugin confirmed a capability. False until it has answered.
   * @param capability The capability.
   * @returns Returns true when it is confirmed.
   */
  private supports(capability: VersionControlCapability): boolean {
    return this.provider !== null && (this.capabilities()?.has(capability) ?? false);
  }

  /**
   * Reads what the plugin serving the bound repository can do.
   * @param root The repository root.
   * @returns Returns a promise that settles once read.
   */
  private async loadCapabilities(root: string): Promise<void> {
    const described: RepositoryCapabilities | null = (await this.api?.describe(root)) ?? null;
    if (described !== null && this.boundRoot === root) {
      this.capabilities.set(new Set<VersionControlCapability>(described.capabilities));
    }
  }

  /**
   * Runs a version-control write over paths in the bound repository, then reads the status again so
   * the rows show what it did. Every path must lie inside the repository: a path outside it is refused
   * rather than sent, and the list sent is never empty — to the provider an empty list means the whole
   * working tree.
   * @param action What the write is, for the log.
   * @param paths The absolute paths it acts on.
   * @param write The write, given the repository-relative paths.
   * @returns Returns the outcome.
   */
  private async mutate(
    action: string,
    paths: readonly string[],
    write: (
      provider: SourceControlProvider,
      relative: readonly string[],
    ) => Promise<MutationResult>,
  ): Promise<MutationResult> {
    const provider: SourceControlProvider | null = this.provider;
    const root: string | null = this.boundRoot === null ? null : normalize(this.boundRoot);
    const targets: string[] = paths.map((path: string): string => this.realKey(path));
    if (
      provider === null ||
      root === null ||
      targets.length === 0 ||
      targets.some((target: string): boolean => !target.startsWith(`${root}/`))
    ) {
      return { success: false, error: 'That path is not in this workspace’s repository.' };
    }
    const relative: string[] = targets.map((target: string): string =>
      target.slice(root.length + 1),
    );
    this.log.info('workspace.git', action, relative);
    const result: MutationResult = await write(provider, relative);
    await this.refresh();
    return result;
  }

  /**
   * Gets the key a path's state is held under: normalised, and moved onto the real path when the
   * workspace was opened through a symlink — the repository's paths are real ones (#862).
   * @param path The absolute path, as the explorers hold it.
   * @returns Returns the key.
   */
  private realKey(path: string): string {
    const key: string = normalize(path);
    const alias: { readonly from: string; readonly to: string } | null = this.pathAlias;
    if (alias === null || (key !== alias.from && !key.startsWith(`${alias.from}/`))) {
      return key;
    }
    return `${alias.to}${key.slice(alias.from.length)}`;
  }

  /**
   * Adds every ancestor directory of a changed file, up to and including the repository root, to the
   * changed-directories set.
   * @param absolute The normalised absolute file path.
   * @param root The normalised repository root.
   * @param dirs The set to add ancestors to.
   */
  private addAncestors(absolute: string, root: string, dirs: Set<string>): void {
    let current: string = absolute;
    for (;;) {
      const slash: number = current.lastIndexOf('/');
      if (slash <= 0) {
        break;
      }
      current = current.slice(0, slash);
      dirs.add(current);
      if (current === root || !current.startsWith(root)) {
        break;
      }
    }
  }
}

/**
 * Gets the state a worktree change puts its path in.
 * @param change The change.
 * @returns Returns the state.
 */
function scmStateOf(change: GitFileChange): ExplorerScmState {
  if (change.untracked === true) {
    return 'untracked';
  }
  return change.status === 'conflicted' ? 'conflicted' : 'modified';
}

/**
 * Gets the files Revert can take back to `HEAD` (#1042): those with only edits or a deletion against
 * it, staged or not, that still read as modified. A file with any added, renamed or conflicted change
 * is left out, since restoring it from `HEAD` would delete it.
 * @param root The normalised repository root.
 * @param status The status just read.
 * @param states Each path's state, as the status was recorded.
 * @returns Returns the files' normalised absolute paths.
 */
function revertableKeys(
  root: string,
  status: ParsedStatus,
  states: ReadonlyMap<string, ExplorerScmState>,
): ReadonlySet<string> {
  const edited: Set<string> = new Set<string>();
  const excluded: Set<string> = new Set<string>();
  for (const change of [...status.staged, ...status.unstaged, ...status.conflicted]) {
    const key: string = normalize(`${root}/${change.path}`);
    const editOnly: boolean =
      change.untracked !== true && (change.status === 'modified' || change.status === 'deleted');
    (editOnly ? edited : excluded).add(key);
  }
  return new Set<string>(
    [...edited].filter(
      (key: string): boolean => !excluded.has(key) && states.get(key) === 'modified',
    ),
  );
}

/**
 * How each state reads in a tree row (#860): its colour and, so colour is never the only signal, the
 * words its tooltip and accessible description say.
 */
const PRESENTATION: Readonly<Record<ExplorerScmState, Pick<TreeRow, 'tone' | 'strong' | 'hint'>>> =
  {
    untracked: { tone: 'danger', hint: 'Untracked — not under version control' },
    added: { tone: 'success', hint: 'Added to version control' },
    modified: { tone: 'warning', hint: 'Modified' },
    conflicted: { tone: 'danger', strong: true, hint: 'Conflicted' },
    ignored: { tone: 'muted', hint: 'Ignored by version control' },
    contains: { tone: 'info', hint: 'Contains changes' },
  };

/**
 * Gets the tree-row fields that present a state: none for an unchanged path.
 * @param state The state, or null when unchanged.
 * @returns Returns the fields to spread into the row.
 */
export function scmRowFields(
  state: ExplorerScmState | null,
): Pick<TreeRow, 'tone' | 'strong' | 'hint'> {
  return state === null ? {} : PRESENTATION[state];
}
