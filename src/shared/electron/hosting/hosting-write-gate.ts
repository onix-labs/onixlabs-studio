import type { AiPermissionPosture, AiToolPolicy } from '@shared/api/ai-types';

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
