import { effect, inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { RepositoryInfo, SourceControlApi } from '../../../shared/studio-api';
import { GitChangeStatus } from '../repository/repository-data';
import { ParsedStatus } from '../source-control/git-output';
import { SourceControlProvider } from '../source-control/source-control-provider';
import { SourceControlProviders } from '../source-control/source-control-providers';
import { Workspace } from '../workspace/workspace';

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
   * Holds the git bridge, or undefined when running outside Electron.
   */
  private readonly api: SourceControlApi | undefined = window.studio?.sourceControl;

  /**
   * Holds the per-tab workspace whose open folder is tracked.
   */
  private readonly workspace: Workspace = inject(Workspace);

  /**
   * Holds the provider factory used to read the resolved repository.
   */
  private readonly providers: SourceControlProviders = inject(SourceControlProviders);

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
   * Holds the last workspace folder a resolve was attempted for, so the resolve runs once per folder.
   */
  private lastWorkspaceRoot: string | null | undefined = undefined;

  /**
   * Holds the changed files, keyed by normalised absolute path.
   */
  private readonly fileStatus: WritableSignal<ReadonlyMap<string, GitChangeStatus>> = signal<
    ReadonlyMap<string, GitChangeStatus>
  >(new Map<string, GitChangeStatus>());

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
      void this.bindTo(root);
    });
  }

  /**
   * Gets the git status of a file, or null when it is unchanged or untracked-by-status.
   * @param path The absolute file path.
   * @returns Returns the change status, or null.
   */
  public statusFor(path: string): GitChangeStatus | null {
    return this.fileStatus().get(normalize(path)) ?? null;
  }

  /**
   * Gets a value indicating whether a directory contains a change at any depth.
   * @param path The absolute directory path.
   * @returns Returns true when the directory has descendant changes.
   */
  public hasChanges(path: string): boolean {
    return this.changedDirs().has(normalize(path));
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
    const files: Map<string, GitChangeStatus> = new Map<string, GitChangeStatus>();
    const dirs: Set<string> = new Set<string>();
    const root: string = normalize(this.boundRoot);
    // Stage first then worktree, so the worktree status wins for a file changed in both.
    for (const change of [...status.staged, ...status.unstaged]) {
      const absolute: string = `${root}/${change.path}`;
      files.set(absolute, change.status);
      this.addAncestors(absolute, root, dirs);
    }
    this.fileStatus.set(files);
    this.changedDirs.set(dirs);
    this.branchSignal.set(status.branch);
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
      return;
    }
    if (this.boundRoot !== info.root) {
      this.release();
      this.boundRoot = info.root;
      this.provider = this.providers.create(info.root);
      this.boundSignal.set(true);
    } else {
      // Same root resolved again (the resolve incremented the main-process count); balance it.
      void this.api?.closeRepository(info.root);
    }
    await this.refresh();
  }

  /**
   * Releases the bound repository in the main process and clears all status.
   */
  private release(): void {
    if (this.boundRoot !== null) {
      void this.api?.closeRepository(this.boundRoot);
      this.boundRoot = null;
    }
    this.provider = null;
    this.boundSignal.set(false);
    this.fileStatus.set(new Map<string, GitChangeStatus>());
    this.changedDirs.set(new Set<string>());
    this.branchSignal.set(null);
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
