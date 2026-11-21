import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  Signal,
  untracked,
  WritableSignal,
} from '@angular/core';
import { StatusStripSegments } from '@shared/angular/components/strips/status-strip/status-strip-segments/status-strip-segments';
import { Icon } from '@shared/angular/icons/icon';
import { StatusSegment } from '@shared/angular/services/status-bar/status-segment';
import { Repository } from '@shared/angular/services/repository/repository';
import { RepositoryTrust } from '@shared/angular/services/repository-trust/repository-trust';
import type { RepositoryTrustDecision } from '@shared/api/source-control-channels';
import { GitBranch } from '@shared/angular/services/repository/repository-data';
import { DirectoryListing } from '@shared/api/workspace-channels';
import { Workspace } from '@shared/angular/services/workspace/workspace';
import { WorktreeSession } from '@features/workspace/angular/worktree/worktree-session';
import { LiveServerSession } from '@features/workspace/angular/live-server/live-server-session';
import type { LiveServerInfo } from '@shared/api/live-server-channels';

/**
 * Identifies the Live Server chip's menu rows (#1062).
 */
const LIVE_SERVER_OPEN: string = 'live-server.open';
const LIVE_SERVER_COPY: string = 'live-server.copy';
const LIVE_SERVER_STOP: string = 'live-server.stop';

/**
 * Shows the active workspace view's status at the start of the strip: the open folder, whether it
 * is trusted, and — when that folder is a git repository — the checkout, the branch, the uncommitted
 * changes, and the commits waiting to be pushed and pulled.
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
   * Holds the trust question's client, which reads and asks for the folder's trust.
   */
  private readonly trust: RepositoryTrust = inject(RepositoryTrust);

  /**
   * Holds the view's live server, whose chip shows while it runs (#1062).
   */
  private readonly liveServer: LiveServerSession = inject(LiveServerSession);

  /**
   * Holds what the user decided about the open folder, read again whenever a decision changes.
   */
  private readonly decision: WritableSignal<RepositoryTrustDecision | null> =
    signal<RepositoryTrustDecision | null>(null);

  /**
   * Initializes a new instance of the {@link DirectoryStatusStrip} class, reading the open folder's
   * trust as the folder opens and whenever a decision changes.
   */
  public constructor() {
    effect((): void => {
      const root: string | null = this.workspace.root()?.path ?? null;
      this.trust.changed();
      untracked((): void => {
        if (root === null) {
          this.decision.set(null);
          return;
        }
        void this.trust.state(root).then((decision: RepositoryTrustDecision): void => {
          if (this.workspace.root()?.path === root) {
            this.decision.set(decision);
          }
        });
      });
    });
  }

  /**
   * Gets the start-aligned segments: the workspace's own, then the Live Server chip while one serves
   * this workspace.
   */
  protected readonly leading: Signal<readonly StatusSegment[]> = computed(
    (): readonly StatusSegment[] => [...this.workspaceSegments(), ...this.liveServerSegments()],
  );

  /**
   * Gets the Live Server chip (#1062): the address it serves at, with a menu that opens it again,
   * copies it, or stops the server.
   */
  private readonly liveServerSegments: Signal<readonly StatusSegment[]> = computed(
    (): readonly StatusSegment[] => {
      const server: LiveServerInfo | null = this.liveServer.server();
      if (server === null) {
        return [];
      }
      const address: string = server.url.replace(/^http:\/\//, '').replace(/\/$/, '');
      return [
        {
          id: 'ws-live-server',
          text: $localize`:The status-strip chip of a running Live Server, followed by its address such as 127.0.0.1.5500:Live Server ${address}:address:`,
          icon: Icon.LIVE_SERVER,
          title: $localize`:Hover text of the Live Server status-strip chip:Live Server is serving this workspace at ${server.url}:url:`,
          menu: {
            items: [
              {
                id: LIVE_SERVER_OPEN,
                label: $localize`:Opens the Live Server's address in the browser:Open in Browser`,
                icon: Icon.LIVE_SERVER,
              },
              {
                id: LIVE_SERVER_COPY,
                label: $localize`:Copies the Live Server's address:Copy Address`,
                icon: Icon.COPY,
              },
              { id: 'live-server.sep', label: '', separator: true },
              {
                id: LIVE_SERVER_STOP,
                label: $localize`:Stops the Live Server, freeing its port:Stop Live Server`,
                icon: Icon.STOP,
              },
            ],
            choose: (id: string): void => this.chooseLiveServer(id),
          },
        },
      ];
    },
  );

  /**
   * Runs a row chosen from the Live Server chip's menu.
   * @param id The chosen row.
   */
  private chooseLiveServer(id: string): void {
    switch (id) {
      case LIVE_SERVER_OPEN:
        void this.liveServer.openAddress();
        return;
      case LIVE_SERVER_COPY:
        void this.liveServer.copyAddress();
        return;
      case LIVE_SERVER_STOP:
        void this.liveServer.stop();
        return;
      default:
        return;
    }
  }

  /**
   * Gets the workspace's own segments: the workspace folder, then the version-control segments when
   * the folder is a repository.
   */
  private readonly workspaceSegments: Signal<readonly StatusSegment[]> = computed(
    (): readonly StatusSegment[] => {
      const root: DirectoryListing | null = this.workspace.root();
      if (root === null) {
        return [];
      }
      // The workspace segment: the open folder, always shown while the workspace is in view — whether
      // or not it is a git repository. A checkout's directory is a GUID, so a container tab names the
      // container instead. No icon (#882): the strip's kind segment before it already wears the
      // folder, and a second would read as the same thing twice.
      const workspaceName: string = this.containerName() ?? root.name ?? this.repository.repoName();
      const segments: StatusSegment[] = [
        { id: 'ws-folder', text: workspaceName, title: workspaceName, shrink: 'end' },
      ];
      // A folder not yet trusted runs nothing (#1504), which explains empty panels; this says so,
      // and is where the user trusts it once they have decided they do.
      const decision: RepositoryTrustDecision | null = this.decision();
      if (decision !== null && decision !== 'trusted') {
        const folder: string = root.path;
        segments.push({
          id: 'ws-trust',
          text: 'Not Trusted',
          icon: Icon.LOCK,
          title:
            'Nothing runs from this folder: no language servers, build tools or version control. ' +
            'Click to choose whether to trust it.',
          activate: (): void => {
            void this.trust.trust(folder);
          },
        });
      }
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
          segments.push({
            id: 'ws-worktree',
            text: label,
            icon: Icon.WORKTREE,
            title: label,
            shrink: 'end',
          });
        }
      }
      const branchName: string = branch?.name ?? 'detached HEAD';
      segments.push({
        id: 'ws-branch',
        text: branchName,
        icon: Icon.BRANCH,
        title: `On branch ${branchName}`,
        shrink: 'end',
      });
      // What is waiting to be committed, before what is waiting to be pushed: the three counts read
      // left to right in the order work actually travels — written, then committed, then sent. Shown
      // at zero like its neighbours, and outside the branch check because a detached HEAD can have
      // uncommitted changes just as readily.
      const changes: number = this.repository.changeCount();
      segments.push({
        id: 'ws-changes',
        text: `${changes}`,
        icon: Icon.GIT_COMMIT,
        title: `${changes} uncommitted change(s)`,
      });
      // The commits to push and to pull, only for a branch that tracks one (#882): a branch never
      // published has nothing to be ahead of or behind, and 0 / 0 would read as "in sync".
      if (branch?.upstream !== undefined) {
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
