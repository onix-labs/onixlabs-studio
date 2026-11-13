import { describe, expect, it } from 'vitest';
import type { HostedPullRequest } from '@shared/api/hosting-protocol';
import { branchMerge, describeBranchMerge } from './branch-merge';
import type { GitBranch } from './repository-data';

/**
 * Builds a local branch.
 * @param overrides The fields to change.
 * @returns Returns the branch.
 */
function branch(overrides: Partial<GitBranch> = {}): GitBranch {
  return { name: 'feat/login', current: false, ahead: 0, behind: 0, tip: 'aaa111', ...overrides };
}

/**
 * Builds a pull request.
 * @param overrides The fields to change.
 * @returns Returns the pull request.
 */
function pull(overrides: Partial<HostedPullRequest> = {}): HostedPullRequest {
  return {
    number: 885,
    title: 'Login',
    author: 'matthew',
    url: 'u',
    draft: false,
    state: 'merged',
    headRef: 'feat/login',
    headSha: 'aaa111',
    fetchRef: 'refs/pull/885/head',
    checks: 'none',
    ...overrides,
  };
}

describe('branchMerge (#887)', () => {
  it('findsAMergeByAncestry_first', () => {
    expect(branchMerge(branch({ mergedInto: 'main' }), [pull()])).toEqual({
      kind: 'local',
      into: 'main',
    });
  });

  it('findsASquashMerge_throughThePullRequestThatMergedThisVeryCommit', () => {
    expect(branchMerge(branch(), [pull({ number: 12, headRef: 'other' }), pull()])).toEqual({
      kind: 'pull-request',
      number: 885,
    });
  });

  it('doesNotMarkABranchWithCommitsAfterItsPullRequestMerged', () => {
    // ⛔ Those commits are nowhere else: deleting the branch would lose them.
    expect(branchMerge(branch({ tip: 'bbb222' }), [pull()])).toBeNull();
  });

  it.each([
    ['still open', { state: 'open' as const }],
    ['closed without merging', { state: 'closed' as const }],
    ['from a plugin that does not say which commit it merged', { headSha: undefined }],
  ])('doesNotMark_forAPullRequest %s', (_label: string, overrides: Partial<HostedPullRequest>) => {
    expect(branchMerge(branch(), [pull(overrides)])).toBeNull();
  });

  it('marksNothing_withNeitherSignal', () => {
    expect(branchMerge(branch(), [])).toBeNull();
  });

  it('describesWhereTheWorkWent', () => {
    expect(describeBranchMerge({ kind: 'local', into: 'main' })).toBe(
      'Merged locally: everything on it is already in main',
    );
    expect(describeBranchMerge({ kind: 'pull-request', number: 885 })).toBe(
      'Merged via pull request #885',
    );
  });
});
