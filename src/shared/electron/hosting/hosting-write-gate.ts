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
 * Names the tool a typed hosting write is known by in per-tool policies: `hosting:<op>`.
 * @param op The operation.
 * @returns Returns the tool name.
 */
export function hostingOpToolName(op: string): string {
  return `hosting:${op}`;
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
    case 'createPullRequest':
      return `${provider}: open a pull request “${text('title')}” from ${text('head')} into ${text('base')}${where}`;
    case 'rerunCiRun':
      return `${provider}: re-run CI run ${text('runId')}${where}`;
    case 'cancelCiRun':
      return `${provider}: cancel CI run ${text('runId')}${where}`;
    default:
      return `${provider}: ${op}${where}`;
  }
}
