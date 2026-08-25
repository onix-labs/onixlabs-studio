import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Repository } from '@shared/angular/services/repository/repository';
import { GitBranch } from '@shared/angular/services/repository/repository-data';
import { Workspace } from '@shared/angular/services/workspace/workspace';
import { DirectoryListing } from '@shared/api/workspace-channels';
import { WorktreeSession } from '@features/workspace/angular/worktree/worktree-session';

import { DirectoryStatusStrip } from './directory-status-strip';

/**
 * Reads the rendered segment texts in render order.
 * @param fixture The mounted strip fixture.
 * @returns Returns the segment texts.
 */
function segmentsOf(fixture: ComponentFixture<DirectoryStatusStrip>): string[] {
  const host: HTMLElement = fixture.nativeElement as HTMLElement;
  return [...host.querySelectorAll('.status-strip-segment')].map((element: Element): string =>
    (element.textContent ?? '').trim(),
  );
}

/**
 * Builds a branch with the given ahead and behind counts.
 * @param ahead The commits to push.
 * @param behind The commits to pull.
 * @returns Returns the branch.
 */
function makeBranch(ahead: number, behind: number): GitBranch {
  return { name: 'main', current: true, upstream: 'origin/main', ahead, behind, tip: 'c2' };
}

describe('DirectoryStatusStrip', () => {
  let fixture: ComponentFixture<DirectoryStatusStrip>;
  let root: WritableSignal<DirectoryListing | null>;
  let isBound: WritableSignal<boolean>;
  let branch: WritableSignal<GitBranch | undefined>;
  let changeCount: WritableSignal<number>;

  beforeEach(() => {
    root = signal<DirectoryListing | null>({ name: 'studio' } as DirectoryListing);
    isBound = signal<boolean>(true);
    branch = signal<GitBranch | undefined>(makeBranch(2, 1));
    changeCount = signal<number>(7);

    TestBed.configureTestingModule({
      providers: [
        { provide: Workspace, useValue: { root } },
        {
          provide: Repository,
          useValue: {
            isBound,
            currentBranch: branch,
            changeCount,
            repoName: signal<string>('studio'),
          },
        },
        {
          provide: WorktreeSession,
          useValue: {
            isContainer: signal<boolean>(false),
            activeLabel: signal<string | null>(null),
            root: signal<string | null>(null),
          },
        },
      ],
    });
    fixture = TestBed.createComponent(DirectoryStatusStrip);
  });

  it('readsLeftToRight_inTheOrderWorkTravels', () => {
    fixture.detectChanges();

    // Written, then committed, then sent: changes sit between the branch and the push count.
    expect(segmentsOf(fixture)).toEqual(['studio', 'main', '7', '2', '1']);
  });

  it('showsTheChangeCountAtZero_likeItsNeighbours', () => {
    changeCount.set(0);
    fixture.detectChanges();

    expect(segmentsOf(fixture)).toEqual(['studio', 'main', '0', '2', '1']);
  });

  it('showsTheChangeCount_evenOnADetachedHead', () => {
    // There is no branch to be ahead or behind of, but the working tree can still be dirty.
    branch.set(undefined);
    fixture.detectChanges();

    expect(segmentsOf(fixture)).toEqual(['studio', 'detached HEAD', '7']);
  });

  it('showsNoGitSegments_whenTheFolderIsNotARepository', () => {
    isBound.set(false);
    fixture.detectChanges();

    expect(segmentsOf(fixture)).toEqual(['studio']);
  });

  it('showsNothing_whenNoFolderIsOpen', () => {
    root.set(null);
    fixture.detectChanges();

    expect(segmentsOf(fixture)).toEqual([]);
  });
});
