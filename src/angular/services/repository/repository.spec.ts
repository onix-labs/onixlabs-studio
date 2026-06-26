import { TestBed } from '@angular/core/testing';
import { Repository, WORKING_NODE_ID } from './repository';
import { GraphNode } from './repository-data';

describe('Repository', () => {
  let repository: Repository;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    repository = TestBed.inject(Repository);
  });

  it('graph_whenWorkingTreeDirty_prependsWorkingNode', () => {
    const graph: readonly GraphNode[] = repository.graph();

    expect(graph[0].kind).toBe('working');
    expect(graph[0].id).toBe(WORKING_NODE_ID);
    expect(graph.filter((node: GraphNode): boolean => node.kind === 'commit').length).toBe(
      repository.commits().length,
    );
  });

  it('graph_whenFeatureBranchPresent_assignsMoreThanOneLane', () => {
    const maxLane: number = repository
      .graph()
      .reduce((max: number, node: GraphNode): number => Math.max(max, node.lane), 0);

    expect(maxLane).toBeGreaterThan(0);
  });

  it('selectedFile_byDefault_isFirstWorkingChange', () => {
    expect(repository.isWorkingSelected()).toBe(true);
    expect(repository.selectedFile()?.path).toBe(repository.staged()[0].path);
  });

  it('selectNode_whenCommitSelected_exposesItsFiles', () => {
    const commitHash: string = repository.commits()[0].hash;

    repository.selectNode(commitHash);

    expect(repository.selectedCommit()?.hash).toBe(commitHash);
    expect(repository.selectedFiles()).toEqual(repository.commits()[0].files);
  });

  it('commit_whenChangesStaged_addsCommitAndClearsStaging', () => {
    repository.stageAll();
    const before: number = repository.commits().length;

    repository.commit('Test commit');

    expect(repository.commits().length).toBe(before + 1);
    expect(repository.commits()[0].summary).toBe('Test commit');
    expect(repository.staged().length).toBe(0);
    expect(repository.unstaged().length).toBe(0);
  });

  it('stash_whenWorkingTreeDirty_movesChangesIntoNewStash', () => {
    const stashesBefore: number = repository.stashes().length;

    repository.stash();

    expect(repository.stashes().length).toBe(stashesBefore + 1);
    expect(repository.changeCount()).toBe(0);
  });

  it('push_whenBranchAhead_clearsAheadCount', () => {
    expect(repository.currentBranch()?.ahead).toBeGreaterThan(0);

    repository.push();

    expect(repository.currentBranch()?.ahead).toBe(0);
  });
});
