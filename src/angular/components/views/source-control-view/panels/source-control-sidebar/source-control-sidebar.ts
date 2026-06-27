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
import { Icon } from '../../../../../icons/icon';
import { DockPanel } from '../../../../../services/dock/dock-panel';
import { Repository, WORKING_NODE_ID } from '../../../../../services/repository/repository';
import {
  GitBranch,
  GitRemote,
  GitStash,
  GitTag,
} from '../../../../../services/repository/repository-data';
import { AppIcon } from '../../../../shared/icon/app-icon';
import { TreeRow, TreeView } from '../../../../shared/tree-view/tree-view';

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
 * Renders the source-control view's left rail: a pinned uncommitted-changes entry followed by the
 * repository tree — collapsible sections for local branches, remotes, tags, and stashes, then
 * placeholder sections for pull requests, issues, and CI/CD actions. The tree is presented through the
 * shared {@link TreeView}: this component flattens the repository model into rows and projects each
 * row's content. Selecting the working entry or a branch drives the repository's selection and
 * checkout; the forge sections are stubbed with sample data until they are wired to a provider.
 */
@Component({
  selector: 'app-source-control-sidebar',
  imports: [AppIcon, TreeView],
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
   * Gets the flattened repository tree: each expanded section's header followed by its children.
   */
  protected readonly rows: Signal<readonly TreeRow[]> = computed((): readonly TreeRow[] => {
    const expanded: ReadonlySet<string> = this.expandedSections();
    const out: TreeRow[] = [];
    for (const section of this.sections) {
      const open: boolean = expanded.has(section.key);
      out.push({
        id: `section:${section.key}`,
        depth: 0,
        expandable: true,
        expanded: open,
        data: { kind: 'section', icon: section.icon, label: section.label, sectionKey: section.key },
      });
      if (open) {
        out.push(...section.children());
      }
    }
    return out;
  });

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
   * Selects the working-tree node, so the detail and diff panes show the uncommitted changes.
   */
  protected selectWorking(): void {
    this.repository.selectNode(this.workingNodeId);
  }

  /**
   * Checks out a branch.
   * @param branch The branch to check out.
   */
  protected checkout(branch: GitBranch): void {
    void this.repository.checkout(branch.name);
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
        data: { kind: 'stash', icon: Icon.STASH, label: stash.message },
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
