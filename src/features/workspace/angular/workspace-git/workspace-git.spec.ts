import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  DetectedRepository,
  RepositoryInfo,
  SourceControlClient,
} from '@shared/api/source-control-channels';
import { VersionControlPrompt } from '@shared/angular/services/plugins/version-control-prompt';
import { RepositoryTrust } from '@shared/angular/services/repository-trust/repository-trust';
import { DirectoryChangeEvent } from '@shared/api/file-channels';
import { DirectoryListing } from '@shared/api/workspace-channels';
import { DirectoryWatch } from '@shared/angular/services/directory-watch/directory-watch';
import { GitFileChange } from '@shared/angular/services/repository/repository-data';
import {
  MutationResult,
  ParsedStatus,
  SourceControlProvider,
} from '@shared/angular/services/source-control/source-control-provider';
import { SourceControl } from '@shared/angular/services/source-control/source-control';
import { SourceControlProviders } from '@shared/angular/services/source-control/source-control-providers';
import { Workspace } from '@shared/angular/services/workspace/workspace';

import { scmRowFields, WorkspaceGit } from './workspace-git';

/**
 * Builds a file change with the given repository-relative path and status.
 * @param path The repository-relative path.
 * @param status The change status.
 * @returns Returns the file change.
 */
function change(
  path: string,
  status: GitFileChange['status'],
  untracked: boolean = false,
): GitFileChange {
  return {
    path,
    status,
    ...(untracked ? { untracked } : {}),
    additions: 0,
    deletions: 0,
    language: '',
    original: '',
    modified: '',
    target: { kind: 'working', staged: false },
  };
}

/**
 * Builds a directory listing for a workspace root path.
 * @param path The root path.
 * @returns Returns the listing.
 */
function listing(path: string): DirectoryListing {
  return { path, name: path.split('/').pop() ?? path, entries: [] };
}

/**
 * Flushes pending microtasks and timers so the async bind/refresh chain settles.
 * @returns Returns a promise that resolves once the queue has drained.
 */
async function settle(): Promise<void> {
  await new Promise((resolve: (value: void) => void): void => {
    setTimeout(resolve, 0);
  });
  await new Promise((resolve: (value: void) => void): void => {
    setTimeout(resolve, 0);
  });
}

describe('WorkspaceGit', () => {
  let git: WorkspaceGit;
  let root: WritableSignal<DirectoryListing | null>;
  let resolved: RepositoryInfo | null;
  let detected: DetectedRepository | null;
  let offers: DetectedRepository[];
  let pluginInstalled: WritableSignal<boolean>;
  let closed: string[];
  let status: ParsedStatus;
  let staged: string[][];
  let unstaged: string[][];
  let discarded: string[][];
  let watched: string[];
  let fireWatch: () => void;
  let trustAnswer: boolean;
  let trustAsked: RepositoryInfo[];
  let trustGranted: string[];

  beforeEach(() => {
    root = signal<DirectoryListing | null>(null);
    resolved = { root: '/repo', name: 'repo', trust: 'trusted' };
    trustAnswer = true;
    trustAsked = [];
    trustGranted = [];
    closed = [];
    watched = [];
    const handlers: ((event: DirectoryChangeEvent) => void)[] = [];
    fireWatch = (): void => {
      for (const handler of handlers) {
        handler({} as DirectoryChangeEvent);
      }
    };
    const directoryWatch: Pick<DirectoryWatch, 'watch'> = {
      watch: (rootPath: string, onChange: (event: DirectoryChangeEvent) => void): (() => void) => {
        watched.push(rootPath);
        handlers.push(onChange);
        return (): void => {
          const index: number = handlers.indexOf(onChange);
          if (index >= 0) {
            handlers.splice(index, 1);
          }
        };
      },
    };
    detected = null;
    pluginInstalled = signal<boolean>(false);
    status = {
      branch: 'main',
      upstream: 'origin/main',
      ahead: 0,
      behind: 0,
      staged: [change('src/app/main.ts', 'modified')],
      unstaged: [change('README.md', 'added', true)],
      conflicted: [],
    };

    offers = [];
    const client: Pick<SourceControlClient, 'resolveRepository' | 'closeRepository' | 'detect'> = {
      detect: (): Promise<DetectedRepository | null> => Promise.resolve(detected),
      resolveRepository: (): Promise<RepositoryInfo | null> => Promise.resolve(resolved),
      closeRepository: (repositoryRoot: string): Promise<void> => {
        closed.push(repositoryRoot);
        return Promise.resolve();
      },
    };
    staged = [];
    unstaged = [];
    discarded = [];
    const provider: Pick<SourceControlProvider, 'getStatus' | 'stage' | 'unstage' | 'discard'> = {
      getStatus: (): Promise<ParsedStatus> => Promise.resolve(status),
      stage: (paths: readonly string[]): Promise<MutationResult> => {
        staged.push([...paths]);
        return Promise.resolve({ success: true });
      },
      unstage: (paths: readonly string[]): Promise<MutationResult> => {
        unstaged.push([...paths]);
        return Promise.resolve({ success: true });
      },
      discard: (paths: readonly string[]): Promise<MutationResult> => {
        discarded.push([...paths]);
        return Promise.resolve({ success: true });
      },
    };

    TestBed.configureTestingModule({
      providers: [
        WorkspaceGit,
        { provide: SourceControl, useValue: { client: client as SourceControlClient } },
        { provide: Workspace, useValue: { root } },
        {
          provide: SourceControlProviders,
          useValue: { create: (): SourceControlProvider => provider as SourceControlProvider },
        },
        { provide: DirectoryWatch, useValue: directoryWatch },
        {
          provide: VersionControlPrompt,
          useValue: {
            isInstalled: pluginInstalled,
            offer: (repository: DetectedRepository): void => {
              offers.push(repository);
            },
          },
        },
        {
          provide: RepositoryTrust,
          useValue: {
            ensureTrusted: (info: RepositoryInfo): Promise<boolean> => {
              if (info.trust !== 'unknown') {
                return Promise.resolve(info.trust === 'trusted');
              }
              trustAsked.push(info);
              return Promise.resolve(trustAnswer);
            },
            trust: (repositoryRoot: string): Promise<boolean> => {
              trustGranted.push(repositoryRoot);
              resolved = { root: repositoryRoot, name: 'repo', trust: 'trusted' };
              return Promise.resolve(true);
            },
          },
        },
      ],
    });
    git = TestBed.inject(WorkspaceGit);
  });

  /**
   * Runs the binding effect for the current workspace root and waits for it to settle.
   * @returns Returns a promise that resolves once the binding has settled.
   */
  async function bind(): Promise<void> {
    TestBed.tick();
    await settle();
  }

  it('bind_whenFolderIsARepository_readsBranchAndFileStatus', async () => {
    root.set(listing('/repo'));
    await bind();

    expect(git.isRepository()).toBe(true);
    expect(git.branch()).toBe('main');
    expect(git.stateFor('/repo/src/app/main.ts')).toBe('modified');
    // #860: a new file not under version control is untracked, not added.
    expect(git.stateFor('/repo/README.md')).toBe('untracked');
    expect(git.stateFor('/repo/src/other.ts')).toBeNull();
  });

  it('stateFor_normalisesSeparatorsAndTrailingSlashes', async () => {
    root.set(listing('/repo'));
    await bind();

    expect(git.stateFor('\\repo\\src\\app\\main.ts')).toBe('modified');
    expect(git.stateFor('/repo/src/')).toBe('contains');
  });

  it('stateFor_marksEveryAncestorOfAChange_asContainingChanges', async () => {
    root.set(listing('/repo'));
    await bind();

    expect(git.stateFor('/repo/src/app')).toBe('contains');
    expect(git.stateFor('/repo/src')).toBe('contains');
    expect(git.stateFor('/repo')).toBe('contains');
    expect(git.stateFor('/repo/docs')).toBeNull();
  });

  it('stateFor_keepsAnAddedFileAdded_evenOnceItIsEditedAgain', async () => {
    // Staged as new, then changed in the worktree: still new to the repository until committed.
    status = {
      ...status,
      staged: [change('src/new.ts', 'added')],
      unstaged: [change('src/new.ts', 'modified')],
    };
    root.set(listing('/repo'));
    await bind();

    expect(git.stateFor('/repo/src/new.ts')).toBe('added');
  });

  it('stateFor_givesEverythingInAnUntrackedOrIgnoredDirectoryThatDirectorysState', async () => {
    status = {
      ...status,
      staged: [],
      unstaged: [change('scratch/', 'added', true)],
      ignored: ['node_modules/', '.env'],
    };
    root.set(listing('/repo'));
    await bind();

    expect(git.stateFor('/repo/scratch')).toBe('untracked');
    expect(git.stateFor('/repo/scratch/deep/file.ts')).toBe('untracked');
    expect(git.stateFor('/repo/node_modules')).toBe('ignored');
    expect(git.stateFor('/repo/node_modules/pkg/index.js')).toBe('ignored');
    expect(git.stateFor('/repo/.env')).toBe('ignored');
  });

  it('stateFor_doesNotMarkAFolderAsContainingChanges_forAnIgnoredPathInIt', async () => {
    status = { ...status, staged: [], unstaged: [], ignored: ['docs/build/'] };
    root.set(listing('/repo'));
    await bind();

    expect(git.stateFor('/repo/docs')).toBeNull();
    expect(git.stateFor('/repo')).toBeNull();
  });

  it('addToVersionControl_stagesTheRepositoryRelativePath_andReadsTheStatusAgain', async () => {
    root.set(listing('/repo'));
    await bind();
    expect(git.canAddToVersionControl('/repo/README.md')).toBe(true);
    expect(git.canAddToVersionControl('/repo/src/app/main.ts')).toBe(false);

    status = { ...status, staged: [change('README.md', 'added')], unstaged: [] };
    const result: MutationResult = await git.addToVersionControl('/repo/README.md');

    expect(result.success).toBe(true);
    expect(staged).toEqual([['README.md']]);
    expect(git.stateFor('/repo/README.md')).toBe('added');
  });

  it('canShowDiff_isTrueOnlyForAModifiedPath', async () => {
    root.set(listing('/repo'));
    await bind();

    expect(git.canShowDiff('/repo/src/app/main.ts')).toBe(true);
    // Untracked has no diff against HEAD, and a folder holding changes is not itself modified.
    expect(git.canShowDiff('/repo/README.md')).toBe(false);
    expect(git.canShowDiff('/repo/src')).toBe(false);
  });

  it('addToVersionControl_refusesAPathOutsideTheRepository_withoutStagingEverything', async () => {
    // An empty path list stages the whole working tree, so the root itself must never become one.
    root.set(listing('/repo'));
    await bind();

    expect((await git.addToVersionControl('/elsewhere/a.ts')).success).toBe(false);
    expect((await git.addToVersionControl('/repo')).success).toBe(false);
    expect(staged).toEqual([]);
  });

  it('revertableFiles_offersOnlyEditedOrDeletedFiles_neverOnesRevertWouldDelete', async () => {
    // #1042: restoring an added or renamed file from HEAD deletes it, so Revert never reaches one.
    status = {
      ...status,
      staged: [
        change('src/app/main.ts', 'modified'),
        change('src/app/new.ts', 'added'),
        change('src/app/moved.ts', 'renamed'),
      ],
      unstaged: [
        change('src/app/gone.ts', 'deleted'),
        change('src/app/new.ts', 'modified'),
        change('src/app/scratch.ts', 'added', true),
      ],
      conflicted: [change('src/both.ts', 'conflicted')],
    };
    root.set(listing('/repo'));
    await bind();

    expect(git.revertableFiles('/repo/src/app/main.ts')).toEqual(['/repo/src/app/main.ts']);
    expect(git.revertableFiles('/repo/src/app/gone.ts')).toEqual(['/repo/src/app/gone.ts']);
    expect(git.revertableFiles('/repo/src/app/new.ts')).toEqual([]);
    expect(git.revertableFiles('/repo/src/app/moved.ts')).toEqual([]);
    expect(git.revertableFiles('/repo/src/app/scratch.ts')).toEqual([]);
    expect(git.revertableFiles('/repo/src/both.ts')).toEqual([]);
    // A folder offers every edited file beneath it, and nothing else.
    expect([...git.revertableFiles('/repo/src')].sort()).toEqual([
      '/repo/src/app/gone.ts',
      '/repo/src/app/main.ts',
    ]);
    expect(git.revertableFiles('/repo/docs')).toEqual([]);
  });

  it('revert_discardsEachFileByName_neverTheFolder_andReadsTheStatusAgain', async () => {
    status = { ...status, unstaged: [change('src/app/other.ts', 'modified')] };
    root.set(listing('/repo'));
    await bind();

    status = { ...status, staged: [], unstaged: [] };
    const result: MutationResult = await git.revert(git.revertableFiles('/repo/src'));

    expect(result.success).toBe(true);
    expect(discarded).toHaveLength(1);
    expect([...discarded[0]].sort()).toEqual(['src/app/main.ts', 'src/app/other.ts']);
    expect(git.stateFor('/repo/src/app/main.ts')).toBeNull();
  });

  it('revert_refusesAFileItCannotRevert_withoutDiscardingAnything', async () => {
    root.set(listing('/repo'));
    await bind();

    // README.md is untracked: discarding it would delete it.
    expect((await git.revert(['/repo/README.md'])).success).toBe(false);
    expect((await git.revert([])).success).toBe(false);
    expect(discarded).toEqual([]);
  });

  it('undoAdd_unstagesAnAddedFile_soItIsUntrackedAgain', async () => {
    status = { ...status, staged: [change('src/new.ts', 'added')], unstaged: [] };
    root.set(listing('/repo'));
    await bind();
    expect(git.canUndoAdd('/repo/src/new.ts')).toBe(true);
    expect(git.canUndoAdd('/repo/README.md')).toBe(false);

    status = { ...status, staged: [], unstaged: [change('src/new.ts', 'added', true)] };
    await git.undoAdd('/repo/src/new.ts');

    expect(unstaged).toEqual([['src/new.ts']]);
    expect(git.stateFor('/repo/src/new.ts')).toBe('untracked');
  });

  it('markResolved_stagesAConflictedFile', async () => {
    status = { ...status, conflicted: [change('src/both.ts', 'conflicted')] };
    root.set(listing('/repo'));
    await bind();
    expect(git.isConflicted('/repo/src/both.ts')).toBe(true);
    expect(git.isConflicted('/repo/src/app/main.ts')).toBe(false);

    await git.markResolved('/repo/src/both.ts');

    expect(staged).toEqual([['src/both.ts']]);
  });

  it('stateFor_findsTheState_whenTheWorkspaceWasOpenedThroughASymlink', async () => {
    // #862: macOS opens /var/… as /private/var/…. The repository answers in real paths; the explorers
    // hold the symlinked ones — they must still meet.
    resolved = {
      root: '/private/repo',
      name: 'repo',
      realDirectory: '/private/repo',
      trust: 'trusted',
    };
    root.set(listing('/repo'));
    await bind();

    expect(git.stateFor('/repo/src/app/main.ts')).toBe('modified');
    expect(git.stateFor('/repo/src')).toBe('contains');
    expect(git.stateFor('/repo/README.md')).toBe('untracked');

    await git.addToVersionControl('/repo/README.md');
    expect(staged).toEqual([['README.md']]);
  });

  it('stateFor_marksAConflictedPath', async () => {
    status = { ...status, conflicted: [change('src/both.ts', 'conflicted')] };
    root.set(listing('/repo'));
    await bind();

    expect(git.stateFor('/repo/src/both.ts')).toBe('conflicted');
  });

  it('bind_whenFolderIsNotARepository_staysUnbound', async () => {
    resolved = null;
    root.set(listing('/plain'));
    await bind();

    expect(git.isRepository()).toBe(false);
    expect(git.branch()).toBeNull();
    expect(git.stateFor('/plain/file.ts')).toBeNull();
  });

  it('bind_whenFolderIsARepositoryNoInstalledPluginReads_offersThePlugin', async () => {
    resolved = null;
    detected = { pluginId: 'onixlabs.git', displayName: 'Git', installed: false };
    root.set(listing('/repo'));
    await bind();

    expect(git.isRepository()).toBe(false);
    expect(offers).toEqual([detected]);
  });

  it('bind_whenAPluginIsInstalled_resolvesTheFolderAgain', async () => {
    resolved = null;
    detected = { pluginId: 'onixlabs.git', displayName: 'Git', installed: false };
    root.set(listing('/repo'));
    await bind();
    expect(git.isRepository()).toBe(false);

    resolved = { root: '/repo', name: 'repo', trust: 'trusted' };
    pluginInstalled.set(true);
    await bind();

    expect(git.isRepository()).toBe(true);
  });

  it('bind_whenTheRepositoryIsNotYetTrusted_asksFirst_andBindsOnYes', async () => {
    resolved = { root: '/repo', name: 'repo', trust: 'unknown' };
    root.set(listing('/repo'));
    await bind();

    expect(trustAsked.map((info: RepositoryInfo): string => info.root)).toEqual(['/repo']);
    expect(git.isRepository()).toBe(true);
    expect(git.isRestricted()).toBe(false);
  });

  it('bind_whenTheRepositoryIsNotTrusted_readsNothing_andSaysSo', async () => {
    // The main process would refuse every read anyway; the explorer shows why rather than looking
    // like a plain folder, and releases its hold on the repository.
    resolved = { root: '/repo', name: 'repo', trust: 'unknown' };
    trustAnswer = false;
    root.set(listing('/repo'));
    await bind();

    expect(git.isRepository()).toBe(false);
    expect(git.isRestricted()).toBe(true);
    expect(git.branch()).toBeNull();
    expect(git.stateFor('/repo/src/app/main.ts')).toBeNull();
    expect(closed).toEqual(['/repo']);
  });

  it('trustRepository_bindsARestrictedRepository', async () => {
    resolved = { root: '/repo', name: 'repo', trust: 'restricted' };
    root.set(listing('/repo'));
    await bind();
    expect(git.isRestricted()).toBe(true);
    expect(trustAsked).toEqual([]);

    await git.trustRepository();
    await settle();

    expect(trustGranted).toEqual(['/repo']);
    expect(git.isRestricted()).toBe(false);
    expect(git.isRepository()).toBe(true);
    expect(git.branch()).toBe('main');
  });

  it('bind_whenFolderIsNoRepositoryAtAll_offersNothing', async () => {
    resolved = null;
    detected = null;
    root.set(listing('/plain'));
    await bind();

    expect(offers).toEqual([]);
  });

  it('bind_whenFolderChangesToNull_releasesTheRepository', async () => {
    root.set(listing('/repo'));
    await bind();

    root.set(null);
    await bind();

    expect(closed).toContain('/repo');
    expect(git.isRepository()).toBe(false);
    expect(git.branch()).toBeNull();
    expect(git.stateFor('/repo/src')).toBeNull();
  });

  it('dispose_releasesTheRepositoryAndClearsAllStatus', async () => {
    root.set(listing('/repo'));
    await bind();

    git.dispose();

    expect(closed).toContain('/repo');
    expect(git.isRepository()).toBe(false);
    expect(git.stateFor('/repo/src/app/main.ts')).toBeNull();
    expect(git.branch()).toBeNull();
  });

  it('refresh_afterTheStatusChanges_reloadsTheWorkingTree', async () => {
    root.set(listing('/repo'));
    await bind();

    status = { ...status, branch: 'develop', staged: [], unstaged: [] };
    await git.refresh();

    expect(git.branch()).toBe('develop');
    expect(git.stateFor('/repo/src/app/main.ts')).toBeNull();
    expect(git.stateFor('/repo/src')).toBeNull();
  });

  it('watch_whenTheRepositoryChangesOnDisk_refreshesBranchWithoutReactivation', async () => {
    root.set(listing('/repo'));
    await bind();
    expect(watched).toContain('/repo');
    expect(git.branch()).toBe('main');

    // An agent creates and switches to a new branch on disk; the directory watcher fires.
    status = { ...status, branch: 'feature/x' };
    fireWatch();
    await new Promise((resolve: (value: void) => void): void => {
      setTimeout(resolve, 600);
    });
    await settle();

    expect(git.branch()).toBe('feature/x');
  });

  it('watch_afterRelease_stopsRefreshing', async () => {
    root.set(listing('/repo'));
    await bind();
    git.dispose();

    status = { ...status, branch: 'feature/x' };
    fireWatch();
    await new Promise((resolve: (value: void) => void): void => {
      setTimeout(resolve, 600);
    });
    await settle();

    expect(git.branch()).toBeNull();
  });
});

describe('scmRowFields', () => {
  it('colours each state, and says it in words too', () => {
    expect(scmRowFields(null)).toEqual({});
    expect(scmRowFields('untracked')).toMatchObject({ tone: 'danger' });
    expect(scmRowFields('added')).toMatchObject({ tone: 'success' });
    expect(scmRowFields('modified')).toMatchObject({ tone: 'warning', hint: 'Modified' });
    expect(scmRowFields('conflicted')).toMatchObject({ tone: 'danger', strong: true });
    expect(scmRowFields('ignored')).toMatchObject({ tone: 'muted' });
    expect(scmRowFields('contains')).toMatchObject({ tone: 'info', hint: 'Contains changes' });
  });
});
