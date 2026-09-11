// Remote Control: bridging a live session to claude.ai/code so it can be watched, and driven, from
// another device.
//
// ⛔ **This is the part of the port that had to move, not merely could.** claude.ai is Anthropic's, and
// a Studio that opened a session on it would be core keeping exactly the vendor code #653 exists to
// remove. The protocol carries the *mode* — `off`, `mirror`, `control` — and what a harness does with
// it is its own business. Everything below is that business.
//
// The `/bridge` SDK surface is `@alpha` and versions independently of the main SDK, so this stays
// deliberately thin and defensive: every failure leaves the local turn untouched and the session simply
// unbridged. A feature that is not available is not a run that fails.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { SDKControlResponse, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type {
  BridgeSessionHandle,
  CreateSessionFailure,
  CredentialsFailure,
  CredentialsRejection,
  RemoteCredentials,
  SessionState,
} from '@anthropic-ai/claude-agent-sdk/bridge';
import { note } from './log';

/**
 * The claude.ai backend the bridge talks to. Overridable for testing or self-hosting; defaults to the
 * public API, the same host the CLI uses.
 */
const BASE_URL: string = process.env['CLAUDE_CODE_API_BASE_URL'] ?? 'https://api.anthropic.com';

/**
 * The timeout applied to each bridge HTTP call, in milliseconds.
 */
const CALL_TIMEOUT_MS: number = 20_000;

/**
 * Details attached to a `requires_action` worker state, which claude.ai surfaces as the session's
 * "waiting on you" state and its push notification.
 *
 * ⚠️ The bridge runtime accepts this as a second argument to `reportState`; the published type omits
 * it. All fields are optional — claude.ai renders whatever is present.
 */
interface RequiresActionDetails {
  readonly tool_name?: string;
  readonly display_tool_name?: string;
  readonly action_description?: string;
  readonly raw_command?: string;
  readonly request_id?: string;
  readonly tool_use_id?: string;
}

/**
 * The runtime's `reportState`, which accepts the {@link RequiresActionDetails} the published type
 * leaves out.
 */
type ReportStateWithDetails = (state: SessionState, details?: RequiresActionDetails) => void;

/**
 * The subset of the SDK's `@alpha` `/bridge` module this uses, imported dynamically so the module load
 * — and the network it implies — happens only when a session actually turns remote control on.
 */
interface BridgeModule {
  createCodeSession(
    baseUrl: string,
    accessToken: string,
    title: string,
    timeoutMs: number,
    tags?: string[],
    gitContext?: undefined,
    cwd?: string,
    model?: string,
  ): Promise<string | CreateSessionFailure | CredentialsRejection | null>;
  fetchRemoteCredentials(
    sessionId: string,
    baseUrl: string,
    accessToken: string,
    timeoutMs: number,
  ): Promise<RemoteCredentials | CredentialsFailure | CredentialsRejection | null>;
  isCredentialsFailure(
    r: RemoteCredentials | CredentialsFailure | CredentialsRejection | null,
  ): r is CredentialsFailure;
  isCredentialsRejection(r: unknown): r is CredentialsRejection;
  isCreateSessionFailure(
    r: string | CreateSessionFailure | CredentialsRejection | null,
  ): r is CreateSessionFailure;
  attachBridgeSession(opts: {
    sessionId: string;
    ingressToken: string;
    apiBaseUrl: string;
    epoch?: number;
    outboundOnly?: boolean;
    onInboundMessage?: (msg: SDKMessage) => void;
    onPermissionResponse?: (res: SDKControlResponse) => void;
    onClose?: (code?: number) => void;
  }): Promise<BridgeSessionHandle>;
}

/**
 * How a session is exposed: `mirror` uploads it view-only, `control` opens the inbound channel so a
 * peer can drive it.
 */
export type AttachMode = 'mirror' | 'control';

/**
 * The context a session hands the bridge when it opens.
 */
export interface RemoteControlOptions {
  readonly mode: AttachMode;
  readonly title: string;
  readonly cwd: string;
  readonly model: string;

  /**
   * Receives a message a peer typed on claude.ai, to be injected into the session as a user turn.
   * Never called in mirror mode.
   * @param text The peer's message.
   */
  readonly onInbound: (text: string) => void;
}

/**
 * Reads the local Claude login's OAuth access token — the same credential the `claude` CLI uses — so
 * this process can call the claude.ai/code bridge API on the user's behalf.
 *
 * ⛔ Read here rather than asked of Studio, and it is not the connection's API key. It is the CLI's own
 * login, which lives where the CLI put it: the macOS Keychain, or `~/.claude/.credentials.json`
 * elsewhere. Studio has no business holding it and the protocol has no way to ask for it.
 * @returns Returns the access token, or null when there is none.
 */
function readAccessToken(): string | null {
  try {
    const raw: string | null =
      process.platform === 'darwin'
        ? ((): string | null => {
            try {
              return execFileSync(
                'security',
                ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
                { encoding: 'utf8', timeout: 5000 },
              );
            } catch {
              return null;
            }
          })()
        : ((): string | null => {
            try {
              return readFileSync(join(homedir(), '.claude', '.credentials.json'), 'utf8');
            } catch {
              return null;
            }
          })();
    if (raw === null) {
      return null;
    }
    const parsed: { claudeAiOauth?: { accessToken?: unknown } } = JSON.parse(raw) as {
      claudeAiOauth?: { accessToken?: unknown };
    };
    const token: unknown = parsed.claudeAiOauth?.accessToken;
    return typeof token === 'string' && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

/**
 * Extracts the plain text of a peer's inbound message, or null when it carries none.
 * @param message The inbound SDK message from claude.ai.
 * @returns Returns the text, or null.
 */
export function inboundText(message: SDKMessage): string | null {
  const content: unknown = (message as { message?: { content?: unknown } }).message?.content;
  if (typeof content === 'string') {
    return content.length > 0 ? content : null;
  }
  if (Array.isArray(content)) {
    const text: string = content
      .map((block: unknown): string => {
        const candidate: { type?: unknown; text?: unknown } = block ?? {};
        return candidate.type === 'text' && typeof candidate.text === 'string'
          ? candidate.text
          : '';
      })
      .join('');
    return text.length > 0 ? text : null;
  }
  return null;
}

/**
 * Reads an allow/deny decision from a claude.ai permission response.
 *
 * ⚠️ Defensively, and that is not paranoia: the shape is undocumented `@alpha`. Several plausible
 * encodings are accepted and **anything unrecognised is a denial**, which is the safe direction for
 * the one message that decides whether a tool runs.
 * @param payload The response record.
 * @returns Returns true when the peer allowed the tool.
 */
export function parseGranted(payload: unknown): boolean {
  if (payload === null || typeof payload !== 'object') {
    return false;
  }
  const record: Record<string, unknown> = payload as Record<string, unknown>;
  return (
    record['behavior'] === 'allow' ||
    record['allow'] === true ||
    record['granted'] === true ||
    record['decision'] === 'approve' ||
    record['result'] === 'allow'
  );
}

/**
 * Reads an `AskUserQuestion` answer from a claude.ai control response.
 *
 * The peer answers as a `canUseTool` result, so the answer rides in `updatedInput` (`{questions,
 * answers}`); a bare `{answers}` or `{response}` payload is accepted too.
 * @param payload The response record.
 * @returns Returns the payload to hand the tool, or null when the peer declined.
 */
export function parseQuestionAnswer(payload: unknown): Record<string, unknown> | null {
  if (payload === null || typeof payload !== 'object') {
    return null;
  }
  const record: Record<string, unknown> = payload as Record<string, unknown>;
  if (record['behavior'] === 'deny' || record['allow'] === false) {
    return null;
  }
  const updated: unknown = record['updatedInput'] ?? record['updated_input'];
  if (updated !== null && typeof updated === 'object') {
    return updated as Record<string, unknown>;
  }
  if (record['answers'] !== undefined || record['response'] !== undefined) {
    return record;
  }
  return null;
}

/**
 * Resolves the pending prompt a claude.ai `control_response` answers, dispatched by which map holds
 * the response's request id. A response for an unknown id is ignored.
 * @param permissions The in-flight permission resolvers, by control-request id.
 * @param questions The in-flight question resolvers, by control-request id.
 * @param res The control response.
 */
export function resolveControlResponse(
  permissions: Map<string, (granted: boolean) => void>,
  questions: Map<string, (answer: Record<string, unknown> | null) => void>,
  res: SDKControlResponse,
): void {
  const inner: { request_id?: unknown; subtype?: unknown; response?: unknown } | undefined = (
    res as { response?: { request_id?: unknown; subtype?: unknown; response?: unknown } }
  ).response;
  const requestId: unknown = inner?.request_id;
  if (typeof requestId !== 'string') {
    return;
  }
  const isError: boolean = inner?.subtype === 'error';
  const permission: ((granted: boolean) => void) | undefined = permissions.get(requestId);
  if (permission !== undefined) {
    permissions.delete(requestId);
    permission(isError ? false : parseGranted(inner?.response));
    return;
  }
  const question: ((answer: Record<string, unknown> | null) => void) | undefined =
    questions.get(requestId);
  if (question !== undefined) {
    questions.delete(requestId);
    question(isError ? null : parseQuestionAnswer(inner?.response));
  }
}

/**
 * Bridges one live Claude session to claude.ai/code.
 *
 * It mints a code session with the user's local login, attaches a worker, forwards the session's
 * messages outbound so it is watchable, and — in control mode — feeds peer messages back through
 * {@link RemoteControlOptions.onInbound}.
 */
export class RemoteControlBridge {
  /**
   * The turn state last reported, so it is toggled only on change.
   */
  private reportedState: 'idle' | 'running' | 'requires_action' = 'idle';

  /**
   * Whether the bridge has been closed.
   */
  private closed: boolean = false;

  /**
   * A monotonic counter minting per-prompt control-request ids, for permissions and questions alike.
   */
  private seq: number = 0;

  /**
   * Initialises a new instance of the {@link RemoteControlBridge} class.
   * @param handle The attached bridge session handle.
   * @param sessionId The claude.ai code-session id.
   * @param mode Whether the session is mirrored or controllable.
   * @param permissions The in-flight permission prompts, shared with the attach callback so a
   * claude.ai answer resolves the awaiting request.
   * @param questions The in-flight question prompts, shared for the same reason.
   */
  private constructor(
    private readonly handle: BridgeSessionHandle,
    public readonly sessionId: string,
    private readonly mode: AttachMode,
    private readonly permissions: Map<string, (granted: boolean) => void>,
    private readonly questions: Map<string, (answer: Record<string, unknown> | null) => void>,
  ) {}

  /**
   * Gets whether a peer can be asked to decide — only a live control-mode session can, since a mirror
   * is view-only.
   */
  public get canPrompt(): boolean {
    return !this.closed && this.mode === 'control';
  }

  /**
   * Opens a bridge: creates the code session, mints worker credentials, and attaches.
   * @param options The session context.
   * @returns Returns the bridge, or null when it could not be established.
   */
  public static async open(options: RemoteControlOptions): Promise<RemoteControlBridge | null> {
    try {
      const token: string | null = readAccessToken();
      if (token === null) {
        note('remote-control: no local Claude login, so remote control is unavailable');
        return null;
      }
      const bridge: BridgeModule = await import('@anthropic-ai/claude-agent-sdk/bridge');
      const created: string | CreateSessionFailure | CredentialsRejection | null =
        await bridge.createCodeSession(
          BASE_URL,
          token,
          options.title,
          CALL_TIMEOUT_MS,
          ['onixlabs-studio'],
          undefined,
          options.cwd,
          options.model,
        );
      // The SDK classifies the failure so a caller can decide whether to retry. This one never does —
      // remote control is best-effort — so the classification only sharpens the log line.
      if (created === null) {
        note('remote-control: could not create a claude.ai code session (transient)');
        return null;
      }
      if (bridge.isCredentialsRejection(created)) {
        note('remote-control: the local Claude login was rejected; sign in again');
        return null;
      }
      if (bridge.isCreateSessionFailure(created)) {
        note(
          `remote-control: could not create a claude.ai code session: ${created.reason} (HTTP ${created.status})`,
        );
        return null;
      }
      const sessionId: string = created;
      const creds: RemoteCredentials | CredentialsFailure | CredentialsRejection | null =
        await bridge.fetchRemoteCredentials(sessionId, BASE_URL, token, CALL_TIMEOUT_MS);
      if (
        creds === null ||
        bridge.isCredentialsFailure(creds) ||
        bridge.isCredentialsRejection(creds)
      ) {
        note(
          `remote-control: could not mint worker credentials: ${creds === null ? 'transient failure' : creds.reason}`,
        );
        return null;
      }
      const permissions: Map<string, (granted: boolean) => void> = new Map<
        string,
        (granted: boolean) => void
      >();
      const questions: Map<string, (answer: Record<string, unknown> | null) => void> = new Map<
        string,
        (answer: Record<string, unknown> | null) => void
      >();
      const handle: BridgeSessionHandle = await bridge.attachBridgeSession({
        sessionId,
        ingressToken: creds.worker_jwt,
        apiBaseUrl: creds.api_base_url,
        epoch: creds.worker_epoch,
        // Mirror is view-only: forward outbound, never open the inbound control stream.
        outboundOnly: options.mode === 'mirror',
        onInboundMessage:
          options.mode === 'control'
            ? (msg: SDKMessage): void => {
                const text: string | null = inboundText(msg);
                if (text !== null) {
                  options.onInbound(text);
                }
              }
            : undefined,
        onPermissionResponse:
          options.mode === 'control'
            ? (res: SDKControlResponse): void => resolveControlResponse(permissions, questions, res)
            : undefined,
        onClose: (code?: number): void =>
          note(`remote-control: bridge transport closed (code ${code ?? 'n/a'})`),
      });
      handle.reportMetadata({ cwd: options.cwd });
      handle.reportState('idle');
      note(`remote-control: session ${sessionId} bridged to claude.ai/code (${options.mode})`);
      return new RemoteControlBridge(handle, sessionId, options.mode, permissions, questions);
    } catch (error: unknown) {
      note(`remote-control: failed to open the bridge: ${String(error)}`);
      return null;
    }
  }

  /**
   * Forwards one of the session's SDK messages so the session is watchable, deriving the "working"
   * state and the turn boundary from the message type.
   * @param message The SDK message the session's pump received.
   */
  public forward(message: SDKMessage): void {
    if (this.closed) {
      return;
    }
    try {
      this.handle.write(message);
      const type: string | undefined = (message as { type?: string }).type;
      if (type === 'assistant') {
        this.setState('running');
      } else if (type === 'result') {
        this.handle.sendResult();
        this.setState('idle');
      }
    } catch {
      // Forwarding is best-effort; a failure never disturbs the local turn.
    }
  }

  /**
   * Forwards a permission prompt so a peer can answer it.
   *
   * Returns the control-request id — so the prompt can be cancelled if Studio answers first — and a
   * promise that resolves with the peer's decision. ⚠️ On a forwarding failure the promise is left
   * **unresolved on purpose**: the local prompt then decides the race uncontested, which is what
   * should happen when the remote side could not be asked.
   * @param toolName The SDK tool name requesting permission.
   * @param input The tool's input.
   * @param action What to show as the "waiting on you" detail.
   * @returns Returns the request id and the peer-decision promise.
   */
  public requestPermission(
    toolName: string,
    input: Record<string, unknown>,
    action?: {
      readonly displayName?: string;
      readonly description?: string;
      readonly toolUseId?: string;
    },
  ): { readonly id: string; readonly granted: Promise<boolean> } {
    const id: string = `studio-perm-${(this.seq += 1)}`;
    const granted: Promise<boolean> = new Promise<boolean>(
      (resolve: (granted: boolean) => void): void => {
        this.permissions.set(id, resolve);
        try {
          // The wire requires a tool_use_id; the answer is correlated by request_id, so when the
          // caller has no tool-use id the request id stands in.
          this.handle.sendControlRequest({
            type: 'control_request',
            request_id: id,
            request: {
              subtype: 'can_use_tool',
              tool_name: toolName,
              input,
              tool_use_id: action?.toolUseId ?? id,
            },
          });
          // Mark the session "waiting on you" so claude.ai shows it needs attention and pushes a
          // notification; the runtime does not derive that from the control request itself.
          this.reportAction({
            tool_name: toolName,
            display_tool_name: action?.displayName,
            action_description: action?.description,
            request_id: id,
            tool_use_id: action?.toolUseId,
          });
        } catch {
          this.permissions.delete(id);
        }
      },
    );
    return { id, granted };
  }

  /**
   * Cancels a forwarded permission prompt, dismissing it on claude.ai.
   * @param id The control-request id.
   */
  public cancelPermission(id: string): void {
    if (!this.permissions.delete(id) || this.closed) {
      return;
    }
    try {
      this.handle.sendControlCancelRequest(id);
    } catch {
      // Best-effort.
    }
  }

  /**
   * Forwards an `AskUserQuestion` prompt so a peer can answer it natively — the mobile app and web
   * render the built-in question card with its options.
   *
   * Rides the same `can_use_tool` control channel as a permission, keyed on the built-in tool name so
   * claude.ai draws the question rather than an allow/deny prompt.
   * @param input The tool input, carrying its `questions` array.
   * @param firstQuestion The first question's text, surfaced as the "waiting on you" detail.
   * @returns Returns the request id and the peer-answer promise.
   */
  public requestQuestions(
    input: Record<string, unknown>,
    firstQuestion?: string,
  ): { readonly id: string; readonly answer: Promise<Record<string, unknown> | null> } {
    const id: string = `studio-ask-${(this.seq += 1)}`;
    const answer: Promise<Record<string, unknown> | null> = new Promise<Record<
      string,
      unknown
    > | null>((resolve: (answer: Record<string, unknown> | null) => void): void => {
      this.questions.set(id, resolve);
      try {
        this.handle.sendControlRequest({
          type: 'control_request',
          request_id: id,
          request: {
            subtype: 'can_use_tool',
            tool_name: 'AskUserQuestion',
            input,
            tool_use_id: id,
          },
        });
        this.reportAction({
          tool_name: 'AskUserQuestion',
          display_tool_name: 'Question',
          action_description: firstQuestion,
          request_id: id,
        });
      } catch {
        this.questions.delete(id);
      }
    });
    return { id, answer };
  }

  /**
   * Cancels a forwarded question, dismissing it on claude.ai.
   * @param id The control-request id.
   */
  public cancelQuestion(id: string): void {
    if (!this.questions.delete(id) || this.closed) {
      return;
    }
    try {
      this.handle.sendControlCancelRequest(id);
    } catch {
      // Best-effort.
    }
  }

  /**
   * Clears a `requires_action` state once the prompt it marked has settled, returning the session to a
   * running turn on claude.ai.
   */
  public clearAction(): void {
    if (this.reportedState === 'requires_action') {
      this.setState('running');
    }
  }

  /**
   * Closes the bridge, ending the claude.ai worker. Idempotent.
   */
  public close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    try {
      this.handle.close();
    } catch {
      // Teardown is best-effort.
    }
  }

  /**
   * Reports a turn-state change, coalescing repeats.
   * @param state The new state.
   */
  private setState(state: 'idle' | 'running' | 'requires_action'): void {
    if (state === this.reportedState) {
      return;
    }
    this.reportedState = state;
    this.handle.reportState(state);
  }

  /**
   * Marks the session `requires_action` with details of what it is waiting for, so the remote UI shows
   * the pending prompt and the backend can push a notification.
   *
   * Sent even when already `requires_action`, because the details may differ.
   * @param details What the session is waiting on.
   */
  private reportAction(details: RequiresActionDetails): void {
    if (this.closed) {
      return;
    }
    this.reportedState = 'requires_action';
    try {
      // The runtime forwards the second argument even though the published type omits it; binding into
      // the wider type calls it with details without an unnecessary assertion.
      const report: ReportStateWithDetails = this.handle.reportState.bind(this.handle);
      report('requires_action', details);
    } catch {
      // Best-effort.
    }
  }
}
