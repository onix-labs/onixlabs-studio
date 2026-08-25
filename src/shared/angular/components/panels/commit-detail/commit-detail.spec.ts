import { computed, signal, Signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Icon } from '@shared/angular/icons/icon';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { DiffOpener } from '@shared/angular/services/diffs/diff-opener';
import { CommitMessageGenerator } from '@shared/angular/services/repository/commit-message-generator';
import { Repository } from '@shared/angular/services/repository/repository';
import {
  GitChangeStatus,
  GitCommit,
  GitFileChange,
} from '@shared/angular/services/repository/repository-data';
import { MutationResult } from '@shared/angular/services/source-control/source-control-provider';
import { FileSystem } from '@shared/angular/services/file-system/file-system';
import { CommitDetail } from './commit-detail';

/**
 * Builds a commit for the detail pane to render.
 * @param hash The commit hash.
 * @param parents The parent commit hashes.
 * @returns Returns the commit.
 */
function makeCommit(hash: string, parents: readonly string[]): GitCommit {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    summary: `Summary ${hash}`,
    body: '',
    author: 'Ada',
    email: 'ada@example.com',
    relativeDate: '2 days ago',
    isoDate: '2026-07-09',
    parents,
    refs: [],
    files: [],
  };
}

/**
 * Builds a changed file with embedded diff content.
 * @param path The file path.
 * @param status How the file changed.
 * @param untracked Whether the file is untracked.
 * @returns Returns the file change.
 */
function makeFile(path: string, status: GitChangeStatus, untracked?: boolean): GitFileChange {
  return {
    path,
    status,
    additions: 1,
    deletions: 0,
    language: 'typescript',
    original: 'a',
    modified: 'b',
    untracked,
  };
}

/**
 * A controllable stand-in for the AI commit-message generator.
 */
class StubGenerator {
  public isAvailable: boolean = true;
  public readonly generating: WritableSignal<boolean> = signal<boolean>(false);
  public result: string | null = 'feat: generated message';
  public generatedFor: readonly GitFileChange[][] = [];

  public generate(files: readonly GitFileChange[]): Promise<string | null> {
    this.generatedFor = [...this.generatedFor, [...files]];
    return Promise.resolve(this.result);
  }
}

/**
 * A controllable repository model standing in for the shared {@link Repository}, recording the
 * mutations the pane invokes.
 */
class StubRepository {
  public readonly selectedCommit: WritableSignal<GitCommit | null> = signal<GitCommit | null>(null);

  /**
   * Mirrors the real repository's surfaced-error signal; null when no operation has failed.
   */
  public readonly lastError: WritableSignal<string | null> = signal<string | null>(null);

  /**
   * Clears the surfaced error, recording the call.
   */
  public dismissError(): void {
    this.lastError.set(null);
  }

  public readonly selectedFiles: WritableSignal<readonly GitFileChange[]> = signal<
    readonly GitFileChange[]
  >([]);
  public readonly selectedFile: WritableSignal<GitFileChange | null> = signal<GitFileChange | null>(
    null,
  );
  public readonly isWorkingSelected: WritableSignal<boolean> = signal<boolean>(false);
  public readonly commitMessage: WritableSignal<string> = signal<string>('');
  public readonly staged: WritableSignal<readonly GitFileChange[]> = signal<
    readonly GitFileChange[]
  >([]);
  public readonly unstaged: WritableSignal<readonly GitFileChange[]> = signal<
    readonly GitFileChange[]
  >([]);
  public readonly changeCount: Signal<number> = computed(
    (): number => this.staged().length + this.unstaged().length,
  );

  /**
   * Records the repository calls the pane makes, in order.
   */
  public readonly calls: string[] = [];

  public selectFile(path: string): void {
    this.calls.push(`selectFile:${path}`);
  }

  public setCommitMessage(message: string): void {
    this.calls.push(`setCommitMessage:${message}`);
  }

  /**
   * Mirrors the real repository's bound state, gating the tool strip's Refresh.
   */
  public readonly isBound: WritableSignal<boolean> = signal<boolean>(true);

  public discard(file: GitFileChange): Promise<MutationResult> {
    this.calls.push(`discard:${file.path}`);
    return Promise.resolve({ success: true });
  }

  public discardFiles(files: readonly GitFileChange[]): Promise<MutationResult> {
    this.calls.push(
      `discardFiles:${files.map((file: GitFileChange): string => file.path).join(',')}`,
    );
    return Promise.resolve({ success: true });
  }

  public refresh(): Promise<void> {
    this.calls.push('refresh');
    return Promise.resolve();
  }

  public stash(): Promise<MutationResult> {
    this.calls.push('stash');
    return Promise.resolve({ success: true });
  }

  public commitFiles(paths: readonly string[]): Promise<MutationResult> {
    this.calls.push(`commitFiles:${paths.join(',')}`);
    return Promise.resolve({ success: true });
  }

  public commitAndPushFiles(paths: readonly string[]): Promise<MutationResult> {
    this.calls.push(`commitAndPushFiles:${paths.join(',')}`);
    return Promise.resolve({ success: true });
  }
}

/**
 * The dock panel descriptor the pane is projected for.
 */
const PANEL: DockPanel = {
  id: 'commit-detail',
  title: 'Details',
  icon: Icon.GIT_COMMIT,
  role: 'tool',
  component: CommitDetail,
};

/**
 * Gets a button by its accessible name. The panel's buttons are `app-button`s, so they are found by
 * what they are called rather than by a class of their own.
 * @param host The rendered panel.
 * @param name The visible label or aria-label.
 * @returns Returns the button.
 */
function namedButton(host: HTMLElement, name: string): HTMLButtonElement {
  return Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
    (button: HTMLButtonElement): boolean =>
      button.textContent?.trim() === name || button.getAttribute('aria-label') === name,
  )!;
}

describe('CommitDetail', () => {
  let fixture: ComponentFixture<CommitDetail>;
  let repository: StubRepository;
  let generator: StubGenerator;
  let opened: GitFileChange[];
  let confirmAnswer: boolean;
  let host: HTMLElement;

  beforeEach(async () => {
    repository = new StubRepository();
    generator = new StubGenerator();
    opened = [];
    confirmAnswer = false;
    await TestBed.configureTestingModule({
      imports: [CommitDetail],
      providers: [
        { provide: Repository, useValue: repository },
        { provide: CommitMessageGenerator, useValue: generator },
        {
          provide: FileSystem,
          useValue: {
            confirmDestructive: (): Promise<boolean> => Promise.resolve(confirmAnswer),
          },
        },
        {
          provide: DiffOpener,
          useValue: {
            open: (file: GitFileChange): void => {
              opened.push(file);
            },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CommitDetail);
    fixture.componentRef.setInput('panel', PANEL);
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  it('render_whenNothingSelected_showsTheNoSelectionHeader', () => {
    expect(host.querySelector('.detail__summary')?.textContent).toContain('No selection');
  });

  it('render_whenCommitSelected_showsSummaryMetadataAndChangedFiles', () => {
    repository.selectedCommit.set(makeCommit('abc1234def', []));
    repository.selectedFiles.set([makeFile('src/app/main.ts', 'modified')]);
    fixture.detectChanges();

    expect(host.querySelector('.detail__summary')?.textContent).toContain('Summary abc1234def');
    expect(host.querySelector('.detail__hash')?.textContent).toContain('abc1234def');
    expect(host.querySelector('.tree-count')?.textContent).toContain('1');
    expect(host.querySelector('.detail__file-name')?.textContent).toContain('main.ts');
    expect(host.querySelector('.detail__file-dir')?.textContent).toContain('src/app');
    expect(host.querySelector('.detail__status')?.textContent?.trim()).toBe('M');
  });

  it('selectFile_whenAChangedFileIsClicked_selectsItAndOpensItsDiff', () => {
    repository.selectedCommit.set(makeCommit('abc1234def', []));
    repository.selectedFiles.set([makeFile('src/app/main.ts', 'modified')]);
    fixture.detectChanges();

    host.querySelector<HTMLElement>('.tree-row')!.click();

    expect(repository.calls).toContain('selectFile:src/app/main.ts');
    expect(opened.length).toBe(1);
    expect(opened[0].path).toBe('src/app/main.ts');
  });

  it('render_whenWorkingTreeSelected_groupsTrackedAndUntrackedWithDefaultChecks', () => {
    repository.isWorkingSelected.set(true);
    repository.staged.set([makeFile('a.ts', 'modified')]);
    repository.unstaged.set([makeFile('b.ts', 'modified'), makeFile('new.ts', 'added', true)]);
    fixture.detectChanges();

    const groups: (string | null)[] = Array.from(host.querySelectorAll('.detail__group-name')).map(
      (element: Element): string | null => element.textContent,
    );
    expect(groups.join(' ')).toContain('Tracked Files');
    expect(groups.join(' ')).toContain('Untracked Files');

    // Tracked files default to checked, untracked to unchecked.
    const checks: HTMLInputElement[] = Array.from(
      host.querySelectorAll<HTMLInputElement>('.detail__file-check input[type="checkbox"]'),
    );
    expect(checks).toHaveLength(3);
    expect(checks[0].checked).toBe(true); // a.ts (tracked)
    expect(checks[1].checked).toBe(true); // b.ts (tracked)
    expect(checks[2].checked).toBe(false); // new.ts (untracked)
  });

  it('commit_isGatedOnAMessageAndChecks_thenCommitsExactlyTheCheckedFiles', () => {
    repository.isWorkingSelected.set(true);
    repository.unstaged.set([makeFile('b.ts', 'modified'), makeFile('new.ts', 'added', true)]);
    fixture.detectChanges();

    const button: HTMLButtonElement = namedButton(host, 'Commit');
    expect(button.disabled).toBe(true);

    repository.commitMessage.set('feat: add a thing');
    fixture.detectChanges();
    expect(button.disabled).toBe(false);

    button.click();
    expect(repository.calls).toContain('commitFiles:b.ts');
  });

  it('commitAndPush_commitsTheCheckedFilesThenPushes', () => {
    repository.isWorkingSelected.set(true);
    repository.unstaged.set([makeFile('b.ts', 'modified')]);
    repository.commitMessage.set('feat: push it');
    fixture.detectChanges();

    namedButton(host, 'Commit and Push').click();

    expect(repository.calls).toContain('commitAndPushFiles:b.ts');
  });

  it('groupCheckbox_checksAndUnchecksEveryChildInTheGroup', () => {
    repository.isWorkingSelected.set(true);
    repository.unstaged.set([
      makeFile('new1.ts', 'added', true),
      makeFile('new2.ts', 'added', true),
    ]);
    repository.commitMessage.set('feat: add news');
    fixture.detectChanges();

    // The second group checkbox is Untracked Files; checking it selects both children.
    const groupChecks: HTMLInputElement[] = Array.from(
      host.querySelectorAll<HTMLInputElement>('.detail__group-check input[type="checkbox"]'),
    );
    expect(groupChecks).toHaveLength(2);
    groupChecks[1].click();
    fixture.detectChanges();

    const fileChecks: HTMLInputElement[] = Array.from(
      host.querySelectorAll<HTMLInputElement>('.detail__file-check input[type="checkbox"]'),
    );
    expect(fileChecks.every((check: HTMLInputElement): boolean => check.checked)).toBe(true);

    namedButton(host, 'Commit').click();
    expect(repository.calls).toContain('commitFiles:new1.ts,new2.ts');
  });

  it('groupCheckbox_showsTheMixedStateWhenOnlySomeChildrenAreChecked', () => {
    repository.isWorkingSelected.set(true);
    repository.unstaged.set([makeFile('a.ts', 'modified'), makeFile('b.ts', 'modified')]);
    fixture.detectChanges();

    // Uncheck one tracked file: the tracked group checkbox turns indeterminate.
    const fileChecks: HTMLInputElement[] = Array.from(
      host.querySelectorAll<HTMLInputElement>('.detail__file-check input[type="checkbox"]'),
    );
    fileChecks[0].click();
    fixture.detectChanges();

    const groupCheck: HTMLInputElement = host.querySelector<HTMLInputElement>(
      '.detail__group-check input[type="checkbox"]',
    )!;
    expect(groupCheck.indeterminate).toBe(true);
    expect(groupCheck.checked).toBe(false);
  });

  it('groupHeader_collapsesAndExpandsItsRows', () => {
    repository.isWorkingSelected.set(true);
    repository.unstaged.set([makeFile('b.ts', 'modified')]);
    fixture.detectChanges();
    expect(host.querySelectorAll('.detail__file-check')).toHaveLength(1);

    // Clicking the group's tree row toggles its expansion.
    host.querySelector<HTMLElement>('.tree-row')!.click();
    fixture.detectChanges();

    expect(host.querySelectorAll('.detail__file-check')).toHaveLength(0);
  });

  it('userChoices_surviveARefreshWhileNewFilesGetDefaults', () => {
    repository.isWorkingSelected.set(true);
    repository.unstaged.set([makeFile('kept.ts', 'modified')]);
    fixture.detectChanges();

    // Uncheck the tracked file, then simulate a refresh that adds another tracked file.
    host.querySelector<HTMLInputElement>('.detail__file-check input[type="checkbox"]')!.click();
    fixture.detectChanges();
    repository.unstaged.set([makeFile('kept.ts', 'modified'), makeFile('fresh.ts', 'modified')]);
    fixture.detectChanges();

    const checks: HTMLInputElement[] = Array.from(
      host.querySelectorAll<HTMLInputElement>('.detail__file-check input[type="checkbox"]'),
    );
    expect(checks[0].checked).toBe(false); // kept.ts keeps the user's choice
    expect(checks[1].checked).toBe(true); // fresh.ts gets the tracked default
  });

  it('generateMessage_putsTheGeneratedDraftIntoTheRepository', async () => {
    repository.isWorkingSelected.set(true);
    repository.unstaged.set([makeFile('b.ts', 'modified')]);
    fixture.detectChanges();

    const button: HTMLButtonElement = namedButton(host, 'Generate commit message');
    expect(button.disabled).toBe(false);
    button.click();
    await fixture.whenStable();

    expect(generator.generatedFor).toHaveLength(1);
    expect(generator.generatedFor[0].map((file: GitFileChange): string => file.path)).toEqual([
      'b.ts',
    ]);
    expect(repository.calls).toContain('setCommitMessage:feat: generated message');
  });

  it('generateMessage_whenUnavailable_disablesTheAffordance', () => {
    generator.isAvailable = false;
    repository.isWorkingSelected.set(true);
    repository.unstaged.set([makeFile('b.ts', 'modified')]);
    fixture.detectChanges();

    expect(namedButton(host, 'Generate commit message').disabled).toBe(true);
  });

  it('discard_whenConfirmed_delegatesToTheRepository', async () => {
    confirmAnswer = true;
    repository.isWorkingSelected.set(true);
    repository.unstaged.set([makeFile('b.ts', 'modified')]);
    fixture.detectChanges();

    host.querySelector<HTMLButtonElement>('[aria-label="Discard changes"]')!.click();
    await fixture.whenStable();

    expect(repository.calls).toContain('discard:b.ts');
  });

  it('discard_whenDeclined_doesNothing', async () => {
    confirmAnswer = false;
    repository.isWorkingSelected.set(true);
    repository.unstaged.set([makeFile('b.ts', 'modified')]);
    fixture.detectChanges();

    host.querySelector<HTMLButtonElement>('[aria-label="Discard changes"]')!.click();
    await fixture.whenStable();

    expect(repository.calls).not.toContain('discard:b.ts');
  });

  it('lastError_rendersADismissibleNotice', async () => {
    repository.lastError.set('Authentication required.');
    fixture.detectChanges();

    expect(host.querySelector('.detail__notice')?.textContent).toContain(
      'Authentication required.',
    );
    host.querySelector<HTMLButtonElement>('[aria-label="Dismiss error"]')!.click();
    await fixture.whenStable();
    expect(host.querySelector('.detail__notice')).toBeNull();
  });

  it('messageComposer_whenTheUserTypes_forwardsTheDraftMessage', () => {
    repository.isWorkingSelected.set(true);
    fixture.detectChanges();

    const textarea: HTMLTextAreaElement = host.querySelector<HTMLTextAreaElement>(
      '.detail__message textarea',
    )!;
    textarea.value = 'wip: draft message';
    textarea.dispatchEvent(new Event('input'));

    expect(repository.calls).toContain('setCommitMessage:wip: draft message');
  });

  describe('the tool strip', () => {
    /**
     * Resolves a tool-strip button by its accessible label.
     * @param label The button's aria-label.
     * @returns Returns the button.
     */
    function tool(label: string): HTMLButtonElement {
      return host.querySelector<HTMLButtonElement>(`app-panel-toolbar [aria-label="${label}"]`)!;
    }

    it('readsLeftToRight_inTheOrderTheCommandsAreReachedFor', () => {
      // The diff-layout toggle that used to lead this strip now lives on the diff panel itself.
      expect(
        Array.from(host.querySelectorAll<HTMLButtonElement>('app-panel-toolbar [aria-label]')).map(
          (button: HTMLButtonElement): string | null => button.getAttribute('aria-label'),
        ),
      ).toEqual(['Refresh', 'Discard All', 'Show Diff', 'Stash', 'Expand All', 'Collapse All']);
    });

    it('showDiff_opensTheSelectedFilesDiff_andIsInertWithoutOne', async () => {
      expect(tool('Show Diff').disabled).toBe(true);

      const file: GitFileChange = makeFile('a.ts', 'modified');
      repository.unstaged.set([file]);
      repository.selectedFile.set(file);
      fixture.detectChanges();

      expect(tool('Show Diff').disabled).toBe(false);
      tool('Show Diff').click();
      await fixture.whenStable();

      expect(opened.map((file: GitFileChange): string => file.path)).toContain('a.ts');
    });

    it('stash_isDisabledWhenTheWorkingTreeIsClean', () => {
      expect(tool('Stash').disabled).toBe(true);

      repository.unstaged.set([makeFile('a.ts', 'modified')]);
      fixture.detectChanges();

      expect(tool('Stash').disabled).toBe(false);
    });

    it('stash_putsTheChangesOnTheStack', async () => {
      repository.unstaged.set([makeFile('a.ts', 'modified')]);
      fixture.detectChanges();

      tool('Stash').click();
      await fixture.whenStable();

      expect(repository.calls).toContain('stash');
    });

    it('expandAllAndCollapseAll_openAndCloseBothFileGroups', () => {
      repository.staged.set([makeFile('tracked.ts', 'modified')]);
      repository.unstaged.set([makeFile('untracked.ts', 'added', true)]);
      repository.isWorkingSelected.set(true);
      fixture.detectChanges();

      const fileRows: () => number = (): number =>
        host.querySelectorAll('app-tree-view [role="treeitem"], .tree-row').length;
      const expanded: number = fileRows();

      tool('Collapse All').click();
      fixture.detectChanges();
      const collapsed: number = fileRows();

      // Both groups shut, so only the two headers are left.
      expect(collapsed).toBeLessThan(expanded);

      tool('Expand All').click();
      fixture.detectChanges();

      expect(fileRows()).toBe(expanded);
    });

    it('refresh_reReadsTheRepository', async () => {
      tool('Refresh').click();
      await fixture.whenStable();

      expect(repository.calls).toContain('refresh');
    });

    it('discardAll_isDisabledWhenTheWorkingTreeIsClean', () => {
      expect(tool('Discard All').disabled).toBe(true);

      repository.unstaged.set([makeFile('a.ts', 'modified')]);
      fixture.detectChanges();

      expect(tool('Discard All').disabled).toBe(false);
    });

    it('discardAll_whenDismissed_discardsNothing', async () => {
      confirmAnswer = false;
      repository.unstaged.set([makeFile('a.ts', 'modified')]);
      fixture.detectChanges();

      tool('Discard All').click();
      await fixture.whenStable();

      expect(
        repository.calls.some((call: string): boolean => call.startsWith('discardFiles')),
      ).toBe(false);
    });

    it('discardAll_whenConfirmed_discardsTheWholeWorkingTreeInOneCall', async () => {
      confirmAnswer = true;
      repository.staged.set([makeFile('staged.ts', 'modified')]);
      repository.unstaged.set([makeFile('untracked.ts', 'added', true)]);
      fixture.detectChanges();

      tool('Discard All').click();
      await fixture.whenStable();

      // Tracked first, untracked after, and one call rather than one per file.
      expect(repository.calls).toContain('discardFiles:staged.ts,untracked.ts');
    });

    it('discardAll_ignoresTheCommitCheckboxes_actingOnTheWholeWorkingTree', async () => {
      confirmAnswer = true;
      repository.staged.set([makeFile('kept.ts', 'modified')]);
      repository.unstaged.set([makeFile('unchecked.ts', 'added', true)]);
      repository.isWorkingSelected.set(true);
      fixture.detectChanges();

      // An untracked file defaults to UNCHECKED, so it would be excluded from a commit — but
      // discarding is about the working tree, not about what the next commit contains.
      tool('Discard All').click();
      await fixture.whenStable();

      expect(repository.calls).toContain('discardFiles:kept.ts,unchecked.ts');
    });
  });
});
