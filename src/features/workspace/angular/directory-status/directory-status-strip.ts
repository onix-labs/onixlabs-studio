import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { StatusStripSegments } from '@shared/angular/components/strips/status-strip/status-strip-segments/status-strip-segments';
import { Icon } from '@shared/angular/icons/icon';
import { StatusSegment } from '@shared/angular/services/status-bar/status-segment';
import { Repository } from '@shared/angular/services/repository/repository';
import { GitBranch } from '@shared/angular/services/repository/repository-data';
import { DirectoryListing } from '@shared/api/workspace-channels';
import { Workspace } from '@shared/angular/services/workspace/workspace';
import { WorktreeSession } from '@features/workspace/angular/worktree/worktree-session';

/**
 * Shows the active workspace view's status at the start of the strip: the open folder, and — when
 * that folder is a git repository — the checkout, branch, and the commits waiting to be pushed and
 * pulled.
 *
 * Mounted by the status strip through the active workspace view's injector, so it reads that view's
 * own {@link Workspace} and {@link Repository}. A worktree container tab holds one sub-view per
 * checkout, and the injector published for the tab is the selected checkout's — so this reports the
 * checkout the user is actually looking at, with no owner key to qualify.
 */
@Component({
  selector: 'app-directory-status-strip',
  imports: [StatusStripSegments],
  template: `<app-status-strip-segments [leading]="leading()" />`,
  // The host must add no box of its own: the strip lays the segment groups and their flexible
  // spacer out in its own flex row, and a shrink-to-fit host would trap the spacer, bunching the
  // trailing segments and the ambient region up on the left.
  styles: [':host { display: contents; }'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DirectoryStatusStrip {
  /**
   * Holds the view's workspace, supplying the open folder.
   */
  private readonly workspace: Workspace = inject(Workspace);

  /**
   * Holds the view's repository, supplying the branch and its ahead/behind counts.
   */
  private readonly repository: Repository = inject(Repository);

  /**
   * Holds the tab's worktree session, naming the container and the selected checkout.
   */
  private readonly worktreeSession: WorktreeSession = inject(WorktreeSession);

  /**
   * Gets the start-aligned segments: the workspace folder, then the git segments when the folder is
   * a repository.
   */
  protected readonly leading: Signal<readonly StatusSegment[]> = computed(
    (): readonly StatusSegment[] => {
      const root: DirectoryListing | null = this.workspace.root();
      if (root === null) {
        return [];
      }
      // The workspace segment: the open folder, always shown while the workspace is in view — whether
      // or not it is a git repository. A checkout's directory is a GUID, so a container tab names the
      // container instead.
      const workspaceName: string = this.containerName() ?? root.name ?? this.repository.repoName();
      const segments: StatusSegment[] = [
        { id: 'ws-folder', text: workspaceName, icon: Icon.FOLDER_SIMPLE, title: workspaceName },
      ];
      if (!this.repository.isBound()) {
        return segments;
      }
      // The git segments follow: branch, then the commits to push and to pull, left to right.
      const branch: GitBranch | undefined = this.repository.currentBranch();
      // The worktree indicator: which checkout the container tab is scoped to. Shown only when it
      // says something the branch segment does not (an alias) — an unaliased checkout's label IS its
      // branch, and "main main" is noise.
      if (this.worktreeSession.isContainer()) {
        const label: string | null = this.worktreeSession.activeLabel();
        if (label !== null && label !== (branch?.name ?? '')) {
          segments.push({ id: 'ws-worktree', text: label, icon: Icon.WORKTREE, title: label });
        }
      }
      const branchName: string = branch?.name ?? 'detached HEAD';
      segments.push({
        id: 'ws-branch',
        text: branchName,
        icon: Icon.BRANCH,
        title: `On branch ${branchName}`,
      });
      if (branch !== undefined) {
        segments.push(
          {
            id: 'ws-push',
            text: `${branch.ahead}`,
            icon: Icon.COMMITS_AHEAD,
            title: `${branch.ahead} commit(s) to push`,
          },
          {
            id: 'ws-pull',
            text: `${branch.behind}`,
            icon: Icon.COMMITS_BEHIND,
            title: `${branch.behind} commit(s) to pull`,
          },
        );
      }
      return segments;
    },
  );

  /**
   * Gets the container tab's name — the last segment of the worktree session's root — or null when
   * the tab is a plain workspace.
   * @returns Returns the container name, or null.
   */
  private containerName(): string | null {
    const root: string | null = this.worktreeSession.root();
    if (root === null) {
      return null;
    }
    return (
      root
        .split(/[\\/]/)
        .filter((part: string): boolean => part.length > 0)
        .pop() ?? null
    );
  }
}
