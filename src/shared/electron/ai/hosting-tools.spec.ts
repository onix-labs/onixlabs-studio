import type { ToolSet } from 'ai';
import { describe, expect, it, vi } from 'vitest';
import type {
  HostedIssue,
  HostedRepositoryRef,
  HostingCapability,
  HostingResponse,
} from '@shared/api/hosting-protocol';
import type { AgentHosting, AgentRunContext } from './agent-provider';
import {
  createHostingTools,
  hostingPromptAppendix,
  offeredHostingTools,
  runHostingTool,
} from './hosting-tools';

const REPOSITORY: HostedRepositoryRef = { host: 'github.com', owner: 'onix-labs', name: 'studio' };

/**
 * Builds a run's hosting over a request that answers the same way every time.
 * @param capabilities What the repository allows.
 * @param answer The answer every request gets.
 * @returns Returns the hosting and the request spy.
 */
function hostingOf(
  capabilities: readonly HostingCapability[],
  answer: HostingResponse = { id: 1, ok: true, result: [] },
): { hosting: AgentHosting; request: ReturnType<typeof vi.fn> } {
  const request: ReturnType<typeof vi.fn> = vi.fn(() => Promise.resolve(answer));
  return {
    hosting: {
      pluginId: 'onixlabs.github',
      provider: 'GitHub',
      repository: REPOSITORY,
      capabilities,
      request: request as unknown as AgentHosting['request'],
    },
    request,
  };
}

/**
 * Builds the slice of a run context the hosting tools read.
 * @param hosting The run's hosting, or null for none.
 * @param mode The run's mode.
 * @returns Returns the context.
 */
function contextOf(
  hosting: AgentHosting | null,
  mode: AgentRunContext['mode'] = 'agent',
): AgentRunContext {
  return { hosting, mode } as unknown as AgentRunContext;
}

const EVERYTHING: readonly HostingCapability[] = [
  'pullRequests',
  'createPullRequest',
  'issues',
  'createIssue',
  'commentOnIssue',
  'setIssueState',
  'subIssues',
  'ciRuns',
  'ciRerun',
  'ciCancel',
];

describe('offeredHostingTools', () => {
  it('offersOnlyWhatTheRepositoryAllows', () => {
    const offered: readonly string[] = offeredHostingTools(
      contextOf(hostingOf(['pullRequests', 'ciRuns']).hosting),
    ).map((spec) => spec.op);

    expect(offered).toEqual(['listPullRequests', 'listCiRuns']);
  });

  it('withholdsEveryWrite_inChatMode', () => {
    const offered: readonly string[] = offeredHostingTools(
      contextOf(hostingOf(EVERYTHING).hosting, 'chat'),
    ).map((spec) => spec.op);

    expect(offered).toEqual([
      'listPullRequests',
      'listIssues',
      'listIssueComments',
      'listSubIssues',
      'listCiRuns',
    ]);
  });

  it('offersNothing_withoutAHostedRepository', () => {
    expect(offeredHostingTools(contextOf(null))).toEqual([]);
  });
});

describe('createHostingTools', () => {
  it('namesEachToolAfterItsOperation_asThePolicyAndThePromptKnowIt', async () => {
    const tools: ToolSet = await createHostingTools(contextOf(hostingOf(EVERYTHING).hosting));

    expect(Object.keys(tools)).toEqual([
      'hosting_list_pull_requests',
      'hosting_list_issues',
      'hosting_list_issue_comments',
      'hosting_list_sub_issues',
      'hosting_list_ci_runs',
      'hosting_create_issue',
      'hosting_comment_on_issue',
      'hosting_set_issue_state',
      'hosting_create_pull_request',
      'hosting_rerun_ci_run',
      'hosting_cancel_ci_run',
    ]);
  });

  it('isEmpty_withoutAHostedRepository', async () => {
    expect(await createHostingTools(contextOf(null))).toEqual({});
  });
});

describe('runHostingTool', () => {
  it('sendsTheRunsRepository_withTheToolsInput', async () => {
    const { hosting, request } = hostingOf(EVERYTHING, {
      id: 1,
      ok: true,
      result: { number: 3 } as unknown as HostedIssue,
    });

    const answer: string = await runHostingTool(hosting, 'createIssue', { title: 'Fix login' });

    // The repository is the run's, never the model's to choose.
    expect(request).toHaveBeenCalledWith('createIssue', {
      repository: REPOSITORY,
      title: 'Fix login',
    });
    expect(answer).toBe('{"number":3}');
  });

  it('wordsARefusal_forTheModel', async () => {
    const { hosting } = hostingOf(EVERYTHING, {
      id: 1,
      ok: false,
      error: 'The write was declined.',
      code: 'refused',
    });

    expect(await runHostingTool(hosting, 'createIssue', { title: 'x' })).toBe(
      'GitHub did not do it: The write was declined.',
    );
  });

  it('shortensLongIssueBodies_inAListing', async () => {
    const issue: HostedIssue = {
      number: 1,
      title: 'Long',
      author: 'a',
      url: 'u',
      labels: [],
      assignees: [],
      state: 'open',
      body: 'x'.repeat(2_000),
      createdAt: '',
      updatedAt: '',
      commentCount: 0,
    };
    const { hosting } = hostingOf(EVERYTHING, { id: 1, ok: true, result: [issue] });

    const listed: readonly HostedIssue[] = JSON.parse(
      await runHostingTool(hosting, 'listIssues', {}),
    ) as readonly HostedIssue[];

    expect(listed[0].body.length).toBe(601);
    expect(listed[0].body.endsWith('…')).toBe(true);
  });
});

describe('hostingPromptAppendix', () => {
  it('namesTheRepositoryAndThePlugin_listsTheTools_andSteersAwayFromTheCli', () => {
    const appendix: string = hostingPromptAppendix(
      contextOf(hostingOf(['issues', 'createIssue']).hosting),
    );

    expect(appendix).toContain(
      "repository is onix-labs/studio on github.com, served by Studio's GitHub plugin",
    );
    expect(appendix).toContain('- hosting_list_issues');
    expect(appendix).toContain('- hosting_create_issue');
    expect(appendix).not.toContain('hosting_list_ci_runs');
    expect(appendix).toContain('rather than a command-line tool');
  });

  it('isEmpty_whenNoToolIsOffered', () => {
    expect(hostingPromptAppendix(contextOf(null))).toBe('');
  });
});
