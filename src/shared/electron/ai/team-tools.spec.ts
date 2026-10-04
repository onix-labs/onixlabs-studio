import { describe, expect, it, vi } from 'vitest';
import {
  TEAM_COMPLETE_TASK,
  TEAM_FAIL_TASK,
  TEAM_INSTRUCT_WORKER,
  TEAM_POST_TO_BOARD,
  TEAM_READ_BOARD,
  TEAM_START_WORKER,
  TEAM_STOP_WORKER,
  TEAM_WORKER_STATUS,
} from '@shared/api/ai/ai-team-tools';
import type { HarnessTool } from '@shared/api/agent-protocol';
import type { AgentRunContext } from './agent-provider';

vi.mock('electron', () => ({ app: { isPackaged: false } }));

const { describeOffer, invokeTool } = await import('./harness-tools');

/**
 * The team tool names, for picking them out of an offer.
 */
const TEAM_TOOLS: readonly string[] = [
  TEAM_START_WORKER,
  TEAM_WORKER_STATUS,
  TEAM_INSTRUCT_WORKER,
  TEAM_STOP_WORKER,
  TEAM_READ_BOARD,
  TEAM_POST_TO_BOARD,
  TEAM_COMPLETE_TASK,
  TEAM_FAIL_TASK,
];

/**
 * A run context recording the capability requests, permission prompts and audit records its tools
 * make.
 */
interface Recording {
  readonly context: AgentRunContext;
  readonly requests: { capability: string; input: unknown; timeoutMs?: number }[];
  readonly prompts: string[];
  readonly audits: string[];
}

/**
 * Builds a run context for a team role, whose bridge answers with a fixed reply.
 * @param team The run's team role.
 * @param options What the renderer answers, and whether the user grants permission.
 * @returns Returns the context and what it records.
 */
function contextFor(
  team: unknown,
  options: { answer?: unknown; grant?: boolean; posture?: string } = {},
): Recording {
  const requests: { capability: string; input: unknown; timeoutMs?: number }[] = [];
  const prompts: string[] = [];
  const audits: string[] = [];
  const context: AgentRunContext = {
    requestId: 'r1',
    surface: 'workspace',
    mode: 'agent',
    team,
    toolPolicies: {},
    language: null,
    systemPromptExtra: '',
    userPromptExtra: '',
    skills: [],
    workspaceRoot: '/ws',
    permissionPosture: options.posture ?? 'prompt',
    bridge: {
      request: (capability: string, input: unknown, timeoutMs?: number): Promise<unknown> => {
        requests.push({ capability, input, ...(timeoutMs === undefined ? {} : { timeoutMs }) });
        return Promise.resolve('answer' in options ? options.answer : { ok: true, text: 'Done.' });
      },
    },
    emit: (): void => undefined,
    recordAudit: (name: string): void => void audits.push(name),
    requestPermission: (name: string): Promise<boolean> => {
      prompts.push(name);
      return Promise.resolve(options.grant ?? true);
    },
  } as unknown as AgentRunContext;
  return { context, requests, prompts, audits };
}

/**
 * Gets the team tools an offer holds.
 * @param offer The offer.
 * @returns Returns their names, sorted.
 */
function teamTools(offer: { tools: readonly HarnessTool[] }): readonly string[] {
  return offer.tools
    .map((tool: HarnessTool): string => tool.name)
    .filter((name: string): boolean => TEAM_TOOLS.includes(name))
    .sort();
}

describe('team tools', () => {
  it('areOfferedToNobodyOutsideATeam', async () => {
    for (const role of [null, undefined, 'supervisor']) {
      const offer: { systemPrompt: string; tools: readonly HarnessTool[] } = await describeOffer(
        contextFor(role).context,
      );
      expect(teamTools(offer)).toEqual([]);
      expect(offer.systemPrompt).not.toContain('team');
    }
  });

  it('giveALeadTheBoardAndItsWorkers', async () => {
    const offer: { systemPrompt: string; tools: readonly HarnessTool[] } = await describeOffer(
      contextFor('lead').context,
    );

    expect(teamTools(offer)).toEqual(
      [
        TEAM_START_WORKER,
        TEAM_WORKER_STATUS,
        TEAM_INSTRUCT_WORKER,
        TEAM_STOP_WORKER,
        TEAM_READ_BOARD,
        TEAM_POST_TO_BOARD,
      ].sort(),
    );
    expect(offer.systemPrompt).toContain('You can lead a team of agents');
    expect(offer.systemPrompt).not.toContain('You are a worker');
  });

  it('giveAWorkerTheBoardAndItsReports_butNoWayToStartOthers', async () => {
    const offer: { systemPrompt: string; tools: readonly HarnessTool[] } = await describeOffer(
      contextFor('worker').context,
    );

    expect(teamTools(offer)).toEqual(
      [TEAM_READ_BOARD, TEAM_POST_TO_BOARD, TEAM_COMPLETE_TASK, TEAM_FAIL_TASK].sort(),
    );
    expect(offer.systemPrompt).toContain('You are a worker on a team');
    expect(offer.systemPrompt).not.toContain('You can lead');
  });

  it('areOfferedInChatModeToo', async () => {
    const recording: Recording = contextFor('lead');
    const chat: AgentRunContext = { ...recording.context, mode: 'chat' };

    expect(teamTools(await describeOffer(chat))).toContain(TEAM_START_WORKER);
  });

  it('askTheUserBeforeStartingAWorker_withALongTimeout', async () => {
    const { context, requests, prompts, audits } = contextFor('lead');

    const outcome: { result: string | null; error: string | null } = await invokeTool(
      context,
      TEAM_START_WORKER,
      { title: 'Schema', task: 'Add it.', branch: 'agent/schema', base: 'main' },
    );

    expect(outcome.result).toBe('Done.');
    expect(prompts).toEqual([TEAM_START_WORKER]);
    expect(audits).toEqual([TEAM_START_WORKER]);
    expect(requests).toHaveLength(1);
    expect(requests[0].capability).toBe(TEAM_START_WORKER);
    expect(requests[0].input).toEqual({
      title: 'Schema',
      task: 'Add it.',
      branch: 'agent/schema',
      base: 'main',
    });
    expect(requests[0].timeoutMs).toBeGreaterThan(60_000);
  });

  it('startNoWorker_whenTheUserDeclines', async () => {
    const { context, requests } = contextFor('lead', { grant: false });

    const outcome: { result: string | null; error: string | null } = await invokeTool(
      context,
      TEAM_START_WORKER,
      { title: 'Schema', task: 'Add it.', branch: 'agent/schema' },
    );

    expect(outcome.result).toContain('declined');
    expect(requests).toEqual([]);
  });

  it('startWithoutAsking_underAnAutoAllPosture', async () => {
    const { context, prompts, requests } = contextFor('lead', { posture: 'auto-all' });

    await invokeTool(context, TEAM_START_WORKER, { title: 'T', task: 'X', branch: 'b' });

    expect(prompts).toEqual([]);
    expect(requests).toHaveLength(1);
  });

  it('boundAndForwardWhatIsPosted', async () => {
    const { context, requests, audits } = contextFor('worker');

    await invokeTool(context, TEAM_POST_TO_BOARD, { kind: 'claim', text: '  src/store/**  ' });

    expect(requests).toEqual([
      { capability: TEAM_POST_TO_BOARD, input: { kind: 'claim', text: 'src/store/**' } },
    ]);
    expect(audits).toEqual([TEAM_POST_TO_BOARD]);
  });

  it('forwardAWorkersReports', async () => {
    const { context, requests } = contextFor('worker');

    await invokeTool(context, TEAM_COMPLETE_TASK, {
      summary: ' Added the schema. ',
      pullRequest: 'https://example.test/pr/1',
    });
    await invokeTool(context, TEAM_FAIL_TASK, { reason: 'The base branch is missing.' });

    expect(requests.map((request): unknown => request.input)).toEqual([
      { summary: 'Added the schema.', pullRequest: 'https://example.test/pr/1' },
      { reason: 'The base branch is missing.' },
    ]);
  });

  it('forwardTheLeadsDirections', async () => {
    const { context, requests } = contextFor('lead');

    await invokeTool(context, TEAM_WORKER_STATUS, {});
    await invokeTool(context, TEAM_WORKER_STATUS, { worker: 'Schema' });
    await invokeTool(context, TEAM_INSTRUCT_WORKER, { worker: 'Schema', text: ' Rebase. ' });
    await invokeTool(context, TEAM_STOP_WORKER, { worker: 'Schema' });
    await invokeTool(context, TEAM_READ_BOARD, { since: 3 });

    expect(requests.map((request): unknown => [request.capability, request.input])).toEqual([
      [TEAM_WORKER_STATUS, {}],
      [TEAM_WORKER_STATUS, { worker: 'Schema' }],
      [TEAM_INSTRUCT_WORKER, { worker: 'Schema', text: 'Rebase.' }],
      [TEAM_STOP_WORKER, { worker: 'Schema' }],
      [TEAM_READ_BOARD, { since: 3 }],
    ]);
  });

  it('passOnARefusal_asWhatTheModelIsTold', async () => {
    const { context } = contextFor('lead', {
      answer: { ok: false, text: 'Four workers are already running.' },
    });

    const outcome: { result: string | null; error: string | null } = await invokeTool(
      context,
      TEAM_WORKER_STATUS,
      {},
    );

    expect(outcome.result).toBe('Four workers are already running.');
  });

  it('sayThereIsNoTeam_whenTheRendererDoesNotAnswer', async () => {
    const { context } = contextFor('worker', { answer: null });

    const outcome: { result: string | null; error: string | null } = await invokeTool(
      context,
      TEAM_READ_BOARD,
      {},
    );

    expect(outcome.result).toContain('no team');
  });
});
