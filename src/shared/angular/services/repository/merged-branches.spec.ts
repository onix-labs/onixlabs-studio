import { describe, expect, it } from 'vitest';
import type { HostedPullRequest } from '@shared/api/hosting-protocol';
import type { MergedBranch } from './merged-branch';
import { mergedBranches } from './merged-branches';
import type { GitBranch, GitRemote } from './repository-data';

/**
 * Builds a local branch.
 * @param name The branch's name.
 * @param overrides The fields to change.
 * @returns Returns the branch.
 */
function branch(name: string, overrides: Partial<GitBranch> = {}): GitBranch {
  return { name, current: false, ahead: 0, behind: 0, tip: `${name}-tip`, ...overrides };
}

/**
 * Builds a merged pull request for a branch, at the branch's tip.
 * @param headRef The branch it was opened from.
 * @param number The pull request's number.
 * @returns Returns the pull request.
 */
function merged(headRef: string, number: number): HostedPullRequest {
  return {
    number,
    title: headRef,
    author: 'matthew',
    url: 'u',
    draft: false,
    state: 'merged',
    headRef,
    headSha: `${headRef}-tip`,
    fetchRef: `refs/pull/${number}/head`,
    checks: 'none',
  };
}

/**
 * Builds the `origin` remote with remote-tracking branches.
 * @param names The branches' names on the remote.
 * @returns Returns the remote.
 */
function origin(...names: string[]): GitRemote {
  return {
    name: 'origin',
    url: 'u',
    branches: names.map((name: string) => ({ name: `origin/${name}`, commit: `${name}-tip` })),
  };
}

/**
 * Names the offered branches.
 * @param offered The offered branches.
 * @returns Returns their names.
 */
function names(offered: readonly MergedBranch[]): readonly string[] {
  return offered.map((candidate: MergedBranch): string => candidate.name);
}

describe('mergedBranches (#887)', () => {
  it('offersBranchesMergedByAncestry_andThroughAPullRequest', () => {
    const offered: readonly MergedBranch[] = mergedBranches(
      [branch('main'), branch('done', { mergedInto: 'main' }), branch('squashed'), branch('wip')],
      [merged('squashed', 12)],
      [],
      'main',
    );

    expect(offered).toEqual([
      { name: 'done', merge: { kind: 'local', into: 'main' } },
      { name: 'squashed', merge: { kind: 'pull-request', number: 12 } },
    ]);
  });

  it('neverOffersTheCheckedOutBranch', () => {
    const offered: readonly MergedBranch[] = mergedBranches(
      [branch('main'), branch('done', { mergedInto: 'main', current: true })],
      [],
      [],
      'main',
    );

    expect(offered).toEqual([]);
  });

  it('neverOffersTheDefaultBranch_evenWhenAPullRequestWasMergedFromIt', () => {
    // A pull request from a fork's main is merged from a branch called main.
    const offered: readonly MergedBranch[] = mergedBranches(
      [branch('trunk'), branch('topic', { mergedInto: 'trunk' })],
      [merged('trunk', 3)],
      [],
      'trunk',
    );

    expect(names(offered)).toEqual(['topic']);
  });

  it('withoutADefaultBranchNamed_protectsWhatOthersAreMergedInto_andMainAndMaster', () => {
    const offered: readonly MergedBranch[] = mergedBranches(
      [
        branch('develop'),
        branch('main'),
        branch('master'),
        branch('topic', { mergedInto: 'develop' }),
      ],
      [merged('develop', 1), merged('main', 2), merged('master', 3)],
      [],
      undefined,
    );

    expect(names(offered)).toEqual(['topic']);
  });

  it('offersTheUpstream_onlyWhileTheRemoteStillHasIt', () => {
    const offered: readonly MergedBranch[] = mergedBranches(
      [
        branch('kept', { mergedInto: 'main', upstream: 'origin/kept' }),
        branch('gone', { mergedInto: 'main', upstream: 'origin/gone', upstreamGone: true }),
        branch('pruned', { mergedInto: 'main', upstream: 'origin/pruned' }),
        branch('untracked', { mergedInto: 'main' }),
      ],
      [],
      [origin('main', 'kept', 'gone')],
      'main',
    );

    expect(offered.map((candidate: MergedBranch) => candidate.remoteBranch)).toEqual([
      { remote: 'origin', name: 'kept', expected: 'kept-tip' },
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('neverOffersTheRemotesDefaultBranch_whenALocalBranchTracksIt', () => {
    const offered: readonly MergedBranch[] = mergedBranches(
      [branch('old-main', { mergedInto: 'main', upstream: 'origin/main' })],
      [],
      [origin('main')],
      'main',
    );

    expect(offered).toEqual([{ name: 'old-main', merge: { kind: 'local', into: 'main' } }]);
  });

  it('readsTheUpstreamAgainstTheLongestRemoteName', () => {
    const offered: readonly MergedBranch[] = mergedBranches(
      [branch('x', { mergedInto: 'main', upstream: 'team/core/x' })],
      [],
      [
        { name: 'team', url: 'u', branches: [] },
        { name: 'team/core', url: 'u', branches: [{ name: 'team/core/x', commit: 'x-tip' }] },
      ],
      'main',
    );

    expect(offered[0]?.remoteBranch).toEqual({ remote: 'team/core', name: 'x', expected: 'x-tip' });
  });

  it('neverOffersAnUpstreamWithCommitsBeyondTheLocalTip', () => {
    // ⛔ Someone pushed to origin/feature after the merge: deleting it there would lose their work.
    const offered: readonly MergedBranch[] = mergedBranches(
      [branch('feature', { mergedInto: 'main', upstream: 'origin/feature' })],
      [],
      [
        {
          name: 'origin',
          url: 'u',
          branches: [{ name: 'origin/feature', commit: 'pushed-later' }],
        },
      ],
      'main',
    );

    expect(offered).toEqual([{ name: 'feature', merge: { kind: 'local', into: 'main' } }]);
  });

  it('offersAnUpstreamAheadOfTheLocalTip_whenItIsItselfMerged', () => {
    const offered: readonly MergedBranch[] = mergedBranches(
      [branch('feature', { mergedInto: 'main', upstream: 'origin/feature' })],
      [],
      [
        {
          name: 'origin',
          url: 'u',
          branches: [{ name: 'origin/feature', commit: 'later', mergedInto: 'main' }],
        },
      ],
      'main',
    );

    expect(offered[0]?.remoteBranch).toEqual({
      remote: 'origin',
      name: 'feature',
      expected: 'later',
    });
  });

  it('neverOffersABranchCheckedOutInAnotherWorktree', () => {
    const offered: readonly MergedBranch[] = mergedBranches(
      [
        branch('main'),
        branch('elsewhere', { mergedInto: 'main', otherWorktree: '/work/other' }),
        branch('done', { mergedInto: 'main' }),
      ],
      [],
      [],
      'main',
    );

    expect(names(offered)).toEqual(['done']);
  });

  it('neverOffersARemotesOwnDefaultBranch_inAFork', () => {
    // origin's default is main; upstream's is develop, which a local branch happens to track.
    const offered: readonly MergedBranch[] = mergedBranches(
      [branch('develop', { mergedInto: 'main', upstream: 'upstream/develop' })],
      [],
      [
        origin('main'),
        {
          name: 'upstream',
          url: 'u',
          defaultBranch: 'develop',
          branches: [{ name: 'upstream/develop', commit: 'develop-tip' }],
        },
      ],
      'main',
    );

    expect(offered).toEqual([{ name: 'develop', merge: { kind: 'local', into: 'main' } }]);
  });

  it('withARemotesDefaultUnknown_protectsMainAndMasterThere', () => {
    const offered: readonly MergedBranch[] = mergedBranches(
      [branch('master', { mergedInto: 'trunk', upstream: 'upstream/master' })],
      [],
      [
        {
          name: 'upstream',
          url: 'u',
          branches: [{ name: 'upstream/master', commit: 'master-tip' }],
        },
      ],
      'trunk',
    );

    expect(offered[0]?.remoteBranch).toBeUndefined();
  });
});
