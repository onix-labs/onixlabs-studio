import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RepositoryInfo, SourceControlClient } from '@shared/api/source-control-channels';
import { DirectoryListing } from '@shared/api/workspace-channels';
import { GitFileChange } from '@shared/angular/services/repository/repository-data';
import { ParsedStatus } from '@shared/angular/services/source-control/git-output';
import { SourceControl } from '@shared/angular/services/source-control/source-control';
import { SourceControlProvider } from '@shared/angular/services/source-control/source-control-provider';
import { SourceControlProviders } from '@shared/angular/services/source-control/source-control-providers';
import { Workspace } from '@shared/angular/services/workspace/workspace';

import { WorkspaceGit } from './workspace-git';

/**
 * Builds a file change with the given repository-relative path and status.
 * @param path The repository-relative path.
 * @param status The change status.
 * @returns Returns the file change.
 */
function change(path: string, status: GitFileChange['status']): GitFileChange {
  return {
    path,
    status,
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
  let closed: string[];
  let status: ParsedStatus;

  beforeEach(() => {
    root = signal<DirectoryListing | null>(null);
    resolved = { root: '/repo', name: 'repo' };
    closed = [];
    status = {
      branch: 'main',
      upstream: 'origin/main',
      ahead: 0,
      behind: 0,
      staged: [change('src/app/main.ts', 'modified')],
      unstaged: [change('README.md', 'added')],
    };

    const client: Pick<SourceControlClient, 'resolveRepository' | 'closeRepository'> = {
      resolveRepository: (): Promise<RepositoryInfo | null> => Promise.resolve(resolved),
      closeRepository: (repositoryRoot: string): Promise<void> => {
        closed.push(repositoryRoot);
        return Promise.resolve();
      },
    };
    const provider: Pick<SourceControlProvider, 'getStatus'> = {
      getStatus: (): Promise<ParsedStatus> => Promise.resolve(status),
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
    expect(git.statusFor('/repo/src/app/main.ts')).toBe('modified');
    expect(git.statusFor('/repo/README.md')).toBe('added');
    expect(git.statusFor('/repo/src/other.ts')).toBeNull();
  });

  it('statusFor_normalisesSeparatorsAndTrailingSlashes', async () => {
    root.set(listing('/repo'));
    await bind();

    expect(git.statusFor('\\repo\\src\\app\\main.ts')).toBe('modified');
    expect(git.hasChanges('/repo/src/')).toBe(true);
  });

  it('hasChanges_flagsEveryAncestorDirectoryOfAChange', async () => {
    root.set(listing('/repo'));
    await bind();

    expect(git.hasChanges('/repo/src/app')).toBe(true);
    expect(git.hasChanges('/repo/src')).toBe(true);
    expect(git.hasChanges('/repo')).toBe(true);
    expect(git.hasChanges('/repo/docs')).toBe(false);
  });

  it('bind_whenFolderIsNotARepository_staysUnbound', async () => {
    resolved = null;
    root.set(listing('/plain'));
    await bind();

    expect(git.isRepository()).toBe(false);
    expect(git.branch()).toBeNull();
    expect(git.statusFor('/plain/file.ts')).toBeNull();
  });

  it('bind_whenFolderChangesToNull_releasesTheRepository', async () => {
    root.set(listing('/repo'));
    await bind();

    root.set(null);
    await bind();

    expect(closed).toContain('/repo');
    expect(git.isRepository()).toBe(false);
    expect(git.branch()).toBeNull();
    expect(git.hasChanges('/repo/src')).toBe(false);
  });

  it('dispose_releasesTheRepositoryAndClearsAllStatus', async () => {
    root.set(listing('/repo'));
    await bind();

    git.dispose();

    expect(closed).toContain('/repo');
    expect(git.isRepository()).toBe(false);
    expect(git.statusFor('/repo/src/app/main.ts')).toBeNull();
    expect(git.branch()).toBeNull();
  });

  it('refresh_afterTheStatusChanges_reloadsTheWorkingTree', async () => {
    root.set(listing('/repo'));
    await bind();

    status = { ...status, branch: 'develop', staged: [], unstaged: [] };
    await git.refresh();

    expect(git.branch()).toBe('develop');
    expect(git.statusFor('/repo/src/app/main.ts')).toBeNull();
    expect(git.hasChanges('/repo/src')).toBe(false);
  });
});
