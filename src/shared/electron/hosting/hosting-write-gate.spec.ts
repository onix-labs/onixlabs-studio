import { describe, expect, it } from 'vitest';
import {
  hostingAgentToolName,
  hostingOpToolName,
  hostingWriteDecision,
  describeHostingWrite,
} from './hosting-write-gate';

describe('hostingWriteDecision', () => {
  it('asks_underPrompt', () => {
    expect(hostingWriteDecision('hosting_rerun_ci_run', 'prompt', {})).toBe('ask');
  });

  it('asks_underAutoEdits_becauseAWriteToAHostIsNotAFileEdit', () => {
    expect(hostingWriteDecision('hosting_rerun_ci_run', 'auto-edits', {})).toBe('ask');
  });

  it('allows_underAutoAll', () => {
    expect(hostingWriteDecision('hosting_rerun_ci_run', 'auto-all', {})).toBe('allow');
  });

  it('letsAnExplicitPolicyWin_overThePosture', () => {
    expect(
      hostingWriteDecision('hosting_rerun_ci_run', 'auto-all', { hosting_rerun_ci_run: 'deny' }),
    ).toBe('deny');
    expect(
      hostingWriteDecision('hosting_rerun_ci_run', 'prompt', { hosting_rerun_ci_run: 'allow' }),
    ).toBe('allow');
  });

  it('ignoresAPolicyForAnotherTool', () => {
    expect(
      hostingWriteDecision('hosting_cancel_ci_run', 'prompt', { hosting_rerun_ci_run: 'allow' }),
    ).toBe('ask');
  });
});

describe('tool names', () => {
  it('namesATypedWrite_andAPluginsToolSoTwoPluginsToolsAreToldApart', () => {
    expect(hostingOpToolName('rerunCiRun')).toBe('hosting_rerun_ci_run');
    expect(hostingAgentToolName('onixlabs.github', 'create_release')).toBe(
      'hosting:onixlabs.github/create_release',
    );
    expect(hostingAgentToolName('acme.gitlab', 'create_release')).not.toBe(
      hostingAgentToolName('onixlabs.github', 'create_release'),
    );
  });
});

describe('describeHostingWrite', () => {
  const repository: { host: string; owner: string; name: string } = {
    host: 'github.com',
    owner: 'onix-labs',
    name: 'studio',
  };

  it('saysWhatEachWriteDoes_inTheUsersTerms', () => {
    // The prompt shows *this* issue in *this* repository, not an operation's name.
    expect(describeHostingWrite('GitHub', 'createIssue', { repository, title: 'Fix login' })).toBe(
      'GitHub: open an issue “Fix login” in onix-labs/studio',
    );
    expect(
      describeHostingWrite('GitHub', 'commentOnIssue', { repository, issue: 12, body: 'x' }),
    ).toBe('GitHub: comment on #12 in onix-labs/studio');
    expect(
      describeHostingWrite('GitHub', 'setIssueState', { repository, issue: 12, state: 'closed' }),
    ).toBe('GitHub: close #12 in onix-labs/studio');
    expect(
      describeHostingWrite('GitHub', 'setIssueState', { repository, issue: 12, state: 'open' }),
    ).toBe('GitHub: reopen #12 in onix-labs/studio');
    expect(
      describeHostingWrite('GitHub', 'createPullRequest', {
        repository,
        title: 'Add bus',
        head: 'feat/bus',
        base: 'main',
      }),
    ).toBe('GitHub: open a pull request “Add bus” from feat/bus into main in onix-labs/studio');
    expect(describeHostingWrite('GitHub', 'rerunCiRun', { repository, runId: '42' })).toBe(
      'GitHub: re-run CI run 42 in onix-labs/studio',
    );
    expect(
      describeHostingWrite('GitHub', 'createRepository', {
        host: 'github.com',
        account: 'onix-labs',
        name: 'new',
        private: true,
      }),
    ).toBe('GitHub: create the private repository onix-labs/new');
  });

  it('saysWhatAnEditChanges_soTheUserApprovesTheseLabelsOnThisIssue', () => {
    // #1156: "edit #12" alone would ask the user to approve something they cannot see.
    expect(
      describeHostingWrite('GitHub', 'updateIssue', {
        repository,
        issue: 12,
        title: 'Fix sign-in',
        body: 'x',
        addLabels: ['epic', 'area:agent'],
        removeLabels: ['bug'],
        addAssignees: ['octocat'],
        milestone: null,
      }),
    ).toBe(
      'GitHub: edit #12 in onix-labs/studio (title “Fix sign-in”; body; add labels epic, area:agent; remove labels bug; assign octocat; clear the milestone)',
    );
    expect(
      describeHostingWrite('GitHub', 'addSubIssue', { repository, issue: 1, subIssue: 12 }),
    ).toBe('GitHub: make #12 a sub-issue of #1 in onix-labs/studio');
    expect(
      describeHostingWrite('GitHub', 'removeSubIssue', { repository, issue: 1, subIssue: 12 }),
    ).toBe('GitHub: take sub-issue #12 off #1 in onix-labs/studio');
    expect(
      describeHostingWrite('GitHub', 'updatePullRequest', {
        repository,
        pullRequest: 7,
        base: 'release',
        draft: false,
      }),
    ).toBe(
      'GitHub: edit pull request #7 in onix-labs/studio (merge into release; mark ready for review)',
    );
    expect(describeHostingWrite('GitHub', 'updateIssue', { repository, issue: 12 })).toBe(
      'GitHub: edit #12 in onix-labs/studio (no changes)',
    );
  });

  it('copesWithMalformedParameters_ratherThanThrowing', () => {
    expect(describeHostingWrite('GitHub', 'createIssue', null)).toBe('GitHub: open an issue “?”');
  });
});
