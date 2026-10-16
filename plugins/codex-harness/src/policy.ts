// How Studio's permission settings become Codex's: the sandbox a turn runs in, when Codex asks before
// acting, and what this harness answers when it does.
//
// Codex has its own sandbox and its own approval machinery, and the app-server protocol routes every
// approval to the client. That is what lets this harness do what the Claude harness does: put each
// action to Studio's permission prompt, under the user's posture and per-tool policy, with Studio
// keeping the audit record. ⛔ The write boundary is Codex's sandbox, and a request to step outside it
// is declined here rather than put to the user: widening it is a settings decision, not a prompt.

import type { TurnRequest } from './protocol';

/**
 * The permission card's name for a shell command, matching Studio's gateable tool list.
 */
export const COMMAND_TOOL: string = 'Bash';

/**
 * The permission card's name for a file change, matching Studio's gateable tool list.
 */
export const EDIT_TOOL: string = 'Edit';

/**
 * The Studio tools a Codex file change stands for, whose policies decide it together.
 */
const FILE_CHANGE_TOOLS: readonly string[] = ['Write', 'Edit', 'MultiEdit'];

/**
 * How a turn is confined: the sandbox, the network, and when Codex asks before acting.
 */
export interface TurnPolicy {
  /**
   * Gets the sandbox mode the thread runs in.
   */
  readonly sandbox: 'read-only' | 'workspace-write';

  /**
   * Gets the folders a `workspace-write` sandbox may write to: the workspace and the user's allowed
   * write paths.
   */
  readonly writableRoots: readonly string[];

  /**
   * Gets whether commands may reach the network.
   */
  readonly networkAccess: boolean;

  /**
   * Gets when Codex asks before acting: `untrusted` asks for everything but known-safe reads, so the
   * question reaches Studio's prompt; `never` runs inside the sandbox and fails rather than asks.
   */
  readonly approvalPolicy: 'untrusted' | 'never';

  /**
   * Gets whether the web search tool is on.
   */
  readonly webSearch: 'disabled' | 'default';
}

/**
 * What this harness answers an approval request with, before or instead of asking the user.
 */
export type Decision =
  | { readonly kind: 'accept'; readonly source: 'policy' | 'posture' }
  | { readonly kind: 'decline'; readonly reason: string }
  | { readonly kind: 'ask'; readonly tool: string };

/**
 * Determines whether a turn keeps Codex off its own tools (#965): a terminal's always, and any turn
 * Studio asks it of — a tool view's. Codex cannot drop its shell, so the turn runs read-only, off the
 * network, with every approval declined.
 * @param turn The turn.
 * @returns Returns true when only Studio's tools may act.
 */
export function withholdsBuiltInTools(turn: TurnRequest): boolean {
  return turn.surface === 'terminal' || turn.builtInTools === 'none';
}

/**
 * Builds the confinement a turn runs under.
 *
 * A chat turn and a confined one are read-only. An agent turn writes inside the workspace and the
 * user's allowed paths, and asks before everything else — unless the user chose to be asked nothing,
 * in which case Codex runs inside the sandbox and a command the sandbox stops simply fails, which is
 * the same boundary the Claude harness keeps under that posture.
 * @param turn The turn.
 * @returns Returns the policy.
 */
export function policyFor(turn: TurnRequest): TurnPolicy {
  const confined: boolean = withholdsBuiltInTools(turn);
  const readOnly: boolean = confined || turn.mode === 'chat';
  // Codex's sandbox has one network switch, not a host list, so an allow list cannot be expressed and
  // the honest mapping is to fail closed. A deny list alone narrows nothing this harness can act on.
  const networkAccess: boolean = !confined && turn.allowedNetworkLocations.length === 0;
  return {
    sandbox: readOnly ? 'read-only' : 'workspace-write',
    writableRoots: readOnly
      ? []
      : [...(turn.workspaceRoot === null ? [] : [turn.workspaceRoot]), ...turn.allowedWritePaths],
    networkAccess,
    approvalPolicy: !readOnly && turn.permissionPosture === 'auto-all' ? 'never' : 'untrusted',
    webSearch:
      confined || turn.toolPolicies['WebSearch'] === 'deny' || turn.mode === 'chat'
        ? 'disabled'
        : 'default',
  };
}

/**
 * Decides a request to run a shell command.
 * @param turn The turn.
 * @returns Returns the decision.
 */
export function decideCommand(turn: TurnRequest): Decision {
  const refusal: Decision | null = refuseWhenNotActing(turn);
  if (refusal !== null) {
    return refusal;
  }
  const policy: 'allow' | 'ask' | 'deny' = turn.toolPolicies[COMMAND_TOOL] ?? 'ask';
  if (policy === 'deny') {
    return {
      kind: 'decline',
      reason: `Blocked: the ${COMMAND_TOOL} tool is set to Deny in your agent settings.`,
    };
  }
  if (policy === 'allow') {
    return { kind: 'accept', source: 'policy' };
  }
  if (turn.permissionPosture === 'auto-all') {
    return { kind: 'accept', source: 'posture' };
  }
  return { kind: 'ask', tool: COMMAND_TOOL };
}

/**
 * Decides a request to change files. One Codex request may touch several files, so it is decided by
 * every file tool's policy together: a Deny on any of them refuses it.
 * @param turn The turn.
 * @returns Returns the decision.
 */
export function decideFileChange(turn: TurnRequest): Decision {
  const refusal: Decision | null = refuseWhenNotActing(turn);
  if (refusal !== null) {
    return refusal;
  }
  const policies: readonly ('allow' | 'ask' | 'deny')[] = FILE_CHANGE_TOOLS.map(
    (tool: string): 'allow' | 'ask' | 'deny' => turn.toolPolicies[tool] ?? 'ask',
  );
  const denied: string | undefined = FILE_CHANGE_TOOLS.find(
    (tool: string): boolean => turn.toolPolicies[tool] === 'deny',
  );
  if (denied !== undefined) {
    return {
      kind: 'decline',
      reason: `Blocked: the ${denied} tool is set to Deny in your agent settings.`,
    };
  }
  if (turn.permissionPosture === 'auto-all' || turn.permissionPosture === 'auto-edits') {
    return { kind: 'accept', source: 'posture' };
  }
  if (policies.every((policy: 'allow' | 'ask' | 'deny'): boolean => policy === 'allow')) {
    return { kind: 'accept', source: 'policy' };
  }
  return { kind: 'ask', tool: EDIT_TOOL };
}

/**
 * Decides a request for permissions beyond the sandbox: more folders to write to, or more of the
 * network. Always declined. The write area is a fixed boundary that a prompt cannot widen; the user
 * widens it in Settings, and the message says so.
 * @returns Returns the decision.
 */
export function decidePermissions(): Decision {
  return {
    kind: 'decline',
    reason:
      "Blocked: that is outside the agent's allowed write area (the workspace root and your allowed " +
      'write paths). This is a fixed safety boundary — add the location to your allowed write paths ' +
      'to permit it.',
  };
}

/**
 * Refuses an action outright when the turn may not act at all: a confined turn, or a chat turn.
 * @param turn The turn.
 * @returns Returns the refusal, or null when the turn may act.
 */
function refuseWhenNotActing(turn: TurnRequest): Decision | null {
  if (withholdsBuiltInTools(turn)) {
    return {
      kind: 'decline',
      reason:
        turn.surface === 'terminal'
          ? 'This agent can only use the terminal.'
          : 'This agent can only use the tools of the view it is docked to.',
    };
  }
  if (turn.mode === 'chat') {
    return {
      kind: 'decline',
      reason: 'Chat mode is read-only — it can inspect but not modify files or run commands.',
    };
  }
  return null;
}

/**
 * Names the coarse reason an action was allowed, for Studio's audit record: the per-tool policy, the
 * posture, or the user's answer to the prompt.
 * @param decision The decision that allowed it.
 * @returns Returns the source.
 */
export function auditSource(decision: Decision): string {
  return decision.kind === 'accept' ? decision.source : 'gated-or-auto';
}
