import type { AiPermissionPosture, AiToolPolicy } from '@shared/api/ai-types';
import type { HostedRepositoryRef, HostingOp } from '@shared/api/hosting-protocol';

/**
 * Describes who is asking the hosting host to do something.
 *
 * A request the user makes from Studio's own controls — Re-run on a CI run — is the user acting, and is
 * sent as asked: the confirmation it needs is the control's own. A request an agent makes goes through
 * the run's permission posture and per-tool policies first, exactly as its file edits and commands do;
 * there are no separate write settings (decided on #804, 2026-10-05).
 */
export type HostingCaller =
  | { readonly kind: 'user' }
  | {
      readonly kind: 'agent';

      /**
       * Gets the run's permission posture.
       */
      readonly posture: AiPermissionPosture;

      /**
       * Gets the run's per-tool policies, keyed by tool name.
       */
      readonly policies: Readonly<Record<string, AiToolPolicy>>;

      /**
       * Asks the user whether the agent may make the write, resolving true when they allow it.
       * @param summary What the agent wants to do, in the user's terms.
       */
      readonly confirm: (summary: string) => Promise<boolean>;
    };

/**
 * Describes what happens to an agent's write: sent, asked about, or refused outright.
 */
export type HostingWriteDecision = 'allow' | 'ask' | 'deny';

/**
 * Decides what happens to an agent's write to a host.
 *
 * - An explicit per-tool policy wins: `deny` refuses and `allow` sends, whatever the posture.
 * - Otherwise `auto-all` sends without asking.
 * - Every other posture asks — including `auto-edits`, which allows *file* edits, and a write to a host
 *   is not one.
 * @param tool The tool name the write is known by in per-tool policies.
 * @param posture The run's permission posture.
 * @param policies The run's per-tool policies.
 * @returns Returns the decision.
 */
export function hostingWriteDecision(
  tool: string,
  posture: AiPermissionPosture,
  policies: Readonly<Record<string, AiToolPolicy>>,
): HostingWriteDecision {
  const policy: AiToolPolicy | undefined = policies[tool];
  if (policy === 'deny') {
    return 'deny';
  }
  if (policy === 'allow' || posture === 'auto-all') {
    return 'allow';
  }
  return 'ask';
}

/**
 * Names the tool a typed hosting operation is offered to agents as, and known by in per-tool policies
 * and remembered permissions: `hosting_<op in snake case>` — `hosting_create_issue`. One name
 * everywhere, so a policy set on the offered tool is the policy the gate reads (#852). Snake case
 * because a tool name must be one an MCP client accepts, which a colon is not.
 * @param op The operation.
 * @returns Returns the tool name.
 */
export function hostingOpToolName(op: string): string {
  return `hosting_${op.replace(/[A-Z]/g, (letter: string): string => `_${letter.toLowerCase()}`)}`;
}

/**
 * Names the tool one of a plugin's agent tools is known by in per-tool policies:
 * `hosting:<plugin>/<tool>`, so two plugins' tools of the same name are told apart.
 * @param pluginId The plugin offering the tool.
 * @param tool The tool's name within the plugin.
 * @returns Returns the tool name.
 */
export function hostingAgentToolName(pluginId: string, tool: string): string {
  return `hosting:${pluginId}/${tool}`;
}

/**
 * Says what an agent's write would do, in the user's terms — what the permission prompt shows. Built
 * from the request itself, so the user approves *this* issue in *this* repository rather than an
 * operation's name.
 * @param provider The display name of the plugin serving the host, such as `GitHub`.
 * @param op The operation.
 * @param params The operation's parameters.
 * @returns Returns the description.
 */
export function describeHostingWrite(provider: string, op: HostingOp, params: unknown): string {
  const record: Record<string, unknown> =
    typeof params === 'object' && params !== null ? (params as Record<string, unknown>) : {};
  const text: (key: string) => string = (key: string): string =>
    typeof record[key] === 'string' || typeof record[key] === 'number' ? String(record[key]) : '?';
  const repository: unknown = record['repository'];
  const where: string =
    typeof repository === 'object' && repository !== null
      ? ` in ${String((repository as HostedRepositoryRef).owner)}/${String((repository as HostedRepositoryRef).name)}`
      : '';
  switch (op) {
    case 'createRepository':
      return `${provider}: create the ${record['private'] === true ? 'private' : 'public'} repository ${text('account')}/${text('name')}`;
    case 'createIssue':
      return `${provider}: open an issue “${text('title')}”${where}`;
    case 'commentOnIssue':
      return `${provider}: comment on #${text('issue')}${where}`;
    case 'setIssueState':
      return `${provider}: ${record['state'] === 'closed' ? 'close' : 'reopen'} #${text('issue')}${where}`;
    case 'updateIssue':
      return `${provider}: edit #${text('issue')}${where} (${describeIssueEdit(record)})`;
    case 'addSubIssue':
      return `${provider}: make #${text('subIssue')} a sub-issue of #${text('issue')}${where}`;
    case 'removeSubIssue':
      return `${provider}: take sub-issue #${text('subIssue')} off #${text('issue')}${where}`;
    case 'createPullRequest':
      return `${provider}: open a pull request “${text('title')}” from ${text('head')} into ${text('base')}${where}`;
    case 'updatePullRequest':
      return `${provider}: edit pull request #${text('pullRequest')}${where} (${describePullRequestEdit(record)})`;
    case 'rerunCiRun':
      return `${provider}: re-run CI run ${text('runId')}${where}`;
    case 'cancelCiRun':
      return `${provider}: cancel CI run ${text('runId')}${where}`;
    default:
      return `${provider}: ${op}${where}`;
  }
}

/**
 * Lists the names an edit adds or removes, for the permission prompt.
 * @param value The untrusted list.
 * @returns Returns the names, joined, or empty when there are none.
 */
function namesIn(value: unknown): string {
  return Array.isArray(value)
    ? value.filter((name: unknown): name is string => typeof name === 'string').join(', ')
    : '';
}

/**
 * Says what an issue edit changes, so the user approves these labels on this issue rather than "an
 * edit" (#1156).
 * @param record The edit's parameters.
 * @returns Returns the changes, separated by semicolons.
 */
function describeIssueEdit(record: Record<string, unknown>): string {
  const changes: string[] = [];
  if (typeof record['title'] === 'string') {
    changes.push(`title “${record['title']}”`);
  }
  if (typeof record['body'] === 'string') {
    changes.push('body');
  }
  const listed: readonly (readonly [string, string])[] = [
    ['addLabels', 'add labels'],
    ['removeLabels', 'remove labels'],
    ['addAssignees', 'assign'],
    ['removeAssignees', 'unassign'],
  ];
  for (const [key, verb] of listed) {
    const names: string = namesIn(record[key]);
    if (names.length > 0) {
      changes.push(`${verb} ${names}`);
    }
  }
  if (record['milestone'] === null) {
    changes.push('clear the milestone');
  } else if (typeof record['milestone'] === 'string') {
    changes.push(`milestone “${record['milestone']}”`);
  }
  return changes.length === 0 ? 'no changes' : changes.join('; ');
}

/**
 * Says what a pull request edit changes, for the permission prompt (#1156).
 * @param record The edit's parameters.
 * @returns Returns the changes, separated by semicolons.
 */
function describePullRequestEdit(record: Record<string, unknown>): string {
  const changes: string[] = [];
  if (typeof record['title'] === 'string') {
    changes.push(`title “${record['title']}”`);
  }
  if (typeof record['body'] === 'string') {
    changes.push('description');
  }
  if (typeof record['base'] === 'string') {
    changes.push(`merge into ${record['base']}`);
  }
  if (record['draft'] === true) {
    changes.push('convert to draft');
  } else if (record['draft'] === false) {
    changes.push('mark ready for review');
  }
  return changes.length === 0 ? 'no changes' : changes.join('; ');
}
