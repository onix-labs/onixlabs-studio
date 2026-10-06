import type { ToolSet } from 'ai';
import type {
  HostedIssue,
  HostingCapability,
  HostingOp,
  HostingParams,
  HostingResponse,
  HostingResult,
} from '@shared/api/hosting-protocol';
import { HOSTING_OP_CAPABILITY, HOSTING_WRITE_OPS } from '@shared/api/hosting-protocol';
import { logger } from '@shared/electron/logger';
import { hostingOpToolName } from '../hosting/hosting-write-gate';
import type { AgentHosting, AgentRunContext } from './agent-provider';

/**
 * The longest issue body a listing carries. Bodies can run to pages, and a listing is for choosing
 * an issue, not reading every one of them in full.
 */
const LISTED_BODY_LIMIT: number = 600;

/**
 * Describes one hosting tool: the operation it runs, what the model is told, and how its input
 * becomes the operation's parameters.
 */
interface HostingToolSpec {
  /**
   * Gets the operation the tool runs, which also names it — see {@link hostingOpToolName}.
   */
  readonly op: HostingOp;

  /**
   * Gets what the model is told the tool does.
   */
  readonly description: string;
}

/**
 * The operations offered to agents, in the order they are listed. Each is offered only where the
 * plugin and the repository allow it; the writes, also only outside chat mode.
 */
const HOSTING_TOOLS: readonly HostingToolSpec[] = [
  {
    op: 'listPullRequests',
    description:
      "List the repository's open pull requests, most recently updated first, with the state of their checks.",
  },
  {
    op: 'listIssues',
    description:
      "List the repository's open issues, most recently updated first, with their labels, assignees and (shortened) bodies.",
  },
  {
    op: 'listIssueComments',
    description:
      'List the comments on one issue or pull request, oldest first. Pull requests share their number with the conversation on them.',
  },
  {
    op: 'listSubIssues',
    description: "List an issue's sub-issues.",
  },
  {
    op: 'listCiRuns',
    description: "List the repository's recent CI runs (workflow runs), most recent first.",
  },
  {
    op: 'createIssue',
    description:
      'Open an issue in the repository. The body is markdown. The user may be asked to approve this first.',
  },
  {
    op: 'commentOnIssue',
    description:
      'Comment on an issue or a pull request (they share one conversation). The body is markdown. The user may be asked to approve this first.',
  },
  {
    op: 'setIssueState',
    description:
      'Close or reopen an issue. When closing, say whether its work was completed or is not planned. The user may be asked to approve this first.',
  },
  {
    op: 'createPullRequest',
    description:
      'Open a pull request from a pushed branch (head) into another (base). Push the branch first; use owner:branch for a fork. The user may be asked to approve this first.',
  },
  {
    op: 'rerunCiRun',
    description: 'Re-run a finished CI run. The user may be asked to approve this first.',
  },
  {
    op: 'cancelCiRun',
    description: 'Cancel a CI run in progress. The user may be asked to approve this first.',
  },
];

/**
 * Gets the operations a run is offered: those its repository allows and, for a write, only outside
 * chat mode — the mode that withholds every mutating tool.
 * @param context The run context.
 * @returns Returns the tool specs offered, in listing order.
 */
export function offeredHostingTools(context: AgentRunContext): readonly HostingToolSpec[] {
  const hosting: AgentHosting | null = context.hosting ?? null;
  if (hosting === null) {
    return [];
  }
  return HOSTING_TOOLS.filter((spec: HostingToolSpec): boolean => {
    const needed: HostingCapability | undefined = HOSTING_OP_CAPABILITY[spec.op];
    const allowed: boolean = needed === undefined || hosting.capabilities.includes(needed);
    return allowed && !(context.mode === 'chat' && HOSTING_WRITE_OPS.includes(spec.op));
  });
}

/**
 * Builds the hosting tools for a run (#852): the hosting protocol's operations, as tools, for the
 * repository the run works in. Absent when the workspace is in no repository an installed hosting
 * plugin serves.
 *
 * Not wrapped in the shared permission round-trip the other mutating tools use: every call goes
 * through {@link AgentHosting.request}, whose write gate already asks under the run's posture and
 * audits what went through. Wrapping it as well would ask the user twice for one action.
 * @param context The run context.
 * @returns Returns the tool set, empty when nothing is offered.
 */
export async function createHostingTools(context: AgentRunContext): Promise<ToolSet> {
  const hosting: AgentHosting | null = context.hosting ?? null;
  const offered: readonly HostingToolSpec[] = offeredHostingTools(context);
  if (hosting === null || offered.length === 0) {
    return {};
  }
  const { tool } = await import('ai');
  const { z } = await import('zod');
  const issue: ReturnType<typeof z.number> = z
    .number()
    .int()
    .positive()
    .describe('The issue or pull request number.');
  const runId: ReturnType<typeof z.string> = z
    .string()
    .regex(/^\d+$/)
    .describe('The CI run id, as listed.');
  const schemas: Readonly<Record<HostingOp, ReturnType<typeof z.object> | undefined>> = {
    initialize: undefined,
    authStatus: undefined,
    listAccounts: undefined,
    listRepositories: undefined,
    createRepository: undefined,
    describeRepository: undefined,
    listAgentTools: undefined,
    invokeAgentTool: undefined,
    listPullRequests: z.object({}),
    listIssues: z.object({}),
    listIssueComments: z.object({ issue }),
    listSubIssues: z.object({ issue }),
    listCiRuns: z.object({}),
    createIssue: z.object({
      title: z.string().min(1).describe("The issue's title."),
      body: z.string().optional().describe("The issue's body, as markdown."),
    }),
    commentOnIssue: z.object({
      issue,
      body: z.string().min(1).describe('The comment, as markdown.'),
    }),
    setIssueState: z.object({
      issue,
      state: z.enum(['open', 'closed']).describe('Whether the issue should be open or closed.'),
      reason: z
        .enum(['completed', 'notPlanned'])
        .optional()
        .describe(
          'When closing: completed (the work is done) or notPlanned (it will not be done).',
        ),
    }),
    createPullRequest: z.object({
      title: z.string().min(1).describe("The pull request's title."),
      head: z
        .string()
        .min(1)
        .describe('The branch with the changes, already pushed. owner:branch for a fork.'),
      base: z.string().min(1).describe('The branch to merge into, such as main.'),
      body: z.string().optional().describe("The pull request's description, as markdown."),
      draft: z.boolean().optional().describe('Whether to open it as a draft.'),
    }),
    rerunCiRun: z.object({ runId }),
    cancelCiRun: z.object({ runId }),
  };
  const tools: ToolSet = {};
  for (const spec of offered) {
    const inputSchema: ReturnType<typeof z.object> | undefined = schemas[spec.op];
    if (inputSchema === undefined) {
      continue;
    }
    tools[hostingOpToolName(spec.op)] = tool({
      description: `${spec.description} (${hosting.provider}: ${hosting.repository.owner}/${hosting.repository.name})`,
      inputSchema,
      execute: (args: Record<string, unknown>): Promise<string> =>
        runHostingTool(hosting, spec.op, args),
    });
  }
  return tools;
}

/**
 * Runs one hosting tool and words its answer for the model.
 * @param hosting The run's hosting.
 * @param op The operation.
 * @param args The tool's validated input.
 * @returns Returns the answer as the model reads it.
 */
export async function runHostingTool(
  hosting: AgentHosting,
  op: HostingOp,
  args: Record<string, unknown>,
): Promise<string> {
  const params: HostingParams<typeof op> = {
    repository: hosting.repository,
    ...args,
  };
  const response: HostingResponse = await hosting.request(op, params);
  if (!response.ok) {
    logger.debug('hosting-tools', `${hostingOpToolName(op)} failed: ${response.error}`);
    return `${hosting.provider} did not do it: ${response.error}`;
  }
  return JSON.stringify(shorten(op, response.result));
}

/**
 * Shortens what a listing carries to what choosing from it needs: issue bodies are cut, so a long
 * backlog does not fill the model's context.
 * @param op The operation answered.
 * @param result Its result.
 * @returns Returns the result to show.
 */
function shorten(op: HostingOp, result: HostingResult<HostingOp>): unknown {
  if ((op === 'listIssues' || op === 'listSubIssues') && Array.isArray(result)) {
    return (result as readonly HostedIssue[]).map((issue: HostedIssue): HostedIssue =>
      issue.body.length > LISTED_BODY_LIMIT
        ? { ...issue, body: `${issue.body.slice(0, LISTED_BODY_LIMIT)}…` }
        : issue,
    );
  }
  return result;
}

/**
 * Tells the model which hosted repository it works in and how to act on it (#852), so it reaches for
 * the hosting tools — which ask the user and keep a record — rather than the host's command-line tool.
 * Kept in step with {@link createHostingTools} by deriving both from {@link offeredHostingTools}.
 * @param context The run context.
 * @returns Returns the prompt section, or empty when no hosting tool is offered.
 */
export function hostingPromptAppendix(context: AgentRunContext): string {
  const hosting: AgentHosting | null = context.hosting ?? null;
  const offered: readonly HostingToolSpec[] = offeredHostingTools(context);
  if (hosting === null || offered.length === 0) {
    return '';
  }
  const { host, owner, name } = hosting.repository;
  return [
    `This workspace's repository is ${owner}/${name} on ${host}, served by Studio's ${hosting.provider} plugin. You have these tools for it:`,
    ...offered.map((spec: HostingToolSpec): string => `- ${hostingOpToolName(spec.op)}`),
    `For these operations, use these tools rather than a command-line tool (such as the host's own CLI) or the web API: Studio asks the user before anything is changed on ${hosting.provider}, keeps a record, and applies the user's own sign-in. For anything they do not cover — releases, wikis, repository settings and the like — use your other tools as usual.`,
  ].join('\n');
}
