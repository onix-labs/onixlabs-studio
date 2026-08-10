import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
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
   * The turn state last reported to claude.ai, so the "working" spinner is toggled only on change.
   */
  private reportedState: 'idle' | 'running' = 'idle';

  /**
   * Whether the bridge has been closed.
   */
  private closed: boolean = false;

  /**
   * Initialises a new instance of the {@link RemoteControlBridge} class.
   * @param handle The attached bridge session handle.
   * @param sessionId The claude.ai code-session id.
   */
  private constructor(
    private readonly handle: BridgeSessionHandle,
    public readonly sessionId: string,
  ) {}

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
        onClose: (code?: number): void =>
          logger.debug('ClaudeRemoteControl', `Bridge transport closed (code ${code ?? 'n/a'})`),
      });
      handle.reportMetadata({ cwd: options.cwd });
      handle.reportState('idle');
      logger.info(
        'ClaudeRemoteControl',
        `Session ${sessionId} bridged to claude.ai/code (${options.mode})`,
      );
      return new RemoteControlBridge(handle, sessionId);
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
  private setState(state: 'idle' | 'running'): void {
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
