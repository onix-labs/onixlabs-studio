import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Icon } from '@shared/angular/icons/icon';
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

import { CommitGraph } from './commit-graph';

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
 * A canned provider serving a dirty working tree over a two-commit history.
 */
class FakeProvider implements SourceControlProvider {
  public constructor(public readonly root: string) {}

  public getStatus(): Promise<ParsedStatus> {
    return Promise.resolve({
      branch: 'main',
      upstream: 'origin/main',
      ahead: 0,
      behind: 0,
      staged: [workingFile('staged.ts')],
      unstaged: [workingFile('unstaged.ts')],
    });
  }

  public getCommits(): Promise<GitCommit[]> {
    return Promise.resolve([makeCommit('c2', ['c1']), makeCommit('c1', [])]);
  }

  public getRefs(): Promise<ParsedRefs> {
    return Promise.resolve({
      branches: [
        { name: 'main', current: true, upstream: 'origin/main', ahead: 0, behind: 0, tip: 'c2' },
      ],
      remotes: [],
      tags: [],
    });
  }

  public getStashes(): Promise<GitStash[]> {
    return Promise.resolve([]);
  }

  public getCommitFiles(commit: GitCommit): Promise<GitFileChange[]> {
    return Promise.resolve([
      {
        ...workingFile(`${commit.hash}.ts`),
        target: { kind: 'commit', hash: commit.hash, parent: null },
      },
    ]);
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
    return Promise.resolve({ success: true });
  }

  public applyStash(): Promise<MutationResult> {
    return Promise.resolve({ success: true });
  }

  public popStash(): Promise<MutationResult> {
    return Promise.resolve({ success: true });
  }

  public dropStash(): Promise<MutationResult> {
    return Promise.resolve({ success: true });
  }

  public checkout(): Promise<MutationResult> {
    return Promise.resolve({ success: true });
  }

  public createBranch(): Promise<MutationResult> {
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

  public createTag(): Promise<MutationResult> {
    return Promise.resolve({ success: true });
  }

  public deleteTag(): Promise<MutationResult> {
    return Promise.resolve({ success: true });
  }

  public deleteRemoteTag(): Promise<MutationResult> {
    return Promise.resolve({ success: true });
  }

  public pushTag(): Promise<MutationResult> {
    return Promise.resolve({ success: true });
  }

  public pushAllTags(): Promise<MutationResult> {
    return Promise.resolve({ success: true });
  }

  public fetchRemote(): Promise<MutationResult> {
    return Promise.resolve({ success: true });
  }

  public pruneRemote(): Promise<MutationResult> {
    return Promise.resolve({ success: true });
  }

  public addRemote(): Promise<MutationResult> {
    return Promise.resolve({ success: true });
  }

  public removeRemote(): Promise<MutationResult> {
    return Promise.resolve({ success: true });
  }

  public checkoutTracking(): Promise<MutationResult> {
    return Promise.resolve({ success: true });
  }

  public deleteBranch(): Promise<MutationResult> {
    return Promise.resolve({ success: true });
  }

  public renameBranch(): Promise<MutationResult> {
    return Promise.resolve({ success: true });
  }

  public setUpstream(): Promise<MutationResult> {
    return Promise.resolve({ success: true });
  }

  public close(): Promise<void> {
    return Promise.resolve();
  }
}

describe('CommitGraph', () => {
  let fixture: ComponentFixture<CommitGraph>;
  let repository: Repository;

  const panel: DockPanel = {
    id: 'graph',
    title: 'Commits',
    icon: Icon.SOURCE_CONTROL,
    role: 'document',
    component: CommitGraph,
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CommitGraph],
      providers: [
        Repository,
        {
          provide: SourceControlProviders,
          useValue: {
            create: (root: string): SourceControlProvider => new FakeProvider(root),
          },
        },
      ],
    }).compileComponents();

    repository = TestBed.inject(Repository);
    repository.bind({ root: '/repo', name: 'repo' });
    await repository.refresh();

    fixture = TestBed.createComponent(CommitGraph);
    fixture.componentRef.setInput('panel', panel);
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('render_whenRepositoryLoaded_drawsARowPerCommit', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const rows: NodeListOf<HTMLButtonElement> = element.querySelectorAll('.graph__row');

    expect(rows.length).toBe(2);
    expect(element.textContent).toContain('Commit c2');
    expect(element.textContent).toContain('Commit c1');
  });

  it('render_whenWorkingTreeDirty_addsNoRowOfItsOwn', () => {
    // The uncommitted changes belong to the branch they sit on, and are shown there. The history is
    // history.
    const element: HTMLElement = fixture.nativeElement as HTMLElement;

    expect(repository.changeCount()).toBeGreaterThan(0);
    expect(element.querySelectorAll('.graph__dot').length).toBe(2);
    expect(element.textContent).not.toContain('Uncommitted changes');
  });

  it('render_whenGraphHasParentEdges_drawsAnSvgPathPerEdge', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const edges: NodeListOf<SVGPathElement> = element.querySelectorAll('.graph__edge');

    expect(edges.length).toBeGreaterThan(0);
    for (const edge of Array.from(edges)) {
      expect(edge.getAttribute('d')).toMatch(/^M /);
    }
  });

  it('render_sizesTheCanvasFromTheRowCount', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const svg: SVGSVGElement | null = element.querySelector('.graph__lanes');

    expect(svg?.getAttribute('height')).toBe('112');
  });

  it('select_whenCommitRowClicked_drivesTheRepositorySelection', () => {
    const element: HTMLElement = fixture.nativeElement as HTMLElement;
    const rows: NodeListOf<HTMLButtonElement> = element.querySelectorAll('.graph__row');

    // The working tree is still the default selection; it simply has no row here any more.
    expect(repository.selectedNodeId()).toBe(WORKING_NODE_ID);

    rows[0].click();
    fixture.detectChanges();

    expect(repository.selectedNodeId()).toBe('c2');
    expect(rows[0].classList.contains('graph__row--selected')).toBe(true);
  });
});
