import { TestBed } from '@angular/core/testing';
import { ParsedRefs, ParsedStatus } from '../source-control/git-output';
import {
  FileDiff,
  MutationResult,
  SourceControlProvider,
} from '../source-control/source-control-provider';
import { SourceControlProviders } from '../source-control/source-control-providers';
import { Repository, WORKING_NODE_ID } from './repository';
import { GitCommit, GitFileChange, GitStash, GraphNode } from './repository-data';

/**
 * Builds a file change with a working-tree target.
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
 * A canned provider whose data the repository tests load and select against.
 */
class FakeProvider implements SourceControlProvider {
  public constructor(public readonly root: string) {}

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

  /**
   * Holds the current branch's upstream returned by {@link getRefs}; undefined means no upstream.
   */
  public upstream: string | undefined = undefined;

  /**
   * Holds the remotes returned by {@link getRefs}.
   */
  public remoteNames: readonly string[] = [];

  public getRefs(): Promise<ParsedRefs> {
    return Promise.resolve({
      branches: [
        { name: 'main', current: true, upstream: this.upstream, ahead: 1, behind: 0, tip: 'c2' },
      ],
      remotes: this.remoteNames.map((name: string) => ({ name, url: '', branches: [] })),
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
    return Promise.resolve({ original: 'before', modified: 'after' });
  }

  public readonly calls: string[] = [];

  public stage(paths: readonly string[]): Promise<MutationResult> {
    this.calls.push(`stage:${paths.join(',')}`);
    return Promise.resolve({ success: true });
  }

  public unstage(paths: readonly string[]): Promise<MutationResult> {
    this.calls.push(`unstage:${paths.join(',')}`);
    return Promise.resolve({ success: true });
  }

  public commit(message: string): Promise<MutationResult> {
    this.calls.push(`commit:${message}`);
    return Promise.resolve({ success: true });
  }

  public stash(): Promise<MutationResult> {
    this.calls.push('stash');
    return Promise.resolve({ success: true });
  }

  public checkout(branch: string): Promise<MutationResult> {
    this.calls.push(`checkout:${branch}`);
    return Promise.resolve({ success: true });
  }

  public createBranch(name: string): Promise<MutationResult> {
    this.calls.push(`createBranch:${name}`);
    return Promise.resolve({ success: true });
  }

  public fetch(): Promise<MutationResult> {
    this.calls.push('fetch');
    return Promise.resolve({ success: true });
  }

  public pull(): Promise<MutationResult> {
    this.calls.push('pull');
    return Promise.resolve({ success: true });
  }

  public push(setUpstream?: {
    readonly remote: string;
    readonly branch: string;
  }): Promise<MutationResult> {
    this.calls.push(`push:${setUpstream?.remote ?? ''}/${setUpstream?.branch ?? ''}`);
    return Promise.resolve({ success: true });
  }

  public close(): Promise<void> {
    return Promise.resolve();
  }
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

describe('Repository', () => {
  let repository: Repository;
  let provider: FakeProvider;

  beforeEach(async () => {
    TestBed.configureTestingModule({
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
    });
    repository = TestBed.inject(Repository);
    repository.bind({ root: '/repo', name: 'repo' });
    await repository.refresh();
  });

  it('bind_thenRefresh_loadsBranchesCommitsStatusAndName', () => {
    expect(repository.isBound()).toBe(true);
    expect(repository.repoName()).toBe('repo');
    expect(repository.commits().length).toBe(2);
    expect(repository.currentBranch()?.name).toBe('main');
    expect(repository.changeCount()).toBe(2);
  });

  it('selectedFiles_whenWorkingSelected_areStagedThenUnstaged', () => {
    expect(repository.isWorkingSelected()).toBe(true);
    expect(repository.selectedFiles().map((file: GitFileChange): string => file.path)).toEqual([
      'staged.ts',
      'unstaged.ts',
    ]);
  });

  it('selectNode_whenCommitSelected_lazilyLoadsItsFiles', async () => {
    repository.selectNode('c2');
    await Promise.resolve();
    await Promise.resolve();

    expect(repository.selectedCommit()?.hash).toBe('c2');
    expect(repository.selectedFiles().map((file: GitFileChange): string => file.path)).toEqual([
      'c2.ts',
    ]);
  });

  it('graph_whenWorkingTreeDirty_prependsWorkingNode', () => {
    const graph: readonly GraphNode[] = repository.graph();

    expect(graph[0].kind).toBe('working');
    expect(graph[0].id).toBe(WORKING_NODE_ID);
  });

  it('loadDiff_returnsTheProvidersDiff', async () => {
    const diff: FileDiff = await repository.loadDiff(workingFile('staged.ts'));

    expect(diff).toEqual({ original: 'before', modified: 'after' });
  });

  it('stageAll_callsTheProviderWithNoPaths', async () => {
    await repository.stageAll();

    expect(provider.calls).toContain('stage:');
  });

  it('commit_usesTheDraftMessageThenClearsItOnSuccess', async () => {
    repository.setCommitMessage('Add feature');

    const result: MutationResult = await repository.commit();

    expect(result.success).toBe(true);
    expect(provider.calls).toContain('commit:Add feature');
    expect(repository.commitMessage()).toBe('');
  });

  it('close_clearsTheRepository', async () => {
    await repository.close();

    expect(repository.isBound()).toBe(false);
    expect(repository.commits().length).toBe(0);
    expect(repository.changeCount()).toBe(0);
  });

  it('push_whenCurrentBranchHasUpstream_pushesWithoutSettingUpstream', async () => {
    provider.upstream = 'origin/main';
    await repository.refresh();

    await repository.push();

    expect(provider.calls).toContain('push:/');
  });

  it('push_whenCurrentBranchHasNoUpstream_setsUpstreamToTheFirstRemote', async () => {
    provider.upstream = undefined;
    provider.remoteNames = ['upstream', 'origin'];
    await repository.refresh();

    await repository.push();

    expect(provider.calls).toContain('push:upstream/main');
  });

  it('push_whenNoUpstreamAndNoRemotes_defaultsTheUpstreamToOrigin', async () => {
    provider.upstream = undefined;
    provider.remoteNames = [];
    await repository.refresh();

    await repository.push();

    expect(provider.calls).toContain('push:origin/main');
  });
});
