import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Repository } from '@shared/angular/services/repository/repository';
import { RepositoryTrust } from '@shared/angular/services/repository-trust/repository-trust';
import type { RepositoryTrustDecision } from '@shared/api/source-control-channels';
import type { TrustChange } from '@shared/api/trust-channels';
import { GitBranch } from '@shared/angular/services/repository/repository-data';
import { Workspace } from '@shared/angular/services/workspace/workspace';
import { DirectoryListing } from '@shared/api/workspace-channels';
import { WorktreeSession } from '@features/workspace/angular/worktree/worktree-session';
import { LiveServerSession } from '@features/workspace/angular/live-server/live-server-session';
import type { LiveServerInfo } from '@shared/api/live-server-channels';

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
  let decision: RepositoryTrustDecision;
  let changed: WritableSignal<TrustChange | null>;
  let asked: string[];
  let liveServer: WritableSignal<LiveServerInfo | null>;

  beforeEach(() => {
    liveServer = signal<LiveServerInfo | null>(null);
    root = signal<DirectoryListing | null>({
      name: 'studio',
      path: '/work/studio',
    } as DirectoryListing);
    decision = 'trusted';
    changed = signal<TrustChange | null>(null);
    asked = [];
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
          provide: RepositoryTrust,
          useValue: {
            changed,
            state: (): Promise<RepositoryTrustDecision> => Promise.resolve(decision),
            trust: (folder: string): Promise<boolean> => {
              asked.push(folder);
              return Promise.resolve(true);
            },
          },
        },
        { provide: LiveServerSession, useValue: { server: liveServer } },
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

  it('showsNoPushOrPullCounts_forABranchWithNoUpstream (#882)', () => {
    // Never published: nothing to be ahead of or behind, so 0 / 0 would wrongly read as in sync.
    branch.set({ name: 'feature', current: true, ahead: 0, behind: 0, tip: 'c3' });
    fixture.detectChanges();

    expect(segmentsOf(fixture)).toEqual(['studio', 'feature', '7']);
  });

  it('namesTheFolderWithoutAnIcon (#882)', () => {
    // The strip's kind segment ("Workspace") already wears the folder icon.
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    const first: Element | null = host.querySelector('app-status-strip-segment');
    expect(first?.textContent?.trim()).toBe('studio');
    expect(first?.querySelector('app-icon')).toBeNull();
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

  it('saysAFolderIsNotTrusted_andAsksWhenClicked (#1504)', async () => {
    decision = 'restricted';
    isBound.set(false);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(segmentsOf(fixture)).toEqual(['studio', 'Not Trusted']);

    const chip: HTMLElement | null = (
      fixture.nativeElement as HTMLElement
    ).querySelectorAll<HTMLElement>('.status-strip-segment')[1];
    chip?.click();
    expect(asked).toEqual(['/work/studio']);
  });

  it('dropsTheNotTrustedChip_onceTheFolderIsTrusted', async () => {
    decision = 'unknown';
    isBound.set(false);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(segmentsOf(fixture)).toEqual(['studio', 'Not Trusted']);

    decision = 'trusted';
    changed.set({ folder: '/work/studio', decision: 'trusted' });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(segmentsOf(fixture)).toEqual(['studio']);
  });

  it('showsTheLiveServerChip_withItsAddress_whileOneServesTheWorkspace (#1062)', () => {
    fixture.detectChanges();
    expect(segmentsOf(fixture)).not.toContain('Live Server 127.0.0.1:5500');

    liveServer.set({
      root: '/work/studio',
      url: 'http://127.0.0.1:5500/',
      port: 5500,
      displayName: 'Live Server',
    });
    fixture.detectChanges();

    expect(segmentsOf(fixture)).toEqual([
      'studio',
      'main',
      '7',
      '2',
      '1',
      'Live Server 127.0.0.1:5500',
    ]);
  });
});
