import {
  HOSTING_WRITE_OPS,
  type HostingOp,
  type HostingParams,
  type HostingResponse,
} from '@shared/api/hosting-protocol';
import type { AiPermissionPosture, AiToolPolicy } from '@shared/api/ai-types';
import type { HostingAgentAccess, RunHosting } from '../hosting/hosting-agent-access';
import { describeHostingWrite, hostingOpToolName } from '../hosting/hosting-write-gate';
import type { AuditGrantSource } from './agent-audit-log';
import type { AgentHosting } from './agent-provider';
import { coarseGrantSource } from './tool-policy';

/**
 * Describes the run a hosted repository is bound to: how it decides an agent's write, how it asks the
 * user, and where it records what went through.
 */
export interface AgentHostingScope {
  /**
   * Gets the run's permission posture.
   */
  readonly permissionPosture: AiPermissionPosture;

  /**
   * Gets the run's per-tool policies.
   */
  readonly toolPolicies: Readonly<Record<string, AiToolPolicy>>;

  /**
   * Asks the user to approve a write — the run's permission prompt, which also honours a remembered
   * "always allow" for the tool.
   * @param tool The tool's name.
   * @param summary What the write does, in the user's terms.
   * @returns Returns true when approved.
   */
  readonly ask: (tool: string, summary: string) => Promise<boolean>;

  /**
   * Records a write that went through in the agent audit log.
   * @param tool The tool's name.
   * @param detail What it did.
   * @param source What granted it.
   */
  readonly audit: (tool: string, detail: string, source: AuditGrantSource) => void;
}

/**
 * Binds a run's hosted repository to the run (#852): every request its tools make goes through the
 * hosting host as this run — its posture and per-tool policies decide an agent's write, the permission
 * prompt asks under the tool's own name — and a write that went through is audited like any other.
 * @param access The agents' way to the hosting plugins.
 * @param run The run's hosted repository.
 * @param scope The run.
 * @returns Returns the run's hosting.
 */
export function bindAgentHosting(
  access: HostingAgentAccess,
  run: RunHosting,
  scope: AgentHostingScope,
): AgentHosting {
  return {
    ...run,
    request: async <Op extends HostingOp>(
      op: Op,
      params: HostingParams<Op>,
    ): Promise<HostingResponse<Op>> => {
      const tool: string = hostingOpToolName(op);
      const response: HostingResponse<Op> = await access.request(run, op, params, {
        kind: 'agent',
        posture: scope.permissionPosture,
        policies: scope.toolPolicies,
        confirm: (summary: string): Promise<boolean> => scope.ask(tool, summary),
      });
      if (response.ok && HOSTING_WRITE_OPS.includes(op)) {
        scope.audit(
          tool,
          describeHostingWrite(run.provider, op, params),
          coarseGrantSource(scope.toolPolicies[tool] ?? 'ask', scope.permissionPosture, false),
        );
      }
      return response;
    },
  };
}
