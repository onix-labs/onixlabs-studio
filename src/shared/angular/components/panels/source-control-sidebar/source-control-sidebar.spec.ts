import { WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
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

describe('SourceControlSidebar', () => {
  let component: SourceControlSidebar;
  let fixture: ComponentFixture<SourceControlSidebar>;
  let repository: Repository;
  let provider: FakeProvider;

  const panel: DockPanel = {
    id: 'repository',
    title: 'Repository',
    icon: Icon.SOURCE_CONTROL,
    role: 'tool',
    component: SourceControlSidebar,
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SourceControlSidebar],
      providers: [
        Repository,
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
    expect(develop?.querySelector('.rail__item-action')).not.toBeNull();
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
      '.rail__item-action',
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
});
