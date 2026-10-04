import type { AiToolPolicy } from '@shared/api/ai-types';
import { logger } from '@shared/electron/logger';
import type { AgentRunContext } from './agent-provider';
import { summarizeToolInput } from './tool-format';
import { coarseGrantSource } from './tool-policy';

/**
 * Wraps a mutating tool's executor in the shared permission round-trip, applying the run's posture
 * exactly as the Claude path's `canUseTool` does for the same tools: `auto-all` runs straight
 * through; every other posture asks the user first (these tools are not in the auto-edits set), and
 * a refusal is reported back to the model instead of running the tool. This closes the gap where the
 * AI-SDK providers executed tools with no gating hook at all.
 * @param context The run context (carries the posture and the permission round-trip).
 * @param name The tool name shown on the permission prompt.
 * @param execute The gated executor.
 * @returns Returns the wrapped executor.
 */
export function gated<TArgs>(
  context: AgentRunContext,
  name: string,
  execute: (args: TArgs) => Promise<string>,
): (args: TArgs) => Promise<string> {
  return async (args: TArgs): Promise<string> => {
    // Per-tool default policy (#309), consulted ahead of the posture: `deny` refuses, `allow` runs
    // without prompting, and an unset tool (or `ask`) falls through to the posture/prompt below.
    const detail: string = summarizeToolInput(args);
    const policy: AiToolPolicy = context.toolPolicies[name] ?? 'ask';
    if (policy === 'deny') {
      logger.debug('tool-gate.gated', `Tool "${name}" refused by Deny policy`);
      return `The ${name} tool is set to Deny in your agent settings.`;
    }
    if (policy !== 'allow' && context.permissionPosture !== 'auto-all') {
      const granted: boolean = await context.requestPermission(name, detail);
      if (!granted) {
        logger.debug('tool-gate.gated', `User declined tool "${name}"`);
        return 'The user declined to run this tool.';
      }
    }
    // This is the execution point — audit the action here (#311), matching the Claude path's
    // `PostToolUse` audit. The AI-SDK providers have no safety classifier, so every `gated` tool
    // reaches this line, and denials returned above. Source is the coarse policy/posture value (these
    // tools are all mutating and none is a file-edit tool, so `auto-edits` never applies).
    context.recordAudit(name, detail, coarseGrantSource(policy, context.permissionPosture, false));
    return execute(args);
  };
}
