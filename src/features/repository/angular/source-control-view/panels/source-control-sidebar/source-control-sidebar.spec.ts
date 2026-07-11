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

  public getStatus(): Promise<ParsedStatus> {
    return Promise.resolve({
      branch: 'main',
      upstream: 'origin/main',
      ahead: 1,
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
        { name: 'main', current: true, upstream: 'origin/main', ahead: 1, behind: 0, tip: 'c2' },
        { name: 'develop', current: false, upstream: undefined, ahead: 0, behind: 2, tip: 'c1' },
      ],
      remotes: [{ name: 'origin', url: '', branches: ['main', 'develop'] }],
      tags: [{ name: 'v1.0.0', commit: 'c1' }],
    });
  }

  public getStashes(): Promise<GitStash[]> {
    return Promise.resolve([]);
  }

  public getCommitFiles(): Promise<GitFileChange[]> {
    return Promise.resolve([]);
  }

  public getFileDiff(): Promise<FileDiff> {
    return Promise.resolve({ original: '', modified: '' });
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

  public checkout(branch: string): Promise<MutationResult> {
    this.calls.push(`checkout:${branch}`);
    return Promise.resolve({ success: true });
  }

  public createBranch(): Promise<MutationResult> {
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

  it('selectWorking_whenWorkingEntryClicked_selectsTheWorkingNode', () => {
    repository.selectNode('c2');
    fixture.detectChanges();

    const working: HTMLButtonElement | null = (fixture.nativeElement as HTMLElement).querySelector(
      '.rail__working',
    );
    working?.click();

    expect(repository.selectedNodeId()).toBe(WORKING_NODE_ID);
  });

  it('checkout_whenBranchActionClicked_checksOutTheBranch', () => {
    const action: HTMLButtonElement | null = (fixture.nativeElement as HTMLElement).querySelector(
      '.rail__item-action',
    );

    expect(action).not.toBeNull();

    action?.click();

    expect(provider.calls).toContain('checkout:develop');
  });
});
