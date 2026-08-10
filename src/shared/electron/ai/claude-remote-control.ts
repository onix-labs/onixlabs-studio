import type { SDKControlResponse, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type {
  BridgeSessionHandle,
  CredentialsFailure,
  RemoteCredentials,
} from '@anthropic-ai/claude-agent-sdk/bridge';
import { logger } from '../logger';
import { readClaudeAccessToken } from './claude-credentials';

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
   * A monotonic counter minting per-permission control-request ids.
   */
  private permissionSeq: number = 0;

  /**
   * The resolver of a question awaiting a peer's answer (an armed {@link requestInput}), or null when
   * no question is pending. The peer answers by typing an inbound message, which {@link consumeInbound}
   * routes here instead of steering the session.
   */
  private pendingInput: ((answer: string) => void) | null = null;

  /**
   * Initialises a new instance of the {@link RemoteControlBridge} class.
   * @param handle The attached bridge session handle.
   * @param sessionId The claude.ai code-session id.
   * @param mode Whether the session is mirrored (view-only) or fully controllable.
   * @param pendingPermissions The in-flight permission prompts keyed by control-request id (shared with
   * the attach callback so a claude.ai answer resolves the awaiting request).
   */
  private constructor(
    private readonly handle: BridgeSessionHandle,
    public readonly sessionId: string,
    private readonly mode: RemoteControlAttachMode,
    private readonly pendingPermissions: Map<string, (granted: boolean) => void>,
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
      const creds: RemoteCredentials | CredentialsFailure | null = await bridge.fetchRemoteCredentials(
        sessionId,
        BASE_URL,
        token,
        CALL_TIMEOUT_MS,
      );
      if (creds === null || bridge.isCredentialsFailure(creds)) {
        const reason: string = creds === null ? 'transient failure' : creds.reason;
        logger.warn('ClaudeRemoteControl', `Could not mint worker credentials: ${reason}`);
        return null;
      }
      // The permission prompts awaiting a claude.ai answer, shared with the attach callback below so a
      // `control_response` from the phone resolves the awaiting request. Wired here (before the instance
      // exists) so the callback can be passed to `attachBridgeSession`.
      const pendingPermissions: Map<string, (granted: boolean) => void> = new Map<
        string,
        (granted: boolean) => void
      >();
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
            ? (res: SDKControlResponse): void => resolvePermissionResponse(pendingPermissions, res)
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
      return new RemoteControlBridge(handle, sessionId, options.mode, pendingPermissions);
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
  ): { readonly id: string; readonly granted: Promise<boolean> } {
    const id: string = `studio-perm-${(this.permissionSeq += 1)}`;
    const granted: Promise<boolean> = new Promise<boolean>((resolve: (granted: boolean) => void): void => {
      this.pendingPermissions.set(id, resolve);
      try {
        this.handle.sendControlRequest({
          type: 'control_request',
          request_id: id,
          request: { subtype: 'can_use_tool', tool_name: toolName, input },
        });
      } catch (error: unknown) {
        // Forwarding failed: drop the pending entry and never resolve, so the local prompt decides the
        // race instead.
        this.pendingPermissions.delete(id);
        logger.debug('ClaudeRemoteControl', 'Forwarding a permission prompt to the bridge failed', error);
      }
    });
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
   * Arms the bridge to answer an in-app question ({@link askUser}) from the peer: the session marks
   * itself `requires_action` on claude.ai, and the peer's next inbound message is taken as the answer
   * (routed here by {@link consumeInbound}) rather than steering the session. The question text is
   * already visible to the peer (the `ask_user` tool call is in the forwarded transcript). Only
   * meaningful in control mode; the caller gates on {@link canPrompt}.
   *
   * The peer channel gives no way to render suggested-answer buttons, so a choice question is answered
   * by the peer typing the label as free text — same as a Studio user typing their own answer.
   * @returns Returns the peer-answer promise and a `cancel` that disarms the capture (used when the
   * local prompt is answered first, so a later inbound message steers again instead of being eaten).
   */
  public requestInput(): { readonly answer: Promise<string>; readonly cancel: () => void } {
    // Only one question is pending at a time (a turn asks once and blocks); a prior capture is
    // superseded — its promise simply never resolves and the local prompt decides that older race.
    this.setState('requires_action');
    const answer: Promise<string> = new Promise<string>((resolve: (answer: string) => void): void => {
      this.pendingInput = resolve;
    });
    return {
      answer,
      cancel: (): void => {
        if (this.pendingInput !== null) {
          this.pendingInput = null;
          // Back to a running turn: the question was answered locally, the turn continues.
          this.setState('running');
        }
      },
    };
  }

  /**
   * Offers an inbound peer message to a pending question ({@link requestInput}): consumes it as the
   * answer when one is armed (returning true so the caller does not also steer the session), otherwise
   * returns false and the message steers as usual.
   * @param text The peer's inbound message text.
   * @returns Returns true when the message was consumed as a question's answer.
   */
  public consumeInbound(text: string): boolean {
    const resolve: ((answer: string) => void) | null = this.pendingInput;
    if (resolve === null || this.closed) {
      return false;
    }
    this.pendingInput = null;
    // The turn resumes now that the question is answered.
    this.setState('running');
    resolve(text);
    return true;
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
 * Resolves the pending permission prompt a claude.ai `control_response` answers. The raw response is
 * logged (its exact allow/deny shape is undocumented `@alpha`) so it can be confirmed from a real run.
 * @param pending The in-flight permission resolvers keyed by control-request id.
 * @param res The control response from claude.ai.
 */
export function resolvePermissionResponse(
  pending: Map<string, (granted: boolean) => void>,
  res: SDKControlResponse,
): void {
  logger.debug('ClaudeRemoteControl', `Permission control_response: ${JSON.stringify(res).slice(0, 500)}`);
  const inner: { request_id?: unknown; subtype?: unknown; response?: unknown } | undefined = (
    res as { response?: { request_id?: unknown; subtype?: unknown; response?: unknown } }
  ).response;
  const requestId: unknown = inner?.request_id;
  if (typeof requestId !== 'string') {
    return;
  }
  const resolve: ((granted: boolean) => void) | undefined = pending.get(requestId);
  if (resolve === undefined) {
    return;
  }
  pending.delete(requestId);
  resolve(inner?.subtype === 'error' ? false : parseGranted(inner?.response));
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
