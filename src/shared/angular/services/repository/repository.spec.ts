import { TestBed } from '@angular/core/testing';
import { Notification, Notifications } from '@shared/angular/services/notifications/notifications';
import { ParsedRefs, ParsedStatus } from '../source-control/git-output';
import {
  FileDiff,
  MutationResult,
  PushTarget,
  SourceControlProvider,
} from '../source-control/source-control-provider';
import { SourceControlProviders } from '../source-control/source-control-providers';
import { Repository, WORKING_NODE_ID } from './repository';
import { GitBranch, GitCommit, GitFileChange, GitStash, GraphNode } from './repository-data';

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

  /**
   * Holds what {@link fetchRef} resolves to, so a failed fetch can be driven from a test.
   */
  public fetchRefResult: MutationResult = { success: true };

  /**
   * Makes the next discard fail with this message, so error surfacing can be exercised.
   */
  public failNextDiscardWith: string | null = null;

  public discard(paths: readonly string[]): Promise<MutationResult> {
    this.calls.push(`discard:${paths.join(',')}`);
    if (this.failNextDiscardWith !== null) {
      const error: string = this.failNextDiscardWith;
      this.failNextDiscardWith = null;
      return Promise.resolve({ success: false, error });
    }
    return Promise.resolve({ success: true });
  }

  /**
   * Makes the next stage fail with this message, so the selective-commit abort path can be exercised.
   */
  public failNextStageWith: string | null = null;

  public stage(paths: readonly string[]): Promise<MutationResult> {
    this.calls.push(`stage:${paths.join(',')}`);
    if (this.failNextStageWith !== null) {
      const error: string = this.failNextStageWith;
      this.failNextStageWith = null;
      return Promise.resolve({ success: false, error });
    }
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
    this.calls.push('fetch');
    return Promise.resolve({ success: true });
  }

  public fetchRef(remote: string, sourceRef: string, localBranch: string): Promise<MutationResult> {
    this.calls.push(`fetchRef:${remote}:${sourceRef}:${localBranch}`);
    return Promise.resolve(this.fetchRefResult);
  }

  /**
   * Makes the next pull fail with this message, so the sync abort path can be exercised.
   */
  public failNextPullWith: string | null = null;

  public pull(): Promise<MutationResult> {
    this.calls.push('pull');
    if (this.failNextPullWith !== null) {
      const error: string = this.failNextPullWith;
      this.failNextPullWith = null;
      return Promise.resolve({ success: false, error });
    }
    return Promise.resolve({ success: true });
  }

  /**
   * Makes the next push fail with this message, so failure toasts can be exercised.
   */
  public failNextPushWith: string | null = null;

  public push(target?: PushTarget): Promise<MutationResult> {
    this.calls.push(
      `push:${target?.remote ?? ''}/${target?.branch ?? ''}:${String(target?.setUpstream ?? '')}`,
    );
    if (this.failNextPushWith !== null) {
      const error: string = this.failNextPushWith;
      this.failNextPushWith = null;
      return Promise.resolve({ success: false, error });
    }
    return Promise.resolve({ success: true });
  }

  /**
   * Makes the next tag push fail with this message, so failure toasts can be exercised.
   */
  public failNextTagPushWith: string | null = null;

  public createTag(name: string, commit: string, message?: string): Promise<MutationResult> {
    this.calls.push(`createTag:${name}@${commit}:${message ?? ''}`);
    return Promise.resolve({ success: true });
  }

  public deleteTag(name: string): Promise<MutationResult> {
    this.calls.push(`deleteTag:${name}`);
    return Promise.resolve({ success: true });
  }

  /**
   * Makes the next remote tag delete fail with this message, so the abort path can be exercised.
   */
  public failNextRemoteTagDeleteWith: string | null = null;

  public deleteRemoteTag(remote: string, name: string): Promise<MutationResult> {
    this.calls.push(`deleteRemoteTag:${remote}:${name}`);
    if (this.failNextRemoteTagDeleteWith !== null) {
      const error: string = this.failNextRemoteTagDeleteWith;
      this.failNextRemoteTagDeleteWith = null;
      return Promise.resolve({ success: false, error });
    }
    return Promise.resolve({ success: true });
  }

  public pushTag(remote: string, name: string): Promise<MutationResult> {
    this.calls.push(`pushTag:${remote}:${name}`);
    return this.tagPushOutcome();
  }

  public pushAllTags(remote: string): Promise<MutationResult> {
    this.calls.push(`pushAllTags:${remote}`);
    return this.tagPushOutcome();
  }

  /**
   * Resolves a tag push, consuming a queued failure when one is set.
   * @returns Returns the outcome.
   */
  private tagPushOutcome(): Promise<MutationResult> {
    if (this.failNextTagPushWith !== null) {
      const error: string = this.failNextTagPushWith;
      this.failNextTagPushWith = null;
      return Promise.resolve({ success: false, error });
    }
    return Promise.resolve({ success: true });
  }

  public fetchRemote(remote: string): Promise<MutationResult> {
    this.calls.push(`fetchRemote:${remote}`);
    return Promise.resolve({ success: true });
  }

  public pruneRemote(remote: string): Promise<MutationResult> {
    this.calls.push(`pruneRemote:${remote}`);
    return Promise.resolve({ success: true });
  }

  public addRemote(name: string, url: string): Promise<MutationResult> {
    this.calls.push(`addRemote:${name}:${url}`);
    return Promise.resolve({ success: true });
  }

  public removeRemote(name: string): Promise<MutationResult> {
    this.calls.push(`removeRemote:${name}`);
    return Promise.resolve({ success: true });
  }

  public checkoutTracking(remoteBranch: string, localBranch: string): Promise<MutationResult> {
    this.calls.push(`checkoutTracking:${remoteBranch}:${localBranch}`);
    return Promise.resolve({ success: true });
  }

  /**
   * Holds what an unforced {@link deleteBranch} resolves to, so the unmerged refusal can be driven.
   */
  public deleteBranchOutcome: Promise<MutationResult> | null = null;

  public deleteBranch(name: string, force: boolean): Promise<MutationResult> {
    this.calls.push(`deleteBranch:${name}:${force}`);
    return this.deleteBranchOutcome ?? Promise.resolve({ success: true });
  }

  public renameBranch(from: string, to: string): Promise<MutationResult> {
    this.calls.push(`renameBranch:${from}:${to}`);
    return Promise.resolve({ success: true });
  }

  public setUpstream(branch: string, upstream: string | null): Promise<MutationResult> {
    this.calls.push(`setUpstream:${branch}:${upstream ?? ''}`);
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
  let notifications: Notifications;

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
    notifications = TestBed.inject(Notifications);
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

  it('discard_callsTheProviderWithTheFilePath', async () => {
    await repository.discard(workingFile('unstaged.ts'));

    expect(provider.calls).toContain('discard:unstaged.ts');
    expect(repository.lastError()).toBeNull();
  });

  it('failedOperation_surfacesLastError_andDismissClears', async () => {
    provider.failNextDiscardWith = 'Authentication required.';

    await repository.discard(workingFile('unstaged.ts'));
    expect(repository.lastError()).toBe('Authentication required.');

    repository.dismissError();
    expect(repository.lastError()).toBeNull();
  });

  it('successfulOperation_clearsAnEarlierError', async () => {
    provider.failNextDiscardWith = 'boom';
    await repository.discard(workingFile('unstaged.ts'));
    expect(repository.lastError()).toBe('boom');

    await repository.discard(workingFile('unstaged.ts'));
    expect(repository.lastError()).toBeNull();
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

    // The branch is named rather than left to HEAD, and its upstream is not re-claimed.
    expect(provider.calls).toContain('push:origin/main:false');
  });

  it('push_whenCurrentBranchHasNoUpstream_setsUpstreamToTheFirstRemote', async () => {
    provider.upstream = undefined;
    provider.remoteNames = ['upstream', 'origin'];
    await repository.refresh();

    await repository.push();

    expect(provider.calls).toContain('push:upstream/main:true');
  });

  it('push_whenNoUpstreamAndNoRemotes_defaultsTheUpstreamToOrigin', async () => {
    provider.upstream = undefined;
    provider.remoteNames = [];
    await repository.refresh();

    await repository.push();

    expect(provider.calls).toContain('push:origin/main:true');
  });

  it('commitFiles_resetsTheIndexStagesExactlyTheGivenFilesAndCommits', async () => {
    repository.setCommitMessage('feat: selected files');
    provider.calls.length = 0;

    const result: MutationResult = await repository.commitFiles(['a.ts', 'new.ts']);

    expect(result.success).toBe(true);
    expect(provider.calls.slice(0, 3)).toEqual([
      'unstage:',
      'stage:a.ts,new.ts',
      'commit:feat: selected files',
    ]);
    expect(repository.commitMessage()).toBe('');
  });

  it('commitFiles_withNoFiles_failsWithoutTouchingTheProvider', async () => {
    provider.calls.length = 0;

    const result: MutationResult = await repository.commitFiles([]);

    expect(result.success).toBe(false);
    expect(provider.calls).toEqual([]);
  });

  it('commitFiles_whenStagingFails_surfacesTheErrorAndSkipsTheCommit', async () => {
    repository.setCommitMessage('feat: will fail');
    provider.failNextStageWith = 'index locked';

    const result: MutationResult = await repository.commitFiles(['a.ts']);

    expect(result.success).toBe(false);
    expect(repository.lastError()).toBe('index locked');
    expect(provider.calls.some((call: string): boolean => call.startsWith('commit:'))).toBe(false);
    expect(repository.commitMessage()).toBe('feat: will fail');
  });

  it('commitAndPushFiles_pushesOnlyAfterASuccessfulCommit', async () => {
    repository.setCommitMessage('feat: ship it');
    provider.calls.length = 0;

    const result: MutationResult = await repository.commitAndPushFiles(['a.ts']);

    expect(result.success).toBe(true);
    const commitIndex: number = provider.calls.findIndex((call: string): boolean =>
      call.startsWith('commit:'),
    );
    const pushIndex: number = provider.calls.findIndex((call: string): boolean =>
      call.startsWith('push:'),
    );
    expect(commitIndex).toBeGreaterThanOrEqual(0);
    expect(pushIndex).toBeGreaterThan(commitIndex);
  });

  it('commitAndPushFiles_whenTheCommitFails_doesNotPush', async () => {
    repository.setCommitMessage('feat: no push');
    provider.failNextStageWith = 'boom';

    const result: MutationResult = await repository.commitAndPushFiles(['a.ts']);

    expect(result.success).toBe(false);
    expect(provider.calls.some((call: string): boolean => call.startsWith('push:'))).toBe(false);
  });

  it('push_whenItSucceeds_raisesASuccessToast', async () => {
    await repository.push();

    const toast: Notification = notifications.toasts()[0];
    expect(toast.severity).toBe('success');
    expect(toast.title).toBe('Pushed main');
    expect(toast.detail).toBe('repo');
  });

  it('push_whenItFails_raisesAStickyErrorToastWithTheDetail', async () => {
    provider.failNextPushWith = 'Authentication required.';

    await repository.push();

    const toast: Notification = notifications.toasts()[0];
    expect(toast.severity).toBe('error');
    expect(toast.sticky).toBe(true);
    expect(toast.title).toBe('Push failed — repo');
    expect(toast.detail).toBe('Authentication required.');
  });

  it('push_whenRetriedAfterAFailure_replacesTheFailureToast', async () => {
    provider.failNextPushWith = 'offline';
    await repository.push();

    await repository.push();

    expect(notifications.toasts().length).toBe(1);
    expect(notifications.toasts()[0].severity).toBe('success');
  });

  it('fetch_whenItSucceeds_raisesAnInfoToast', async () => {
    await repository.fetch();

    const toast: Notification = notifications.toasts()[0];
    expect(toast.severity).toBe('info');
    expect(toast.title).toBe('Fetched all remotes');
  });

  it('commit_whenTheRepositoryHasARemote_raisesAToastOfferingPush', async () => {
    provider.remoteNames = ['origin'];
    await repository.refresh();
    repository.setCommitMessage('feat: toast');

    await repository.commit();

    const toast: Notification = notifications.toasts()[0];
    expect(toast.severity).toBe('success');
    expect(toast.title).toBe('Committed to main');
    expect(toast.actions.map((action): string => action.label)).toEqual(['Push']);
  });

  it('commit_whenTheRepositoryHasNoRemote_raisesAToastWithoutActions', async () => {
    repository.setCommitMessage('feat: no remote');

    await repository.commit();

    expect(notifications.toasts()[0].actions).toEqual([]);
  });

  it('committedToast_whenItsPushActionRuns_pushesTheBranch', async () => {
    provider.remoteNames = ['origin'];
    await repository.refresh();
    repository.setCommitMessage('feat: push me');
    await repository.commit();

    notifications.toasts()[0].actions[0].run();

    expect(provider.calls.some((call: string): boolean => call.startsWith('push:'))).toBe(true);
  });

  it('commitAndPushFiles_raisesOnlyThePushToast', async () => {
    repository.setCommitMessage('feat: combined');

    await repository.commitAndPushFiles(['a.ts']);

    const titles: readonly string[] = notifications
      .toasts()
      .map((toast: Notification): string => toast.title);
    expect(titles).toEqual(['Pushed main']);
  });

  it('applyStash_restoresTheStashAndSelectsTheWorkingTree', async () => {
    repository.selectNode('c2');

    await repository.applyStash(2);

    expect(provider.calls).toContain('applyStash:2');
    // The point of restoring is to work on what came back, so the selection follows it.
    expect(repository.selectedNodeId()).toBe(WORKING_NODE_ID);
  });

  it('popStash_restoresTheStashAndSelectsTheWorkingTree', async () => {
    repository.selectNode('c2');

    await repository.popStash(0);

    expect(provider.calls).toContain('popStash:0');
    expect(repository.selectedNodeId()).toBe(WORKING_NODE_ID);
  });

  it('dropStash_deletesTheStashWithoutMovingTheSelection', async () => {
    repository.selectNode('c2');

    await repository.dropStash(1);

    expect(provider.calls).toContain('dropStash:1');
    // Nothing was restored, so there is no reason to leave the commit the user was reading.
    expect(repository.selectedNodeId()).toBe('c2');
  });

  it('createBranch_checksTheNewBranchOutUnlessToldNotTo', async () => {
    await repository.createBranch('feature/one');
    expect(provider.calls).toContain('createBranch:feature/one:true');

    await repository.createBranch('feature/two', false);
    expect(provider.calls).toContain('createBranch:feature/two:false');
  });

  describe('branch housekeeping', () => {
    it('deleteBranch_defaultsToUnforced', async () => {
      await repository.deleteBranch('develop');

      expect(provider.calls).toContain('deleteBranch:develop:false');
    });

    it('deleteBranch_passesTheFailureCodeThrough_soTheCallerCanOfferToForceIt', async () => {
      provider.deleteBranchOutcome = Promise.resolve({
        success: false,
        error: 'not fully merged',
        code: 'branch-not-merged',
      });

      const result: MutationResult = await repository.deleteBranch('develop');

      expect(result.code).toBe('branch-not-merged');
    });

    it('renameBranch_reachesTheProvider', async () => {
      await repository.renameBranch('develop', 'feature/renamed');

      expect(provider.calls).toContain('renameBranch:develop:feature/renamed');
    });

    it('setUpstream_andClearUpstream_differOnlyInWhatTheyPass', async () => {
      await repository.setUpstream('develop', 'origin/develop');
      await repository.clearUpstream('develop');

      expect(provider.calls).toContain('setUpstream:develop:origin/develop');
      expect(provider.calls).toContain('setUpstream:develop:');
    });
  });

  describe('remotes', () => {
    it('fetchRemote_fetchesOneRatherThanAllOfThem', async () => {
      await repository.fetchRemote('origin');

      expect(provider.calls).toContain('fetchRemote:origin');
      expect(notifications.toasts()[0].title).toBe('Fetched origin');
    });

    it('pruneRemote_dropsBranchesDeletedUpstream', async () => {
      await repository.pruneRemote('origin');

      expect(provider.calls).toContain('pruneRemote:origin');
      expect(notifications.toasts()[0].title).toBe('Pruned origin');
    });

    it('addRemote_andRemoveRemote_reachTheProvider', async () => {
      await repository.addRemote('upstream', 'https://example.com/u.git');
      await repository.removeRemote('upstream');

      expect(provider.calls).toContain('addRemote:upstream:https://example.com/u.git');
      expect(provider.calls).toContain('removeRemote:upstream');
    });

    it('checkoutTracking_createsALocalBranchTrackingTheRemoteOne', async () => {
      await repository.checkoutTracking('origin/release', 'release');

      expect(provider.calls).toContain('checkoutTracking:origin/release:release');
    });

    it('checkoutTracking_whenTheLocalBranchExists_checksItOutInstead', async () => {
      // `main` is the fixture's local branch. Refusing under `-b` would be git's answer, not a useful
      // one — the branch asked for is the branch delivered.
      await repository.checkoutTracking('origin/main', 'main');

      expect(provider.calls).toContain('checkout:main');
      expect(
        provider.calls.some((call: string): boolean => call.startsWith('checkoutTracking:')),
      ).toBe(false);
    });
  });

  describe('branch-named push, pull and sync', () => {
    /**
     * Builds a branch that is not the checked-out one.
     * @param upstream The branch's upstream, or undefined for none.
     * @returns Returns the branch.
     */
    function otherBranch(upstream: string | undefined): GitBranch {
      return { name: 'develop', current: false, upstream, ahead: 0, behind: 2, tip: 'c1' };
    }

    it('pushBranch_namesTheBranch_soOneThatIsNotCheckedOutCanBePushed', async () => {
      provider.remoteNames = ['origin'];
      await repository.refresh();

      await repository.pushBranch(otherBranch('origin/develop'));

      expect(provider.calls).toContain('push:origin/develop:false');
    });

    it('pushBranch_whenTheBranchHasNoUpstream_claimsOne', async () => {
      provider.remoteNames = ['origin'];
      await repository.refresh();

      await repository.pushBranch(otherBranch(undefined));

      expect(provider.calls).toContain('push:origin/develop:true');
    });

    it('pushBranch_namesTheBranchInItsToast_notWhicheverIsCheckedOut', async () => {
      await repository.pushBranch(otherBranch('origin/develop'));

      expect(notifications.toasts()[0].title).toBe('Pushed develop');
    });

    it('pullBranch_offTheWorkingTree_fastForwardsFromTheUpstreamInsteadOfMerging', async () => {
      provider.remoteNames = ['origin'];
      await repository.refresh();

      await repository.pullBranch(otherBranch('origin/develop'));

      // A merge needs a working tree, which a branch that is not checked out does not have.
      expect(provider.calls).toContain('fetchRef:origin:develop:develop');
      expect(provider.calls).not.toContain('pull');
    });

    it('pullBranch_forTheCheckedOutBranch_pullsProperly', async () => {
      await repository.pullBranch({
        name: 'main',
        current: true,
        upstream: 'origin/main',
        ahead: 0,
        behind: 1,
        tip: 'c2',
      });

      expect(provider.calls).toContain('pull');
    });

    it('pullBranch_whenTheBranchHasNoUpstream_saysSoRatherThanGuessing', async () => {
      const result: MutationResult = await repository.pullBranch(otherBranch(undefined));

      expect(result.success).toBe(false);
      expect(result.error).toContain('no upstream');
    });

    it('splitsAnUpstreamOnItsRemote_notOnItsFirstSlash', async () => {
      // Branch names contain slashes; only knowing the remotes tells the two apart.
      provider.remoteNames = ['origin'];
      await repository.refresh();

      await repository.pullBranch({
        name: 'feature/thing',
        current: false,
        upstream: 'origin/feature/thing',
        ahead: 0,
        behind: 1,
        tip: 'c1',
      });

      expect(provider.calls).toContain('fetchRef:origin:feature/thing:feature/thing');
    });

    it('syncBranch_fastForwardsThenPushes', async () => {
      provider.remoteNames = ['origin'];
      await repository.refresh();

      await repository.syncBranch(otherBranch('origin/develop'));

      expect(provider.calls.filter((call: string): boolean => call.includes('develop'))).toEqual([
        'fetchRef:origin:develop:develop',
        'push:origin/develop:false',
      ]);
    });

    it('syncBranch_whenTheFastForwardFails_doesNotPush', async () => {
      provider.remoteNames = ['origin'];
      provider.fetchRefResult = { success: false, error: 'Not a fast-forward.' };
      await repository.refresh();

      const result: MutationResult = await repository.syncBranch(otherBranch('origin/develop'));

      expect(result.success).toBe(false);
      expect(provider.calls.some((call: string): boolean => call.startsWith('push:'))).toBe(false);
    });
  });

  describe('sync', () => {
    it('pullsBeforePushing_soThePushIsNotRefusedForBeingBehind', async () => {
      await repository.sync();

      expect(provider.calls.filter((call: string): boolean => call.startsWith('p'))).toEqual([
        'pull',
        'push:origin/main:true',
      ]);
    });

    it('whenThePullFails_stopsThere_ratherThanPublishingAHalfFinishedMerge', async () => {
      provider.failNextPullWith = 'Merge conflict.';

      const result: MutationResult = await repository.sync();

      expect(result.success).toBe(false);
      expect(provider.calls.some((call: string): boolean => call.startsWith('push'))).toBe(false);
    });

    it('whenItSucceeds_raisesOneToastForTheWholeThing', async () => {
      await repository.sync();

      // A sync is one command as far as the user is concerned, so it reports once.
      expect(notifications.toasts().length).toBe(1);
      expect(notifications.toasts()[0].title).toBe('Synced main');
    });

    it('whenThePullFails_reportsItAsTheSyncsFailure', async () => {
      provider.failNextPullWith = 'Merge conflict.';

      await repository.sync();

      const toast: Notification = notifications.toasts()[0];
      expect(toast.severity).toBe('error');
      expect(toast.title).toContain('Sync failed');
      expect(toast.detail).toBe('Merge conflict.');
    });
  });

  describe('tags', () => {
    it('createTag_withNoMessage_createsALightweightTagAtTheCurrentHead', async () => {
      await repository.createTag('v1.0.0');

      expect(provider.calls).toContain('createTag:v1.0.0@HEAD:');
    });

    it('createTag_withAMessage_annotatesItAtTheGivenCommit', async () => {
      await repository.createTag('v1.0.0', 'c2', 'First release');

      expect(provider.calls).toContain('createTag:v1.0.0@c2:First release');
    });

    it('deleteTag_removesItLocally', async () => {
      await repository.deleteTag('v0.9.0');

      expect(provider.calls).toContain('deleteTag:v0.9.0');
    });

    it('deleteTagEverywhere_deletesOnTheRemoteBeforeDeletingLocally', async () => {
      await repository.deleteTagEverywhere('v0.9.0', 'origin');

      // The order is the point: the remote is the step that can fail.
      expect(provider.calls.filter((call: string): boolean => call.includes('Tag'))).toEqual([
        'deleteRemoteTag:origin:v0.9.0',
        'deleteTag:v0.9.0',
      ]);
    });

    it('deleteTagEverywhere_whenTheRemoteRefuses_leavesTheLocalTagAlone', async () => {
      provider.failNextRemoteTagDeleteWith = 'Authentication required.';

      const result: MutationResult = await repository.deleteTagEverywhere('v0.9.0', 'origin');

      // Nothing was lost, so the tag is still there to try again with.
      expect(result.success).toBe(false);
      expect(provider.calls).not.toContain('deleteTag:v0.9.0');
    });

    it('deleteTagEverywhere_whenTheRemoteRefuses_raisesAnErrorToast', async () => {
      provider.failNextRemoteTagDeleteWith = 'Authentication required.';

      await repository.deleteTagEverywhere('v0.9.0', 'origin');

      const toast: Notification = notifications.toasts()[0];
      expect(toast.severity).toBe('error');
      expect(toast.detail).toBe('Authentication required.');
    });

    it('deleteTagEverywhere_whenItSucceeds_namesTheTagAndRemoteInItsToast', async () => {
      await repository.deleteTagEverywhere('v0.9.0', 'origin');

      expect(notifications.toasts()[0].title).toBe('Deleted tag v0.9.0 on origin');
    });

    it('deleteTagEverywhere_whenNoRemoteIsNamed_usesTheFirstConfiguredOne', async () => {
      provider.remoteNames = ['upstream', 'origin'];
      await repository.refresh();

      await repository.deleteTagEverywhere('v0.9.0');

      expect(provider.calls).toContain('deleteRemoteTag:upstream:v0.9.0');
    });

    it('pushTag_whenNoRemoteIsNamed_usesTheFirstConfiguredOne', async () => {
      provider.remoteNames = ['upstream', 'origin'];
      await repository.refresh();

      await repository.pushTag('v1.0.0');

      expect(provider.calls).toContain('pushTag:upstream:v1.0.0');
    });

    it('pushTag_whenARemoteIsNamed_pushesToThatOne', async () => {
      provider.remoteNames = ['upstream', 'origin'];
      await repository.refresh();

      await repository.pushTag('v1.0.0', 'origin');

      expect(provider.calls).toContain('pushTag:origin:v1.0.0');
    });

    it('pushTag_whenTheRepositoryHasNoRemotes_fallsBackToOrigin', async () => {
      await repository.pushTag('v1.0.0');

      expect(provider.calls).toContain('pushTag:origin:v1.0.0');
    });

    it('pushTag_whenItSucceeds_namesTheTagInItsToast', async () => {
      await repository.pushTag('v1.0.0');

      const toast: Notification = notifications.toasts()[0];
      expect(toast.severity).toBe('success');
      expect(toast.title).toBe('Pushed tag v1.0.0');
    });

    it('pushAllTags_whenItSucceeds_saysSoInItsToast', async () => {
      await repository.pushAllTags();

      expect(notifications.toasts()[0].title).toBe('Pushed all tags');
    });

    it('pushTag_whenItFails_raisesAnErrorToastRatherThanFailingSilently', async () => {
      provider.failNextTagPushWith = 'Authentication required.';

      await repository.pushTag('v1.0.0');

      const toast: Notification = notifications.toasts()[0];
      expect(toast.severity).toBe('error');
      expect(toast.detail).toBe('Authentication required.');
    });
  });

  describe('checkoutRef', () => {
    it('fetchesTheRefIntoALocalBranch_thenChecksItOut', async () => {
      await repository.checkoutRef('origin', 'refs/pull/7/head', 'feature/thing');

      expect(provider.calls).toContain('fetchRef:origin:refs/pull/7/head:feature/thing');
      expect(provider.calls).toContain('checkout:feature/thing');
    });

    it('doesNotCheckOut_whenTheFetchFailed', async () => {
      // Checking out after a failed fetch would land on whatever that branch name happened to mean
      // locally, which is not what the user asked for.
      provider.fetchRefResult = { success: false, error: 'no such ref' };

      const result: MutationResult = await repository.checkoutRef(
        'origin',
        'refs/pull/9/head',
        'x',
      );

      expect(result.success).toBe(false);
      expect(provider.calls).not.toContain('checkout:x');
    });
  });
});
