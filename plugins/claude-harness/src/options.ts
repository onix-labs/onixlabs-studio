// Building the Agent SDK's options for a session: the tool set, the permission gate, the audit hook,
// confinement, the sandbox, the system prompt, and the session's own resume/budget settings.
//
// This is the port of `ClaudeAgentProvider.buildRunOptions`, and the shape is deliberately the same:
//
//   - **structural options are frozen at open** from the turn the session opened with — the working
//     directory, the tool set, the sandbox, the system prompt, resume. Studio's live-session router
//     reopens the session when any of those change, which is what makes freezing them correct rather
//     than merely convenient.
//   - **per-turn closures read the current turn.** The permission gate, the audit hook and the tool
//     handlers all call `getTurn()` on each invocation, so across a held-open session they follow the
//     turn actually running: its posture, its policies, its request id.
//
// The one exception is the model, which is structural but changed live through `Query.setModel`.

import { homedir } from 'node:os';
import type {
  CanUseTool,
  HookJSONOutput,
  McpSdkServerConfigWithInstance,
  Options,
  PermissionResult,
  PostToolUseHookInput,
  SandboxSettings,
} from '@anthropic-ai/claude-agent-sdk';
import {
  absolutePathsOf,
  CONFINED_WRITE_TOOLS,
  expandNetworkLocations,
  isWriteDenied,
  isWriteWithinRoots,
  writeTargetPath,
} from './confinement';
import { resolveExecutable, runEnvironment } from './environment';
import { coarseGrantSource, prettyToolName, summarizeToolInput } from './format';
import { note } from './log';
import type { RemoteControlBridge } from './remote-control';
import { STUDIO_TOOL_PREFIX } from './tools';
import type { Choice, TurnRequest } from './protocol';

/**
 * Built-in tools auto-allowed whenever the run has something to read: read-only project exploration.
 */
const READ_ONLY_TOOLS: readonly string[] = ['Read', 'Glob', 'Grep'];

/**
 * Built-in file-editing tools auto-allowed under the `auto-edits` posture.
 */
const EDIT_TOOLS: readonly string[] = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];

/**
 * Built-in tools the audit log ignores beyond the read-only set: planning and delegation tools, which
 * are not themselves mutating actions. A delegated sub-agent's own tool uses are still audited
 * through their own `PostToolUse` events, so nothing is actually missed.
 */
const AUDIT_SKIP_TOOLS: readonly string[] = ['Task', 'TodoWrite'];

/**
 * The model's built-in clarifying-question tool.
 *
 * 🔑 The one asking path this harness uses, which is why it tells Studio to `omit` its `ask_user` tool:
 * having both would give the model two ways to ask, described differently. It reaches `canUseTool`
 * even under an allow rule, and is answered by returning `{behavior:'allow', updatedInput:{questions,
 * answers}}` — and that is exactly the seam that lets the same question be rendered in Studio *and*
 * forwarded to claude.ai, where the mobile and web clients draw the question card natively.
 */
export const ASK_USER_QUESTION_TOOL: string = 'AskUserQuestion';

/**
 * One suggested answer to a question, as the tool's input carries it.
 */
interface QuestionOption {
  readonly label: string;
  readonly description?: string;
}

/**
 * One question from an `AskUserQuestion` call, reduced to what Studio's input prompt renders.
 */
interface ParsedQuestion {
  readonly question: string;
  readonly options: readonly QuestionOption[];
}

/**
 * What the gate needs from the session in order to decide.
 */
export interface GateContext {
  /**
   * Gets the turn currently running, read per invocation so the gate follows it across a session.
   */
  readonly getTurn: () => TurnRequest;

  /**
   * Gets the session's remote-control bridge, or null when remote control is off or mirror-only.
   */
  readonly getBridge: () => RemoteControlBridge | null;

  /**
   * Asks Studio to put a permission decision to the user.
   * @param requestId The run the question belongs to.
   * @param name The display name of the action.
   * @param detail A one-line summary of what it will do.
   * @returns Returns the decision, and a way to withdraw the question.
   */
  readonly askPermission: (
    requestId: string,
    name: string,
    detail: string,
  ) => { readonly granted: Promise<boolean>; readonly withdraw: () => void };

  /**
   * Asks Studio to put a question to the user.
   * @param requestId The run the question belongs to.
   * @param question The question text.
   * @param choices The suggested answers.
   * @returns Returns the answer, and a way to withdraw the question.
   */
  readonly askInput: (
    requestId: string,
    question: string,
    choices: readonly Choice[],
  ) => { readonly answer: Promise<string | null>; readonly withdraw: () => void };

  /**
   * Records an executed action to Studio's audit log.
   * @param requestId The run that ran it.
   * @param name The tool's display name.
   * @param detail What it targeted.
   * @param source Why it was allowed.
   */
  readonly audit: (requestId: string, name: string, detail: string, source: string) => void;
}

/**
 * Parses the `questions` array from an `AskUserQuestion` input, defensively — a malformed entry is
 * skipped rather than allowed to derail the turn.
 * @param input The tool input.
 * @returns Returns the usable questions, which may be none.
 */
export function parseQuestions(input: Record<string, unknown>): readonly ParsedQuestion[] {
  const raw: unknown = input['questions'];
  if (!Array.isArray(raw)) {
    return [];
  }
  const questions: ParsedQuestion[] = [];
  for (const item of raw as readonly unknown[]) {
    if (item === null || typeof item !== 'object') {
      continue;
    }
    const record: Record<string, unknown> = item as Record<string, unknown>;
    const question: unknown = record['question'];
    if (typeof question !== 'string' || question.length === 0) {
      continue;
    }
    const options: QuestionOption[] = [];
    if (Array.isArray(record['options'])) {
      for (const candidate of record['options'] as readonly unknown[]) {
        if (candidate === null || typeof candidate !== 'object') {
          continue;
        }
        const option: Record<string, unknown> = candidate as Record<string, unknown>;
        const label: unknown = option['label'];
        if (typeof label !== 'string' || label.length === 0) {
          continue;
        }
        options.push({
          label,
          ...(typeof option['description'] === 'string'
            ? { description: option['description'] }
            : {}),
        });
      }
    }
    questions.push({ question, options });
  }
  return questions;
}

/**
 * Builds the SDK sandbox settings for a session.
 *
 * 🔑 This is where the confinement the permission gate **cannot reach** is expressed. The gate sees a
 * tool's arguments, so it can range-check a file write but not an arbitrary shell command; the OS
 * sandbox sees the syscalls, so it covers `Bash` and the SDK's own web access. Three things are handed
 * to it: the denied write paths (so a shell command cannot write where a file tool may not), the
 * allowed write paths (so a granted shell write to a widened root is not then blocked), and the
 * network locations, which have no gate equivalent at all.
 *
 * Every list is omitted when empty, so a user who configured nothing gets precisely the sandbox Studio
 * has always applied.
 * @param turn The opening turn.
 * @returns Returns the sandbox settings.
 */
export function sandboxFor(turn: TurnRequest): SandboxSettings {
  const sandbox: SandboxSettings = {
    enabled: true,
    // Sandboxed Bash is still gated: the sandbox is defence in depth on top of the prompt, not a
    // replacement for it.
    autoAllowBashIfSandboxed: false,
    // Degrade gracefully where the platform sandbox is missing: run unsandboxed rather than fail.
    failIfUnavailable: false,
  };
  if (turn.allowedWritePaths.length > 0 || turn.deniedWritePaths.length > 0) {
    sandbox.filesystem = {
      ...(turn.allowedWritePaths.length > 0 ? { allowWrite: [...turn.allowedWritePaths] } : {}),
      ...(absolutePathsOf(turn.deniedWritePaths).length > 0
        ? { denyWrite: absolutePathsOf(turn.deniedWritePaths) }
        : {}),
    };
  }
  if (turn.allowedNetworkLocations.length > 0 || turn.deniedNetworkLocations.length > 0) {
    // Expanded on the way out: the sandbox matches label-for-label, so `*.example.com` reaches it as
    // both itself and the apex it is taken to include. Without that, one list would allow a request
    // through Studio's API tools and block the same request in the shell.
    sandbox.network = {
      ...(turn.allowedNetworkLocations.length > 0
        ? { allowedDomains: [...expandNetworkLocations(turn.allowedNetworkLocations)] }
        : {}),
      ...(turn.deniedNetworkLocations.length > 0
        ? { deniedDomains: [...expandNetworkLocations(turn.deniedNetworkLocations)] }
        : {}),
    };
  }
  return sandbox;
}

/**
 * Answers the built-in clarifying-question tool: renders each question in Studio and, under remote
 * control, forwards the whole prompt to claude.ai so a peer can answer it natively.
 *
 * Whichever side answers first wins and the other's prompt is dismissed — Studio's through the
 * protocol's `cancel`, claude.ai's through the bridge's own cancel.
 * @param gate What the gate can reach.
 * @param turn The turn in flight.
 * @param input The tool input, carrying its `questions` array.
 * @returns Returns the permission result carrying the answers, or a deny when the user declined.
 */
async function answerQuestions(
  gate: GateContext,
  turn: TurnRequest,
  input: Record<string, unknown>,
): Promise<PermissionResult> {
  const questions: readonly ParsedQuestion[] = parseQuestions(input);
  if (questions.length === 0) {
    // Nothing usable to ask. Allow with the input unchanged so the tool resolves rather than the turn
    // stalling on a malformed call.
    return { behavior: 'allow', updatedInput: input };
  }
  const bridge: RemoteControlBridge | null = gate.getBridge();
  const askLocally: (withdrawn: {
    value: boolean;
  }) => Promise<Record<string, string> | null> = async (withdrawn: {
    value: boolean;
  }): Promise<Record<string, string> | null> => {
    const answers: Record<string, string> = {};
    for (const parsed of questions) {
      const asked: { answer: Promise<string | null>; withdraw: () => void } = gate.askInput(
        turn.requestId,
        parsed.question,
        parsed.options,
      );
      // Registered so a peer answering mid-sequence takes this question off the user's screen
      // rather than leaving them part way through a set that no longer matters.
      pendingWithdraw.push(asked.withdraw);
      const answer: string | null = await asked.answer;
      if (answer === null || withdrawn.value) {
        return null;
      }
      answers[parsed.question] = answer;
    }
    return answers;
  };
  const pendingWithdraw: (() => void)[] = [];
  const withdrawn: { value: boolean } = { value: false };
  if (!bridge?.canPrompt) {
    const answers: Record<string, string> | null = await askLocally(withdrawn);
    return answers === null
      ? { behavior: 'deny', message: 'The user declined to answer.' }
      : { behavior: 'allow', updatedInput: { questions: input['questions'], answers } };
  }
  const peer: { id: string; answer: Promise<Record<string, unknown> | null> } =
    bridge.requestQuestions(input, questions[0]?.question);
  const local: Promise<{ payload: Record<string, unknown> | null; who: 'studio' | 'remote' }> =
    askLocally(withdrawn).then(
      (
        answers: Record<string, string> | null,
      ): { payload: Record<string, unknown> | null; who: 'studio' } => ({
        payload: answers === null ? null : { questions: input['questions'], answers },
        who: 'studio',
      }),
    );
  const remote: Promise<{ payload: Record<string, unknown> | null; who: 'studio' | 'remote' }> =
    peer.answer.then(
      (
        payload: Record<string, unknown> | null,
      ): { payload: Record<string, unknown> | null; who: 'remote' } => ({ payload, who: 'remote' }),
    );
  const winner: { payload: Record<string, unknown> | null; who: 'studio' | 'remote' } =
    await Promise.race([local, remote]);
  if (winner.who === 'remote') {
    withdrawn.value = true;
    for (const withdraw of pendingWithdraw) {
      withdraw();
    }
  } else {
    bridge.cancelQuestion(peer.id);
  }
  // The prompt has settled: return the session to a running turn on claude.ai.
  bridge.clearAction();
  return winner.payload === null
    ? { behavior: 'deny', message: 'The user declined to answer.' }
    : { behavior: 'allow', updatedInput: winner.payload };
}

/**
 * Resolves a tool permission, racing Studio's prompt against the remote peer when a controllable
 * bridge is open.
 *
 * Whichever side answers first wins and the loser's prompt is dismissed. With no controllable bridge —
 * remote control off, or mirror, which is view-only — Studio's prompt alone decides.
 * @param gate What the gate can reach.
 * @param turn The turn in flight.
 * @param displayName The human-facing tool name.
 * @param toolName The raw SDK tool name forwarded to the peer.
 * @param input The tool input forwarded to the peer.
 * @param detail The human-facing detail.
 * @returns Returns true when the tool is approved.
 */
async function decidePermission(
  gate: GateContext,
  turn: TurnRequest,
  displayName: string,
  toolName: string,
  input: Record<string, unknown>,
  detail: string,
): Promise<boolean> {
  const bridge: RemoteControlBridge | null = gate.getBridge();
  const local: { granted: Promise<boolean>; withdraw: () => void } = gate.askPermission(
    turn.requestId,
    displayName,
    detail,
  );
  if (!bridge?.canPrompt) {
    return local.granted;
  }
  const peer: { id: string; granted: Promise<boolean> } = bridge.requestPermission(
    toolName,
    input,
    { displayName, description: detail },
  );
  const winner: { granted: boolean; who: 'studio' | 'remote' } = await Promise.race([
    local.granted.then((granted: boolean): { granted: boolean; who: 'studio' } => ({
      granted,
      who: 'studio',
    })),
    peer.granted.then((granted: boolean): { granted: boolean; who: 'remote' } => ({
      granted,
      who: 'remote',
    })),
  ]);
  if (winner.who === 'remote') {
    local.withdraw();
  } else {
    bridge.cancelPermission(peer.id);
  }
  bridge.clearAction();
  return winner.granted;
}

/**
 * Builds the permission gate.
 *
 * The order of the checks is the whole design, and each one is ahead of the next for a reason:
 *
 *  1. **the clarifying question**, which is allowed on every surface and in every mode, because asking
 *     is read-only and the user's answer is itself the gate;
 *  2. **Studio's own tools**, which Studio gates on its own side, so gating them again here would
 *     prompt the user twice for one action;
 *  3. **surface confinement**, so a terminal-docked agent cannot reach the file system at all;
 *  4. **read-only mode**, which denies outright rather than prompting — a chat turn may not act, and
 *     offering the user a way to say yes would contradict the mode they chose;
 *  5. **write confinement**, checked *before* the auto-allow below so an `auto-all` posture is confined
 *     too. A deliberate hard boundary that approving cannot widen: a single yes must not be able to
 *     escape the allowed area, and widening it is a settings decision;
 *  6. the per-tool **policy**, then the **posture**, then the prompt.
 * @param gate What the gate can reach.
 * @param open The turn the session opened with, which fixes the structural scope.
 * @returns Returns the gate.
 */
export function buildGate(gate: GateContext, open: TurnRequest): CanUseTool {
  const terminal: boolean = open.surface === 'terminal';
  const readOnly: boolean = open.mode === 'chat';
  const hasWorkspace: boolean = open.workspaceRoot !== null;
  // The filesystem area a granted write may touch. The first root is the working directory, so a
  // relative target anchors to the workspace. Left empty without a workspace, which keeps the
  // unconfined behaviour a no-workspace run has always had.
  const confinementRoots: readonly string[] = hasWorkspace
    ? [open.workspaceRoot!, ...open.allowedWritePaths]
    : [];
  return async (toolName: string, input: Record<string, unknown>): Promise<PermissionResult> => {
    const turn: TurnRequest = gate.getTurn();
    if (toolName === ASK_USER_QUESTION_TOOL) {
      return answerQuestions(gate, turn, input);
    }
    // Studio's own tools carry their policy, their prompt and their audit record on Studio's side —
    // see the note at the top of `tools.ts`. Allowing here is what stops the same action being put to
    // the user twice.
    if (toolName.startsWith(STUDIO_TOOL_PREFIX)) {
      return { behavior: 'allow', updatedInput: input };
    }
    // A terminal-surface run is confined to its terminal: every built-in is denied, because the
    // confinement is about what the agent may *act on* and a file system is not its terminal.
    if (terminal) {
      return { behavior: 'deny', message: 'This agent can only use the terminal.' };
    }
    if (readOnly) {
      return READ_ONLY_TOOLS.includes(toolName)
        ? { behavior: 'allow', updatedInput: input }
        : {
            behavior: 'deny',
            message:
              'Chat mode is read-only — it can inspect but not modify files or run commands.',
          };
    }
    if (CONFINED_WRITE_TOOLS.includes(toolName)) {
      const target: string | null = writeTargetPath(input);
      if (
        target !== null &&
        confinementRoots.length > 0 &&
        !isWriteWithinRoots(target, confinementRoots)
      ) {
        return {
          behavior: 'deny',
          message:
            `Blocked: "${target}" is outside the agent's allowed write area (the workspace root ` +
            `and your allowed write paths). This is a fixed safety boundary — add the location to ` +
            `your allowed write paths to permit it.`,
        };
      }
      if (
        target !== null &&
        isWriteDenied(target, turn.deniedWritePaths, turn.workspaceRoot ?? homedir())
      ) {
        return {
          behavior: 'deny',
          message: `Blocked: "${target}" is on your denied write paths and cannot be written to.`,
        };
      }
    }
    const displayName: string = prettyToolName(toolName);
    const policy: 'allow' | 'ask' | 'deny' = turn.toolPolicies[displayName] ?? 'ask';
    if (policy === 'deny') {
      return {
        behavior: 'deny',
        message: `Blocked: the ${displayName} tool is set to Deny in your agent settings.`,
      };
    }
    if (
      policy === 'allow' ||
      READ_ONLY_TOOLS.includes(toolName) ||
      turn.permissionPosture === 'auto-all' ||
      (turn.permissionPosture === 'auto-edits' && EDIT_TOOLS.includes(toolName))
    ) {
      // ⛔ `updatedInput` MUST echo the original input: it is what the SDK runs the tool with, and
      // omitting it runs the tool with no arguments and fails as a malformed response.
      return { behavior: 'allow', updatedInput: input };
    }
    const granted: boolean = await decidePermission(
      gate,
      turn,
      displayName,
      toolName,
      input,
      summarizeToolInput(input),
    );
    return granted
      ? { behavior: 'allow', updatedInput: input }
      : { behavior: 'deny', message: 'The user declined to run this tool.' };
  };
}

/**
 * Builds the SDK options for a session.
 * @param gate What the permission gate can reach.
 * @param open The turn the session opens with, which fixes the structural options.
 * @param studio The in-process MCP server exposing Studio's tools.
 * @param systemPrompt Studio's instructions for the surface and mode, as the `tools` answer gave them.
 * @param apiKey The API key to authenticate with, or null to use the local Claude login.
 * @param controller The abort controller wired to the SDK query.
 * @returns Returns the options.
 */
export function buildOptions(
  gate: GateContext,
  open: TurnRequest,
  studio: McpSdkServerConfigWithInstance,
  systemPrompt: string,
  apiKey: string | null,
  controller: AbortController,
): Options {
  const readOnly: boolean = open.mode === 'chat';
  const hasReadableContext: boolean = open.workspaceRoot !== null || open.contextPaths.length > 0;
  // Tools the user's policy denies are removed from the model's context outright rather than left to
  // the gate. 🔥 Necessary, not tidy: the Claude Code CLI auto-runs commands its own safety classifier
  // deems harmless — `echo` and the like — **without calling `canUseTool`**, so a gate-only deny would
  // leak them. The gate's deny below stays as a backstop for anything that does reach it.
  const disallowedTools: readonly string[] = Object.entries(open.toolPolicies)
    .filter(([, value]: [string, string]): boolean => value === 'deny')
    .map(([tool]: [string, string]): string => tool);
  const env: Record<string, string> | null = runEnvironment(open.agentShell, apiKey);
  const executable: string | undefined = resolveExecutable(
    open.providerSettings['claudeExecutable'],
    env ?? process.env,
  );
  note(
    `options: surface=${open.surface} mode=${open.mode} model=${open.model} ` +
      `denied=${disallowedTools.length} roots=${open.allowedWritePaths.length} ` +
      `resume=${String(open.resumeSessionId !== null)}`,
  );
  return {
    model: open.model,
    // `minimal` is not one of the SDK's levels. Studio already clamps to what the handshake declared,
    // so this guards the type rather than the value.
    ...(open.effort !== null && open.effort !== 'minimal'
      ? { effort: open.effort as Options['effort'] }
      : {}),
    cwd: open.workspaceRoot ?? homedir(),
    ...(open.allowedWritePaths.length > 0
      ? { additionalDirectories: [...open.allowedWritePaths] }
      : {}),
    ...(disallowedTools.length > 0 ? { disallowedTools: [...disallowedTools] } : {}),
    hooks: {
      PostToolUse: [
        {
          hooks: [
            (input): Promise<HookJSONOutput> => {
              try {
                // 🔑 Audited at the **execution point**, not at the gate. `PostToolUse` fires for every
                // tool that actually ran — including the commands the CLI's classifier auto-ran
                // without asking, which a gate-based audit missed entirely — and never fires for a
                // denied tool. The grant path is no longer distinguishable here, so the source is the
                // coarse value computed from the turn's policy and posture.
                const turn: TurnRequest = gate.getTurn();
                const post: PostToolUseHookInput = input as PostToolUseHookInput;
                const raw: string = post.tool_name;
                if (
                  READ_ONLY_TOOLS.includes(raw) ||
                  AUDIT_SKIP_TOOLS.includes(raw) ||
                  raw.startsWith('mcp__')
                ) {
                  return Promise.resolve({ continue: true });
                }
                const displayName: string = prettyToolName(raw);
                const policy: 'allow' | 'ask' | 'deny' = turn.toolPolicies[displayName] ?? 'ask';
                gate.audit(
                  turn.requestId,
                  displayName,
                  summarizeToolInput(post.tool_input),
                  coarseGrantSource(policy, turn.permissionPosture, EDIT_TOOLS.includes(raw)),
                );
              } catch {
                // Auditing is best-effort; it must never disturb the run.
              }
              return Promise.resolve({ continue: true });
            },
          ],
        },
      ],
    },
    sandbox: sandboxFor(open),
    systemPrompt: { type: 'preset', preset: 'claude_code', append: systemPrompt },
    mcpServers: { studio },
    // Read-only project exploration is auto-allowed when there is something to read; everything else
    // reaches the gate. Studio's own tools are not listed here — the gate allows them by prefix,
    // because their names are not known until Studio has been asked.
    allowedTools: [...(hasReadableContext && !readOnly ? READ_ONLY_TOOLS : [])],
    canUseTool: buildGate(gate, open),
    abortController: controller,
    // Sub-agent text and thinking arrive with `parent_tool_use_id` set, so the renderer can show
    // nested activity as live progress instead of an opaque "Working…" stall.
    forwardSubagentText: true,
    // A branch resumes only up to its anchor and forks to a new session id, so the discarded turns
    // never reach the model and the original session stays resumable.
    ...(open.resumeSessionId !== null ? { resume: open.resumeSessionId } : {}),
    ...(open.resumeSessionId !== null && open.resumeSessionAt !== null
      ? { resumeSessionAt: open.resumeSessionAt }
      : {}),
    ...(open.resumeSessionId !== null && open.forkSession ? { forkSession: true } : {}),
    // Sent as the API-side task budget, so the model paces its tool use and wraps up before the limit
    // rather than being cut off at it.
    ...(open.tokenCap > 0 ? { taskBudget: { total: open.tokenCap } } : {}),
    ...(executable === undefined ? {} : { pathToClaudeCodeExecutable: executable }),
    ...(env === null ? {} : { env }),
  };
}
