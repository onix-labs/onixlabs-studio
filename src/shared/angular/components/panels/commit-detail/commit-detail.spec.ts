import { computed, signal, Signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Icon } from '@shared/angular/icons/icon';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { DiffOpener } from '@shared/angular/services/diffs/diff-opener';
import { Repository } from '@shared/angular/services/repository/repository';
import {
  GitChangeStatus,
  GitCommit,
  GitFileChange,
} from '@shared/angular/services/repository/repository-data';
import { MutationResult } from '@shared/angular/services/source-control/source-control-provider';
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
 * @returns Returns the file change.
 */
function makeFile(path: string, status: GitChangeStatus): GitFileChange {
  return {
    path,
    status,
    additions: 1,
    deletions: 0,
    language: 'typescript',
    original: 'a',
    modified: 'b',
  };
}

/**
 * A controllable repository model standing in for the shared {@link Repository}, recording the
 * mutations the pane invokes.
 */
class StubRepository {
  public readonly selectedCommit: WritableSignal<GitCommit | null> = signal<GitCommit | null>(null);
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

  public stage(file: GitFileChange): Promise<MutationResult> {
    this.calls.push(`stage:${file.path}`);
    return Promise.resolve({ success: true });
  }

  public unstage(file: GitFileChange): Promise<MutationResult> {
    this.calls.push(`unstage:${file.path}`);
    return Promise.resolve({ success: true });
  }

  public stageAll(): Promise<MutationResult> {
    this.calls.push('stageAll');
    return Promise.resolve({ success: true });
  }

  public unstageAll(): Promise<MutationResult> {
    this.calls.push('unstageAll');
    return Promise.resolve({ success: true });
  }

  public commit(): Promise<MutationResult> {
    this.calls.push('commit');
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

describe('CommitDetail', () => {
  let fixture: ComponentFixture<CommitDetail>;
  let repository: StubRepository;
  let opened: GitFileChange[];
  let host: HTMLElement;

  beforeEach(async () => {
    repository = new StubRepository();
    opened = [];
    await TestBed.configureTestingModule({
      imports: [CommitDetail],
      providers: [
        { provide: Repository, useValue: repository },
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
    expect(host.querySelector('.detail__files-count')?.textContent).toContain('1');
    expect(host.querySelector('.detail__file-name')?.textContent).toContain('main.ts');
    expect(host.querySelector('.detail__file-dir')?.textContent).toContain('src/app');
    expect(host.querySelector('.detail__status')?.textContent?.trim()).toBe('M');
  });

  it('selectFile_whenAChangedFileIsClicked_selectsItAndOpensItsDiff', () => {
    repository.selectedCommit.set(makeCommit('abc1234def', []));
    repository.selectedFiles.set([makeFile('src/app/main.ts', 'modified')]);
    fixture.detectChanges();

    host.querySelector<HTMLButtonElement>('.detail__file-main')!.click();

    expect(repository.calls).toContain('selectFile:src/app/main.ts');
    expect(opened.length).toBe(1);
    expect(opened[0].path).toBe('src/app/main.ts');
  });

  it('render_whenWorkingTreeSelected_showsCommitBoxWithStagedAndUnstagedGroupsAndGatesTheCommit', () => {
    repository.isWorkingSelected.set(true);
    repository.staged.set([makeFile('a.ts', 'added')]);
    repository.unstaged.set([makeFile('b.ts', 'modified')]);
    fixture.detectChanges();

    const headers: (string | null)[] = Array.from(
      host.querySelectorAll('.detail__files-header'),
    ).map((element: Element): string | null => element.textContent);
    expect(headers.join(' ')).toContain('Staged');
    expect(headers.join(' ')).toContain('Changes');

    // With no draft message the commit button is disabled; a message enables it and commits.
    const button: HTMLButtonElement =
      host.querySelector<HTMLButtonElement>('.detail__commit-button')!;
    expect(button.disabled).toBe(true);

    repository.commitMessage.set('feat: add a thing');
    fixture.detectChanges();

    expect(button.disabled).toBe(false);
    button.click();
    expect(repository.calls).toContain('commit');
  });

  it('stageAndUnstage_rowAndGroupActionsDelegateToTheRepository', () => {
    repository.isWorkingSelected.set(true);
    repository.staged.set([makeFile('a.ts', 'added')]);
    repository.unstaged.set([makeFile('b.ts', 'modified')]);
    fixture.detectChanges();

    host.querySelector<HTMLButtonElement>('[aria-label="Stage file"]')!.click();
    host.querySelector<HTMLButtonElement>('[aria-label="Unstage file"]')!.click();
    const groupActions: HTMLButtonElement[] = Array.from(
      host.querySelectorAll<HTMLButtonElement>('.detail__group-action'),
    );
    groupActions.forEach((action: HTMLButtonElement): void => action.click());

    expect(repository.calls).toContain('stage:b.ts');
    expect(repository.calls).toContain('unstage:a.ts');
    expect(repository.calls).toContain('stageAll');
    expect(repository.calls).toContain('unstageAll');
  });

  it('onMessageInput_whenTheUserTypes_forwardsTheDraftMessage', () => {
    repository.isWorkingSelected.set(true);
    fixture.detectChanges();

    const textarea: HTMLTextAreaElement =
      host.querySelector<HTMLTextAreaElement>('.detail__message')!;
    textarea.value = 'wip: draft message';
    textarea.dispatchEvent(new Event('input'));

    expect(repository.calls).toContain('setCommitMessage:wip: draft message');
  });
});
