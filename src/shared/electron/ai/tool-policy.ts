import type { AiToolPolicy } from '@shared/api/ai-types';

/**
 * The per-tool policy values accepted from the renderer.
 */
export const TOOL_POLICIES: readonly AiToolPolicy[] = ['allow', 'ask', 'deny'];

/**
 * Sanitises the per-tool policy map from an untrusted run request (#309): keeps only
 * string→valid-policy entries and drops `ask` (the default), so the permission gate sees a clean,
 * sparse map. Anything malformed yields an empty map rather than throwing.
 * @param value The raw value from the request.
 * @returns Returns a validated policy map (empty when there is nothing usable).
 */
export function sanitizeToolPolicies(value: unknown): Readonly<Record<string, AiToolPolicy>> {
  if (typeof value !== 'object' || value === null) {
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
  return result;
}
