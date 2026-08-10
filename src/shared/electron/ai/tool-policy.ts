import type { AiPermissionPosture, AiToolPolicy } from '@shared/api/ai-types';
import { logger } from '@shared/electron/logger';
import type { AuditGrantSource } from './agent-audit-log';

/**
 * The per-tool policy values accepted from the renderer.
 */
export const TOOL_POLICIES: readonly AiToolPolicy[] = ['allow', 'ask', 'deny'];

/**
 * Computes the coarse audit source (#311) for an executed tool from the run's settings. An explicit
 * `allow` policy takes precedence (`policy`); otherwise an auto-allowing posture is credited
 * (`posture`, honouring `auto-edits` only for edit tools); everything else — an interactive grant, a
 * remembered/session rule, or a classifier-auto-run command — collapses to `gated-or-auto`, since the
 * exact grant path is not recoverable at the execution point.
 * @param policy The tool's per-tool policy.
 * @param posture The run's permission posture.
 * @param isEditTool Whether the tool is a file-edit tool (relevant to the `auto-edits` posture).
 * @returns Returns the coarse audit source.
 */
export function coarseGrantSource(
  policy: AiToolPolicy,
  posture: AiPermissionPosture,
  isEditTool: boolean,
): AuditGrantSource {
  if (policy === 'allow') {
    logger.debug('ToolPolicy', 'Grant source resolved to policy (explicit allow)');
    return 'policy';
  }
  if (posture === 'auto-all' || (posture === 'auto-edits' && isEditTool)) {
    logger.debug('ToolPolicy', `Grant source resolved to posture (${posture})`);
    return 'posture';
  }
  logger.trace('ToolPolicy', 'Grant source resolved to gated-or-auto');
  return 'gated-or-auto';
}

/**
 * Sanitises the per-tool policy map from an untrusted run request (#309): keeps only
 * string→valid-policy entries and drops `ask` (the default), so the permission gate sees a clean,
 * sparse map. Anything malformed yields an empty map rather than throwing.
 * @param value The raw value from the request.
 * @returns Returns a validated policy map (empty when there is nothing usable).
 */
export function sanitizeToolPolicies(value: unknown): Readonly<Record<string, AiToolPolicy>> {
  if (typeof value !== 'object' || value === null) {
    logger.trace('ToolPolicy', 'No per-tool policy map in request');
    return {};
  }
  const result: Record<string, AiToolPolicy> = {};
  for (const [tool, policy] of Object.entries(value as Record<string, unknown>)) {
    if (
      tool.length > 0 &&
      typeof policy === 'string' &&
      TOOL_POLICIES.includes(policy as AiToolPolicy) &&
      policy !== 'ask'
    ) {
      result[tool] = policy as AiToolPolicy;
    }
  }
  logger.debug('ToolPolicy', `Sanitized ${Object.keys(result).length} per-tool policy override(s)`);
  return result;
}
