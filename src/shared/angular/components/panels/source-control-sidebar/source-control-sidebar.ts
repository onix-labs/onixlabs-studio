import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  OnDestroy,
  Signal,
  signal,
  WritableSignal,
} from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import type { HostingCapability } from '@shared/api/hosting-protocol';
import { VersionControlCapability } from '@shared/api/version-control-protocol';
import { VersionControlMissing } from '../version-control-missing/version-control-missing';
import { RepositoryRestricted } from '../repository-restricted/repository-restricted';
import { WorkspaceGit } from '@features/workspace/angular/workspace-git/workspace-git';
import { VersionControlPrompt } from '@shared/angular/services/plugins/version-control-prompt';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { Repository, WORKING_NODE_ID } from '@shared/angular/services/repository/repository';
import {
  ForgeRepository,
  ForgeSection,
} from '@shared/angular/services/forge-repository/forge-repository';
import {
  ForgeCheckStatus,
  ForgeIssue,
  ForgePullRequest,
  ForgeRunStatus,
  ForgeWorkflowRun,
} from '@shared/api/forge-types';
import { GitMergeMode } from '@shared/api/source-control-channels';
import { Shell } from '@shared/angular/services/shell/shell';
import { DockReveal } from '@shared/angular/services/dock-layout/dock-reveal';
import { IssueAgentConfirm } from '@shared/angular/components/panels/issue-agent-confirm/issue-agent-confirm';
import { IssueAgent } from '@shared/angular/services/issues/issue-agent';
import { IssueOpener } from '@shared/angular/services/issues/issue-opener';
import {
  GitBranch,
  GitCommit,
  GitRemote,
  GitRemoteBranch,
  GitStash,
  GitTag,
} from '@shared/angular/services/repository/repository-data';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Button } from '@shared/angular/components/forms/button/button';
import { ButtonRow } from '@shared/angular/components/forms/button-row/button-row';
import { Checkbox } from '@shared/angular/components/forms/checkbox/checkbox';
import { Modal } from '@shared/angular/components/modal/modal';
import { ModalContent } from '@shared/angular/components/modal/modal-content';
import { ExplorerToolbar } from '@shared/angular/components/explorer-toolbar/explorer-toolbar';
import {
  TreeEdit,
  TreeMenuSelection,
  TreeRow,
  TreeView,
} from '@shared/angular/components/tree-view/tree-view';
import { MenuItem } from '@shared/angular/components/menu/menu';
import { MutationResult } from '@shared/angular/services/source-control/source-control-provider';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { Log } from '@shared/angular/services/log/log';
import { Chip } from '@shared/angular/components/chip/chip';
import { PanelStatus } from '@shared/angular/components/panel-status/panel-status';
import {
  REPOSITORY_WORKTREES,
  RepositoryWorktree,
  RepositoryWorktrees,
  WorktreeBranchDeletion,
} from '@shared/angular/services/repository-worktrees/repository-worktrees';
import { OPEN_IN_FILE_SYSTEM_LABEL } from '@shared/angular/services/shell/shell-labels';
import type { WorktreeBranch } from '@shared/api/worktree';

/**
 * Identifies the outcome of a pull request's checks, as the status badge shows it. Re-exported from
 * the forge model so the panel and the provider cannot drift apart.
 */
export type CheckStatus = ForgeCheckStatus;

/**
 * Describes a branch being deleted: one of this repository's, or, with its worktree, another
 * worktree's (#939).
 */
interface BranchDeletion {
  /**
   * Gets the branch's name.
   */
  readonly name: string;

  /**
   * Gets the worktree the branch lives in, when it is not this repository's.
   */
  readonly worktree?: RepositoryWorktree;
}

/**
 * Describes a row of the repository tree. The same flat shape covers every kind of row (section header,
 * branch, remote, tag, stash, and the stubbed forge entries) so the projected row-content template can
 * render them uniformly; {@link kind} discriminates behaviour and the optional fields carry the extras a
 * given kind needs.
 */
interface RepoNode {
  /**
   * Gets the kind of row, which drives click behaviour and any extra decorations.
   */
  readonly kind:
    | 'section'
    | 'branch'
    | 'worktree'
    | 'worktree-branch'
    | 'remote'
    | 'remote-branch'
    | 'tag'
    | 'stash'
    | 'pr'
    | 'issue'
    | 'action'
    | 'empty';

  /**
   * Gets the row's leading icon.
   */
  readonly icon: Icon;

  /**
   * Gets the row's label.
   */
  readonly label: string;

  /**
   * Gets the section key, for a section header row.
   */
  readonly sectionKey?: string;

  /**
   * Gets a muted note shown after a section header's label — why what is beneath it is not current.
   */
  readonly note?: string;

  /**
   * Gets the branch, for a local-branch row (drives the ahead/behind deltas and checkout action).
   */
  readonly branch?: GitBranch;

  /**
   * Gets the worktree, for a worktree row and for the branch rows of a worktree other than the
   * current one (drives switching, revealing and removal).
   */
  readonly worktree?: RepositoryWorktree;

  /**
   * Gets the branch, for a branch row of a worktree other than the current one. The current
   * worktree's branches are ordinary {@link branch} rows, with every branch action behind them.
   */
  readonly worktreeBranch?: WorktreeBranch;

  /**
   * Gets the changed-entry count to show on a branch row of another worktree: set only on the branch
   * that worktree has checked out, where its uncommitted changes sit.
   */
  readonly changes?: number;

  /**
   * Gets the stash, for a stash row (drives the apply, pop, and drop actions).
   */
  readonly stash?: GitStash;

  /**
   * Gets the tag, for a tag row (drives the push and delete actions).
   */
  readonly tag?: GitTag;

  /**
   * Gets the remote, for a remote row and for the remote-branch rows beneath it (drives the fetch,
   * prune and remove actions, and tells a branch row which remote to track from).
   */
  readonly remote?: GitRemote;

  /**
   * Gets the remote-tracking branch, for a remote-branch row (drives the check-out action).
   */
  readonly remoteBranch?: GitRemoteBranch;

  /**
   * Gets the commit a row navigates to when selected (a branch tip or a tag's commit).
   */
  readonly commit?: string;

  /**
   * Gets the pull request, for a pull-request row (drives the open and checkout actions).
   */
  readonly pullRequest?: ForgePullRequest;

  /**
   * Gets the issue, for an issue row (drives the open action).
   */
  readonly issue?: ForgeIssue;

  /**
   * Gets the workflow run, for an action row (drives the open, re-run and cancel actions).
   */
  readonly run?: ForgeWorkflowRun;

  /**
   * Gets the badge to show beside a pull-request or action row: a pull request's rolled-up checks, or
   * a workflow run's own lifecycle.
   */
  readonly status?: CheckStatus | ForgeRunStatus;

  /**
   * Gets a value indicating whether the row is a muted placeholder (an empty-section message).
   */
  readonly muted?: boolean;
}

/**
 * Identifies the Check Out command on a pull request's context menu.
 */
const ACTION_CHECKOUT_PULL_REQUEST: string = 'pr.checkout';

/**
 * Identifies the Open command on a pull request's context menu.
 */
const ACTION_OPEN_PULL_REQUEST: string = 'pr.open';

/**
 * Identifies the Open command on an issue's context menu.
 */
const ACTION_OPEN_ISSUE: string = 'issue.open';

/**
 * Identifies the Check Out command on a branch's context menu.
 */
const ACTION_CHECKOUT_BRANCH: string = 'branch.checkout';

/**
 * Identifies the Check Out command on a remote-tracking branch's context menu.
 */
const ACTION_CHECKOUT_REMOTE_BRANCH: string = 'remoteBranch.checkout';

/**
 * Identifies the Fetch command on a remote's context menu.
 */
const ACTION_FETCH_REMOTE: string = 'remote.fetch';

/**
 * Identifies the Prune command on a remote's context menu.
 */
const ACTION_PRUNE_REMOTE: string = 'remote.prune';

/**
 * Identifies the Remove command on a remote's context menu.
 */
const ACTION_REMOVE_REMOTE: string = 'remote.remove';

/**
 * Identifies the Copy Remote URL command on a remote's context menu.
 */
const ACTION_COPY_REMOTE_URL: string = 'remote.copyUrl';

/**
 * Identifies the Open Remote URL command on a remote's context menu.
 */
const ACTION_OPEN_REMOTE_URL: string = 'remote.openUrl';

/**
 * Identifies the Add Remote command on the tool strip's more-actions menu.
 */
const ACTION_ADD_REMOTE: string = 'repo.addRemote';

/**
 * Identifies the Rename command on a branch's context menu.
 */
const ACTION_RENAME_BRANCH: string = 'branch.rename';

/**
 * Identifies the Set Upstream command on a branch's context menu.
 */
const ACTION_SET_UPSTREAM: string = 'branch.setUpstream';

/**
 * Identifies the Clear Upstream command on a branch's context menu.
 */
const ACTION_CLEAR_UPSTREAM: string = 'branch.clearUpstream';

/**
 * Identifies the Delete command on a branch's context menu.
 */
const ACTION_DELETE_BRANCH: string = 'branch.delete';

/**
 * The failure code an unforced branch delete carries when git refused it because the branch still
 * holds commits merged nowhere. The one refusal that is offered a way past.
 */
const BRANCH_NOT_MERGED: string = 'branch-not-merged';

/**
 * Identifies the Merge command on a branch's context menu, which merges that branch into the
 * checked-out one.
 */
const ACTION_MERGE_BRANCH: string = 'branch.merge';

/**
 * Identifies the Merge Without Fast-Forward command, which records a merge commit even where the
 * history would have allowed the branch pointer simply to move.
 */
const ACTION_MERGE_BRANCH_NO_FF: string = 'branch.merge.noFastForward';

/**
 * Identifies the Squash Merge command, which stages the branch's changes as one without recording a
 * merge at all.
 */
const ACTION_SQUASH_MERGE_BRANCH: string = 'branch.merge.squash';

/**
 * Identifies the Rebase Onto command on a branch's context menu, which replays the checked-out branch
 * onto the branch the row carries.
 */
const ACTION_REBASE_ONTO_BRANCH: string = 'branch.rebaseOnto';

/**
 * Why the integration commands are inert when the working tree has changes in it. Git refuses a merge
 * or rebase that would overwrite them, and saying so in the menu is cheaper than the refusal.
 */
const REASON_UNCOMMITTED: string = 'uncommitted changes';

/**
 * Why the integration commands are inert while an operation is already unfinished.
 */
const REASON_IN_PROGRESS: string = 'finish the current operation first';

/**
 * Identifies the Commit command on the checked-out branch's context menu.
 */
const ACTION_COMMIT_BRANCH: string = 'branch.commit';

/**
 * Identifies the Push command on a branch's context menu.
 */
const ACTION_PUSH_BRANCH: string = 'branch.push';

/**
 * Identifies the Pull command on the checked-out branch's context menu.
 */
const ACTION_PULL_BRANCH: string = 'branch.pull';

/**
 * Identifies the Sync command on the checked-out branch's context menu.
 */
const ACTION_SYNC_BRANCH: string = 'branch.sync';

/**
 * Identifies the Apply command on a stash's context menu.
 */
const ACTION_APPLY_STASH: string = 'stash.apply';

/**
 * Identifies the Pop command on a stash's context menu.
 */
const ACTION_POP_STASH: string = 'stash.pop';

/**
 * Identifies the Drop command on a stash's context menu.
 */
const ACTION_DROP_STASH: string = 'stash.drop';

/**
 * Identifies the Push command on a tag's context menu. A repository with more than one remote gets a
 * submenu instead, whose rows carry the remote after this prefix and a colon — the tag is addressed
 * by the row it was chosen on, so only the remote needs saying.
 */
const ACTION_PUSH_TAG: string = 'tag.push';

/**
 * Identifies the Delete command on a tag's context menu.
 */
const ACTION_DELETE_TAG: string = 'tag.delete';

/**
 * Identifies the New Tag command on the tool strip's more-actions menu.
 */
const ACTION_NEW_TAG: string = 'repo.newTag';

/**
 * Identifies the Push All Tags command on the tool strip's more-actions menu, and the prefix of its
 * per-remote submenu rows.
 */
const ACTION_PUSH_ALL_TAGS: string = 'repo.pushAllTags';

/**
 * Identifies the New Branch command on the tool strip's more-actions menu.
 */
const ACTION_NEW_BRANCH: string = 'repo.newBranch';

/**
 * Identifies the Stash command on the tool strip's more-actions menu.
 */
const ACTION_STASH: string = 'repo.stash';

/**
 * Identifies the Fetch command on the tool strip's more-actions menu.
 */
const ACTION_FETCH: string = 'repo.fetch';

/**
 * The capability each optional command needs, by action-id prefix (#818). A command not listed needs
 * nothing a version-control system might lack. Prefixes, because some actions carry a remote after
 * their id (`repo.pushAllTags:origin`).
 */
const ACTION_CAPABILITY: readonly (readonly [string, VersionControlCapability])[] = [
  [ACTION_NEW_TAG, 'tags'],
  [ACTION_PUSH_ALL_TAGS, 'tags'],
  [ACTION_ADD_REMOTE, 'remotes'],
  [ACTION_FETCH, 'remotes'],
  [ACTION_STASH, 'stash'],
  [ACTION_REBASE_ONTO_BRANCH, 'rebase'],
  [ACTION_MERGE_BRANCH, 'merge'],
];

/**
 * Identifies the Open in Agent command on an issue's context menu.
 */
const ACTION_ISSUE_IN_AGENT: string = 'issue.agent';

/**
 * Identifies the Open command on a workflow run's context menu.
 */
const ACTION_OPEN_RUN: string = 'run.open';

/**
 * Identifies the Re-run command on a workflow run's context menu.
 */
const ACTION_RERUN: string = 'run.rerun';

/**
 * Identifies the Cancel command on a workflow run's context menu.
 */
const ACTION_CANCEL_RUN: string = 'run.cancel';

/**
 * Identifies the Switch to Worktree command on a worktree's context menu.
 */
const ACTION_SWITCH_WORKTREE: string = 'worktree.switch';

/**
 * Identifies the Delete command on another worktree's branch (#939).
 */
const ACTION_DELETE_WORKTREE_BRANCH: string = 'worktree.deleteBranch';

/**
 * Identifies the Refresh command on a forge-backed section's context menu (#939).
 */
const ACTION_REFRESH_SECTION: string = 'section.refresh';

/**
 * Identifies the Rename command on a worktree's context menu.
 */
const ACTION_RENAME_WORKTREE: string = 'worktree.rename';

/**
 * Identifies the Open in File System command on a worktree's context menu.
 */
const ACTION_REVEAL_WORKTREE: string = 'worktree.reveal';

/**
 * Identifies the Copy Path command on a worktree's context menu.
 */
const ACTION_COPY_WORKTREE_PATH: string = 'worktree.copyPath';

/**
 * Identifies the Remove Worktree command on a worktree's context menu.
 */
const ACTION_REMOVE_WORKTREE: string = 'worktree.remove';

/**
 * Identifies the New Worktree command on the tool strip's more-actions menu.
 */
const ACTION_NEW_WORKTREE: string = 'repo.newWorktree';

/**
 * Identifies the Convert to Worktrees command on the tool strip's more-actions menu.
 */
const ACTION_CONVERT_TO_WORKTREES: string = 'repo.convertToWorktrees';

/**
 * What an unhappy forge section says when the read itself supplied no message. `no-forge`, `error` and
 * `unauthorized` always carry one, so only the two quiet states need an entry here.
 */
const PENDING_MESSAGES: Readonly<Record<string, string>> = {
  'no-repository': 'No repository open',
  loading: 'Loading…',
  'no-forge': 'This repository has no remote on a supported forge',
  error: 'Could not read from the forge',
  unauthorized: 'Not signed in — add a token in Settings → Version Control',
};

/**
 * Describes a collapsible section of the repository tree.
 */
interface SectionDef {
  /**
   * Gets the section's stable key.
   */
  readonly key: string;

  /**
   * Gets the section's display label.
   */
  readonly label: string;

  /**
   * Gets the section's icon.
   */
  readonly icon: Icon;

  /**
   * Builds the section's child rows when it is expanded.
   * @returns Returns the child rows.
   */
  readonly children: () => readonly TreeRow[];

  /**
   * Gets the capability the section needs, or undefined when every version-control system has it.
   */
  readonly capability?: VersionControlCapability;

  /**
   * Gets the hosting capability the section needs, for a section a hosting plugin fills. Such a
   * section is shown only when a plugin serves the repository's host and the repository allows it.
   */
  readonly hostingCapability?: HostingCapability;
}

/**
 * Renders the source-control view's left rail: its own tool strip over the repository tree —
 * collapsible sections for local branches, remotes, tags, and stashes, then placeholder sections for
 * pull requests, issues, and CI/CD actions. The tree is presented through the shared {@link TreeView}:
 * this component flattens the repository model into rows and projects each row's content. The forge
 * sections are stubbed with sample data until they are wired to a provider.
 *
 * This panel owns the branch and stash actions, per the ribbon-versus-panel rule: the ribbon carries
 * only the repo-global actions, and anything acting on a row the user can see lives here. Branches
 * check out and are created from here (the tool strip's New Branch dialog); stashes apply, pop, and
 * drop from their rows, dropping behind a confirmation. The uncommitted-changes entry is not a
 * separate header but a badge on the CHECKED-OUT branch's row — uncommitted changes belong to the
 * branch they sit on — and it is always present (muted at zero) so the Commit panel's composer stays
 * reachable from the rail even when the tree is clean.
 */
@Component({
  selector: 'app-source-control-sidebar',
  imports: [
    TextField,
    Button,
    ButtonRow,
    Dropdown,
    AppIcon,
    Checkbox,
    Modal,
    ModalContent,
    ExplorerToolbar,
    TreeView,
    IssueAgentConfirm,
    VersionControlMissing,
    RepositoryRestricted,
    Chip,
    PanelStatus,
  ],
  templateUrl: './source-control-sidebar.html',
  styleUrl: './source-control-sidebar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SourceControlSidebar implements OnDestroy {
  /**
   * Gets the dock panel descriptor this panel was projected for. Supplied by the dock outlet; the
   * sidebar reads its state from the shared {@link Repository} rather than the descriptor.
   */
  public readonly panel: InputSignal<DockPanel> = input.required<DockPanel>();

  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the working-tree node identifier, exposed for the template.
   */
  protected readonly workingNodeId: string = WORKING_NODE_ID;

  /**
   * Holds the repository model the rail renders.
   */
  protected readonly repository: Repository = inject(Repository);

  /**
   * Holds the prompt that knows when the folder is a repository no installed plugin can read.
   */
  private readonly versionControlPrompt: VersionControlPrompt = inject(VersionControlPrompt);

  /**
   * Gets whether the folder is a repository no installed plugin can read, so the rail shows only its
   * empty state.
   */
  protected readonly needsPlugin: Signal<boolean> = computed(
    (): boolean => this.versionControlPrompt.needed() !== null && !this.repository.isBound(),
  );

  /**
   * Holds the workspace's version-control binding, which knows whether the folder is a repository the
   * user has not trusted; null outside a workspace tab.
   */
  private readonly workspaceGit: WorkspaceGit | null = inject(WorkspaceGit, { optional: true });

  /**
   * Gets whether the folder is a repository the user has not trusted, so the rail shows only the
   * restricted state.
   */
  protected readonly restricted: Signal<boolean> = computed(
    (): boolean => this.workspaceGit?.isRestricted() === true && !this.repository.isBound(),
  );

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds this workspace's forge-backed view of the repository, behind the Pull Requests section.
   */
  protected readonly forge: ForgeRepository = inject(ForgeRepository);

  /**
   * Holds the shell seam a pull request is opened in the browser through.
   */
  private readonly shell: Shell = inject(Shell);

  /**
   * Holds the seam that starts a conversation about an issue, shared with the issue's own document
   * so both offers of Open in Agent ask the same thing and warn at the same moment.
   */
  private readonly issueAgent: IssueAgent = inject(IssueAgent);

  /**
   * Holds this view's dock reveal helper, used to bring the agent panel forward once a conversation
   * has been started from here — starting one the user cannot see would be a strange thing to do.
   */
  private readonly dockReveal: DockReveal = inject(DockReveal);

  /**
   * Holds the opener that surfaces an issue as a document in the well.
   */
  private readonly issueOpener: IssueOpener = inject(IssueOpener);

  /**
   * Holds the view's worktrees, or null where the view provides none (so it reads as flat).
   */
  private readonly worktreeSource: RepositoryWorktrees | null = inject(REPOSITORY_WORKTREES, {
    optional: true,
  });

  /**
   * Gets the repository's worktrees, or null for a flat repository. In a flat repository Local is a
   * list of branches; with worktrees it is the worktrees, each over its own branches.
   */
  protected readonly worktrees: Signal<readonly RepositoryWorktree[] | null> = computed(
    (): readonly RepositoryWorktree[] | null => this.worktreeSource?.worktrees() ?? null,
  );

  /**
   * Holds the worktree being renamed in place, or null while none is.
   */
  protected readonly renaming: WritableSignal<RepositoryWorktree | null> =
    signal<RepositoryWorktree | null>(null);

  /**
   * Gets the row id of the worktree being renamed, which the tree opens its name field on.
   */
  protected readonly renamingRowId: Signal<string | null> = computed((): string | null => {
    const worktree: RepositoryWorktree | null = this.renaming();
    return worktree === null ? null : `worktree:${worktree.id}`;
  });

  /**
   * Holds the ids of the worktrees the user has expanded. Every worktree starts collapsed, naming its
   * checked-out branch beside it, so the worktrees read as a list of what is in work.
   */
  private readonly expandedWorktrees: WritableSignal<ReadonlySet<string>> = signal<
    ReadonlySet<string>
  >(new Set<string>());

  /**
   * Holds the keys of the currently expanded sections. Only the local branches start open; the rest
   * are collapsed until the user opens them.
   */
  private readonly expandedSections: WritableSignal<ReadonlySet<string>> = signal<
    ReadonlySet<string>
  >(new Set<string>(['local']));

  /**
   * Describes the rail's sections in display order, each with a builder for its child rows.
   */
  private readonly sections: readonly SectionDef[] = [
    { key: 'local', label: 'Local', icon: Icon.SOURCE_CONTROL, children: () => this.localRows() },
    {
      key: 'remote',
      label: 'Remote',
      icon: Icon.CLOUD,
      children: () => this.remoteRows(),
      capability: 'remotes',
    },
    {
      key: 'tags',
      label: 'Tags',
      icon: Icon.TAG,
      children: () => this.tagRows(),
      capability: 'tags',
    },
    {
      key: 'stashes',
      label: 'Stashes',
      icon: Icon.STASH,
      children: () => this.stashRows(),
      capability: 'stash',
    },
    {
      key: 'pullRequests',
      label: 'Pull Requests',
      icon: Icon.GIT_PULL_REQUEST,
      children: () => this.pullRequestRows(),
      hostingCapability: 'pullRequests',
    },
    {
      key: 'issues',
      label: 'Issues',
      icon: Icon.INFO,
      children: () => this.issueRows(),
      hostingCapability: 'issues',
    },
    {
      key: 'actions',
      label: 'Actions',
      icon: Icon.PLAY,
      children: () => this.actionRows(),
      hostingCapability: 'ciRuns',
    },
  ];

  /**
   * Holds the filter text narrowing the tree, or an empty string when nothing is filtered.
   */
  protected readonly filter: WritableSignal<string> = signal<string>('');

  /**
   * Gets the flattened repository tree: each expanded section's header followed by its children.
   *
   * While a filter is set the collapsed state is ignored — every section is searched, only matching
   * children are kept, and a section with no matches is dropped entirely. A filter that matches
   * nothing therefore yields an empty tree rather than a list of empty section headers.
   */
  protected readonly rows: Signal<readonly TreeRow[]> = computed((): readonly TreeRow[] => {
    const expanded: ReadonlySet<string> = this.expandedSections();
    const needle: string = this.filter().trim().toLowerCase();
    const filtering: boolean = needle.length > 0;
    const out: TreeRow[] = [];
    for (const section of this.sections) {
      // A section the serving plugin cannot fill is not shown at all (#818).
      if (section.capability !== undefined && !this.repository.supports(section.capability)) {
        continue;
      }
      // Likewise a section no hosting plugin can fill: absent, rather than a row saying it is (#820).
      if (
        section.hostingCapability !== undefined &&
        !(this.forge.hasForge() && this.forge.supports(section.hostingCapability))
      ) {
        continue;
      }
      const open: boolean = filtering || expanded.has(section.key);
      const children: readonly TreeRow[] = open ? section.children() : [];
      const matched: readonly TreeRow[] = filtering
        ? children.filter((row: TreeRow): boolean => this.matches(row, needle))
        : children;
      if (filtering && matched.length === 0) {
        continue;
      }
      out.push({
        id: `section:${section.key}`,
        depth: 0,
        expandable: true,
        expanded: open,
        data: {
          kind: 'section',
          icon: section.icon,
          label: section.label,
          sectionKey: section.key,
          ...(this.noteFor(section.key) === null ? {} : { note: this.noteFor(section.key) }),
        },
      });
      out.push(...matched);
    }
    return out;
  });

  /**
   * Resolves a section header's muted note: why what is beneath it is not current.
   *
   * Only a section still showing something needs one. A section with nothing to show says why in the
   * placeholder row instead, where there is room for the whole sentence.
   *
   * @param key The section key.
   * @returns Returns the note, or null when the section is current or empty.
   */
  private noteFor(key: string): string | null {
    const section: ForgeSection<unknown> | null = this.forgeSectionFor(key);
    if (!section?.stale) {
      return null;
    }
    return section.state === 'rate-limited' ? 'rate limited' : 'offline';
  }

  /**
   * Resolves a forge-backed section by key.
   * @param key The section key.
   * @returns Returns the section, or null for a section backed by git rather than the forge.
   */
  private forgeSectionFor(key: string): ForgeSection<unknown> | null {
    switch (key) {
      case 'pullRequests':
        return this.forge.pullRequests();
      case 'issues':
        return this.forge.issues();
      case 'actions':
        return this.forge.workflowRuns();
      default:
        return null;
    }
  }

  /**
   * Determines whether a row survives the filter. Placeholder rows never match: an empty section's
   * "No tags" message is chrome, not a result.
   * @param row The row to test.
   * @param needle The lower-cased filter text.
   * @returns Returns true when the row matches.
   */
  private matches(row: TreeRow, needle: string): boolean {
    const node: RepoNode = this.nodeOf(row);
    if (node.kind === 'empty') {
      return false;
    }
    // A worktree stays while any branch beneath it matches, so a match is never shown without the
    // worktree it belongs to.
    if (node.kind === 'worktree' && node.worktree !== undefined) {
      const names: readonly string[] = node.worktree.current
        ? this.repository.branches().map((branch: GitBranch): string => branch.name)
        : node.worktree.branches.map((branch: WorktreeBranch): string => branch.name);
      return [node.label, ...names].some((name: string): boolean =>
        name.toLowerCase().includes(needle),
      );
    }
    return node.label.toLowerCase().includes(needle);
  }

  /**
   * Records the filter text as it is typed.
   * @param event The input event carrying the text.
   */
  protected onFilterValue(value: string): void {
    this.filter.set(value);
  }

  /**
   * Gets the tool strip's more-actions menu: the repository commands that act on the whole
   * repository rather than on a row. Anything acting on a row the user can see lives on that row's
   * context menu instead, which is the rule the panel already followed with its buttons.
   */
  protected readonly moreItems: Signal<readonly MenuItem[]> = computed((): readonly MenuItem[] =>
    this.grouped('repo', [
      [this.addRemoteItem()],
      [...this.worktreeMoreItems(), this.newBranchItem(), this.newTagItem()],
      [this.stashItem()],
      // Pushing every tag acts on the whole repository rather than on a row, which is what puts it
      // here rather than on a tag's own menu. Nothing to push is a reason not to offer it.
      [this.fetchItem('Fetch'), ...this.pushAllTagsItems()],
    ]),
  );

  /**
   * Builds a menu from groups of items, in the one order the panel's menus share (#939): what adds
   * (a remote), then what makes new (a worktree, branch or tag), then the stash, then what talks to a
   * remote. Each group keeps only what the plugin supports, and a separator falls only between two
   * groups that are left.
   * @param prefix A prefix for the separators' identifiers.
   * @param groups The groups, in order.
   * @returns Returns the items.
   */
  private grouped(prefix: string, groups: readonly (readonly MenuItem[])[]): readonly MenuItem[] {
    const kept: readonly (readonly MenuItem[])[] = groups
      .map((group: readonly MenuItem[]): readonly MenuItem[] => this.offeredOnly(group))
      .filter((group: readonly MenuItem[]): boolean => group.length > 0);
    return kept.flatMap((group: readonly MenuItem[], index: number): readonly MenuItem[] =>
      index === 0
        ? group
        : [{ separator: true, id: `${prefix}.sep.${index}`, label: '' }, ...group],
    );
  }

  /**
   * Builds the New Branch command, shared by the more menu and Local's own menu.
   * @returns Returns the item.
   */
  private newBranchItem(): MenuItem {
    return {
      id: ACTION_NEW_BRANCH,
      label: 'New Branch…',
      icon: Icon.PLUS,
      disabled: !this.repository.isBound(),
    };
  }

  /**
   * Builds the New Tag command, shared by the more menu and Tags' own menu.
   * @returns Returns the item.
   */
  private newTagItem(): MenuItem {
    return {
      id: ACTION_NEW_TAG,
      label: 'New Tag…',
      icon: Icon.TAG,
      disabled: !this.repository.isBound(),
    };
  }

  /**
   * Builds the Add Remote command, shared by the more menu and Remote's own menu.
   * @returns Returns the item.
   */
  private addRemoteItem(): MenuItem {
    return {
      id: ACTION_ADD_REMOTE,
      label: 'Add Remote…',
      icon: Icon.CLOUD,
      disabled: !this.repository.isBound(),
    };
  }

  /**
   * Builds the Stash Changes command, shared by the more menu and Stashes' own menu.
   * @returns Returns the item.
   */
  private stashItem(): MenuItem {
    return {
      id: ACTION_STASH,
      label: 'Stash Changes',
      icon: Icon.STASH,
      disabled: this.repository.changeCount() === 0,
    };
  }

  /**
   * Builds the Fetch command, which fetches every remote.
   * @param label What the menu calls it: Fetch on the strip, Fetch All beside the remotes.
   * @returns Returns the item.
   */
  private fetchItem(label: string): MenuItem {
    return {
      id: ACTION_FETCH,
      label,
      icon: Icon.CLOUD_DOWN,
      disabled: !this.repository.isBound(),
    };
  }

  /**
   * Builds Push All Tags, or nothing when there is no tag to push.
   * @returns Returns the items.
   */
  private pushAllTagsItems(): readonly MenuItem[] {
    return this.repository.tags().length === 0
      ? []
      : [this.pushToRemoteItem(ACTION_PUSH_ALL_TAGS, 'Push All Tags')];
  }

  /**
   * Builds a section header's menu (#939): the commands that make something in that section, so the
   * user finds them where they are looking rather than only on the strip's more menu. Each is the
   * strip's own command, gated the same way.
   * @param key The section's key.
   * @returns Returns the items, or none for a section with nothing to offer.
   */
  private sectionItems(key: string): readonly MenuItem[] {
    switch (key) {
      case 'local':
        // Local holds the worktrees when there are any, so it makes a worktree; a branch is made in a
        // worktree, from that worktree's own menu. A flat repository's Local is only branches.
        return this.worktrees() === null
          ? this.grouped('local', [[this.newBranchItem()]])
          : this.grouped('local', [
              [
                {
                  id: ACTION_NEW_WORKTREE,
                  label: 'New Worktree…',
                  icon: Icon.WORKTREE,
                  disabled: this.worktreeSource?.busy() ?? false,
                },
              ],
            ]);
      case 'remote':
        return this.grouped('remote', [[this.addRemoteItem()], [this.fetchItem('Fetch All')]]);
      case 'tags':
        return this.grouped('tags', [[this.newTagItem()], this.pushAllTagsItems()]);
      case 'stashes':
        return this.grouped('stashes', [[this.stashItem()]]);
      case 'pullRequests':
      case 'issues':
      case 'actions':
        return [{ id: ACTION_REFRESH_SECTION, label: 'Refresh', icon: Icon.REFRESH }];
      default:
        return [];
    }
  }

  /**
   * Builds the more-actions menu's worktree command: a new worktree beside the others, or — for a
   * flat repository that can have them — converting it to worktrees. Nothing when it can be neither.
   * @returns Returns the menu items.
   */
  private worktreeMoreItems(): readonly MenuItem[] {
    if (this.worktrees() !== null) {
      return [
        {
          id: ACTION_NEW_WORKTREE,
          label: 'New Worktree…',
          icon: Icon.WORKTREE,
          disabled: this.worktreeSource?.busy() ?? false,
        },
      ];
    }
    if (!(this.worktreeSource?.canConvert() ?? false)) {
      return [];
    }
    // Shown but disabled while the agent works in the folder, with the reason beside it: the command
    // exists and will be back, which a missing item would not say.
    const blocked: boolean = (this.worktreeSource?.convertBlocker() ?? null) !== null;
    return [
      {
        id: ACTION_CONVERT_TO_WORKTREES,
        label: 'Convert to Worktrees…',
        icon: Icon.WORKTREE,
        disabled: blocked,
        ...(blocked ? { status: 'agent is working' } : {}),
      },
    ];
  }

  /**
   * Runs a command chosen from the tool strip's more-actions menu.
   * @param id The chosen item's identifier.
   */
  protected onMoreAction(id: string): void {
    if (id.startsWith(ACTION_PUSH_ALL_TAGS)) {
      void this.repository.pushAllTags(this.remoteOf(id, ACTION_PUSH_ALL_TAGS));
      return;
    }
    switch (id) {
      case ACTION_NEW_WORKTREE:
        this.worktreeSource?.requestAdd();
        break;
      case ACTION_CONVERT_TO_WORKTREES:
        this.worktreeSource?.requestConvert();
        break;
      case ACTION_NEW_BRANCH:
        this.openBranchDialog();
        break;
      case ACTION_NEW_TAG:
        this.openTagDialog();
        break;
      case ACTION_ADD_REMOTE:
        this.openRemoteDialog();
        break;
      case ACTION_STASH:
        this.stash();
        break;
      case ACTION_FETCH:
        this.fetch();
        break;
      default:
        break;
    }
  }

  /**
   * Expands every section, and reads whatever the forge-backed ones have not read yet — expanding a
   * section by hand is what loads it, so expanding them all must do the same or the three would open
   * onto nothing.
   */
  protected expandAll(): void {
    const keys: readonly string[] = this.sections.map((section: SectionDef): string => section.key);
    this.expandedSections.set(new Set<string>(keys));
    for (const key of keys) {
      this.loadSection(key);
      this.forge.watch(key);
    }
  }

  /**
   * Collapses every section.
   */
  protected collapseAll(): void {
    this.expandedSections.set(new Set<string>());
    this.forge.unwatchAll();
  }

  /**
   * Stops keeping the forge sections current when the panel goes away. A tool panel is destroyed
   * whenever another in its stack activates, so this is the common case rather than the rare one.
   */
  public ngOnDestroy(): void {
    this.forge.unwatchAll();
  }

  /**
   * Re-reads the repository state.
   */
  protected refresh(): void {
    this.log.info('SourceControlSidebar', 'Refreshing repository');
    void this.repository.refresh();
    this.worktreeSource?.refresh();
    // Refresh what the panel is actually showing, which includes any forge section the user has
    // open — but only those: a collapsed section has nothing on screen to bring up to date, and the
    // forge is rate-limited.
    this.refreshForge();
  }

  /**
   * Fetches every remote, so the remote-tracking branches this rail lists are current.
   */
  protected fetch(): void {
    this.log.info('SourceControlSidebar', 'Fetching remotes');
    void this.repository.fetch();
  }

  /**
   * Stashes the working-tree changes.
   */
  protected stash(): void {
    this.log.info('SourceControlSidebar', 'Stashing working-tree changes');
    void this.repository.stash();
  }

  /**
   * Gets the id of the row to highlight: the checked-out branch's row, or null when there is none.
   */
  protected readonly selectedId: Signal<string | null> = computed((): string | null => {
    const current: GitBranch | undefined = this.repository.currentBranch();
    return current === undefined ? null : `branch:${current.name}`;
  });

  /**
   * Gets the ids of the other rows drawn as checked out: in a worktree container, every other
   * worktree's checked-out branch. The point of worktrees is several branches in work at once, so
   * every one of them is highlighted, as the current branch always was.
   */
  protected readonly selectedIds: Signal<readonly string[]> = computed((): readonly string[] =>
    (this.worktrees() ?? [])
      .filter(
        (worktree: RepositoryWorktree): boolean => !worktree.current && worktree.branch !== null,
      )
      .map((worktree: RepositoryWorktree): string =>
        this.worktreeBranchId(worktree.id, worktree.branch ?? ''),
      ),
  );

  /**
   * Gets the status strip's chip: whether the repository is a single checkout or a set of worktrees.
   */
  protected readonly layoutChip: Signal<string> = computed((): string => {
    const worktrees: readonly RepositoryWorktree[] | null = this.worktrees();
    return worktrees === null ? 'Single checkout' : `Worktrees · ${worktrees.length}`;
  });

  /**
   * Unwraps a tree row's repository-node payload.
   * @param row The tree row.
   * @returns Returns the repository node.
   */
  protected nodeOf(row: TreeRow): RepoNode {
    return row.data as RepoNode;
  }

  /**
   * Toggles a section, or navigates to the commit a branch or tag row points at.
   * @param row The tree row that was clicked.
   */
  public onRowClick(row: TreeRow): void {
    const node: RepoNode = this.nodeOf(row);
    switch (node.kind) {
      case 'section':
        if (node.sectionKey !== undefined) {
          this.toggleSection(node.sectionKey);
        }
        break;
      // A worktree opens and closes like a section; switching to it is a double click or its menu,
      // since a single click that also moved the whole view would make looking inside one a jump.
      case 'worktree':
        if (node.worktree !== undefined) {
          this.toggleWorktree(node.worktree.id);
        }
        break;
      // A remote-tracking branch navigates like any other ref now that it knows its tip; it was only
      // ever inert because the hash was dropped at parse time.
      case 'branch':
      case 'tag':
      case 'remote-branch':
        if (node.commit !== undefined) {
          this.repository.selectNode(node.commit);
        }
        break;
      default:
        break;
    }
  }

  /**
   * Opens what a row stands for, when a double click asks for more than the row itself can show.
   *
   * Only issues answer this today. A single click still selects, which is why this is a second event
   * rather than a replacement: the first click is a choice, the second is a request to read.
   *
   * @param row The row that was double-clicked.
   */
  public onRowDoubleClick(row: TreeRow): void {
    const node: RepoNode = this.nodeOf(row);
    if (node.issue !== undefined) {
      this.issueOpener.open(node.issue);
      return;
    }
    // Another worktree, or one of its branches: go and work in it.
    if (node.worktree !== undefined && !node.worktree.current) {
      this.switchToWorktree(node.worktree);
    }
  }

  /**
   * Opens or closes a worktree's branches.
   * @param id The worktree's checkout id.
   */
  private toggleWorktree(id: string): void {
    const next: Set<string> = new Set<string>(this.expandedWorktrees());
    if (!next.delete(id)) {
      next.add(id);
    }
    this.expandedWorktrees.set(next);
  }

  /**
   * Renames the worktree whose name field was committed. The tree commits only a trimmed name that
   * is not empty and differs from the one it started with.
   * @param edit The committed edit.
   */
  protected onRenameCommit(edit: TreeEdit): void {
    const worktree: RepositoryWorktree | null = this.renaming();
    this.renaming.set(null);
    if (worktree !== null) {
      this.log.info('SourceControlSidebar', 'Renaming worktree', worktree.label, edit.value);
      this.worktreeSource?.rename(worktree.id, edit.value);
    }
  }

  /**
   * Closes the name field without renaming.
   */
  protected onRenameCancel(): void {
    this.renaming.set(null);
  }

  /**
   * Scopes the view to a worktree.
   * @param worktree The worktree.
   */
  private switchToWorktree(worktree: RepositoryWorktree): void {
    this.log.info('SourceControlSidebar', 'Switching to worktree', worktree.label);
    this.worktreeSource?.activate(worktree.id);
  }

  /**
   * Resolves the badge icon for a pull-request check or action run status.
   * @param status The status.
   * @returns Returns the icon.
   */
  protected statusIcon(status: CheckStatus | ForgeRunStatus): Icon {
    switch (status) {
      // Filled, because a settled outcome is a badge the eye should catch at a glance rather than an
      // outline competing with the row's own icon.
      case 'succeeded':
        return Icon.SUCCESS_FILL;
      case 'failed':
        return Icon.ERROR_FILL;
      case 'cancelled':
        // Not a failure to act on, so it is muted rather than red — the run simply stopped.
        return Icon.STATUS_STOPPED;
      default:
        // `running` and `queued` never reach here: the template draws a pulsing circle for both, since
        // a queued run is work the user is waiting on just as much as one in progress.
        return Icon.PLAY;
    }
  }

  /**
   * Checks out a branch.
   * @param branch The branch to check out.
   */
  private checkout(branch: GitBranch): void {
    this.log.info('SourceControlSidebar', `Checking out branch '${branch.name}'`);
    void this.repository.checkout(branch.name);
  }

  /**
   * Gets what a branch row's push delta means on hover.
   *
   * A branch that tracks nothing still shows the number, so every row carries the same three counts
   * and a glance down the list compares like with like — but zero there means "has never been
   * pushed" rather than "is level with its upstream", and the two are worth telling apart somewhere.
   * Hover is that somewhere.
   *
   * @param branch The branch the row carries.
   * @returns Returns the title.
   */
  protected pushTitle(branch: GitBranch): string {
    return branch.upstream === undefined
      ? 'Not tracking a remote branch — nothing has been pushed'
      : `${branch.ahead} commit(s) to push to ${branch.upstream}`;
  }

  /**
   * Gets what a branch row's pull delta means on hover.
   * @param branch The branch the row carries.
   * @returns Returns the title.
   */
  protected pullTitle(branch: GitBranch): string {
    return branch.upstream === undefined
      ? 'Not tracking a remote branch — there is nothing to pull from'
      : `${branch.behind} commit(s) to pull from ${branch.upstream}`;
  }

  /**
   * Selects the working tree, so the Commit panel shows the uncommitted changes and its composer.
   * Reached from the changes badge on the checked-out branch's row: uncommitted changes belong to
   * the branch they sit on, so that is where the rail shows them.
   */
  protected selectWorking(): void {
    this.repository.selectNode(this.workingNodeId);
  }

  /**
   * Selects the working tree and brings the Commit panel forward, so the composer is in front of the
   * user rather than merely pointed at.
   *
   * Reached from the checked-out branch's menu, which is the one row that can have uncommitted
   * changes. This does not commit: a commit needs a message, and the composer is where one is
   * written — which is exactly what the ellipsis on the label promises.
   */
  private commitOnBranch(): void {
    this.log.info('SourceControlSidebar', 'Revealing the Commit panel for the working tree');
    this.selectWorking();
    this.dockReveal.reveal('commit');
  }

  /**
   * Gets a value indicating whether the working tree is the current selection, so the changes badge
   * can show itself as active.
   */
  protected readonly workingSelected: Signal<boolean> = computed(
    (): boolean => this.repository.selectedNodeId() === this.workingNodeId,
  );

  /**
   * Restores a stash onto the working tree, keeping it on the stack.
   * @param stash The stash to apply.
   */
  private applyStash(stash: GitStash): void {
    void this.repository.applyStash(stash.index);
  }

  /**
   * Restores a stash onto the working tree and drops it from the stack.
   * @param stash The stash to pop.
   */
  private popStash(stash: GitStash): void {
    void this.repository.popStash(stash.index);
  }

  /**
   * Holds the stash awaiting the user's drop confirmation, or null when none is. Dropping discards
   * the stashed work with no way back, so it is never done from a bare button press.
   */
  protected readonly pendingDrop: WritableSignal<GitStash | null> = signal<GitStash | null>(null);

  /**
   * Opens the drop confirmation for a stash.
   * @param stash The stash to drop.
   */
  private requestDropStash(stash: GitStash): void {
    this.pendingDrop.set(stash);
  }

  /**
   * Confirms the drop, deleting the stash without restoring it.
   */
  protected confirmDropStash(): void {
    const stash: GitStash | null = this.pendingDrop();
    this.pendingDrop.set(null);
    if (stash !== null) {
      this.log.info('SourceControlSidebar', `Dropping stash ${stash.index}`);
      void this.repository.dropStash(stash.index);
    }
  }

  /**
   * Dismisses the drop confirmation, leaving the stash alone.
   */
  protected cancelDropStash(): void {
    this.pendingDrop.set(null);
  }

  /**
   * Holds whether the new-branch dialog is open.
   */
  protected readonly branchDialogOpen: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the name being entered in the new-branch dialog.
   */
  protected readonly branchName: WritableSignal<string> = signal<string>('');

  /**
   * Holds whether the new branch is checked out once created. On by default: creating a branch is
   * nearly always the first step of working on it.
   */
  protected readonly branchCheckout: WritableSignal<boolean> = signal<boolean>(true);

  /**
   * Gets the reason the entered branch name cannot be used, or null when it can. Git would reject a
   * duplicate itself, but saying so before the command runs is friendlier than surfacing its error.
   */
  protected readonly branchNameError: Signal<string | null> = computed((): string | null => {
    const name: string = this.branchName().trim();
    if (name.length === 0) {
      return null;
    }
    const target: RepositoryWorktree | null = this.branchTarget();
    const taken: readonly string[] =
      target === null || target.current
        ? this.repository.branches().map((branch: GitBranch): string => branch.name)
        : target.branches.map((branch: WorktreeBranch): string => branch.name);
    return taken.includes(name) ? 'A branch with this name already exists.' : null;
  });

  /**
   * Holds the worktree the new branch is made in, or null for this repository (#939). Each worktree
   * is a clone of its own, so a branch made from a worktree's menu is made in that one.
   */
  protected readonly branchTarget: WritableSignal<RepositoryWorktree | null> =
    signal<RepositoryWorktree | null>(null);

  /**
   * Gets a value indicating whether the new-branch dialog can be submitted.
   */
  protected readonly canCreateBranch: Signal<boolean> = computed(
    (): boolean => this.branchName().trim().length > 0 && this.branchNameError() === null,
  );

  /**
   * Opens the new-branch dialog.
   * @param target The worktree to make the branch in, or null for this repository.
   */
  protected openBranchDialog(target: RepositoryWorktree | null = null): void {
    this.branchTarget.set(target);
    this.branchName.set('');
    this.branchCheckout.set(true);
    this.branchDialogOpen.set(true);
  }

  /**
   * Confirms the new-branch dialog, creating the branch at the current head.
   */
  protected confirmBranch(): void {
    if (!this.canCreateBranch()) {
      return;
    }
    const name: string = this.branchName().trim();
    this.branchDialogOpen.set(false);
    this.log.info(
      'SourceControlSidebar',
      `Creating branch '${name}'`,
      `checkout=${this.branchCheckout()}`,
    );
    const target: RepositoryWorktree | null = this.branchTarget();
    if (target !== null && !target.current) {
      void this.worktreeSource?.createBranch(target.id, name, this.branchCheckout());
      return;
    }
    void this.repository.createBranch(name, this.branchCheckout());
  }

  /**
   * Dismisses the new-branch dialog without creating anything.
   */
  protected cancelBranch(): void {
    this.branchDialogOpen.set(false);
  }

  /**
   * Records the branch name as it is typed.
   * @param event The input event carrying the name.
   */
  protected onBranchNameValue(value: string): void {
    this.branchName.set(value);
  }

  /**
   * Checks out a remote-tracking branch as a local branch that tracks it.
   *
   * The local name is the branch's own, with the remote stripped: `origin/main` becomes `main`, which
   * is what the row said and what the user is asking for.
   *
   * @param remote The remote the branch belongs to.
   * @param branch The remote-tracking branch.
   */
  private checkoutTracking(remote: GitRemote, branch: GitRemoteBranch): void {
    const local: string = branch.name.startsWith(`${remote.name}/`)
      ? branch.name.slice(remote.name.length + 1)
      : branch.name;
    this.log.info('SourceControlSidebar', `Checking out '${local}' tracking '${branch.name}'`);
    void this.repository.checkoutTracking(branch.name, local);
  }

  /**
   * Holds the branch awaiting delete confirmation, or null when none is.
   */
  protected readonly pendingDeleteBranch: WritableSignal<BranchDeletion | null> =
    signal<BranchDeletion | null>(null);

  /**
   * Holds the branch whose delete git refused for holding unmerged commits, or null when none has
   * been. Distinct from {@link pendingDeleteBranch} because it is a different question: the first
   * asks whether to delete, this one asks whether to lose work.
   */
  protected readonly pendingForceDeleteBranch: WritableSignal<BranchDeletion | null> =
    signal<BranchDeletion | null>(null);

  /**
   * Says where a branch being deleted lives, for the delete questions: this repository, or another
   * worktree, named.
   * @param deletion The branch being deleted.
   * @returns Returns the phrase.
   */
  protected deletionPlace(deletion: BranchDeletion | null): string {
    return deletion?.worktree === undefined
      ? 'this repository'
      : `the “${deletion.worktree.label}” worktree`;
  }

  /**
   * Confirms the delete, attempting it without force first.
   *
   * A refusal for unmerged commits is not reported as a failure but asked about: git declined because
   * the branch holds work that exists nowhere else, and whether to lose it is the user's call. Every
   * other failure is left to the panel's error surface.
   */
  protected async confirmDeleteBranch(): Promise<void> {
    const branch: BranchDeletion | null = this.pendingDeleteBranch();
    this.pendingDeleteBranch.set(null);
    if (branch === null) {
      return;
    }
    this.log.info('SourceControlSidebar', `Deleting branch '${branch.name}'`);
    if (await this.deleteBranch(branch, false)) {
      this.pendingForceDeleteBranch.set(branch);
    }
  }

  /**
   * Deletes a branch where it lives: through this repository, or, for another worktree's, through
   * that worktree (#939).
   * @param branch The branch being deleted.
   * @param force Whether to delete it even with unmerged commits.
   * @returns Returns true when git refused for unmerged commits, which is a question rather than a
   * failure.
   */
  private async deleteBranch(branch: BranchDeletion, force: boolean): Promise<boolean> {
    if (branch.worktree !== undefined) {
      const outcome: WorktreeBranchDeletion | undefined = await this.worktreeSource?.deleteBranch(
        branch.worktree.id,
        branch.name,
        force,
      );
      return outcome === 'not-merged';
    }
    const result: MutationResult = await this.repository.deleteBranch(branch.name, force);
    return !result.success && result.code === BRANCH_NOT_MERGED;
  }

  /**
   * Dismisses the delete confirmation, leaving the branch alone.
   */
  protected cancelDeleteBranch(): void {
    this.pendingDeleteBranch.set(null);
  }

  /**
   * Confirms the forced delete, losing the branch's unmerged commits.
   */
  protected confirmForceDeleteBranch(): void {
    const branch: BranchDeletion | null = this.pendingForceDeleteBranch();
    this.pendingForceDeleteBranch.set(null);
    if (branch !== null) {
      this.log.warn('SourceControlSidebar', `Force-deleting branch '${branch.name}'`);
      void this.deleteBranch(branch, true);
    }
  }

  /**
   * Dismisses the forced-delete question, leaving the branch and its commits alone.
   */
  protected cancelForceDeleteBranch(): void {
    this.pendingForceDeleteBranch.set(null);
  }

  /**
   * Merges a branch into the checked-out one.
   *
   * No confirmation: a merge adds to the history rather than rewriting it, and one that goes wrong is
   * undone by the abort the panel now offers. A conflict is not reported here at all — it comes back
   * coded, the working tree reloads, and the state it left is what the user sees.
   *
   * @param branch The branch to merge in.
   * @param mode How the merge records its result.
   */
  private merge(branch: GitBranch, mode: GitMergeMode): void {
    this.log.info('SourceControlSidebar', `Merging '${branch.name}' (${mode})`);
    void this.repository.merge(branch.name, mode);
  }

  /**
   * Holds the branch the checked-out one is to be rebased onto, or null when the confirmation is
   * closed. Unlike a merge, a rebase is asked about first: it rewrites the commits of the branch the
   * user is standing on, and a branch already pushed cannot take the result without a force.
   */
  protected readonly pendingRebaseOnto: WritableSignal<GitBranch | null> = signal<GitBranch | null>(
    null,
  );

  /**
   * Gets the name of the branch a confirmed rebase would rewrite — the checked-out one, which the
   * dialog names rather than leaving the user to remember.
   */
  protected readonly rebaseSubject: Signal<string> = computed(
    (): string => this.repository.currentBranch()?.name ?? '',
  );

  /**
   * Gets a value indicating whether the branch a rebase would rewrite has already been pushed, which
   * is what turns a tidy-up into something that needs a force-push and a word to anyone else on it.
   */
  protected readonly rebaseRewritesPublished: Signal<boolean> = computed(
    (): boolean => this.repository.currentBranch()?.upstream !== undefined,
  );

  /**
   * Confirms the rebase, replaying the checked-out branch onto the chosen one.
   */
  protected confirmRebase(): void {
    const branch: GitBranch | null = this.pendingRebaseOnto();
    this.pendingRebaseOnto.set(null);
    if (branch !== null) {
      this.log.info('SourceControlSidebar', `Rebasing onto '${branch.name}'`);
      void this.repository.rebase(branch.name);
    }
  }

  /**
   * Dismisses the rebase confirmation, leaving the history alone.
   */
  protected cancelRebase(): void {
    this.pendingRebaseOnto.set(null);
  }

  /**
   * Holds the branch being renamed, or null when the rename dialog is closed.
   */
  protected readonly renamingBranch: WritableSignal<GitBranch | null> = signal<GitBranch | null>(
    null,
  );

  /**
   * Holds the new name being entered in the rename dialog.
   */
  protected readonly renameName: WritableSignal<string> = signal<string>('');

  /**
   * Gets the reason the entered name cannot be used, or null when it can.
   */
  protected readonly renameNameError: Signal<string | null> = computed((): string | null => {
    const name: string = this.renameName().trim();
    if (name.length === 0 || name === this.renamingBranch()?.name) {
      return null;
    }
    return this.repository.branches().some((branch: GitBranch): boolean => branch.name === name)
      ? 'A branch with this name already exists.'
      : null;
  });

  /**
   * Gets whether the rename can be applied. A name unchanged from the branch's own is not an error to
   * report, but there is nothing to do with it either.
   */
  protected readonly canRenameBranch: Signal<boolean> = computed((): boolean => {
    const name: string = this.renameName().trim();
    return (
      name.length > 0 && name !== this.renamingBranch()?.name && this.renameNameError() === null
    );
  });

  /**
   * Opens the rename dialog for a branch, seeded with its current name.
   * @param branch The branch to rename.
   */
  private openRenameDialog(branch: GitBranch): void {
    this.renameName.set(branch.name);
    this.renamingBranch.set(branch);
  }

  /**
   * Confirms the rename.
   */
  protected confirmRenameBranch(): void {
    const branch: GitBranch | null = this.renamingBranch();
    if (branch === null || !this.canRenameBranch()) {
      return;
    }
    const name: string = this.renameName().trim();
    this.renamingBranch.set(null);
    this.log.info('SourceControlSidebar', `Renaming '${branch.name}' to '${name}'`);
    void this.repository.renameBranch(branch.name, name);
  }

  /**
   * Dismisses the rename dialog without renaming anything.
   */
  protected cancelRenameBranch(): void {
    this.renamingBranch.set(null);
  }

  /**
   * Records the new branch name as it is typed.
   * @param value The entered name.
   */
  protected onRenameNameValue(value: string): void {
    this.renameName.set(value);
  }

  /**
   * Holds the branch whose upstream is being set, or null when the dialog is closed.
   */
  protected readonly upstreamBranch: WritableSignal<GitBranch | null> = signal<GitBranch | null>(
    null,
  );

  /**
   * Holds the remote-tracking branch chosen in the upstream dialog.
   */
  protected readonly upstreamChoice: WritableSignal<string> = signal<string>('');

  /**
   * Gets the remote-tracking branches offered as upstreams, grouped by the remote they belong to.
   * The dropdown groups consecutive runs, and the remotes already arrive grouped.
   */
  protected readonly upstreamOptions: Signal<readonly DropdownOption[]> = computed(
    (): readonly DropdownOption[] =>
      this.repository.remotes().flatMap((remote: GitRemote): readonly DropdownOption[] =>
        remote.branches.map((branch: GitRemoteBranch): DropdownOption => ({
          value: branch.name,
          label: branch.name,
          group: remote.name,
        })),
      ),
  );

  /**
   * Opens the upstream dialog for a branch.
   *
   * The choice is seeded with what the branch already tracks; failing that, with a remote-tracking
   * branch of the same name if one exists, which is nearly always what was meant. Failing both, the
   * first on offer.
   *
   * @param branch The branch whose upstream is being set.
   */
  private openUpstreamDialog(branch: GitBranch): void {
    const options: readonly DropdownOption[] = this.upstreamOptions();
    const sameName: DropdownOption | undefined = options.find((option: DropdownOption): boolean =>
      option.value.endsWith(`/${branch.name}`),
    );
    this.upstreamChoice.set(branch.upstream ?? sameName?.value ?? options[0]?.value ?? '');
    this.upstreamBranch.set(branch);
  }

  /**
   * Confirms the upstream dialog.
   */
  protected confirmUpstream(): void {
    const branch: GitBranch | null = this.upstreamBranch();
    const upstream: string = this.upstreamChoice();
    this.upstreamBranch.set(null);
    if (branch !== null && upstream.length > 0) {
      this.log.info('SourceControlSidebar', `Setting '${branch.name}' to track '${upstream}'`);
      void this.repository.setUpstream(branch.name, upstream);
    }
  }

  /**
   * Dismisses the upstream dialog without changing anything.
   */
  protected cancelUpstream(): void {
    this.upstreamBranch.set(null);
  }

  /**
   * Records the upstream chosen from the dropdown.
   * @param value The chosen remote-tracking branch.
   */
  protected onUpstreamChoice(value: string): void {
    this.upstreamChoice.set(value);
  }

  /**
   * Opens a remote's web address in the browser.
   * @param remote The remote to open.
   */
  private openRemoteUrl(remote: GitRemote): void {
    const url: string | null = browsableRemoteUrl(remote.url);
    if (url === null) {
      return;
    }
    this.log.info('SourceControlSidebar', `Opening remote '${remote.name}' at ${url}`);
    void this.shell.openExternal(url);
  }

  /**
   * Holds the remote awaiting removal confirmation, or null when none is.
   */
  protected readonly pendingRemoveRemote: WritableSignal<GitRemote | null> =
    signal<GitRemote | null>(null);

  /**
   * Confirms the removal, dropping the remote and its tracking branches.
   */
  protected confirmRemoveRemote(): void {
    const remote: GitRemote | null = this.pendingRemoveRemote();
    this.pendingRemoveRemote.set(null);
    if (remote !== null) {
      this.log.info('SourceControlSidebar', `Removing remote '${remote.name}'`);
      void this.repository.removeRemote(remote.name);
    }
  }

  /**
   * Dismisses the removal confirmation, leaving the remote alone.
   */
  protected cancelRemoveRemote(): void {
    this.pendingRemoveRemote.set(null);
  }

  /**
   * Holds whether the add-remote dialog is open.
   */
  protected readonly remoteDialogOpen: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the name being entered in the add-remote dialog.
   */
  protected readonly remoteName: WritableSignal<string> = signal<string>('');

  /**
   * Holds the URL being entered in the add-remote dialog.
   */
  protected readonly remoteUrl: WritableSignal<string> = signal<string>('');

  /**
   * Gets the reason the entered remote name cannot be used, or null when it can.
   */
  protected readonly remoteNameError: Signal<string | null> = computed((): string | null => {
    const name: string = this.remoteName().trim();
    if (name.length === 0) {
      return null;
    }
    return this.repository.remotes().some((remote: GitRemote): boolean => remote.name === name)
      ? 'A remote with that name already exists.'
      : null;
  });

  /**
   * Gets whether the entered remote can be added. Both fields are required: a remote without a URL is
   * not a remote, and git would reject it anyway.
   */
  protected readonly canAddRemote: Signal<boolean> = computed(
    (): boolean =>
      this.remoteName().trim().length > 0 &&
      this.remoteUrl().trim().length > 0 &&
      this.remoteNameError() === null,
  );

  /**
   * Opens the add-remote dialog.
   */
  protected openRemoteDialog(): void {
    this.remoteName.set('');
    this.remoteUrl.set('');
    this.remoteDialogOpen.set(true);
  }

  /**
   * Confirms the add-remote dialog.
   */
  protected confirmRemote(): void {
    if (!this.canAddRemote()) {
      return;
    }
    const name: string = this.remoteName().trim();
    const url: string = this.remoteUrl().trim();
    this.remoteDialogOpen.set(false);
    this.log.info('SourceControlSidebar', `Adding remote '${name}'`);
    void this.repository.addRemote(name, url);
  }

  /**
   * Dismisses the add-remote dialog without adding anything.
   */
  protected cancelRemote(): void {
    this.remoteDialogOpen.set(false);
  }

  /**
   * Records the remote name as it is typed.
   * @param value The entered name.
   */
  protected onRemoteNameValue(value: string): void {
    this.remoteName.set(value);
  }

  /**
   * Records the remote URL as it is typed.
   * @param value The entered URL.
   */
  protected onRemoteUrlValue(value: string): void {
    this.remoteUrl.set(value);
  }

  /**
   * Holds the tag awaiting delete confirmation, or null when none is.
   */
  protected readonly pendingDeleteTag: WritableSignal<GitTag | null> = signal<GitTag | null>(null);

  /**
   * Holds whether the new-tag dialog is open.
   */
  protected readonly tagDialogOpen: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the name being entered in the new-tag dialog.
   */
  protected readonly tagName: WritableSignal<string> = signal<string>('');

  /**
   * Holds the annotation message being entered. An empty message makes the tag lightweight, which is
   * what makes this one field rather than a field and a switch: a tag is annotated exactly when there
   * is something to annotate it with.
   */
  protected readonly tagMessage: WritableSignal<string> = signal<string>('');

  /**
   * Gets the commit a new tag would be created at: the one selected in the graph, or the current head
   * when the selection is the working tree or nothing.
   */
  protected readonly tagTarget: Signal<GitCommit | null> = computed((): GitCommit | null =>
    this.repository.selectedCommit(),
  );

  /**
   * Gets how the new tag's target reads in the dialog, so the commit being tagged is never a guess.
   */
  protected readonly tagTargetLabel: Signal<string> = computed((): string => {
    const commit: GitCommit | null = this.tagTarget();
    return commit === null ? 'the current head' : `${commit.shortHash} — ${commit.summary}`;
  });

  /**
   * Gets the reason the entered tag name cannot be used, or null when it can. Git would reject a
   * duplicate itself, but saying so before the command runs is friendlier than surfacing its error.
   */
  protected readonly tagNameError: Signal<string | null> = computed((): string | null => {
    const name: string = this.tagName().trim();
    if (name.length === 0) {
      return null;
    }
    return this.repository.tags().some((tag: GitTag): boolean => tag.name === name)
      ? 'A tag with that name already exists.'
      : null;
  });

  /**
   * Gets whether the entered tag can be created.
   */
  protected readonly canCreateTag: Signal<boolean> = computed(
    (): boolean => this.tagName().trim().length > 0 && this.tagNameError() === null,
  );

  /**
   * Opens the new-tag dialog.
   */
  protected openTagDialog(): void {
    this.tagName.set('');
    this.tagMessage.set('');
    this.tagDialogOpen.set(true);
  }

  /**
   * Confirms the new-tag dialog, creating the tag at the selected commit.
   */
  protected confirmTag(): void {
    if (!this.canCreateTag()) {
      return;
    }
    const name: string = this.tagName().trim();
    const message: string = this.tagMessage().trim();
    const commit: string = this.tagTarget()?.hash ?? 'HEAD';
    this.tagDialogOpen.set(false);
    this.log.info('SourceControlSidebar', `Creating tag '${name}' at ${commit}`);
    void this.repository.createTag(name, commit, message.length === 0 ? undefined : message);
  }

  /**
   * Dismisses the new-tag dialog without creating anything.
   */
  protected cancelTag(): void {
    this.tagDialogOpen.set(false);
  }

  /**
   * Records the tag name as it is typed.
   * @param value The entered name.
   */
  protected onTagNameValue(value: string): void {
    this.tagName.set(value);
  }

  /**
   * Records the annotation message as it is typed.
   * @param value The entered message.
   */
  protected onTagMessageValue(value: string): void {
    this.tagMessage.set(value);
  }

  /**
   * Pushes a tag to a remote.
   * @param tag The tag to push.
   * @param remote The remote to push to, or undefined to let the repository choose.
   */
  private pushTag(tag: GitTag, remote?: string): void {
    this.log.info(
      'SourceControlSidebar',
      `Pushing tag '${tag.name}' to ${remote ?? 'the default remote'}`,
    );
    void this.repository.pushTag(tag.name, remote);
  }

  /**
   * Asks for confirmation before deleting a tag.
   * @param tag The tag to delete.
   */
  private requestDeleteTag(tag: GitTag): void {
    this.pendingDeleteTag.set(tag);
  }

  /**
   * Confirms the delete, removing the tag locally.
   */
  protected confirmDeleteTag(): void {
    const tag: GitTag | null = this.pendingDeleteTag();
    this.pendingDeleteTag.set(null);
    if (tag !== null) {
      this.log.info('SourceControlSidebar', `Deleting tag '${tag.name}'`);
      void this.repository.deleteTag(tag.name);
    }
  }

  /**
   * Gets the remote a tag delete would also reach, or null when the repository has none — which is
   * what decides whether the confirmation offers the remote at all. Named in the button rather than
   * left implicit: with more than one remote configured this is the first, and deleting a tag on the
   * wrong one is not something the user can quietly undo.
   */
  protected readonly deleteTagRemote: Signal<string | null> = computed(
    (): string | null => this.repository.remotes()[0]?.name ?? null,
  );

  /**
   * Confirms the delete, removing the tag locally and on its remote.
   */
  protected confirmDeleteTagEverywhere(): void {
    const tag: GitTag | null = this.pendingDeleteTag();
    const remote: string | null = this.deleteTagRemote();
    this.pendingDeleteTag.set(null);
    if (tag !== null && remote !== null) {
      this.log.info(
        'SourceControlSidebar',
        `Deleting tag '${tag.name}' on '${remote}' and locally`,
      );
      void this.repository.deleteTagEverywhere(tag.name, remote);
    }
  }

  /**
   * Dismisses the delete confirmation, leaving the tag alone.
   */
  protected cancelDeleteTag(): void {
    this.pendingDeleteTag.set(null);
  }

  /**
   * Toggles a section between expanded and collapsed.
   * @param key The section key.
   */
  private toggleSection(key: string): void {
    const next: Set<string> = new Set<string>(this.expandedSections());
    if (next.has(key)) {
      next.delete(key);
      // Out of sight, so it stops being kept current: an idle workspace must not talk to the forge.
      this.forge.unwatch(key);
    } else {
      next.add(key);
      // Read on first expand rather than eagerly: a section the user never opens should cost nothing.
      this.loadSection(key);
      this.forge.watch(key);
    }
    this.expandedSections.set(next);
  }

  /**
   * Loads a forge-backed section's data, if it is one and it has nothing yet, or always when forced
   * (its menu's Refresh). Sections backed by git are already loaded with the repository and need
   * nothing here.
   * @param key The section key being expanded.
   * @param force Whether to read it even when it has data already.
   */
  private loadSection(key: string, force: boolean = false): void {
    if (key === 'pullRequests' && (force || this.forge.pullRequests().state !== 'ready')) {
      void this.forge.loadPullRequests();
    }
    if (key === 'issues' && (force || this.forge.issues().state !== 'ready')) {
      void this.forge.loadIssues();
    }
    if (key === 'actions' && (force || this.forge.workflowRuns().state !== 'ready')) {
      void this.forge.loadWorkflowRuns();
    }
  }

  /**
   * Builds the local-branch rows.
   * @returns Returns the rows.
   */
  private localRows(): readonly TreeRow[] {
    const worktrees: readonly RepositoryWorktree[] | null = this.worktrees();
    return worktrees === null ? this.branchRows(1) : this.worktreeRows(worktrees);
  }

  /**
   * Builds the current checkout's branch rows: the whole of Local in a flat repository, and the
   * branches beneath the current worktree in a worktree container. Either way they are this view's
   * own branches, with every branch action behind them.
   * @param depth The rows' depth in the tree.
   * @returns Returns the rows.
   */
  private branchRows(depth: number): readonly TreeRow[] {
    const branches: readonly GitBranch[] = this.repository.branches();
    if (branches.length === 0) {
      return [this.emptyRow('local', Icon.SOURCE_CONTROL, 'No local branches', depth)];
    }
    return branches.map((branch: GitBranch): TreeRow => ({
      id: `branch:${branch.name}`,
      depth,
      expandable: false,
      expanded: false,
      data: {
        kind: 'branch',
        icon: Icon.SOURCE_CONTROL,
        label: branch.name,
        branch,
        commit: branch.tip,
      },
    }));
  }

  /**
   * Builds Local for a worktree container: each worktree, and beneath it its own local branches with
   * its checked-out branch among them. Several branches are worked on at once, so each worktree's
   * checked-out branch is highlighted, not only the current one's (see {@link selectedIds}).
   *
   * The current worktree's branches are this view's live ones. Another worktree's are read from its
   * status: it is a clone of its own, so it has branches this view's repository does not.
   * @param worktrees The worktrees, in registration order.
   * @returns Returns the rows.
   */
  private worktreeRows(worktrees: readonly RepositoryWorktree[]): readonly TreeRow[] {
    const expanded: ReadonlySet<string> = this.expandedWorktrees();
    const out: TreeRow[] = [];
    for (const worktree of worktrees) {
      const open: boolean = expanded.has(worktree.id);
      out.push({
        id: `worktree:${worktree.id}`,
        depth: 1,
        expandable: true,
        expanded: open,
        data: {
          kind: 'worktree',
          icon: Icon.WORKTREE,
          label: worktree.label,
          worktree,
        },
      });
      if (!open) {
        continue;
      }
      out.push(...(worktree.current ? this.branchRows(2) : this.otherWorktreeBranchRows(worktree)));
    }
    return out;
  }

  /**
   * Builds the branch rows beneath a worktree other than the current one.
   * @param worktree The worktree.
   * @returns Returns the rows.
   */
  private otherWorktreeBranchRows(worktree: RepositoryWorktree): readonly TreeRow[] {
    if (worktree.branches.length === 0) {
      return [
        this.emptyRow(`worktree:${worktree.id}`, Icon.SOURCE_CONTROL, 'No local branches', 2),
      ];
    }
    return worktree.branches.map((branch: WorktreeBranch): TreeRow => ({
      id: this.worktreeBranchId(worktree.id, branch.name),
      depth: 2,
      expandable: false,
      expanded: false,
      data: {
        kind: 'worktree-branch',
        icon: Icon.SOURCE_CONTROL,
        label: branch.name,
        worktree,
        worktreeBranch: branch,
        ...(branch.name === worktree.branch && worktree.changes !== null
          ? { changes: worktree.changes }
          : {}),
      },
    }));
  }

  /**
   * Builds the row id of a branch beneath a worktree other than the current one.
   * @param worktreeId The worktree's checkout id.
   * @param branch The branch name.
   * @returns Returns the row id.
   */
  private worktreeBranchId(worktreeId: string, branch: string): string {
    return `worktree:${worktreeId}:branch:${branch}`;
  }

  /**
   * Builds the remote rows, each remote followed by its nested branches.
   * @returns Returns the rows.
   */
  private remoteRows(): readonly TreeRow[] {
    const remotes: readonly GitRemote[] = this.repository.remotes();
    if (remotes.length === 0) {
      return [this.emptyRow('remote', Icon.CLOUD, 'No remotes')];
    }
    const out: TreeRow[] = [];
    for (const remote of remotes) {
      out.push({
        id: `remote:${remote.name}`,
        depth: 1,
        expandable: false,
        expanded: false,
        // The URL stays off the row: it is long, it is the same for most of a repository's life, and
        // a tree of names reads worse with an address after each one. It lives on the menu, where it
        // can be copied or opened rather than merely looked at.
        data: { kind: 'remote', icon: Icon.CLOUD, label: remote.name, remote },
      });
      for (const branch of remote.branches) {
        out.push({
          id: `remote:${branch.name}`,
          depth: 2,
          expandable: false,
          expanded: false,
          data: {
            kind: 'remote-branch',
            icon: Icon.SOURCE_CONTROL,
            label: branch.name,
            commit: branch.commit,
            remote,
            remoteBranch: branch,
          },
        });
      }
    }
    return out;
  }

  /**
   * Builds the tag rows.
   * @returns Returns the rows.
   */
  private tagRows(): readonly TreeRow[] {
    const tags: readonly GitTag[] = this.repository.tags();
    if (tags.length === 0) {
      return [this.emptyRow('tags', Icon.TAG, 'No tags')];
    }
    return tags.map((tag: GitTag): TreeRow => ({
      id: `tag:${tag.name}`,
      depth: 1,
      expandable: false,
      expanded: false,
      data: { kind: 'tag', icon: Icon.TAG, label: tag.name, commit: tag.commit, tag },
    }));
  }

  /**
   * Builds the stash rows.
   * @returns Returns the rows.
   */
  private stashRows(): readonly TreeRow[] {
    const stashes: readonly GitStash[] = this.repository.stashes();
    if (stashes.length === 0) {
      return [this.emptyRow('stashes', Icon.STASH, 'No stashes')];
    }
    return stashes.map((stash: GitStash): TreeRow => ({
      id: `stash:${stash.index}`,
      depth: 1,
      expandable: false,
      expanded: false,
      data: { kind: 'stash', icon: Icon.STASH, label: stash.message, stash },
    }));
  }

  /**
   * Builds the pull-request rows.
   * @returns Returns the rows.
   */
  private pullRequestRows(): readonly TreeRow[] {
    const section: ForgeSection<ForgePullRequest> = this.forge.pullRequests();
    if (section.state !== 'ready' && section.items.length === 0) {
      return [
        this.emptyRow(
          'pullRequests',
          Icon.GIT_PULL_REQUEST,
          section.message ?? PENDING_MESSAGES[section.state],
        ),
      ];
    }
    if (section.items.length === 0) {
      return [this.emptyRow('pullRequests', Icon.GIT_PULL_REQUEST, 'No open pull requests')];
    }
    return section.items.map((pull: ForgePullRequest): TreeRow => ({
      id: `pr:${pull.number}`,
      depth: 1,
      expandable: false,
      expanded: false,
      data: {
        kind: 'pr',
        icon: Icon.GIT_PULL_REQUEST,
        label: `#${pull.number} ${pull.title}${pull.draft ? ' (draft)' : ''}`,
        pullRequest: pull,
        // A pull request whose checks have not reported gets no badge at all, rather than one
        // implying work is in flight.
        ...(pull.checks === 'none' ? {} : { status: pull.checks }),
      },
    }));
  }

  /**
   * Builds a branch row's commands: what to do with the branch itself, then what to exchange with its
   * upstream.
   *
   * The first command is whichever the row can offer. A branch that is not checked out offers to
   * become so; the checked-out one cannot be checked out again, and instead offers to commit what is
   * sitting in the working tree — but only when there is something sitting there, since a commit of
   * nothing is not a command, it is an error message waiting to happen.
   *
   * @param branch The branch the row carries.
   * @returns Returns the menu items.
   */
  private branchItems(branch: GitBranch): readonly MenuItem[] {
    const lead: readonly MenuItem[] = branch.current
      ? this.repository.changeCount() === 0
        ? []
        : [
            {
              id: ACTION_COMMIT_BRANCH,
              label: 'Commit…',
              icon: Icon.GIT_COMMIT,
              status: `${this.repository.changeCount()} changed`,
            },
          ]
      : [{ id: ACTION_CHECKOUT_BRANCH, label: 'Check Out', icon: Icon.TRAY_UP }];
    const integration: readonly MenuItem[] = this.integrationItems(branch);
    return [
      ...lead,
      ...(lead.length === 0 ? [] : [{ separator: true, id: 'branch.sep.lead', label: '' }]),
      ...this.upstreamItems(branch),
      ...(integration.length === 0
        ? []
        : [{ separator: true, id: 'branch.sep.integrate', label: '' }, ...integration]),
      { separator: true, id: 'branch.sep.manage', label: '' },
      ...this.branchManagementItems(branch),
    ];
  }

  /**
   * Builds a branch's integration commands: bringing it into the checked-out branch, or replaying the
   * checked-out branch on top of it.
   *
   * Neither is offered on the checked-out branch itself — a branch cannot be merged into itself, nor
   * rebased onto itself — so the row that carries them is always the other one. Both are inert while
   * the working tree has changes git would have to overwrite, or while an earlier operation is still
   * unfinished, and each says which it is rather than leaving the user to find out from a refusal.
   *
   * The three merges sit behind one submenu rather than three rows. They answer the same question and
   * differ only in what they record, and a menu that spends three of its rows on one command reads as
   * though it were three.
   *
   * @param branch The branch the row carries.
   * @returns Returns the menu items, or none for the checked-out branch.
   */
  private integrationItems(branch: GitBranch): readonly MenuItem[] {
    const current: GitBranch | undefined = this.repository.currentBranch();
    if (branch.current || current === undefined) {
      return [];
    }
    return this.offeredOnly(this.allIntegrationItems(branch, current));
  }

  /**
   * Keeps the menu items whose command the serving plugin supports (#818): a tag command to a plugin
   * with tags, a stash to one with stashes. Items needing nothing in particular are always kept.
   * @param items The items.
   * @returns Returns the items the plugin can carry out.
   */
  private offeredOnly(items: readonly MenuItem[]): readonly MenuItem[] {
    return items.filter((item: MenuItem): boolean => {
      const needed: VersionControlCapability | undefined = ACTION_CAPABILITY.find(
        ([prefix]: readonly [string, VersionControlCapability]): boolean =>
          item.id.startsWith(prefix),
      )?.[1];
      return needed === undefined || this.repository.supports(needed);
    });
  }

  /**
   * Builds a branch's merge and rebase commands, before they are filtered by what the plugin supports.
   * @param branch The branch the row carries.
   * @param current The checked-out branch.
   * @returns Returns the menu items.
   */
  private allIntegrationItems(branch: GitBranch, current: GitBranch): readonly MenuItem[] {
    const reason: string | undefined = this.repository.operationInFlight()
      ? REASON_IN_PROGRESS
      : this.repository.changeCount() > 0
        ? REASON_UNCOMMITTED
        : undefined;
    const blocked: boolean = reason !== undefined;
    return [
      {
        id: ACTION_MERGE_BRANCH,
        label: `Merge Into “${current.name}”`,
        icon: Icon.GIT_MERGE,
        disabled: blocked,
        ...(reason === undefined ? {} : { status: reason }),
        children: [
          { id: ACTION_MERGE_BRANCH, label: 'Merge', icon: Icon.GIT_MERGE, disabled: blocked },
          {
            id: ACTION_MERGE_BRANCH_NO_FF,
            label: 'Merge Without Fast-Forward',
            icon: Icon.GIT_MERGE,
            disabled: blocked,
            status: 'always records a merge commit',
          },
          {
            id: ACTION_SQUASH_MERGE_BRANCH,
            label: 'Squash Merge',
            icon: Icon.GIT_MERGE,
            disabled: blocked,
            status: 'stages the changes as one, uncommitted',
          },
        ],
      },
      {
        id: ACTION_REBASE_ONTO_BRANCH,
        label: `Rebase “${current.name}” Onto This…`,
        icon: Icon.BRANCH,
        disabled: blocked,
        ...(reason === undefined ? {} : { status: reason }),
      },
    ];
  }

  /**
   * Builds a branch's own housekeeping commands — what to call it, what it tracks, and whether it
   * stays.
   *
   * Clearing the upstream is offered only to a branch that has one, since it is a command with no
   * effect otherwise. Deleting is offered to every branch but the checked-out one: git will not
   * delete the branch it is standing on, and a command whose only outcome is that refusal is not
   * worth a row.
   *
   * @param branch The branch the row carries.
   * @returns Returns the menu items.
   */
  private branchManagementItems(branch: GitBranch): readonly MenuItem[] {
    const items: MenuItem[] = [
      { id: ACTION_RENAME_BRANCH, label: 'Rename…', icon: Icon.PENCIL },
      {
        id: ACTION_SET_UPSTREAM,
        label: 'Set Upstream…',
        icon: Icon.CLOUD,
        ...(branch.upstream === undefined ? {} : { status: branch.upstream }),
      },
    ];
    if (branch.upstream !== undefined) {
      items.push({ id: ACTION_CLEAR_UPSTREAM, label: 'Clear Upstream', icon: Icon.CLOSE });
    }
    if (!branch.current) {
      items.push({ separator: true, id: 'branch.sep.delete', label: '' });
      items.push({ id: ACTION_DELETE_BRANCH, label: 'Delete…', icon: Icon.TRASH });
    }
    return items;
  }

  /**
   * Builds a branch's exchange commands, each offered only where git could honour it.
   *
   * A repository with no remote has nowhere to send anything, so all three are inert. A branch with
   * no upstream can still be pushed — the push publishes it and sets the upstream, which is how a
   * freshly-created branch is meant to reach the remote — but there is nothing to pull from and so
   * nothing to sync with, and offering either would be offering a command git would only refuse.
   *
   * A branch that is not checked out is fast-forwarded rather than merged, which the note says: a
   * merge needs a working tree and git will not give one to a branch that does not have it. Saying so
   * in the menu is cheaper than letting the refusal explain it afterwards.
   *
   * The counts ride along as muted notes, because whether there is anything to send or receive is the
   * question the user opened the menu to answer.
   *
   * @param branch The branch the row carries.
   * @returns Returns the menu items.
   */
  private upstreamItems(branch: GitBranch): readonly MenuItem[] {
    const noRemote: boolean = this.repository.remotes().length === 0;
    const noUpstream: boolean = branch.upstream === undefined;
    const reason: string | undefined = noRemote
      ? 'no remotes'
      : noUpstream
        ? 'no upstream'
        : undefined;
    return [
      {
        id: ACTION_PUSH_BRANCH,
        label: 'Push',
        icon: Icon.CLOUD_UP,
        disabled: noRemote,
        // A branch with no upstream is published by the push, so the count is what it is sending, not
        // a comparison with something that does not exist yet.
        ...(noRemote
          ? { status: 'no remotes' }
          : branch.ahead > 0
            ? { status: `${branch.ahead} ahead` }
            : {}),
      },
      {
        id: ACTION_PULL_BRANCH,
        label: 'Pull',
        icon: Icon.CLOUD_DOWN,
        disabled: noRemote || noUpstream,
        status:
          reason ??
          // Off the working tree there is no merge to be had, so the note says which kind of update
          // this is before it is chosen rather than after git refuses.
          (branch.current
            ? branch.behind > 0
              ? `${branch.behind} behind`
              : 'up to date'
            : branch.behind > 0
              ? `${branch.behind} behind, fast-forward`
              : 'fast-forward'),
      },
      {
        id: ACTION_SYNC_BRANCH,
        label: 'Sync',
        icon: Icon.CLOUD_CHECK,
        disabled: noRemote || noUpstream,
        status: reason ?? 'pull, then push',
      },
    ];
  }

  /**
   * Builds a push command that names the remote it would push to.
   *
   * One remote is the ordinary case and gets a single row saying where it goes, because a command
   * whose destination is not in doubt should not make the user open a submenu to confirm it. Several
   * remotes get one row each: a fork has both `origin` and `upstream`, and pushing to the wrong one
   * is exactly the mistake a silent default would invite. None at all leaves the row inert rather
   * than absent, so the command's existence is still discoverable.
   *
   * @param action The command's identifier, which its submenu rows extend with `:<remote>`.
   * @param label The command's verb.
   * @returns Returns the menu item.
   */
  private pushToRemoteItem(action: string, label: string): MenuItem {
    const remotes: readonly GitRemote[] = this.repository.remotes();
    if (remotes.length === 0) {
      return { id: action, label, icon: Icon.CLOUD, disabled: true, status: 'no remotes' };
    }
    if (remotes.length === 1) {
      return { id: action, label: `${label} to ${remotes[0].name}`, icon: Icon.CLOUD };
    }
    return {
      id: action,
      label: `${label} to`,
      icon: Icon.CLOUD,
      children: remotes.map((remote: GitRemote): MenuItem => ({
        id: `${action}:${remote.name}`,
        label: remote.name,
        icon: Icon.CLOUD,
      })),
    };
  }

  /**
   * Reads the remote a push command was chosen for: the part after the identifier's colon for a
   * submenu row, or undefined for the single-remote row, which leaves the choice to the repository.
   * @param itemId The chosen item's identifier.
   * @param action The command's identifier.
   * @returns Returns the remote name, or undefined when the command named none.
   */
  private remoteOf(itemId: string, action: string): string | undefined {
    return itemId.startsWith(`${action}:`) ? itemId.slice(action.length + 1) : undefined;
  }

  /**
   * Builds a row's context-menu items.
   *
   * Bound as a value rather than a method, because the tree calls it as its item factory when a menu
   * opens — `this` must stay this component. A row with no commands returns nothing and the tree
   * suppresses its trigger, so right-clicking a branch or a tag does not open an empty panel.
   */
  public readonly contextMenuFor: (treeRow: TreeRow) => readonly MenuItem[] = (
    treeRow: TreeRow,
  ): readonly MenuItem[] => {
    const node: RepoNode = this.nodeOf(treeRow);
    if (node.branch !== undefined) {
      return this.branchItems(node.branch);
    }
    if (node.kind === 'section' && node.sectionKey !== undefined) {
      return this.sectionItems(node.sectionKey);
    }
    if (node.kind === 'worktree' && node.worktree !== undefined) {
      return this.worktreeItems(node.worktree);
    }
    // Another worktree's branch is mostly acted on from inside that worktree, but it can be deleted
    // from here (#939): each worktree is a clone of its own, so the delete runs in that one. The
    // branch it has checked out cannot go, as git would refuse, and the menu says why.
    if (
      node.kind === 'worktree-branch' &&
      node.worktree !== undefined &&
      node.worktreeBranch !== undefined
    ) {
      const checkedOut: boolean = node.worktreeBranch.name === node.worktree.branch;
      return [
        { id: ACTION_SWITCH_WORKTREE, label: 'Switch to Worktree', icon: Icon.WORKTREE },
        { separator: true, id: 'worktree-branch.sep', label: '' },
        {
          id: ACTION_DELETE_WORKTREE_BRANCH,
          label: 'Delete…',
          icon: Icon.TRASH,
          disabled: checkedOut,
          ...(checkedOut ? { status: 'checked out there' } : {}),
        },
      ];
    }
    if (node.stash !== undefined) {
      // Apply and pop differ only in what becomes of the stash afterwards, which is exactly what the
      // buttons' tooltips used to say; the muted trailing note carries it into the menu.
      return [
        { id: ACTION_APPLY_STASH, label: 'Apply', icon: Icon.ARROW_DOWN, status: 'keep the stash' },
        { id: ACTION_POP_STASH, label: 'Pop', icon: Icon.ARROW_UP, status: 'drop the stash' },
        { id: ACTION_DROP_STASH, label: 'Drop…', icon: Icon.TRASH },
      ];
    }
    if (node.remoteBranch !== undefined) {
      // Checking one out as a local tracking branch is the thing people come to this section for.
      return [
        {
          id: ACTION_CHECKOUT_REMOTE_BRANCH,
          label: 'Check Out',
          icon: Icon.TRAY_UP,
          status: 'as a local branch',
        },
      ];
    }
    if (node.remote !== undefined) {
      const url: string = node.remote.url;
      return [
        { id: ACTION_FETCH_REMOTE, label: 'Fetch', icon: Icon.CLOUD_DOWN },
        {
          id: ACTION_PRUNE_REMOTE,
          label: 'Prune',
          icon: Icon.REFRESH,
          status: 'drop deleted branches',
        },
        { separator: true, id: 'remote.sep.url', label: '' },
        {
          id: ACTION_COPY_REMOTE_URL,
          label: 'Copy Remote URL',
          icon: Icon.COPY,
          // Copied exactly as git has it configured: this is the string that would be pasted into a
          // clone, so rewriting it to something browsable would hand back the wrong thing.
          disabled: url.length === 0,
          ...(url.length === 0 ? { status: 'no URL' } : {}),
        },
        {
          id: ACTION_OPEN_REMOTE_URL,
          label: 'Open Remote URL',
          icon: Icon.OPEN_EXTERNAL,
          // An SSH remote is rewritten to its web address; a path-shaped one has none at all, and
          // saying so beats opening a browser onto nothing.
          disabled: browsableRemoteUrl(url) === null,
          ...(browsableRemoteUrl(url) === null ? { status: 'not a web address' } : {}),
        },
        { separator: true, id: 'remote.sep.remove', label: '' },
        { id: ACTION_REMOVE_REMOTE, label: 'Remove…', icon: Icon.TRASH },
      ];
    }
    if (node.tag !== undefined) {
      return [
        this.pushToRemoteItem(ACTION_PUSH_TAG, 'Push'),
        { id: ACTION_DELETE_TAG, label: 'Delete…', icon: Icon.TRASH },
      ];
    }
    if (node.pullRequest !== undefined) {
      return [
        { id: ACTION_CHECKOUT_PULL_REQUEST, label: 'Check Out', icon: Icon.TRAY_UP },
        { id: ACTION_OPEN_PULL_REQUEST, label: this.openOnLabel(), icon: Icon.OPEN_EXTERNAL },
      ];
    }
    if (node.issue !== undefined) {
      return [
        { id: ACTION_ISSUE_IN_AGENT, label: 'Open in Agent', icon: Icon.AGENT },
        { id: ACTION_OPEN_ISSUE, label: this.openOnLabel(), icon: Icon.OPEN_EXTERNAL },
      ];
    }
    if (node.run !== undefined) {
      const items: MenuItem[] = [];
      // Cancel applies only to a run still going, re-run only to one that has stopped. Offering the
      // inapplicable one would be offering a command the forge would simply refuse.
      // Each is also offered only where the repository allows it — a user without push access cannot.
      if (node.run.status === 'queued' || node.run.status === 'running') {
        if (this.forge.supports('ciCancel')) {
          items.push({ id: ACTION_CANCEL_RUN, label: 'Cancel Run', icon: Icon.STOP });
        }
      } else if (this.forge.supports('ciRerun')) {
        items.push({ id: ACTION_RERUN, label: 'Re-run', icon: Icon.REFRESH });
      }
      items.push({ id: ACTION_OPEN_RUN, label: this.openOnLabel(), icon: Icon.OPEN_EXTERNAL });
      return items;
    }
    return [];
  };

  /**
   * Builds a worktree row's menu: switching to it (from another), finding it on disk, and removing it.
   *
   * Removal is omitted rather than disabled on the last worktree and while one is being created or
   * removed: the first is a rule about the container, the second momentary, and a greyed item would
   * only invite the user to keep trying.
   * @param worktree The worktree.
   * @returns Returns the menu items.
   */
  private worktreeItems(worktree: RepositoryWorktree): readonly MenuItem[] {
    const items: MenuItem[] = [];
    if (!worktree.current) {
      items.push(
        { id: ACTION_SWITCH_WORKTREE, label: 'Switch to Worktree', icon: Icon.WORKTREE },
        { separator: true, id: 'worktree.sep.switch', label: '' },
      );
    }
    items.push(
      // A branch is made in a worktree, since each is a clone of its own (#939).
      { ...this.newBranchItem(), disabled: false },
      { separator: true, id: 'worktree.sep.branch', label: '' },
      { id: ACTION_RENAME_WORKTREE, label: 'Rename…', icon: Icon.PENCIL },
      { separator: true, id: 'worktree.sep.rename', label: '' },
      { id: ACTION_REVEAL_WORKTREE, label: OPEN_IN_FILE_SYSTEM_LABEL, icon: Icon.DIRECTORY },
      { id: ACTION_COPY_WORKTREE_PATH, label: 'Copy Path', icon: Icon.COPY },
    );
    const removable: boolean =
      (this.worktrees()?.length ?? 0) > 1 && !(this.worktreeSource?.busy() ?? false);
    if (removable) {
      items.push(
        { separator: true, id: 'worktree.sep.remove', label: '' },
        { id: ACTION_REMOVE_WORKTREE, label: 'Remove Worktree…', icon: Icon.TRASH, tone: 'danger' },
      );
    }
    return items;
  }

  /**
   * Runs a worktree command from a worktree row, or from a branch row of another worktree.
   * @param itemId The chosen item's identifier.
   * @param worktree The worktree the row belongs to.
   * @returns Returns true when the command was a worktree command.
   */
  private onWorktreeAction(itemId: string, worktree: RepositoryWorktree): boolean {
    switch (itemId) {
      case ACTION_NEW_BRANCH:
        this.openBranchDialog(worktree);
        return true;
      case ACTION_SWITCH_WORKTREE:
        this.switchToWorktree(worktree);
        return true;
      case ACTION_RENAME_WORKTREE:
        this.renaming.set(worktree);
        return true;
      case ACTION_REVEAL_WORKTREE:
        void this.shell.revealPath(worktree.path);
        return true;
      case ACTION_COPY_WORKTREE_PATH:
        void navigator.clipboard.writeText(worktree.path).catch((): void => undefined);
        return true;
      case ACTION_REMOVE_WORKTREE:
        this.worktreeSource?.requestRemove(worktree.id);
        return true;
      default:
        return false;
    }
  }

  /**
   * Runs a context-menu command against the row it was chosen on.
   * @param choice The chosen item and its row.
   */
  protected onContextAction(choice: TreeMenuSelection): void {
    const node: RepoNode = this.nodeOf(choice.row);
    if (choice.itemId === ACTION_NEW_WORKTREE) {
      this.worktreeSource?.requestAdd();
      return;
    }
    // A section's commands are the strip's own, bar Refresh, which re-reads that one section.
    if (node.kind === 'section' && node.sectionKey !== undefined) {
      if (choice.itemId === ACTION_REFRESH_SECTION) {
        this.loadSection(node.sectionKey, true);
      } else {
        this.onMoreAction(choice.itemId);
      }
      return;
    }
    if (
      choice.itemId === ACTION_DELETE_WORKTREE_BRANCH &&
      node.worktree !== undefined &&
      node.worktreeBranch !== undefined
    ) {
      this.pendingDeleteBranch.set({ name: node.worktreeBranch.name, worktree: node.worktree });
      return;
    }
    if (node.worktree !== undefined && this.onWorktreeAction(choice.itemId, node.worktree)) {
      return;
    }
    // Push carries its remote in the identifier, so it is matched by prefix before the exact-match
    // switch below — a `case` cannot express "this command, whichever remote it named".
    if (node.tag !== undefined && choice.itemId.startsWith(ACTION_PUSH_TAG)) {
      this.pushTag(node.tag, this.remoteOf(choice.itemId, ACTION_PUSH_TAG));
      return;
    }
    switch (choice.itemId) {
      case ACTION_DELETE_TAG:
        if (node.tag !== undefined) {
          this.requestDeleteTag(node.tag);
        }
        break;
      case ACTION_CHECKOUT_BRANCH:
        if (node.branch !== undefined) {
          this.checkout(node.branch);
        }
        break;
      case ACTION_COMMIT_BRANCH:
        this.commitOnBranch();
        break;
      case ACTION_RENAME_BRANCH:
        if (node.branch !== undefined) {
          this.openRenameDialog(node.branch);
        }
        break;
      case ACTION_SET_UPSTREAM:
        if (node.branch !== undefined) {
          this.openUpstreamDialog(node.branch);
        }
        break;
      case ACTION_CLEAR_UPSTREAM:
        if (node.branch !== undefined) {
          this.log.info('SourceControlSidebar', `Clearing the upstream of '${node.branch.name}'`);
          void this.repository.clearUpstream(node.branch.name);
        }
        break;
      case ACTION_DELETE_BRANCH:
        if (node.branch !== undefined) {
          this.pendingDeleteBranch.set(node.branch);
        }
        break;
      case ACTION_MERGE_BRANCH:
        if (node.branch !== undefined) {
          this.merge(node.branch, 'default');
        }
        break;
      case ACTION_MERGE_BRANCH_NO_FF:
        if (node.branch !== undefined) {
          this.merge(node.branch, 'no-ff');
        }
        break;
      case ACTION_SQUASH_MERGE_BRANCH:
        if (node.branch !== undefined) {
          this.merge(node.branch, 'squash');
        }
        break;
      case ACTION_REBASE_ONTO_BRANCH:
        if (node.branch !== undefined) {
          this.pendingRebaseOnto.set(node.branch);
        }
        break;
      case ACTION_CHECKOUT_REMOTE_BRANCH:
        if (node.remoteBranch !== undefined && node.remote !== undefined) {
          this.checkoutTracking(node.remote, node.remoteBranch);
        }
        break;
      case ACTION_FETCH_REMOTE:
        if (node.remote !== undefined) {
          void this.repository.fetchRemote(node.remote.name);
        }
        break;
      case ACTION_PRUNE_REMOTE:
        if (node.remote !== undefined) {
          void this.repository.pruneRemote(node.remote.name);
        }
        break;
      case ACTION_COPY_REMOTE_URL:
        if (node.remote !== undefined && node.remote.url.length > 0) {
          this.log.info('SourceControlSidebar', `Copying the URL of remote '${node.remote.name}'`);
          void navigator.clipboard.writeText(node.remote.url).catch((): void => undefined);
        }
        break;
      case ACTION_OPEN_REMOTE_URL:
        if (node.remote !== undefined) {
          this.openRemoteUrl(node.remote);
        }
        break;
      case ACTION_REMOVE_REMOTE:
        if (node.remote !== undefined) {
          this.pendingRemoveRemote.set(node.remote);
        }
        break;
      case ACTION_PUSH_BRANCH:
        if (node.branch !== undefined) {
          this.log.info('SourceControlSidebar', `Pushing '${node.branch.name}'`);
          void this.repository.pushBranch(node.branch);
        }
        break;
      case ACTION_PULL_BRANCH:
        if (node.branch !== undefined) {
          this.log.info('SourceControlSidebar', `Pulling '${node.branch.name}'`);
          void this.repository.pullBranch(node.branch);
        }
        break;
      case ACTION_SYNC_BRANCH:
        if (node.branch !== undefined) {
          this.log.info('SourceControlSidebar', `Syncing '${node.branch.name}'`);
          void this.repository.syncBranch(node.branch);
        }
        break;
      case ACTION_APPLY_STASH:
        if (node.stash !== undefined) {
          this.applyStash(node.stash);
        }
        break;
      case ACTION_POP_STASH:
        if (node.stash !== undefined) {
          this.popStash(node.stash);
        }
        break;
      case ACTION_DROP_STASH:
        if (node.stash !== undefined) {
          this.requestDropStash(node.stash);
        }
        break;
      case ACTION_CHECKOUT_PULL_REQUEST:
        if (node.pullRequest !== undefined) {
          this.checkoutPullRequest(node.pullRequest);
        }
        break;
      case ACTION_OPEN_PULL_REQUEST:
        if (node.pullRequest !== undefined) {
          this.openPullRequest(node.pullRequest);
        }
        break;
      case ACTION_OPEN_ISSUE:
        if (node.issue !== undefined) {
          this.openIssue(node.issue);
        }
        break;
      case ACTION_ISSUE_IN_AGENT:
        if (node.issue !== undefined) {
          this.issueAgent.open(node.issue);
        }
        break;
      case ACTION_OPEN_RUN:
        if (node.run !== undefined) {
          this.openRun(node.run);
        }
        break;
      case ACTION_RERUN:
        this.pendingRerun.set(node.run ?? null);
        break;
      case ACTION_CANCEL_RUN:
        this.pendingCancel.set(node.run ?? null);
        break;
      default:
        break;
    }
  }

  /**
   * Opens a pull request on the forge, in the user's browser.
   * @param pullRequest The pull request to open.
   */
  private openPullRequest(pullRequest: ForgePullRequest): void {
    if (pullRequest.url.length === 0) {
      return;
    }
    this.log.info('forge', `Opening pull request #${pullRequest.number} in the browser`);
    void this.shell.openExternal(pullRequest.url);
  }

  /**
   * Checks a pull request's head out as a local branch.
   * @param pullRequest The pull request to check out.
   */
  private checkoutPullRequest(pullRequest: ForgePullRequest): void {
    void this.forge.checkout(pullRequest);
  }

  /**
   * Re-reads the forge-backed sections. Separate from {@link refresh}, which re-reads git: the two
   * have entirely different costs, and a rate-limited API should not be hit every time the working
   * tree is re-read.
   */
  protected refreshForge(): void {
    const open: ReadonlySet<string> = this.expandedSections();
    if (open.has('pullRequests')) {
      void this.forge.loadPullRequests();
    }
    if (open.has('issues')) {
      void this.forge.loadIssues();
    }
    if (open.has('actions')) {
      void this.forge.loadWorkflowRuns();
    }
  }

  /**
   * Builds the issue rows.
   * @returns Returns the rows.
   */
  private issueRows(): readonly TreeRow[] {
    const section: ForgeSection<ForgeIssue> = this.forge.issues();
    if (section.state !== 'ready' && section.items.length === 0) {
      return [
        this.emptyRow('issues', Icon.INFO, section.message ?? PENDING_MESSAGES[section.state]),
      ];
    }
    if (section.items.length === 0) {
      return [this.emptyRow('issues', Icon.INFO, 'No open issues')];
    }
    return section.items.map((issue: ForgeIssue): TreeRow => ({
      id: `issue:${issue.number}`,
      depth: 1,
      expandable: false,
      expanded: false,
      data: {
        kind: 'issue',
        icon: Icon.INFO,
        label: `#${issue.number} ${issue.title}`,
        issue,
      },
    }));
  }

  /**
   * Opens an issue on the forge, in the user's browser.
   * @param issue The issue to open.
   */
  private openIssue(issue: ForgeIssue): void {
    if (issue.url.length === 0) {
      return;
    }
    this.log.info('forge', `Opening issue #${issue.number} in the browser`);
    void this.shell.openExternal(issue.url);
  }

  /**
   * Builds the action rows.
   * @returns Returns the rows.
   */
  private actionRows(): readonly TreeRow[] {
    const section: ForgeSection<ForgeWorkflowRun> = this.forge.workflowRuns();
    if (section.state !== 'ready' && section.items.length === 0) {
      return [
        this.emptyRow('actions', Icon.PLAY, section.message ?? PENDING_MESSAGES[section.state]),
      ];
    }
    if (section.items.length === 0) {
      return [this.emptyRow('actions', Icon.PLAY, 'No recent workflow runs')];
    }
    return section.items.map((run: ForgeWorkflowRun): TreeRow => ({
      id: `action:${run.id}`,
      depth: 1,
      expandable: false,
      expanded: false,
      data: {
        kind: 'action',
        icon: Icon.PLAY,
        // The branch is what tells two runs of the same workflow apart, which is the common case.
        label:
          run.branch !== null && run.branch.length > 0 ? `${run.name} — ${run.branch}` : run.name,
        run,
        status: run.status,
      },
    }));
  }

  /**
   * Names where an item opens in the browser: the provider serving the repository, such as GitHub.
   * @returns Returns the menu label.
   */
  private openOnLabel(): string {
    const provider: string | undefined = this.forge.repositoryRef()?.provider;
    return provider === undefined ? 'Open in Browser' : `Open on ${provider}`;
  }

  /**
   * Opens a workflow run on the forge, in the user's browser.
   * @param run The run to open.
   */
  private openRun(run: ForgeWorkflowRun): void {
    if (run.url.length === 0) {
      return;
    }
    this.log.info('forge', `Opening workflow run ${run.id} in the browser`);
    void this.shell.openExternal(run.url);
  }

  /**
   * Holds the run awaiting the user's re-run confirmation, or null when none is. Re-running spends
   * CI minutes and can redeploy, so it is never done from a bare menu click.
   */
  protected readonly pendingRerun: WritableSignal<ForgeWorkflowRun | null> =
    signal<ForgeWorkflowRun | null>(null);

  /**
   * Holds the run awaiting the user's cancel confirmation, or null when none is.
   */
  protected readonly pendingCancel: WritableSignal<ForgeWorkflowRun | null> =
    signal<ForgeWorkflowRun | null>(null);

  /**
   * Confirms the re-run.
   */
  protected confirmRerun(): void {
    const run: ForgeWorkflowRun | null = this.pendingRerun();
    this.pendingRerun.set(null);
    if (run !== null) {
      this.log.info('forge', `Re-running workflow run ${run.id}`);
      void this.forge.rerun(run);
    }
  }

  /**
   * Dismisses the re-run confirmation.
   */
  protected cancelRerun(): void {
    this.pendingRerun.set(null);
  }

  /**
   * Confirms the cancellation.
   */
  protected confirmCancelRun(): void {
    const run: ForgeWorkflowRun | null = this.pendingCancel();
    this.pendingCancel.set(null);
    if (run !== null) {
      this.log.info('forge', `Cancelling workflow run ${run.id}`);
      void this.forge.cancel(run);
    }
  }

  /**
   * Dismisses the cancellation confirmation.
   */
  protected dismissCancelRun(): void {
    this.pendingCancel.set(null);
  }

  /**
   * Builds a muted placeholder row for an empty section.
   * @param key The section key, for a stable id.
   * @param icon The icon to show.
   * @param label The placeholder text.
   * @param depth The row's depth: a section's child by default, deeper beneath a worktree.
   * @returns Returns the row.
   */
  private emptyRow(key: string, icon: Icon, label: string, depth: number = 1): TreeRow {
    return {
      id: `empty:${key}`,
      depth,
      expandable: false,
      expanded: false,
      data: { kind: 'empty', icon, label, muted: true },
    };
  }
}

/**
 * Resolves the address a remote can be opened at in a browser, or null when it has none.
 *
 * Most remotes are SSH, which no browser can open, so the two common SSH spellings are rewritten to
 * `https` on the same host: `git@host:owner/repo.git` and `ssh://git@host/owner/repo.git` both become
 * `https://host/owner/repo`. That holds for every forge Studio talks to, where the SSH and web paths
 * agree. It does not hold for a bare path or a `file://` remote, which have no web address at all and
 * yield null rather than a guess.
 *
 * The trailing `.git` is dropped because it is a fetch-path convention rather than part of the page's
 * address; forges redirect it, but showing the user the address they would have typed is better than
 * relying on that.
 *
 * @param url The remote's URL as git has it configured.
 * @returns Returns the browsable address, or null when the remote has none.
 */
export function browsableRemoteUrl(url: string): string | null {
  const trimmed: string = url.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const withoutSuffix: (value: string) => string = (value: string): string =>
    value.endsWith('.git') ? value.slice(0, -'.git'.length) : value;
  // Anything carrying a scheme is decided by it, and by nothing else. Reaching the scp-like branch
  // below with a `file://` remote would read `file` as a host and produce an address to nowhere.
  const scheme: RegExpMatchArray | null = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/i.exec(trimmed);
  if (scheme !== null) {
    const protocol: string = scheme[1].toLowerCase();
    if (protocol === 'https' || protocol === 'http') {
      return withoutSuffix(trimmed);
    }
    if (protocol === 'ssh' || protocol === 'git') {
      // The scheme is swapped and any credential before the host dropped, having no use in a browser.
      return `https://${withoutSuffix(scheme[2].replace(/^[^@/]+@/, ''))}`;
    }
    return null;
  }
  // The scp-like form, `git@host:owner/repo.git`. The colon separates host from path rather than
  // naming a port, which is what makes this its own case rather than a URL.
  const scp: RegExpMatchArray | null = /^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/.exec(trimmed);
  if (scp !== null) {
    return `https://${scp[1]}/${withoutSuffix(scp[2])}`;
  }
  return null;
}
