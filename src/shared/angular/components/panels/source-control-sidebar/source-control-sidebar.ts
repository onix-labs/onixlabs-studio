import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  Signal,
  signal,
  WritableSignal,
} from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { Repository, WORKING_NODE_ID } from '@shared/angular/services/repository/repository';
import {
  GitBranch,
  GitRemote,
  GitStash,
  GitTag,
} from '@shared/angular/services/repository/repository-data';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Button } from '@shared/angular/components/forms/button/button';
import { Checkbox } from '@shared/angular/components/forms/checkbox/checkbox';
import { Modal } from '@shared/angular/components/modal/modal';
import { ModalContent } from '@shared/angular/components/modal/modal-content';
import { PanelToolbar } from '@shared/angular/components/panel-toolbar/panel-toolbar';
import { TreeRow, TreeView } from '@shared/angular/components/tree-view/tree-view';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { Log } from '@shared/angular/services/log/log';

/**
 * Identifies the outcome of a build/check on a pull request or a CI/CD action: in progress, passed, or
 * failed. Drives the status badge shown beside the entry.
 */
export type CheckStatus = 'running' | 'succeeded' | 'failed';

/**
 * A placeholder pull request shown in the (not-yet-wired) Pull Requests section.
 */
interface StubPullRequest {
  /**
   * Gets the pull request number.
   */
  readonly number: number;

  /**
   * Gets the pull request title.
   */
  readonly title: string;

  /**
   * Gets the status of the pull request's checks.
   */
  readonly status: CheckStatus;
}

/**
 * A placeholder issue shown in the (not-yet-wired) Issues section.
 */
interface StubIssue {
  /**
   * Gets the issue number.
   */
  readonly number: number;

  /**
   * Gets the issue title.
   */
  readonly title: string;
}

/**
 * A placeholder CI/CD action shown in the (not-yet-wired) Actions section.
 */
interface StubAction {
  /**
   * Gets the action's name.
   */
  readonly name: string;

  /**
   * Gets whether the action is currently running or merely available to run.
   */
  readonly status: 'available' | 'running';
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
   * Gets the branch, for a local-branch row (drives the ahead/behind deltas and checkout action).
   */
  readonly branch?: GitBranch;

  /**
   * Gets the stash, for a stash row (drives the apply, pop, and drop actions).
   */
  readonly stash?: GitStash;

  /**
   * Gets the commit a row navigates to when selected (a branch tip or a tag's commit).
   */
  readonly commit?: string;

  /**
   * Gets the check/run status badge to show, for a pull-request or action row.
   */
  readonly status?: CheckStatus | StubAction['status'];

  /**
   * Gets a value indicating whether the row is a muted placeholder (an empty-section message).
   */
  readonly muted?: boolean;
}

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
  imports: [TextField, Button, AppIcon, Checkbox, Modal, ModalContent, PanelToolbar, TreeView],
  templateUrl: './source-control-sidebar.html',
  styleUrl: './source-control-sidebar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SourceControlSidebar {
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
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds the keys of the currently expanded sections. Only the local branches start open; the rest
   * are collapsed until the user opens them.
   */
  private readonly expandedSections: WritableSignal<ReadonlySet<string>> = signal<
    ReadonlySet<string>
  >(new Set<string>(['local']));

  /**
   * Holds the placeholder pull requests shown until the Pull Requests section is wired to a provider.
   */
  protected readonly pullRequests: readonly StubPullRequest[] = [
    { number: 142, title: 'feat(git): network ops', status: 'succeeded' },
    { number: 145, title: 'feat(git): docked terminal', status: 'running' },
    { number: 139, title: 'fix(git): status parsing', status: 'failed' },
  ];

  /**
   * Holds the placeholder issues shown until the Issues section is wired to a provider.
   */
  protected readonly issues: readonly StubIssue[] = [
    { number: 96, title: 'Source-control provider abstraction' },
    { number: 99, title: 'Workspace git decorations' },
  ];

  /**
   * Holds the placeholder actions shown until the Actions section is wired to a provider.
   */
  protected readonly actions: readonly StubAction[] = [
    { name: 'CI / build', status: 'running' },
    { name: 'CI / test', status: 'available' },
    { name: 'Release', status: 'available' },
  ];

  /**
   * Describes the rail's sections in display order, each with a builder for its child rows.
   */
  private readonly sections: readonly SectionDef[] = [
    { key: 'local', label: 'Local', icon: Icon.SOURCE_CONTROL, children: () => this.localRows() },
    { key: 'remote', label: 'Remote', icon: Icon.CLOUD, children: () => this.remoteRows() },
    { key: 'tags', label: 'Tags', icon: Icon.TAG, children: () => this.tagRows() },
    { key: 'stashes', label: 'Stashes', icon: Icon.STASH, children: () => this.stashRows() },
    {
      key: 'pullRequests',
      label: 'Pull Requests',
      icon: Icon.GIT_PULL_REQUEST,
      children: () => this.pullRequestRows(),
    },
    { key: 'issues', label: 'Issues', icon: Icon.INFO, children: () => this.issueRows() },
    { key: 'actions', label: 'Actions', icon: Icon.PLAY, children: () => this.actionRows() },
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
        },
      });
      out.push(...matched);
    }
    return out;
  });

  /**
   * Determines whether a row survives the filter. Placeholder rows never match: an empty section's
   * "No tags" message is chrome, not a result.
   * @param row The row to test.
   * @param needle The lower-cased filter text.
   * @returns Returns true when the row matches.
   */
  private matches(row: TreeRow, needle: string): boolean {
    const node: RepoNode = this.nodeOf(row);
    return node.kind !== 'empty' && node.label.toLowerCase().includes(needle);
  }

  /**
   * Records the filter text as it is typed.
   * @param event The input event carrying the text.
   */
  protected onFilterValue(value: string): void {
    this.filter.set(value);
  }

  /**
   * Clears the filter, restoring the sections' own collapsed state.
   */
  protected clearFilter(): void {
    this.filter.set('');
  }

  /**
   * Collapses every section. Disabled while filtering, when the collapsed state is not in force.
   */
  protected collapseAll(): void {
    this.expandedSections.set(new Set<string>());
  }

  /**
   * Re-reads the repository state.
   */
  protected refresh(): void {
    this.log.info('SourceControlSidebar', 'Refreshing repository');
    void this.repository.refresh();
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
      case 'branch':
      case 'tag':
        if (node.commit !== undefined) {
          this.repository.selectNode(node.commit);
        }
        break;
      default:
        break;
    }
  }

  /**
   * Resolves the badge icon for a pull-request check or action run status.
   * @param status The status.
   * @returns Returns the icon.
   */
  protected statusIcon(status: CheckStatus | StubAction['status']): Icon {
    switch (status) {
      case 'succeeded':
        return Icon.SUCCESS;
      case 'failed':
        return Icon.ERROR;
      case 'running':
        return Icon.SPINNER;
      default:
        return Icon.PLAY;
    }
  }

  /**
   * Checks out a branch.
   * @param branch The branch to check out.
   */
  protected checkout(branch: GitBranch): void {
    this.log.info('SourceControlSidebar', `Checking out branch '${branch.name}'`);
    void this.repository.checkout(branch.name);
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
  protected applyStash(stash: GitStash): void {
    void this.repository.applyStash(stash.index);
  }

  /**
   * Restores a stash onto the working tree and drops it from the stack.
   * @param stash The stash to pop.
   */
  protected popStash(stash: GitStash): void {
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
  protected requestDropStash(stash: GitStash): void {
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
    return this.repository.branches().some((branch: GitBranch): boolean => branch.name === name)
      ? 'A branch with this name already exists.'
      : null;
  });

  /**
   * Gets a value indicating whether the new-branch dialog can be submitted.
   */
  protected readonly canCreateBranch: Signal<boolean> = computed(
    (): boolean => this.branchName().trim().length > 0 && this.branchNameError() === null,
  );

  /**
   * Opens the new-branch dialog.
   */
  protected openBranchDialog(): void {
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
    this.log.info('SourceControlSidebar', `Creating branch '${name}'`, `checkout=${this.branchCheckout()}`);
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
   * Toggles a section between expanded and collapsed.
   * @param key The section key.
   */
  private toggleSection(key: string): void {
    const next: Set<string> = new Set<string>(this.expandedSections());
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    this.expandedSections.set(next);
  }

  /**
   * Builds the local-branch rows.
   * @returns Returns the rows.
   */
  private localRows(): readonly TreeRow[] {
    const branches: readonly GitBranch[] = this.repository.branches();
    if (branches.length === 0) {
      return [this.emptyRow('local', Icon.SOURCE_CONTROL, 'No local branches')];
    }
    return branches.map(
      (branch: GitBranch): TreeRow => ({
        id: `branch:${branch.name}`,
        depth: 1,
        expandable: false,
        expanded: false,
        data: {
          kind: 'branch',
          icon: Icon.SOURCE_CONTROL,
          label: branch.name,
          branch,
          commit: branch.tip,
        },
      }),
    );
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
        data: { kind: 'remote', icon: Icon.CLOUD, label: remote.name },
      });
      for (const branch of remote.branches) {
        out.push({
          id: `remote:${remote.name}/${branch}`,
          depth: 2,
          expandable: false,
          expanded: false,
          data: { kind: 'remote-branch', icon: Icon.SOURCE_CONTROL, label: branch },
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
    return tags.map(
      (tag: GitTag): TreeRow => ({
        id: `tag:${tag.name}`,
        depth: 1,
        expandable: false,
        expanded: false,
        data: { kind: 'tag', icon: Icon.TAG, label: tag.name, commit: tag.commit },
      }),
    );
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
    return stashes.map(
      (stash: GitStash): TreeRow => ({
        id: `stash:${stash.index}`,
        depth: 1,
        expandable: false,
        expanded: false,
        data: { kind: 'stash', icon: Icon.STASH, label: stash.message, stash },
      }),
    );
  }

  /**
   * Builds the pull-request rows.
   * @returns Returns the rows.
   */
  private pullRequestRows(): readonly TreeRow[] {
    if (this.pullRequests.length === 0) {
      return [this.emptyRow('pullRequests', Icon.GIT_PULL_REQUEST, 'No open pull requests')];
    }
    return this.pullRequests.map(
      (pr: StubPullRequest): TreeRow => ({
        id: `pr:${pr.number}`,
        depth: 1,
        expandable: false,
        expanded: false,
        data: {
          kind: 'pr',
          icon: Icon.GIT_PULL_REQUEST,
          label: `#${pr.number} ${pr.title}`,
          status: pr.status,
        },
      }),
    );
  }

  /**
   * Builds the issue rows.
   * @returns Returns the rows.
   */
  private issueRows(): readonly TreeRow[] {
    if (this.issues.length === 0) {
      return [this.emptyRow('issues', Icon.INFO, 'No issues')];
    }
    return this.issues.map(
      (issue: StubIssue): TreeRow => ({
        id: `issue:${issue.number}`,
        depth: 1,
        expandable: false,
        expanded: false,
        data: { kind: 'issue', icon: Icon.INFO, label: `#${issue.number} ${issue.title}` },
      }),
    );
  }

  /**
   * Builds the action rows.
   * @returns Returns the rows.
   */
  private actionRows(): readonly TreeRow[] {
    if (this.actions.length === 0) {
      return [this.emptyRow('actions', Icon.PLAY, 'No actions')];
    }
    return this.actions.map(
      (action: StubAction): TreeRow => ({
        id: `action:${action.name}`,
        depth: 1,
        expandable: false,
        expanded: false,
        data: { kind: 'action', icon: Icon.PLAY, label: action.name, status: action.status },
      }),
    );
  }

  /**
   * Builds a muted placeholder row for an empty section.
   * @param key The section key, for a stable id.
   * @param icon The icon to show.
   * @param label The placeholder text.
   * @returns Returns the row.
   */
  private emptyRow(key: string, icon: Icon, label: string): TreeRow {
    return {
      id: `empty:${key}`,
      depth: 1,
      expandable: false,
      expanded: false,
      data: { kind: 'empty', icon, label, muted: true },
    };
  }
}
