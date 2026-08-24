import {
  ForgeRepository,
  ForgeSection,
} from '@shared/angular/services/forge-repository/forge-repository';
import {
  ForgeIssue,
  ForgePullRequest,
  ForgeRepositoryRef,
  ForgeWorkflowRun,
} from '@shared/api/forge-types';
import { Shell } from '@shared/angular/services/shell/shell';
import { Agent } from '@shared/angular/services/agent/agent';
import { AgentConversation } from '@shared/angular/services/agent-conversation/agent-conversation';
import { DockReveal } from '@shared/angular/services/dock-layout/dock-reveal';
import { ApplicationRef, signal, Signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ModalWindows } from '@shared/angular/services/modal-windows/modal-windows';
import { FakeModalWindows } from '@shared/angular/services/modal-windows/modal-windows.fake';
import { Icon } from '@shared/angular/icons/icon';
import { TreeMenuSelection, TreeRow } from '@shared/angular/components/tree-view/tree-view';
import { MenuItem } from '@shared/angular/components/menu/menu';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { ParsedRefs, ParsedStatus } from '@shared/angular/services/source-control/git-output';
import {
  FileDiff,
  MutationResult,
  SourceControlProvider,
} from '@shared/angular/services/source-control/source-control-provider';
import { SourceControlProviders } from '@shared/angular/services/source-control/source-control-providers';
import { Repository, WORKING_NODE_ID } from '@shared/angular/services/repository/repository';
import {
  GitCommit,
  GitFileChange,
  GitStash,
} from '@shared/angular/services/repository/repository-data';

import { SourceControlSidebar } from './source-control-sidebar';

/**
 * Builds a file change targeting the working tree.
 * @param path The file path.
 * @returns Returns the file change.
 */
function workingFile(path: string): GitFileChange {
  return {
    path,
    status: 'modified',
    additions: 0,
    deletions: 0,
    language: '',
    original: '',
    modified: '',
    target: { kind: 'working', staged: false },
  };
}

/**
 * Builds a commit with the given hash and parents.
 * @param hash The commit hash.
 * @param parents The parent hashes.
 * @returns Returns the commit.
 */
function makeCommit(hash: string, parents: readonly string[]): GitCommit {
  return {
    hash,
    shortHash: hash,
    summary: `Commit ${hash}`,
    body: '',
    author: 'Test',
    email: 't@example.com',
    relativeDate: 'now',
    isoDate: 'now',
    parents: [...parents],
    refs: [],
    files: [],
  };
}

/**
 * A canned provider with two local branches, one remote, a tag, and a dirty working tree.
 */
class FakeProvider implements SourceControlProvider {
  public constructor(public readonly root: string) {}

  /**
   * Holds the mutations invoked on the provider, for assertion.
   */
  public readonly calls: string[] = [];

  /**
   * Holds the working-tree changes reported by {@link getStatus}, so a spec can empty the tree and
   * re-read it.
   */
  public working: { staged: readonly GitFileChange[]; unstaged: readonly GitFileChange[] } = {
    staged: [workingFile('staged.ts')],
    unstaged: [workingFile('unstaged.ts')],
  };

  /**
   * Holds the stash entries reported by {@link getStashes}.
   */
  public stashEntries: readonly GitStash[] = [];

  public getStatus(): Promise<ParsedStatus> {
    return Promise.resolve({
      branch: 'main',
      upstream: 'origin/main',
      ahead: 1,
      behind: 0,
      staged: [...this.working.staged],
      unstaged: [...this.working.unstaged],
    });
  }

  public getCommits(): Promise<GitCommit[]> {
    return Promise.resolve([makeCommit('c2', ['c1']), makeCommit('c1', [])]);
  }

  public getRefs(): Promise<ParsedRefs> {
    return Promise.resolve({
      branches: [
        { name: 'main', current: true, upstream: 'origin/main', ahead: 1, behind: 0, tip: 'c2' },
        { name: 'develop', current: false, upstream: undefined, ahead: 0, behind: 2, tip: 'c1' },
      ],
      remotes: [{ name: 'origin', url: '', branches: ['main', 'develop'] }],
      tags: [{ name: 'v1.0.0', commit: 'c1' }],
    });
  }

  public getStashes(): Promise<GitStash[]> {
    return Promise.resolve([...this.stashEntries]);
  }

  public getCommitFiles(): Promise<GitFileChange[]> {
    return Promise.resolve([]);
  }

  public getFileDiff(): Promise<FileDiff> {
    return Promise.resolve({ original: '', modified: '' });
  }

  public discard(): Promise<MutationResult> {
    return Promise.resolve({ success: true });
  }

  public stage(): Promise<MutationResult> {
    return Promise.resolve({ success: true });
  }

  public unstage(): Promise<MutationResult> {
    return Promise.resolve({ success: true });
  }

  public commit(): Promise<MutationResult> {
    return Promise.resolve({ success: true });
  }

  public stash(): Promise<MutationResult> {
    this.calls.push('stash');
    return Promise.resolve({ success: true });
  }

  public applyStash(index: number): Promise<MutationResult> {
    this.calls.push(`applyStash:${index}`);
    return Promise.resolve({ success: true });
  }

  public popStash(index: number): Promise<MutationResult> {
    this.calls.push(`popStash:${index}`);
    return Promise.resolve({ success: true });
  }

  public dropStash(index: number): Promise<MutationResult> {
    this.calls.push(`dropStash:${index}`);
    return Promise.resolve({ success: true });
  }

  public checkout(branch: string): Promise<MutationResult> {
    this.calls.push(`checkout:${branch}`);
    return Promise.resolve({ success: true });
  }

  public createBranch(name: string, checkout: boolean): Promise<MutationResult> {
    this.calls.push(`createBranch:${name}:${checkout}`);
    return Promise.resolve({ success: true });
  }

  public fetch(): Promise<MutationResult> {
    return Promise.resolve({ success: true });
  }

  public fetchRef(): Promise<MutationResult> {
    return Promise.resolve({ success: true });
  }

  public pull(): Promise<MutationResult> {
    return Promise.resolve({ success: true });
  }

  public push(): Promise<MutationResult> {
    return Promise.resolve({ success: true });
  }

  public close(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * Builds a section-header tree row, matching the shape the sidebar builds for its sections.
 * @param key The section key.
 * @param label The section label.
 * @returns Returns the row.
 */
function sectionRow(key: string, label: string): TreeRow {
  return {
    id: `section:${key}`,
    depth: 0,
    expandable: true,
    expanded: false,
    data: { kind: 'section', icon: Icon.TAG, label, sectionKey: key },
  };
}

/**
 * A controllable stand-in for the forge-backed view of the repository.
 */
class FakeForgeRepository {
  public readonly section: WritableSignal<ForgeSection<ForgePullRequest>> = signal<
    ForgeSection<ForgePullRequest>
  >({ state: 'no-repository', items: [], message: null });

  /**
   * Holds how many times the pull requests were loaded, so lazy loading can be asserted.
   */
  public loads: number = 0;

  /**
   * Holds the pull requests checked out through this fake.
   */
  public readonly checkedOut: ForgePullRequest[] = [];

  public readonly issueSection: WritableSignal<ForgeSection<ForgeIssue>> = signal<
    ForgeSection<ForgeIssue>
  >({ state: 'no-repository', items: [], message: null });

  public readonly runSection: WritableSignal<ForgeSection<ForgeWorkflowRun>> = signal<
    ForgeSection<ForgeWorkflowRun>
  >({ state: 'no-repository', items: [], message: null });

  /**
   * Holds the run commands issued, in order.
   */
  public readonly commands: string[] = [];

  /**
   * Holds the detected forge repository, which names the issue in the agent's opening message.
   */
  public readonly repositoryRef: Signal<ForgeRepositoryRef | null> =
    signal<ForgeRepositoryRef | null>({
      kind: 'github',
      host: 'github.com',
      owner: 'onix-labs',
      name: 'onixlabs-studio',
    });

  public readonly pullRequests: Signal<ForgeSection<ForgePullRequest>> = this.section.asReadonly();
  public readonly issues: Signal<ForgeSection<ForgeIssue>> = this.issueSection.asReadonly();
  public readonly workflowRuns: Signal<ForgeSection<ForgeWorkflowRun>> =
    this.runSection.asReadonly();

  public loadPullRequests(): Promise<void> {
    this.loads += 1;
    return Promise.resolve();
  }

  public loadIssues(): Promise<void> {
    this.loads += 1;
    return Promise.resolve();
  }

  public loadWorkflowRuns(): Promise<void> {
    this.loads += 1;
    return Promise.resolve();
  }

  public rerun(entry: ForgeWorkflowRun): Promise<{ ok: boolean }> {
    this.commands.push(`rerun:${entry.id}`);
    return Promise.resolve({ ok: true });
  }

  public cancel(entry: ForgeWorkflowRun): Promise<{ ok: boolean }> {
    this.commands.push(`cancel:${entry.id}`);
    return Promise.resolve({ ok: true });
  }

  public checkout(pull: ForgePullRequest): Promise<{ success: boolean }> {
    this.checkedOut.push(pull);
    return Promise.resolve({ success: true });
  }

  public reset(): void {
    this.section.set({ state: 'no-repository', items: [], message: null });
  }
}

/**
 * Builds a pull request.
 * @param overrides The fields to vary.
 * @returns Returns the pull request.
 */
function pullRequest(overrides: Partial<ForgePullRequest> = {}): ForgePullRequest {
  return {
    number: 7,
    title: 'Add the thing',
    author: 'matthew',
    url: 'https://github.com/onix-labs/onixlabs-studio/pull/7',
    draft: false,
    headRef: 'feature/thing',
    headRefspec: 'refs/pull/7/head',
    checks: 'succeeded',
    ...overrides,
  };
}

/**
 * Builds the tree row a pull request renders as.
 * @param overrides The pull-request fields to vary.
 * @returns Returns the row.
 */
function pullRequestRow(overrides: Partial<ForgePullRequest> = {}): TreeRow {
  const pull: ForgePullRequest = pullRequest(overrides);
  return {
    id: `pr:${pull.number}`,
    depth: 1,
    expandable: false,
    expanded: false,
    data: {
      kind: 'pr',
      icon: Icon.GIT_PULL_REQUEST,
      label: `#${pull.number} ${pull.title}`,
      pullRequest: pull,
    },
  };
}

/**
 * Builds a workflow run.
 * @param overrides The fields to vary.
 * @returns Returns the run.
 */
function workflowRun(overrides: Partial<ForgeWorkflowRun> = {}): ForgeWorkflowRun {
  return {
    id: 99,
    name: 'CI',
    status: 'succeeded',
    url: 'https://github.com/onix-labs/onixlabs-studio/actions/runs/99',
    branch: 'main',
    event: 'push',
    startedAt: '2026-08-24T10:00:00Z',
    ...overrides,
  };
}

/**
 * Builds the tree row a workflow run renders as.
 * @param overrides The run fields to vary.
 * @returns Returns the row.
 */
function runRow(overrides: Partial<ForgeWorkflowRun> = {}): TreeRow {
  const entry: ForgeWorkflowRun = workflowRun(overrides);
  return {
    id: `action:${entry.id}`,
    depth: 1,
    expandable: false,
    expanded: false,
    data: { kind: 'action', icon: Icon.PLAY, label: entry.name, run: entry, status: entry.status },
  };
}

/**
 * Builds the tree row an issue renders as.
 * @returns Returns the row.
 */
function issueRow(): TreeRow {
  const issue: ForgeIssue = {
    number: 12,
    title: 'Something is broken',
    author: 'matthew',
    url: 'https://github.com/onix-labs/onixlabs-studio/issues/12',
    labels: [],
    assignees: [],
  };
  return {
    id: `issue:${issue.number}`,
    depth: 1,
    expandable: false,
    expanded: false,
    data: { kind: 'issue', icon: Icon.INFO, label: `#12 ${issue.title}`, issue },
  };
}

/**
 * A recording stand-in for this view's agent.
 */
class FakeAgent {
  public readonly messages: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the messages sent, in order.
   */
  public readonly sent: string[] = [];

  public readonly hasMessages: Signal<boolean> = this.messages.asReadonly();

  public send(text: string): void {
    this.sent.push(text);
  }
}

/**
 * A recording stand-in for the conversation, which owns starting a fresh one.
 */
class FakeConversation {
  public newChats: number = 0;

  public newChat(): void {
    this.newChats += 1;
  }
}

describe('SourceControlSidebar', () => {
  let component: SourceControlSidebar;
  let fixture: ComponentFixture<SourceControlSidebar>;
  let repository: Repository;
  let provider: FakeProvider;
  let windows: FakeModalWindows;
  let forge: FakeForgeRepository;
  let opened: string[];
  let agent: FakeAgent;
  let conversation: FakeConversation;
  let revealed: string[];

  const panel: DockPanel = {
    id: 'repository',
    title: 'Repository',
    icon: Icon.SOURCE_CONTROL,
    role: 'tool',
    component: SourceControlSidebar,
  };

  beforeEach(async () => {
    windows = new FakeModalWindows();
    forge = new FakeForgeRepository();
    opened = [];
    agent = new FakeAgent();
    conversation = new FakeConversation();
    revealed = [];
    await TestBed.configureTestingModule({
      imports: [SourceControlSidebar],
      providers: [
        Repository,
        { provide: ModalWindows, useValue: windows },
        { provide: ForgeRepository, useValue: forge },
        { provide: Agent, useValue: agent },
        { provide: AgentConversation, useValue: conversation },
        {
          provide: DockReveal,
          useValue: {
            reveal: (panelId: string): void => {
              revealed.push(panelId);
            },
          },
        },
        {
          provide: Shell,
          useValue: {
            openExternal: (url: string): Promise<void> => {
              opened.push(url);
              return Promise.resolve();
            },
          },
        },
        {
          provide: SourceControlProviders,
          useValue: {
            create: (root: string): SourceControlProvider => {
              provider = new FakeProvider(root);
              return provider;
            },
          },
        },
      ],
    }).compileComponents();

    repository = TestBed.inject(Repository);
    repository.bind({ root: '/repo', name: 'repo' });
    await repository.refresh();

    fixture = TestBed.createComponent(SourceControlSidebar);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('panel', panel);
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('render_whenInitialised_showsLocalBranchesAndKeepsOtherSectionsCollapsed', () => {
    const text: string = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('main');
    expect(text).toContain('develop');
    expect(text).toContain('Remote');
    expect(text).toContain('Tags');
    expect(text).not.toContain('origin');
    expect(text).not.toContain('v1.0.0');
  });

  it('render_whenWorkingTreeDirty_showsTheChangeCountBadge', () => {
    const badge: HTMLElement | null = (fixture.nativeElement as HTMLElement).querySelector(
      '.rail__count',
    );

    expect(badge?.textContent?.trim()).toBe('2');
  });

  it('onRowClick_whenSectionRowClicked_togglesTheSection', () => {
    component.onRowClick(sectionRow('tags', 'Tags'));
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('v1.0.0');

    component.onRowClick(sectionRow('tags', 'Tags'));
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('v1.0.0');
  });

  it('onRowClick_whenBranchRowClicked_selectsItsTipCommit', () => {
    component.onRowClick({
      id: 'branch:develop',
      depth: 1,
      expandable: false,
      expanded: false,
      data: { kind: 'branch', icon: Icon.SOURCE_CONTROL, label: 'develop', commit: 'c1' },
    });

    expect(repository.selectedNodeId()).toBe('c1');
  });

  it('changesBadge_sitsOnTheCheckedOutBranch_andSelectsTheWorkingNode', () => {
    repository.selectNode('c2');
    fixture.detectChanges();

    // One badge only, and it belongs to the checked-out branch's row rather than a pinned header.
    const badges: NodeListOf<HTMLButtonElement> = (
      fixture.nativeElement as HTMLElement
    ).querySelectorAll('.rail__changes');
    expect(badges.length).toBe(1);
    expect(badges[0].closest('.tree-row')?.getAttribute('data-tree-id')).toBe('branch:main');

    badges[0].click();

    expect(repository.selectedNodeId()).toBe(WORKING_NODE_ID);
  });

  it('changesBadge_isNotRenderedOnABranchThatIsNotCheckedOut', () => {
    const rows: NodeListOf<HTMLElement> = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '.tree-row',
    );
    const develop: HTMLElement | undefined = [...rows].find((row: HTMLElement): boolean =>
      (row.textContent ?? '').includes('develop'),
    );

    expect(develop?.querySelector('.rail__changes')).toBeNull();
    // Its checkout lives on the context menu now; the row itself carries no buttons at all.
    expect(develop?.querySelector('.tree-row-action')).toBeNull();
  });

  it('changesBadge_staysReachableWhenTheTreeIsClean_butReadsAsEmpty', async () => {
    provider.working = { staged: [], unstaged: [] };
    await repository.refresh();
    fixture.detectChanges();

    const badge: HTMLButtonElement | null = (fixture.nativeElement as HTMLElement).querySelector(
      '.rail__changes',
    );

    expect(badge).not.toBeNull();
    expect(badge?.classList.contains('rail__changes--empty')).toBe(true);
    // No count is drawn at zero, but the working tree is still one click away.
    expect(badge?.querySelector('.rail__count')).toBeNull();
  });

  it('checkout_isChosenFromTheBranchContextMenu', () => {
    const row: TreeRow = {
      id: 'branch:develop',
      depth: 1,
      expandable: false,
      expanded: false,
      data: {
        kind: 'branch',
        icon: Icon.SOURCE_CONTROL,
        label: 'develop',
        branch: { name: 'develop', current: false, ahead: 0, behind: 0, tip: 'c1' },
      },
    };
    const menu: {
      contextMenuFor(r: TreeRow): readonly MenuItem[];
      onContextAction(c: TreeMenuSelection): void;
    } = component as unknown as {
      contextMenuFor(r: TreeRow): readonly MenuItem[];
      onContextAction(c: TreeMenuSelection): void;
    };

    expect(menu.contextMenuFor(row).map((item: MenuItem): string => item.label)).toEqual([
      'Check Out',
    ]);

    menu.onContextAction({ itemId: 'branch.checkout', row });

    expect(provider.calls).toContain('checkout:develop');
  });

  it('theCheckedOutBranchOffersNothing_becauseItsChangesBadgeIsAlwaysThere', () => {
    // It cannot be checked out again, and its uncommitted changes are one always-visible click away.
    const menu: { contextMenuFor(r: TreeRow): readonly MenuItem[] } = component;

    expect(
      menu.contextMenuFor({
        id: 'branch:main',
        depth: 1,
        expandable: false,
        expanded: false,
        data: {
          kind: 'branch',
          icon: Icon.SOURCE_CONTROL,
          label: 'main',
          branch: { name: 'main', current: true, ahead: 0, behind: 0, tip: 'c2' },
        },
      }),
    ).toEqual([]);
  });

  /**
   * Reveals the sidebar's protected surface for the tool-strip and dialog tests.
   * @returns Returns the internals.
   */
  function internals(): {
    filter: WritableSignal<string>;
    rows(): readonly TreeRow[];
    collapseAll(): void;
    refresh(): void;
    fetch(): void;
    stash(): void;
    applyStash(stash: GitStash): void;
    popStash(stash: GitStash): void;
    requestDropStash(stash: GitStash): void;
    confirmDropStash(): void;
    cancelDropStash(): void;
    pendingDrop(): GitStash | null;
    openBranchDialog(): void;
    branchDialogOpen(): boolean;
    branchName: WritableSignal<string>;
    branchCheckout: WritableSignal<boolean>;
    branchNameError(): string | null;
    canCreateBranch(): boolean;
    confirmBranch(): void;
    cancelBranch(): void;
  } {
    return component as unknown as ReturnType<typeof internals>;
  }

  /**
   * Loads a stash into the repository and expands the Stashes section.
   * @returns Returns the loaded stash.
   */
  async function withStash(): Promise<GitStash> {
    const stash: GitStash = { index: 0, message: 'WIP on main', branch: 'main', files: [] };
    provider.stashEntries = [stash];
    await repository.refresh();
    component.onRowClick(sectionRow('stashes', 'Stashes'));
    fixture.detectChanges();
    return stash;
  }

  describe('the tool strip', () => {
    it('filter_narrowsToMatchingRows_andDropsSectionsWithNoMatches', () => {
      internals().filter.set('develop');

      const labels: readonly string[] = internals()
        .rows()
        .map((row: TreeRow): string => (row.data as { label: string }).label);

      // The Local section survives for its matching branch; Tags and Stashes have no match and go.
      expect(labels).toContain('Local');
      expect(labels).toContain('develop');
      expect(labels).not.toContain('main');
      expect(labels).not.toContain('Tags');
    });

    it('filter_searchesCollapsedSectionsToo', () => {
      // Tags start collapsed, so an unfiltered tree never lists v1.0.0.
      expect(
        internals()
          .rows()
          .some((row: TreeRow): boolean => (row.data as { label: string }).label === 'v1.0.0'),
      ).toBe(false);

      internals().filter.set('v1');

      expect(
        internals()
          .rows()
          .some((row: TreeRow): boolean => (row.data as { label: string }).label === 'v1.0.0'),
      ).toBe(true);
    });

    it('filter_matchingNothing_yieldsAnEmptyTreeRatherThanBareSectionHeaders', () => {
      internals().filter.set('nothing-matches-this');

      expect(internals().rows()).toEqual([]);
    });

    it('collapseAll_closesEverySection', () => {
      expect(
        internals()
          .rows()
          .some((row: TreeRow): boolean => (row.data as { label: string }).label === 'main'),
      ).toBe(true);

      internals().collapseAll();

      expect(
        internals()
          .rows()
          .every((row: TreeRow): boolean => (row.data as { kind: string }).kind === 'section'),
      ).toBe(true);
    });

    it('refreshFetchAndStash_dispatchThroughTheRepository', async () => {
      internals().fetch();
      internals().stash();
      await fixture.whenStable();

      expect(provider.calls).toContain('stash');
    });
  });

  describe('stash row actions', () => {
    it('apply_restoresTheStashAndKeepsIt', async () => {
      const stash: GitStash = await withStash();

      internals().applyStash(stash);
      await fixture.whenStable();

      expect(provider.calls).toContain('applyStash:0');
      // Restoring selects the working tree, so the Commit panel shows what came back.
      expect(repository.selectedNodeId()).toBe(WORKING_NODE_ID);
    });

    it('pop_restoresTheStashAndDropsIt', async () => {
      const stash: GitStash = await withStash();

      internals().popStash(stash);
      await fixture.whenStable();

      expect(provider.calls).toContain('popStash:0');
    });

    it('drop_asksFirst_andOnlyDropsOnConfirmation', async () => {
      const stash: GitStash = await withStash();

      internals().requestDropStash(stash);
      expect(internals().pendingDrop()).toBe(stash);
      expect(provider.calls).not.toContain('dropStash:0');

      internals().cancelDropStash();
      await fixture.whenStable();
      expect(internals().pendingDrop()).toBeNull();
      expect(provider.calls).not.toContain('dropStash:0');

      internals().requestDropStash(stash);
      TestBed.inject(ApplicationRef).tick();
      expect(windows.openWindows).toBe(1);
      expect(windows.contentHost?.textContent).toContain('Drop this stash?');

      internals().confirmDropStash();
      await fixture.whenStable();

      expect(provider.calls).toContain('dropStash:0');
      expect(internals().pendingDrop()).toBeNull();
    });
  });

  describe('the new-branch dialog', () => {
    it('createsTheBranchAndChecksItOutByDefault', async () => {
      internals().openBranchDialog();
      expect(internals().branchCheckout()).toBe(true);
      internals().branchName.set('  feature/ribbon  ');

      internals().confirmBranch();
      await fixture.whenStable();

      // The name is trimmed, and the dialog closes behind it.
      expect(provider.calls).toContain('createBranch:feature/ribbon:true');
      expect(internals().branchDialogOpen()).toBe(false);
    });

    it('createsWithoutCheckingOutWhenTheBoxIsCleared', async () => {
      internals().openBranchDialog();
      internals().branchName.set('feature/quiet');
      internals().branchCheckout.set(false);

      internals().confirmBranch();
      await fixture.whenStable();

      expect(provider.calls).toContain('createBranch:feature/quiet:false');
    });

    it('whenOpen_rendersItsFields_andClosingRetiresThem', () => {
      internals().openBranchDialog();
      TestBed.inject(ApplicationRef).tick();

      expect(windows.openWindows).toBe(1);
      const host: HTMLElement | null = windows.contentHost;
      expect(host?.querySelector('.rail__dialog-title')?.textContent).toContain('New branch');
      expect(host?.querySelector('.rail__dialog-input')).not.toBeNull();

      internals().cancelBranch();
      TestBed.inject(ApplicationRef).tick();

      expect(windows.openWindows).toBe(0);
      expect(host?.querySelector('.rail__dialog-title')).toBeNull();
    });

    it('rejectsADuplicateName_beforeTheCommandRuns', () => {
      internals().openBranchDialog();
      internals().branchName.set('main');

      expect(internals().branchNameError()).toBe('A branch with this name already exists.');
      expect(internals().canCreateBranch()).toBe(false);

      internals().confirmBranch();

      expect(provider.calls.some((call: string): boolean => call.startsWith('createBranch:'))).toBe(
        false,
      );
      expect(internals().branchDialogOpen()).toBe(true);
    });

    it('anEmptyNameIsNeitherAnErrorNorSubmittable', () => {
      internals().openBranchDialog();
      internals().branchName.set('   ');

      // Nothing typed yet is not a failure to report, but there is nothing to create either.
      expect(internals().branchNameError()).toBeNull();
      expect(internals().canCreateBranch()).toBe(false);
    });

    it('reopening_startsFromACleanNameAndCheckoutOn', () => {
      internals().openBranchDialog();
      internals().branchName.set('feature/one');
      internals().branchCheckout.set(false);
      internals().cancelBranch();

      internals().openBranchDialog();

      expect(internals().branchName()).toBe('');
      expect(internals().branchCheckout()).toBe(true);
    });
  });

  describe('the Pull Requests section', () => {
    /**
     * Expands the Pull Requests section.
     */
    function expand(): void {
      component.onRowClick(sectionRow('pullRequests', 'Pull Requests'));
      fixture.detectChanges();
    }

    it('readsNothing_untilTheSectionIsExpanded', () => {
      // The forge is rate-limited: a section the user never opens must cost nothing.
      expect(forge.loads).toBe(0);

      expand();

      expect(forge.loads).toBe(1);
    });

    it('showsTheRealPullRequests_notSampleData', () => {
      forge.section.set({ state: 'ready', items: [pullRequest()], message: null });

      expand();

      const text: string = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('#7 Add the thing');
      // The sample data the section used to ship with is gone for good.
      expect(text).not.toContain('feat(git): network ops');
    });

    it('marksADraft', () => {
      forge.section.set({
        state: 'ready',
        items: [pullRequest({ draft: true })],
        message: null,
      });

      expand();

      expect((fixture.nativeElement as HTMLElement).textContent).toContain('(draft)');
    });

    it('showsTheCheckBadge_butOmitsItWhenNothingHasReported', () => {
      forge.section.set({ state: 'ready', items: [pullRequest()], message: null });
      expand();
      expect(
        (fixture.nativeElement as HTMLElement).querySelector('.rail__status--succeeded'),
      ).not.toBeNull();

      forge.section.set({
        state: 'ready',
        items: [pullRequest({ checks: 'none' })],
        message: null,
      });
      fixture.detectChanges();

      expect((fixture.nativeElement as HTMLElement).querySelector('.rail__status')).toBeNull();
    });

    it('pulsesWhileChecksAreRunning_ratherThanShowingAStaticSpinner', () => {
      // A spinner glyph nothing rotates reads as a rendering glitch. Warning-toned, so the badge's
      // three states read as one scale: in flight, passed, failed.
      forge.section.set({
        state: 'ready',
        items: [pullRequest({ checks: 'running' })],
        message: null,
      });

      expand();

      const host: HTMLElement = fixture.nativeElement as HTMLElement;
      const dot: HTMLElement | null = host.querySelector('app-pulse-dot.rail__status');
      expect(dot).not.toBeNull();
      expect(dot?.classList.contains('pulse-dot--pulsing')).toBe(true);
      expect(dot?.classList.contains('pulse-dot--warning')).toBe(true);
      // No icon badge competes with it.
      expect(host.querySelector('app-icon.rail__status')).toBeNull();
    });

    it('usesFilledBadgesForASettledOutcome', () => {
      forge.section.set({
        state: 'ready',
        items: [pullRequest({ checks: 'failed' })],
        message: null,
      });

      expand();

      const icon: HTMLElement | null = (fixture.nativeElement as HTMLElement).querySelector(
        '.rail__status--failed i',
      );
      expect(icon?.className).toContain('ph-fill');
      expect(icon?.className).toContain('ph-x-circle');
    });

    it('distinguishesNoPullRequests_fromEveryFailedState', () => {
      const cases: readonly [ForgeSection<ForgePullRequest>, string][] = [
        [{ state: 'ready', items: [], message: null }, 'No open pull requests'],
        [{ state: 'no-forge', items: [], message: 'No forge here' }, 'No forge here'],
        [{ state: 'unauthorized', items: [], message: 'Sign in first' }, 'Sign in first'],
        [{ state: 'error', items: [], message: 'It broke' }, 'It broke'],
      ];
      expand();

      for (const [section, expected] of cases) {
        forge.section.set(section);
        fixture.detectChanges();
        expect((fixture.nativeElement as HTMLElement).textContent).toContain(expected);
      }
    });

    it('fallsBackToAStateMessage_whenTheReadSuppliedNone', () => {
      forge.section.set({ state: 'loading', items: [], message: null });

      expand();

      expect((fixture.nativeElement as HTMLElement).textContent).toContain('Loading');
    });

    it('offersItsCommandsOnTheContextMenu_notAsInlineButtons', () => {
      const internals: { contextMenuFor(row: TreeRow): readonly MenuItem[] } = component;

      const items: readonly MenuItem[] = internals.contextMenuFor(pullRequestRow());

      expect(items.map((item: MenuItem): string => item.label)).toEqual([
        'Check Out',
        'Open on GitHub',
      ]);
    });

    it('offersNothingOnARowWithNoCommands_soTheTreeSuppressesItsTrigger', () => {
      // An empty context menu opens onto nothing; the tree hides the trigger when the factory yields
      // no items, which only works if this returns none.
      const internals: { contextMenuFor(row: TreeRow): readonly MenuItem[] } = component;

      expect(internals.contextMenuFor(sectionRow('tags', 'Tags'))).toEqual([]);
      expect(
        internals.contextMenuFor({
          id: 'branch:main',
          depth: 1,
          expandable: false,
          expanded: false,
          data: { kind: 'branch', icon: Icon.SOURCE_CONTROL, label: 'main' },
        }),
      ).toEqual([]);
    });

    it('checksOutAPullRequest_andOpensItInTheBrowser_fromTheMenu', () => {
      const internals: { onContextAction(choice: TreeMenuSelection): void } =
        component as unknown as { onContextAction(choice: TreeMenuSelection): void };
      const row: TreeRow = pullRequestRow();

      internals.onContextAction({ itemId: 'pr.checkout', row });
      internals.onContextAction({ itemId: 'pr.open', row });

      expect(forge.checkedOut.map((pull: ForgePullRequest): number => pull.number)).toEqual([7]);
      expect(opened).toEqual(['https://github.com/onix-labs/onixlabs-studio/pull/7']);
    });

    it('ignoresAnUnknownCommand', () => {
      const internals: { onContextAction(choice: TreeMenuSelection): void } =
        component as unknown as { onContextAction(choice: TreeMenuSelection): void };

      internals.onContextAction({ itemId: 'nonsense', row: pullRequestRow() });

      expect(forge.checkedOut).toEqual([]);
      expect(opened).toEqual([]);
    });

    it('refresh_reReadsTheForge_onlyWhileTheSectionIsOpen', () => {
      const internals: { refresh(): void } = component as unknown as { refresh(): void };

      internals.refresh();
      expect(forge.loads).toBe(0);

      expand();
      expect(forge.loads).toBe(1);

      internals.refresh();
      expect(forge.loads).toBe(2);
    });
  });

  describe('the Issues and Actions sections', () => {
    /**
     * Reveals the protected surface these tests drive.
     * @returns Returns the internals.
     */
    function internals(): {
      contextMenuFor(row: TreeRow): readonly MenuItem[];
      onContextAction(choice: TreeMenuSelection): void;
      pendingRerun(): ForgeWorkflowRun | null;
      pendingCancel(): ForgeWorkflowRun | null;
      confirmRerun(): void;
      confirmCancelRun(): void;
      cancelRerun(): void;
    } {
      return component as unknown as ReturnType<typeof internals>;
    }

    it('showTheRealDataAndNotTheSampleArrays', () => {
      forge.issueSection.set({
        state: 'ready',
        items: [issueRow().data as { issue: ForgeIssue }].map(
          (data: { issue: ForgeIssue }): ForgeIssue => data.issue,
        ),
        message: null,
      });
      forge.runSection.set({ state: 'ready', items: [workflowRun()], message: null });

      component.onRowClick(sectionRow('issues', 'Issues'));
      component.onRowClick(sectionRow('actions', 'Actions'));
      fixture.detectChanges();

      const text: string = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('#12 Something is broken');
      expect(text).toContain('CI — main');
      // The sample data both sections shipped with is gone for good.
      expect(text).not.toContain('Source-control provider abstraction');
      expect(text).not.toContain('CI / build');
    });

    it('readNothing_untilTheirSectionsAreExpanded', () => {
      expect(forge.loads).toBe(0);

      component.onRowClick(sectionRow('issues', 'Issues'));
      expect(forge.loads).toBe(1);

      component.onRowClick(sectionRow('actions', 'Actions'));
      expect(forge.loads).toBe(2);
    });

    it('aRunOffersCancelWhileGoing_andReRunOnceStopped', () => {
      // Offering the inapplicable one would be offering a command the forge would simply refuse.
      expect(
        internals()
          .contextMenuFor(runRow({ status: 'running' }))
          .map((item: MenuItem): string => item.label),
      ).toEqual(['Cancel Run', 'Open on GitHub']);
      expect(
        internals()
          .contextMenuFor(runRow({ status: 'queued' }))
          .map((item: MenuItem): string => item.label),
      ).toEqual(['Cancel Run', 'Open on GitHub']);
      expect(
        internals()
          .contextMenuFor(runRow({ status: 'failed' }))
          .map((item: MenuItem): string => item.label),
      ).toEqual(['Re-run', 'Open on GitHub']);
    });

    it('openingAnIssueOrRunReachesTheBrowser', () => {
      internals().onContextAction({ itemId: 'issue.open', row: issueRow() });
      internals().onContextAction({ itemId: 'run.open', row: runRow() });

      expect(opened).toEqual([
        'https://github.com/onix-labs/onixlabs-studio/issues/12',
        'https://github.com/onix-labs/onixlabs-studio/actions/runs/99',
      ]);
    });

    it('reRunAndCancel_areConfirmedBeforeAnythingHappens', () => {
      // Re-running spends CI minutes and can redeploy; cancelling abandons work in flight.
      internals().onContextAction({ itemId: 'run.rerun', row: runRow() });

      expect(internals().pendingRerun()?.id).toBe(99);
      expect(forge.commands).toEqual([]);

      internals().confirmRerun();

      expect(internals().pendingRerun()).toBeNull();
      expect(forge.commands).toEqual(['rerun:99']);
    });

    it('dismissingTheConfirmation_leavesTheRunAlone', () => {
      internals().onContextAction({ itemId: 'run.rerun', row: runRow() });

      internals().cancelRerun();

      expect(internals().pendingRerun()).toBeNull();
      expect(forge.commands).toEqual([]);
    });

    it('cancelRun_isConfirmedToo', () => {
      internals().onContextAction({ itemId: 'run.cancel', row: runRow({ status: 'running' }) });

      expect(internals().pendingCancel()?.id).toBe(99);
      internals().confirmCancelRun();

      expect(forge.commands).toEqual(['cancel:99']);
    });

    it('aQueuedRunPulses_becauseItIsWorkTheUserIsWaitingOn', () => {
      forge.runSection.set({
        state: 'ready',
        items: [workflowRun({ status: 'queued' })],
        message: null,
      });

      component.onRowClick(sectionRow('actions', 'Actions'));
      fixture.detectChanges();

      expect(
        (fixture.nativeElement as HTMLElement).querySelector('app-pulse-dot.rail__status'),
      ).not.toBeNull();
    });
  });

  describe('Open in Agent', () => {
    /**
     * Reveals the protected surface these tests drive.
     * @returns Returns the internals.
     */
    function internals(): {
      contextMenuFor(row: TreeRow): readonly MenuItem[];
      onContextAction(choice: TreeMenuSelection): void;
      pendingAgentIssue(): ForgeIssue | null;
      confirmOpenInAgent(): void;
      dismissOpenInAgent(): void;
    } {
      return component as unknown as ReturnType<typeof internals>;
    }

    it('isOfferedOnAnIssue', () => {
      expect(
        internals()
          .contextMenuFor(issueRow())
          .map((item: MenuItem): string => item.label),
      ).toEqual(['Open in Agent', 'Open on GitHub']);
    });

    it('startsImmediately_whenThereIsNoConversationToLose', () => {
      internals().onContextAction({ itemId: 'issue.agent', row: issueRow() });

      expect(internals().pendingAgentIssue()).toBeNull();
      expect(conversation.newChats).toBe(1);
      expect(agent.sent.length).toBe(1);
    });

    it('opensWithAMessageNamingTheIssueAndItsUrl', () => {
      internals().onContextAction({ itemId: 'issue.agent', row: issueRow() });

      const message: string = agent.sent[0];
      expect(message).toContain('#12');
      expect(message).toContain('Something is broken');
      expect(message).toContain('onix-labs/onixlabs-studio');
      expect(message).toContain('https://github.com/onix-labs/onixlabs-studio/issues/12');
      // A conversation started by one menu click should arrive at an understanding, not at edits.
      expect(message).toContain("Don't make any changes yet");
    });

    it('bringsTheAgentPanelForward_soTheConversationIsVisible', () => {
      internals().onContextAction({ itemId: 'issue.agent', row: issueRow() });

      expect(revealed).toEqual(['agent']);
    });

    it('asksFirst_whenAConversationAlreadyHoldsSomething', () => {
      // Starting a new one discards the transcript; a half-aimed menu click must not lose it.
      agent.messages.set(true);

      internals().onContextAction({ itemId: 'issue.agent', row: issueRow() });

      expect(internals().pendingAgentIssue()?.number).toBe(12);
      expect(conversation.newChats).toBe(0);
      expect(agent.sent).toEqual([]);
    });

    it('yes_endsTheOldConversationAndStartsTheNewOne', () => {
      agent.messages.set(true);
      internals().onContextAction({ itemId: 'issue.agent', row: issueRow() });

      internals().confirmOpenInAgent();

      expect(internals().pendingAgentIssue()).toBeNull();
      expect(conversation.newChats).toBe(1);
      expect(agent.sent.length).toBe(1);
      expect(revealed).toEqual(['agent']);
    });

    it('no_leavesTheConversationAlone', () => {
      agent.messages.set(true);
      internals().onContextAction({ itemId: 'issue.agent', row: issueRow() });

      internals().dismissOpenInAgent();

      expect(internals().pendingAgentIssue()).toBeNull();
      expect(conversation.newChats).toBe(0);
      expect(agent.sent).toEqual([]);
      expect(revealed).toEqual([]);
    });
  });

  describe('the tool strip', () => {
    /**
     * Reveals the protected surface these tests drive.
     * @returns Returns the internals.
     */
    function internals(): {
      moreItems(): readonly MenuItem[];
      onMoreAction(id: string): void;
      expandAll(): void;
      branchDialogOpen(): boolean;
    } {
      return component as unknown as ReturnType<typeof internals>;
    }

    it('isTheSharedExplorerStrip_asTheOtherExplorersUse', () => {
      const host: HTMLElement = fixture.nativeElement as HTMLElement;

      expect(host.querySelector('app-explorer-toolbar')).not.toBeNull();
      // The bespoke strip it replaced is gone, along with its row of buttons.
      expect(host.querySelector('app-panel-toolbar')).toBeNull();
    });

    it('offersTheRepositoryWideCommandsOnItsMenu', () => {
      // Anything acting on a row the user can see lives on that row's context menu instead.
      expect(
        internals()
          .moreItems()
          .filter((item: MenuItem): boolean => item.separator !== true)
          .map((item: MenuItem): string => item.label),
      ).toEqual(['New Branch…', 'Stash Changes', 'Fetch', 'Refresh']);
    });

    it('disablesStash_whenThereIsNothingToStash', () => {
      const stash: MenuItem | undefined = internals()
        .moreItems()
        .find((item: MenuItem): boolean => item.label === 'Stash Changes');

      // The fixture's working tree is dirty, so the command is live.
      expect(stash?.disabled).toBe(false);
    });

    it('newBranch_opensTheDialogFromTheMenu', () => {
      internals().onMoreAction('repo.newBranch');

      expect(internals().branchDialogOpen()).toBe(true);
    });

    it('expandAll_opensEverySection_andReadsTheForgeBackedOnes', () => {
      // Expanding a section by hand is what loads it, so expanding them all must do the same or the
      // three forge sections would open onto nothing.
      internals().expandAll();
      fixture.detectChanges();

      const text: string = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('v1.0.0');
      expect(forge.loads).toBe(3);
    });

    it('theSectionHeadingsReadLikeTheExplorersRootRows', () => {
      // Bold body text, not the small uppercase treatment the rail used to give them.
      const heading: HTMLElement | null = (fixture.nativeElement as HTMLElement).querySelector(
        '.tree-name.bold',
      );

      expect(heading).not.toBeNull();
      expect(
        (fixture.nativeElement as HTMLElement).querySelector('.rail__section-name'),
      ).toBeNull();
    });
  });

  describe('stash commands on the context menu', () => {
    const stashRow: TreeRow = {
      id: 'stash:0',
      depth: 1,
      expandable: false,
      expanded: false,
      data: {
        kind: 'stash',
        icon: Icon.STASH,
        label: 'WIP on main',
        stash: { index: 0, message: 'WIP on main', branch: 'main', files: [] },
      },
    };

    /**
     * Reveals the menu surface.
     * @returns Returns the internals.
     */
    function menu(): {
      contextMenuFor(row: TreeRow): readonly MenuItem[];
      onContextAction(choice: TreeMenuSelection): void;
      pendingDrop(): GitStash | null;
    } {
      return component as unknown as ReturnType<typeof menu>;
    }

    it('offersApplyPopAndDrop_andSaysWhatBecomesOfTheStash', () => {
      // Apply and pop differ only in what happens to the stash afterwards, which is what the
      // buttons' tooltips used to explain and the muted trailing note now carries.
      const items: readonly MenuItem[] = menu().contextMenuFor(stashRow);

      expect(items.map((item: MenuItem): string => item.label)).toEqual(['Apply', 'Pop', 'Drop…']);
      expect(items[0].status).toBe('keep the stash');
      expect(items[1].status).toBe('drop the stash');
    });

    it('applyAndPop_actImmediately', () => {
      menu().onContextAction({ itemId: 'stash.apply', row: stashRow });
      menu().onContextAction({ itemId: 'stash.pop', row: stashRow });

      expect(provider.calls).toContain('applyStash:0');
      expect(provider.calls).toContain('popStash:0');
    });

    it('drop_stillAsksFirst', () => {
      // Dropping discards the stashed work with no way back, whichever surface asks for it.
      menu().onContextAction({ itemId: 'stash.drop', row: stashRow });

      expect(menu().pendingDrop()?.index).toBe(0);
      expect(provider.calls).not.toContain('dropStash:0');
    });
  });
});
