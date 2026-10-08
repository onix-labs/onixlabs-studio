import { effect, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import {
  DetectedRepository,
  RepositoryInfo,
  SourceControlClient,
} from '@shared/api/source-control-channels';
import { VersionControlPrompt } from '@shared/angular/services/plugins/version-control-prompt';
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
   * Holds the current branch, or null when detached or not a repository.
   */
  private readonly branchSignal: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Holds whether a repository is currently bound.
   */
  private readonly boundSignal: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets the current branch, or null when detached or the folder is not a repository.
   */
  public readonly branch: Signal<string | null> = this.branchSignal.asReadonly();

  /**
   * Gets a value indicating whether the open folder is a git repository.
   */
  public readonly isRepository: Signal<boolean> = this.boundSignal.asReadonly();

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
   * Source Control panel rather than read here.
   * @param path The absolute file path.
   * @returns Returns true when the context menu offers Show Diff.
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
  public async addToVersionControl(path: string): Promise<MutationResult> {
    const provider: SourceControlProvider | null = this.provider;
    const root: string | null = this.boundRoot === null ? null : normalize(this.boundRoot);
    const target: string = this.realKey(path);
    if (provider === null || root === null || !target.startsWith(`${root}/`)) {
      return { success: false, error: 'That path is not in this workspace’s repository.' };
    }
    // Never empty: an empty list stages the whole working tree.
    const relative: string = target.slice(root.length + 1);
    this.log.info('workspace.git', 'Adding to version control', relative);
    const result: MutationResult = await provider.stage([relative]);
    await this.refresh();
    return result;
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
    this.pathState.set(new Map<string, ExplorerScmState>());
    this.wholeDirs.set(new Map<string, ExplorerScmState>());
    this.changedDirs.set(new Set<string>());
    this.branchSignal.set(null);
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
