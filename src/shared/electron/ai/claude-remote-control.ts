import type { SDKControlResponse, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type {
  BridgeSessionHandle,
  CredentialsFailure,
  RemoteCredentials,
  SessionState,
} from '@anthropic-ai/claude-agent-sdk/bridge';
import { logger } from '../logger';
import { readClaudeAccessToken } from './claude-credentials';

/**
 * Details attached to a `requires_action` worker state, surfaced by claude.ai as the session's "waiting
 * on you" state and its push notification. The bridge runtime accepts this as a second argument to
 * `reportState` (the public type omits it); the shape mirrors the runtime's `requires_action_details`.
 * All fields optional — claude.ai renders whatever is present.
 */
interface RequiresActionDetails {
  /**
   * Gets the raw tool name the action is for (e.g. `Bash`), or undefined for a non-tool prompt.
   */
  readonly tool_name?: string;

  /**
   * Gets the human-facing tool name (e.g. `Run command`), or undefined.
   */
  readonly display_tool_name?: string;

  /**
   * Gets a one-line description of what is being asked (the permission target, or the question text).
   */
  readonly action_description?: string;

  /**
   * Gets the raw command a shell action would run, or undefined.
   */
  readonly raw_command?: string;

  /**
   * Gets the correlating control-request id, or undefined.
   */
  readonly request_id?: string;

  /**
   * Gets the correlating tool-use id, or undefined.
   */
  readonly tool_use_id?: string;
}

/**
 * The bridge runtime's `reportState`, which (unlike the published type) accepts an optional
 * {@link RequiresActionDetails} second argument used with the `requires_action` state.
 */
type ReportStateWithDetails = (state: SessionState, details?: RequiresActionDetails) => void;

/**
 * The claude.ai backend the bridge talks to. Overridable for testing/self-hosting; defaults to the
 * public API (the same host the CLI uses).
 */
const BASE_URL: string = process.env['CLAUDE_CODE_API_BASE_URL'] ?? 'https://api.anthropic.com';

/**
 * The timeout applied to each bridge HTTP call, in milliseconds.
 */
const CALL_TIMEOUT_MS: number = 20_000;

/**
 * The subset of the SDK's `@alpha` `/bridge` module this uses, imported dynamically so the module load
 * (and the network it implies) happens only when a session actually enables remote control.
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
  ): Promise<string | null>;
  fetchRemoteCredentials(
    sessionId: string,
    baseUrl: string,
    accessToken: string,
    timeoutMs: number,
  ): Promise<RemoteCredentials | CredentialsFailure | null>;
  isCredentialsFailure(r: RemoteCredentials | CredentialsFailure | null): r is CredentialsFailure;
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
 * How the session is exposed by the bridge: `mirror` uploads it view-only (a peer can watch but not
 * act); `control` opens the inbound channel so a peer can drive it.
 */
export type RemoteControlAttachMode = 'mirror' | 'control';

/**
 * The context a session hands the bridge when it opens.
 */
export interface RemoteControlOptions {
  /**
   * Gets whether the session is mirrored (view-only) or fully controllable.
   */
  readonly mode: RemoteControlAttachMode;

  /**
   * Gets the session title shown on claude.ai/code.
   */
  readonly title: string;

  /**
   * Gets the working directory the session runs in (shown on claude.ai).
   */
  readonly cwd: string;

  /**
   * Gets the model the session runs with.
   */
  readonly model: string;

  /**
   * Receives a message a peer typed on claude.ai (control mode only), to be injected into the session as
   * a user turn. Never called in mirror mode.
   * @param text The peer's message text.
   */
  readonly onInbound: (text: string) => void;
}

/**
 * Bridges one live Claude session to claude.ai/code (#331). It mints a code session with the user's
 * local login, attaches a worker, forwards the session's messages outbound so the session is watchable,
 * and — in control mode — feeds peer messages back through {@link RemoteControlOptions.onInbound}. The
 * whole thing is best-effort: any failure leaves the local agent untouched.
 *
 * The `/bridge` SDK surface is `@alpha` and versions independently of the main SDK, so this is
 * deliberately thin and defensive.
 */
export class RemoteControlBridge {
  /**
   * The turn state last reported to claude.ai, so it is toggled only on change. `requires_action`
   * marks the session as waiting on the peer (an in-app question is pending).
   */
  private reportedState: 'idle' | 'running' | 'requires_action' = 'idle';

  /**
   * Whether the bridge has been closed.
   */
  private closed: boolean = false;

  /**
   * A monotonic counter minting per-prompt control-request ids (permissions and questions alike).
   */
  private permissionSeq: number = 0;

  /**
   * Initialises a new instance of the {@link RemoteControlBridge} class.
   * @param handle The attached bridge session handle.
   * @param sessionId The claude.ai code-session id.
   * @param mode Whether the session is mirrored (view-only) or fully controllable.
   * @param pendingPermissions The in-flight permission prompts keyed by control-request id (shared with
   * the attach callback so a claude.ai answer resolves the awaiting request).
   * @param pendingQuestions The in-flight `AskUserQuestion` prompts keyed by control-request id (shared
   * with the attach callback so a claude.ai answer resolves the awaiting request).
   */
  private constructor(
    private readonly handle: BridgeSessionHandle,
    public readonly sessionId: string,
    private readonly mode: RemoteControlAttachMode,
    private readonly pendingPermissions: Map<string, (granted: boolean) => void>,
    private readonly pendingQuestions: Map<
      string,
      (answer: Record<string, unknown> | null) => void
    >,
  ) {}

  /**
   * Gets whether the bridge can prompt a peer for a permission decision — only a live control-mode
   * session can (a mirror is view-only).
   */
  public get canPrompt(): boolean {
    return !this.closed && this.mode === 'control';
  }

  /**
   * Opens a bridge for a session: creates the code session, mints worker credentials, and attaches.
   * Returns null (having logged why) when remote control is unavailable — no local login, a transient
   * failure, or a terminal auth failure (untrusted device / stale login).
   * @param options The session context.
   * @returns Returns the bridge, or null when it could not be established.
   */
  public static async open(options: RemoteControlOptions): Promise<RemoteControlBridge | null> {
    try {
      const token: string | null = readClaudeAccessToken();
      if (token === null) {
        logger.warn('ClaudeRemoteControl', 'No local Claude login; remote control unavailable');
        return null;
      }
      const bridge: BridgeModule = await import('@anthropic-ai/claude-agent-sdk/bridge');
      const sessionId: string | null = await bridge.createCodeSession(
        BASE_URL,
        token,
        options.title,
        CALL_TIMEOUT_MS,
        ['onixlabs-studio'],
        undefined,
        options.cwd,
        options.model,
      );
      if (sessionId === null) {
        logger.warn('ClaudeRemoteControl', 'Could not create a claude.ai code session');
        return null;
      }
      const creds: RemoteCredentials | CredentialsFailure | null =
        await bridge.fetchRemoteCredentials(sessionId, BASE_URL, token, CALL_TIMEOUT_MS);
      if (creds === null || bridge.isCredentialsFailure(creds)) {
        const reason: string = creds === null ? 'transient failure' : creds.reason;
        logger.warn('ClaudeRemoteControl', `Could not mint worker credentials: ${reason}`);
        return null;
      }
      // The permission and question prompts awaiting a claude.ai answer, shared with the attach callback
      // below so a `control_response` from the remote device resolves the awaiting request. Wired here (before
      // the instance exists) so the callback can be passed to `attachBridgeSession`.
      const pendingPermissions: Map<string, (granted: boolean) => void> = new Map<
        string,
        (granted: boolean) => void
      >();
      const pendingQuestions: Map<string, (answer: Record<string, unknown> | null) => void> =
        new Map<string, (answer: Record<string, unknown> | null) => void>();
      const handle: BridgeSessionHandle = await bridge.attachBridgeSession({
        sessionId,
        ingressToken: creds.worker_jwt,
        apiBaseUrl: creds.api_base_url,
        epoch: creds.worker_epoch,
        // Mirror = view-only: forward outbound only, never open the inbound control stream.
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
            ? (res: SDKControlResponse): void =>
                resolveControlResponse(pendingPermissions, pendingQuestions, res)
            : undefined,
        onClose: (code?: number): void =>
          logger.debug('ClaudeRemoteControl', `Bridge transport closed (code ${code ?? 'n/a'})`),
      });
      handle.reportMetadata({ cwd: options.cwd });
      handle.reportState('idle');
      logger.info(
        'ClaudeRemoteControl',
        `Session ${sessionId} bridged to claude.ai/code (${options.mode})`,
      );
      return new RemoteControlBridge(
        handle,
        sessionId,
        options.mode,
        pendingPermissions,
        pendingQuestions,
      );
    } catch (error: unknown) {
      logger.warn('ClaudeRemoteControl', 'Failed to open the remote-control bridge', error);
      return null;
    }
  }

  /**
   * Forwards one of the session's SDK messages to claude.ai so the session is watchable, deriving the
   * "working" state and turn boundary from the message type. Best-effort — a forward failure never
   * disturbs the local run.
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
    } catch (error: unknown) {
      logger.debug('ClaudeRemoteControl', 'Forwarding a message to the bridge failed', error);
    }
  }

  /**
   * Forwards a permission prompt to claude.ai so the peer can answer it, returning the control-request
   * id (to cancel the prompt if answered locally first) and a promise that resolves with the peer's
   * allow/deny decision. Only meaningful in control mode; the caller gates on {@link canPrompt}.
   * @param toolName The SDK tool name requesting permission.
   * @param input The tool's input.
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
    const id: string = `studio-perm-${(this.permissionSeq += 1)}`;
    const granted: Promise<boolean> = new Promise<boolean>(
      (resolve: (granted: boolean) => void): void => {
        this.pendingPermissions.set(id, resolve);
        try {
          this.handle.sendControlRequest({
            type: 'control_request',
            request_id: id,
            request: { subtype: 'can_use_tool', tool_name: toolName, input },
          });
          // Mark the session "waiting on you" so claude.ai shows it needs attention and pushes a
          // notification (the runtime does not derive this from the control request itself).
          this.reportAction({
            tool_name: toolName,
            display_tool_name: action?.displayName,
            action_description: action?.description,
            request_id: id,
            tool_use_id: action?.toolUseId,
          });
        } catch (error: unknown) {
          // Forwarding failed: drop the pending entry and never resolve, so the local prompt decides the
          // race instead.
          this.pendingPermissions.delete(id);
          logger.debug(
            'ClaudeRemoteControl',
            'Forwarding a permission prompt to the bridge failed',
            error,
          );
        }
      },
    );
    return { id, granted };
  }

  /**
   * Cancels a forwarded permission prompt (the local prompt was answered first), dismissing it on
   * claude.ai. Best-effort.
   * @param id The control-request id returned by {@link requestPermission}.
   */
  public cancelPermission(id: string): void {
    if (!this.pendingPermissions.delete(id) || this.closed) {
      return;
    }
    try {
      this.handle.sendControlCancelRequest(id);
    } catch (error: unknown) {
      logger.debug('ClaudeRemoteControl', 'Cancelling a forwarded permission prompt failed', error);
    }
  }

  /**
   * Forwards an `AskUserQuestion` prompt to claude.ai so the peer can answer it natively (the mobile
   * app and web render the built-in question card with its multiple-choice options), returning the
   * control-request id (to cancel if answered locally first) and a promise that resolves with the
   * peer's answer — the `updatedInput` payload the remote device sends back (`{questions, answers}`), or null
   * when the peer declines. Rides the same `can_use_tool` control channel as a permission, keyed on the
   * built-in tool name so claude.ai renders the question rather than an allow/deny prompt. Only
   * meaningful in control mode; the caller gates on {@link canPrompt}.
   * @param input The `AskUserQuestion` tool input (its `questions` array).
   * @param firstQuestion The first question's text, surfaced as the `requires_action` detail (and push).
   * @returns Returns the request id and the peer-answer promise.
   */
  public requestQuestions(
    input: Record<string, unknown>,
    firstQuestion?: string,
  ): { readonly id: string; readonly answer: Promise<Record<string, unknown> | null> } {
    const id: string = `studio-ask-${(this.permissionSeq += 1)}`;
    const answer: Promise<Record<string, unknown> | null> = new Promise<Record<
      string,
      unknown
    > | null>((resolve: (answer: Record<string, unknown> | null) => void): void => {
      this.pendingQuestions.set(id, resolve);
      try {
        this.handle.sendControlRequest({
          type: 'control_request',
          request_id: id,
          request: { subtype: 'can_use_tool', tool_name: 'AskUserQuestion', input },
        });
        this.reportAction({
          tool_name: 'AskUserQuestion',
          display_tool_name: 'Question',
          action_description: firstQuestion,
          request_id: id,
        });
      } catch (error: unknown) {
        // Forwarding failed: drop the pending entry and never resolve, so the local prompt decides.
        this.pendingQuestions.delete(id);
        logger.debug('ClaudeRemoteControl', 'Forwarding a question to the bridge failed', error);
      }
    });
    return { id, answer };
  }

  /**
   * Cancels a forwarded question (answered locally first), dismissing it on claude.ai. Best-effort.
   * @param id The control-request id returned by {@link requestQuestions}.
   */
  public cancelQuestion(id: string): void {
    if (!this.pendingQuestions.delete(id) || this.closed) {
      return;
    }
    try {
      this.handle.sendControlCancelRequest(id);
    } catch (error: unknown) {
      logger.debug('ClaudeRemoteControl', 'Cancelling a forwarded question failed', error);
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
   * Clears a `requires_action` state once the prompt it marked has settled, returning the session to a
   * running turn on claude.ai. A no-op if the session is not currently waiting.
   */
  public clearAction(): void {
    if (this.reportedState === 'requires_action') {
      this.setState('running');
    }
  }

  /**
   * Reports a turn-state change to claude.ai, coalescing repeats.
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
   * Marks the session `requires_action` on claude.ai with details of what it is waiting for, so the
   * remote UI shows the pending prompt and the backend can push a notification. Best-effort — a failure
   * never disturbs the local run. Sent even when already `requires_action` (the details may differ).
   * @param details What the session is waiting on (the tool, or the question text).
   */
  private reportAction(details: RequiresActionDetails): void {
    if (this.closed) {
      return;
    }
    this.reportedState = 'requires_action';
    try {
      // The runtime `reportState` forwards the second argument even though the published type omits it;
      // binding into the wider type calls it with details without an (unnecessary) assertion.
      const report: ReportStateWithDetails = this.handle.reportState.bind(this.handle);
      report('requires_action', details);
    } catch (error: unknown) {
      logger.debug('ClaudeRemoteControl', 'Reporting requires_action to the bridge failed', error);
    }
  }
}

/**
 * Extracts the plain text of a peer's inbound user message, or null when it carries no text.
 * @param message The inbound SDK message from claude.ai.
 * @returns Returns the message text, or null.
 */
export function inboundText(message: SDKMessage): string | null {
  const content: unknown = (message as { message?: { content?: unknown } }).message?.content;
  if (typeof content === 'string') {
    return content.length > 0 ? content : null;
  }
  if (Array.isArray(content)) {
    const text: string = content
      .filter((block: unknown): block is { text: string } => {
        const candidate: { type?: unknown; text?: unknown } = block as {
          type?: unknown;
          text?: unknown;
        };
        return candidate.type === 'text' && typeof candidate.text === 'string';
      })
      .map((block: { text: string }): string => block.text)
      .join('');
    return text.length > 0 ? text : null;
  }
  return null;
}

/**
 * Resolves the pending prompt a claude.ai `control_response` answers — a permission (allow/deny) or an
 * `AskUserQuestion` (the answers payload) — dispatched by which map holds the response's request id. The
 * raw response is logged (its exact shape is undocumented `@alpha`) so it can be confirmed from a real
 * run. A response for an unknown id is ignored.
 * @param pendingPermissions The in-flight permission resolvers keyed by control-request id.
 * @param pendingQuestions The in-flight question resolvers keyed by control-request id.
 * @param res The control response from claude.ai.
 */
export function resolveControlResponse(
  pendingPermissions: Map<string, (granted: boolean) => void>,
  pendingQuestions: Map<string, (answer: Record<string, unknown> | null) => void>,
  res: SDKControlResponse,
): void {
  logger.debug('ClaudeRemoteControl', `control_response: ${JSON.stringify(res).slice(0, 800)}`);
  const inner: { request_id?: unknown; subtype?: unknown; response?: unknown } | undefined = (
    res as { response?: { request_id?: unknown; subtype?: unknown; response?: unknown } }
  ).response;
  const requestId: unknown = inner?.request_id;
  if (typeof requestId !== 'string') {
    return;
  }
  const isError: boolean = inner?.subtype === 'error';
  const permission: ((granted: boolean) => void) | undefined = pendingPermissions.get(requestId);
  if (permission !== undefined) {
    pendingPermissions.delete(requestId);
    permission(isError ? false : parseGranted(inner?.response));
    return;
  }
  const question: ((answer: Record<string, unknown> | null) => void) | undefined =
    pendingQuestions.get(requestId);
  if (question !== undefined) {
    pendingQuestions.delete(requestId);
    question(isError ? null : parseQuestionAnswer(inner?.response));
  }
}

/**
 * Reads an allow/deny decision from a claude.ai permission response payload, defensively — the exact
 * shape is undocumented `@alpha`, so several plausible encodings are accepted; anything unrecognised is
 * treated as a denial.
 * @param payload The `response.response` record from the control response.
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
 * Reads an `AskUserQuestion` answer from a claude.ai control response, defensively — the exact shape is
 * undocumented `@alpha`. The peer answers like a `canUseTool` result, so the answer object rides in
 * `updatedInput` (`{questions, answers}`); a bare `{answers}` or `{response}` payload is also accepted.
 * Returns null when the peer declined (a deny behavior) or nothing usable is present.
 * @param payload The `response.response` record from the control response.
 * @returns Returns the `{questions?, answers?, response?}` payload to hand the tool, or null on decline.
 */
export function parseQuestionAnswer(payload: unknown): Record<string, unknown> | null {
  if (payload === null || typeof payload !== 'object') {
    return null;
  }
  const record: Record<string, unknown> = payload as Record<string, unknown>;
  // An explicit deny is a decline.
  if (record['behavior'] === 'deny' || record['allow'] === false) {
    return null;
  }
  // The canUseTool contract nests the answer under `updatedInput`; accept it, or a bare answer payload.
  const updated: unknown = record['updatedInput'] ?? record['updated_input'];
  if (updated !== null && typeof updated === 'object') {
    return updated as Record<string, unknown>;
  }
  if (record['answers'] !== undefined || record['response'] !== undefined) {
    return record;
  }
  return null;
}
