import type { ToolSet } from 'ai';
import {
  boundedText,
  CompleteTaskInput,
  FailTaskInput,
  InstructWorkerInput,
  MAX_TEAM_TITLE,
  PostToBoardInput,
  ReadBoardInput,
  StartWorkerInput,
  TEAM_BOARD_KINDS,
  TEAM_COMPLETE_TASK,
  TEAM_FAIL_TASK,
  TEAM_INSTRUCT_WORKER,
  TEAM_POST_TO_BOARD,
  TEAM_READ_BOARD,
  TEAM_START_WORKER,
  TEAM_STOP_WORKER,
  TEAM_WORKER_STATUS,
  TeamBoardKind,
  TeamToolReply,
  WorkerRefInput,
} from '@shared/api/ai/ai-team-tools';
import { logger } from '@shared/electron/logger';
import type { AgentRunContext } from './agent-provider';
import { gated } from './tool-gate';

// The agent-team tools (#788): a lead starts and directs workers, each an ordinary agent in a checkout
// of its own on a branch of its own; workers coordinate through a board and report to the lead.
//
// ⛔ The team lives in the renderer, beside the checkouts and agents it hosts. These tools describe
// what a model may ask of it and carry the request across the bridge; every decision — limits, which
// worker a name means, whether the caller is a lead at all — is made there, against the run's stamped
// scope, never against anything the model says about itself.

/**
 * The guidance a lead's runs carry, after Studio's other tool guidance. Says how to work as a lead; the
 * tools' own descriptions say what each does.
 */
export const LEAD_PROMPT_APPENDIX: string = [
  'You can lead a team of agents in this repository. Each worker you start is an agent of its own, in a full checkout of its own, on a branch of its own.',
  '- Do small or sequential work yourself, as usual. Use workers when the user asks for work to run in parallel, or agrees when you suggest it.',
  '- Plan before you start anyone. Give the user the tasks, what each depends on, the parts of the code each will touch, and the order the work should land in. Start workers once the user agrees. Starting each one asks the user too.',
  '- Keep tasks apart: two workers changing the same files collide. Start a task that depends on another only after that one completes, with the finished branch as its base.',
  "- Name each worker's branch and base the way this repository and the user's instructions say. If you do not know the convention, ask.",
  '- A worker never sees this conversation. Brief it completely: what to do, what done looks like, and how to finish. Whether it pushes, opens a pull request or merges is for the user’s policy to say, not you to assume.',
  '- You are woken when a worker completes or fails. Do not poll worker_status in a loop; read it when you need the picture.',
  '- A worker waiting on the user shows as input_required. The user answers it; never answer for them or say you have.',
  '- When workers finish, check what they did — their summaries, the board, their branches — and report to the user.',
  '- A message that starts with [Team] comes from Studio about your workers, not from the user.',
].join('\n');

/**
 * The guidance a worker's runs carry.
 */
export const WORKER_PROMPT_APPENDIX: string = [
  "You are a worker on a team. Your lead gave you a task; you do it in this checkout, on this checkout's branch, and nowhere else.",
  '- Read the board before you start. Post a claim for the parts of the code you will change, and post a change for anything the others depend on: a renamed type, a moved file, a new dependency.',
  '- Keep out of what another worker has claimed. If your task needs it, post blocked and say why, or fail the task.',
  '- When you finish, commit your work, follow the instructions you were given about pushing and pull requests, then call complete_task with a short summary. If you cannot finish, call fail_task with the reason. Either one ends your task and tells your lead.',
  '- A message that starts with [Lead] comes from your lead. A message without it is the user, who may be watching.',
  '- Ask the user only about decisions that are genuinely theirs.',
].join('\n');

/**
 * How long starting a worker may take: cloning the repository, opening its checkout and starting its
 * agent. A large repository's clone is the slow part.
 */
const START_WORKER_TIMEOUT_MS: number = 10 * 60_000;

/**
 * Asks the renderer's team to fulfil a request and turns its answer into what the model is told. A
 * renderer that does not answer — no team hosts this agent, an older build — is reported as such
 * rather than as success.
 * @param context The run context, which carries the bridge and its stamped scope.
 * @param capability The capability, which is also the tool's name.
 * @param input The capability's input.
 * @param timeoutMs How long to wait for the answer, or undefined for the bridge's default.
 * @returns Returns the text for the model.
 */
async function ask(
  context: AgentRunContext,
  capability: string,
  input: unknown,
  timeoutMs?: number,
): Promise<string> {
  logger.trace('team-tools', `Tool invoked: ${capability}`);
  const reply: unknown = await context.bridge.request(capability, input, timeoutMs);
  const answer: Partial<TeamToolReply> = typeof reply === 'object' && reply !== null ? reply : {};
  if (typeof answer.text !== 'string') {
    logger.warn('team-tools', `${capability}: no answer from the team`);
    return 'Studio has no team for this agent. Teams run in a worktree container.';
  }
  if (answer.ok !== true) {
    logger.debug('team-tools', `${capability} refused: ${answer.text}`);
  }
  return answer.text;
}

/**
 * Wraps a tool so its use is audited. The team tools coordinate agents rather than act on the
 * workspace — the work they start runs under each agent's own permissions — so most are not put to
 * the user, but every use is recorded.
 * @param context The run context.
 * @param name The tool's name.
 * @param execute The tool.
 * @returns Returns the audited tool.
 */
function audited<TArgs>(
  context: AgentRunContext,
  name: string,
  execute: (args: TArgs) => Promise<string>,
): (args: TArgs) => Promise<string> {
  return (args: TArgs): Promise<string> => {
    context.recordAudit(name, JSON.stringify(args).slice(0, 200), 'policy');
    return execute(args);
  };
}

/**
 * Builds the board tools every team member carries.
 * @param context The run context.
 * @returns Returns the tools.
 */
async function boardTools(context: AgentRunContext): Promise<ToolSet> {
  const { tool } = await import('ai');
  const { z } = await import('zod');
  return {
    [TEAM_READ_BOARD]: tool({
      description:
        "Read the team's board: what each worker has claimed, changed, is blocked on, or noted. Pass the last sequence number you saw to read only what is new.",
      inputSchema: z.object({
        since: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('The sequence number of the last entry already read.'),
      }),
      execute: (args: ReadBoardInput): Promise<string> =>
        ask(context, TEAM_READ_BOARD, args.since === undefined ? {} : { since: args.since }),
    }),
    [TEAM_POST_TO_BOARD]: tool({
      description:
        "Post to the team's board, which the lead and every worker read. claim: what you are changing, so others keep clear. change: something others depend on. blocked: what you are waiting for. note: anything else the team should know. One or two plain sentences.",
      inputSchema: z.object({
        kind: z.enum(TEAM_BOARD_KINDS as [TeamBoardKind, ...TeamBoardKind[]]),
        text: z.string().min(1).describe('What the entry says.'),
      }),
      execute: audited(context, TEAM_POST_TO_BOARD, (args: PostToBoardInput): Promise<string> =>
        ask(context, TEAM_POST_TO_BOARD, { kind: args.kind, text: boundedText(args.text) ?? '' }),
      ),
    }),
  };
}

/**
 * Builds the lead's tools.
 * @param context The run context.
 * @returns Returns the tools.
 */
async function leadTools(context: AgentRunContext): Promise<ToolSet> {
  const { tool } = await import('ai');
  const { z } = await import('zod');
  return {
    [TEAM_START_WORKER]: tool({
      description:
        'Start a worker: an agent of its own, in a new full checkout of this repository, on a branch of its own, given the task as its first message. The user is asked before it starts. Brief it completely; it never sees this conversation.',
      inputSchema: z.object({
        title: z
          .string()
          .min(1)
          .max(MAX_TEAM_TITLE)
          .describe('A few words naming the task, shown to the user and on the board.'),
        task: z
          .string()
          .min(1)
          .describe(
            'The whole brief: what to do, what done looks like, and how to finish (committing, and pushing or opening a pull request only if the user’s policy says so).',
          ),
        branch: z.string().min(1).describe('The branch the worker works on.'),
        base: z
          .string()
          .optional()
          .describe(
            'The branch a new branch starts from. Omit for the repository’s default branch.',
          ),
      }),
      // ⛔ Gated: the one team action put to the user. Each worker is a clone, a branch and a paid
      // agent running unattended, and approving it is the user's bound on the team.
      execute: gated(context, TEAM_START_WORKER, (args: StartWorkerInput): Promise<string> =>
        ask(context, TEAM_START_WORKER, args, START_WORKER_TIMEOUT_MS),
      ),
    }),
    [TEAM_WORKER_STATUS]: tool({
      description:
        "See your workers: each one's task, branch, state (starting, working, input_required, idle, completed, failed, cancelled), what it is waiting on, and its summary. Name a worker to see only that one.",
      inputSchema: z.object({
        worker: z.string().optional().describe('A worker, by id or title. Omit for all of them.'),
      }),
      execute: (args: Partial<WorkerRefInput>): Promise<string> =>
        ask(context, TEAM_WORKER_STATUS, args.worker === undefined ? {} : { worker: args.worker }),
    }),
    [TEAM_INSTRUCT_WORKER]: tool({
      description:
        'Give a worker further instructions. It reads them as its next message; a worker that has finished its task takes no more.',
      inputSchema: z.object({
        worker: z.string().min(1).describe('The worker, by id or title.'),
        text: z.string().min(1).describe('The instructions.'),
      }),
      execute: audited(
        context,
        TEAM_INSTRUCT_WORKER,
        (args: InstructWorkerInput): Promise<string> =>
          ask(context, TEAM_INSTRUCT_WORKER, {
            worker: args.worker,
            text: boundedText(args.text) ?? '',
          }),
      ),
    }),
    [TEAM_STOP_WORKER]: tool({
      description:
        'Stop a worker: its current turn ends and its task is cancelled. Its checkout and branch stay, for the user to keep or remove.',
      inputSchema: z.object({
        worker: z.string().min(1).describe('The worker, by id or title.'),
      }),
      execute: audited(context, TEAM_STOP_WORKER, (args: WorkerRefInput): Promise<string> =>
        ask(context, TEAM_STOP_WORKER, { worker: args.worker }),
      ),
    }),
  };
}

/**
 * Builds a worker's own tools.
 * @param context The run context.
 * @returns Returns the tools.
 */
async function workerTools(context: AgentRunContext): Promise<ToolSet> {
  const { tool } = await import('ai');
  const { z } = await import('zod');
  return {
    [TEAM_COMPLETE_TASK]: tool({
      description:
        'Report your task done: what you did, and the pull request if you opened one. It ends your task and wakes your lead.',
      inputSchema: z.object({
        summary: z.string().min(1).describe('What you did, in a short paragraph.'),
        pullRequest: z.string().optional().describe('The pull request’s URL, if you opened one.'),
      }),
      execute: audited(context, TEAM_COMPLETE_TASK, (args: CompleteTaskInput): Promise<string> =>
        ask(context, TEAM_COMPLETE_TASK, {
          summary: boundedText(args.summary) ?? '',
          ...(args.pullRequest === undefined
            ? {}
            : { pullRequest: boundedText(args.pullRequest, 500) ?? '' }),
        }),
      ),
    }),
    [TEAM_FAIL_TASK]: tool({
      description:
        'Report that you cannot finish your task, and why. It ends your task and wakes your lead.',
      inputSchema: z.object({
        reason: z.string().min(1).describe('Why the task cannot be finished.'),
      }),
      execute: audited(context, TEAM_FAIL_TASK, (args: FailTaskInput): Promise<string> =>
        ask(context, TEAM_FAIL_TASK, { reason: boundedText(args.reason) ?? '' }),
      ),
    }),
  };
}

/**
 * Builds the team tools for a run (#788): the board for every member, the lead's tools for a lead, and
 * a worker's for a worker. A run in no team gets none.
 *
 * Offered in chat mode as much as agent mode: they coordinate agents rather than act on the workspace,
 * so a lead planning in chat mode can still start the work it planned.
 * @param context The run context the tools act through.
 * @returns Returns the tool set, empty outside a team.
 */
export async function createTeamTools(context: AgentRunContext): Promise<ToolSet> {
  // Matched exactly rather than tested against null, so a context that never set the field — an older
  // caller, a test — is outside a team rather than inside one.
  if (context.team === 'lead') {
    return { ...(await boardTools(context)), ...(await leadTools(context)) };
  }
  if (context.team === 'worker') {
    return { ...(await boardTools(context)), ...(await workerTools(context)) };
  }
  return {};
}

/**
 * Gets the team guidance a run carries, or empty outside a team.
 * @param context The run context.
 * @returns Returns the guidance.
 */
export function teamAppendix(context: AgentRunContext): string {
  switch (context.team) {
    case 'lead':
      return LEAD_PROMPT_APPENDIX;
    case 'worker':
      return WORKER_PROMPT_APPENDIX;
    default:
      return '';
  }
}
