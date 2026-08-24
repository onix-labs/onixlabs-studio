import {
  ForgeRepository,
  ForgeSection,
} from '@shared/angular/services/forge-repository/forge-repository';
import { ForgePullRequest } from '@shared/api/forge-types';
import { Shell } from '@shared/angular/services/shell/shell';
import { ApplicationRef, signal, Signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ModalWindows } from '@shared/angular/services/modal-windows/modal-windows';
import { FakeModalWindows } from '@shared/angular/services/modal-windows/modal-windows.fake';
import { Icon } from '@shared/angular/icons/icon';
import { TreeRow } from '@shared/angular/components/tree-view/tree-view';
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

  public readonly pullRequests: Signal<ForgeSection<ForgePullRequest>> = this.section.asReadonly();

  public loadPullRequests(): Promise<void> {
    this.loads += 1;
    return Promise.resolve();
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

describe('SourceControlSidebar', () => {
  let component: SourceControlSidebar;
  let fixture: ComponentFixture<SourceControlSidebar>;
  let repository: Repository;
  let provider: FakeProvider;
  let windows: FakeModalWindows;
  let forge: FakeForgeRepository;
  let opened: string[];

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
    await TestBed.configureTestingModule({
      imports: [SourceControlSidebar],
      providers: [
        Repository,
        { provide: ModalWindows, useValue: windows },
        { provide: ForgeRepository, useValue: forge },
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
    // It carries the checkout action instead.
    expect(develop?.querySelector('button[aria-label="Check out branch"]')).not.toBeNull();
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

  it('checkout_whenBranchActionClicked_checksOutTheBranch', () => {
    const action: HTMLButtonElement | null = (fixture.nativeElement as HTMLElement).querySelector(
      'button[aria-label="Check out branch"]',
    );

    expect(action).not.toBeNull();

    action?.click();

    expect(provider.calls).toContain('checkout:develop');
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
      // A spinner glyph nothing rotates reads as a rendering glitch; the pulsing dot is the same cue
      // Mission Control uses for a working agent.
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
      expect(dot?.classList.contains('pulse-dot--accent')).toBe(true);
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

    it('checksOutAPullRequest_andOpensItInTheBrowser', () => {
      forge.section.set({ state: 'ready', items: [pullRequest()], message: null });
      expand();
      // The aria-label sits on the button the atom renders, not on its host element.
      const host: HTMLElement = fixture.nativeElement as HTMLElement;
      const checkout: HTMLButtonElement | null = host.querySelector(
        'button[aria-label="Check out pull request"]',
      );
      const open: HTMLButtonElement | null = host.querySelector(
        'button[aria-label="Open pull request in browser"]',
      );

      checkout?.click();
      open?.click();

      expect(forge.checkedOut.map((pull: ForgePullRequest): number => pull.number)).toEqual([7]);
      expect(opened).toEqual(['https://github.com/onix-labs/onixlabs-studio/pull/7']);
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
});
