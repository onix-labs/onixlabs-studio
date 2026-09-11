import {
  AGENT_PROTOCOL_VERSION,
  HarnessAnswer,
  HarnessCapabilities,
  HarnessMessage,
  HarnessModel,
  HostMessage,
  isProtocolCompatible,
  parseHarnessMessage,
} from '@shared/api/agent-protocol';
import { logger } from '@shared/electron/logger';

/**
 * The pipe a harness process is reached through, injected so the host can be driven by a fake in tests
 * without spawning anything.
 *
 * Deliberately the smallest surface that can carry the protocol: a way to send a line, a way to be told
 * about lines and about the process ending, and a way to stop it. Everything about *how* the process was
 * started belongs to whoever built the transport, not to the host.
 */
export interface HarnessTransport {
  /**
   * Sends one message to the harness.
   * @param line The serialised message, without its terminating newline.
   */
  send(line: string): void;

  /**
   * Registers the handler for lines arriving from the harness.
   * @param handler Invoked once per line received.
   */
  onLine(handler: (line: string) => void): void;

  /**
   * Registers the handler for the harness ending, however it ended.
   * @param handler Invoked with the reason, once.
   */
  onClose(handler: (reason: string) => void): void;

  /**
   * Ends the harness process.
   */
  close(): void;
}

/**
 * The host messages every harness must handle, which are therefore never gated on what it declared.
 *
 * A harness that cannot take a turn, cannot be told to stop one, cannot be answered, or cannot complete
 * a handshake is not a harness. Gating `initialize` in particular would be circular: the list that would
 * permit it only arrives in the reply to it.
 */
const MANDATORY_MESSAGES: readonly string[] = ['initialize', 'turn.start', 'turn.abort', 'answer'];

/**
 * A pending blocking request: the harness has stopped and is waiting for this to be answered.
 */
interface PendingCall {
  /**
   * Gets the run the request belongs to, so aborting a turn can refuse everything it is waiting on.
   */
  readonly requestId: string;

  /**
   * Gets what was asked, so a refusal can be the right shape for the question rather than a blanket
   * denial the harness may not even be expecting.
   */
  readonly request: unknown;

  /**
   * Settles the harness's question.
   * @param answer The answer to send back.
   */
  readonly settle: (answer: HarnessAnswer) => void;
}

/**
 * What the host hands back to whoever is driving a turn.
 */
export interface HarnessTurnHandlers {
  /**
   * Handles a streamed event from the harness.
   * @param event The event, as `AiEvent`.
   */
  onEvent(event: unknown): void;

  /**
   * Answers a blocking question from the harness.
   * @param request The question.
   * @returns Returns the answer, eventually.
   */
  onRequest(request: unknown): Promise<HarnessAnswer>;
}

/**
 * Speaks the agent protocol to one harness process.
 *
 * This is the half of #653 phase 3 that is *not* about any particular harness: framing, the handshake,
 * correlating the four blocking round-trips, and settling turns. What runs on the far end — a wrapper
 * around the Claude SDK, around Codex, or something nobody has written — is not this class's business,
 * which is the entire point of having a protocol.
 *
 * **Line-delimited JSON**, matching what the Codex CLI already does and what the plugin system's own
 * `node`-kind payloads do. Simpler than LSP's `Content-Length` framing, and a harness author does not
 * need a library to speak it.
 *
 * ⚠️ Everything arriving is untrusted and goes through `parseHarnessMessage`. A line that is not a
 * message is dropped with a log line rather than guessed at — the harness is another program, possibly
 * one Studio downloaded, and a malformed request reaching the permission prompt is the one place where
 * believing a badly-formed thing has consequences.
 */
export class HarnessHost {
  /**
   * Holds the pipe to the harness.
   */
  private readonly transport: HarnessTransport;

  /**
   * Holds the harness's declared capabilities once it has said `ready`, or null before.
   */
  private capabilitiesValue: HarnessCapabilities | null = null;

  /**
   * Holds the blocking requests the harness is waiting on, by call id.
   */
  private readonly pending: Map<string, PendingCall> = new Map<string, PendingCall>();

  /**
   * Holds the handlers for each in-flight turn, by run id.
   */
  private readonly turns: Map<string, HarnessTurnHandlers> = new Map<string, HarnessTurnHandlers>();

  /**
   * Holds the settlers for each in-flight turn, by run id.
   */
  private readonly settlers: Map<string, (error: string | null) => void> = new Map<
    string,
    (error: string | null) => void
  >();

  /**
   * Holds the resolvers for discoveries in flight, by discovery id.
   */
  private readonly discoveries: Map<string, (models: readonly HarnessModel[] | null) => void> =
    new Map<string, (models: readonly HarnessModel[] | null) => void>();

  /**
   * Holds the resolver for the handshake, cleared once the harness is ready or has failed to be.
   */
  private readyResolver: ((capabilities: HarnessCapabilities | null) => void) | null = null;

  /**
   * Holds why the harness ended, or null while it is alive.
   */
  private closedReason: string | null = null;

  /**
   * Holds the sink executed actions are recorded to.
   */
  private readonly onAudit: (
    requestId: string,
    name: string,
    detail: string,
    source: string,
  ) => void;

  /**
   * Initializes a new instance of the {@link HarnessHost} class.
   * @param transport The pipe to the harness process.
   * @param onAudit Records an executed action to the audit log, attributed to the turn that ran it.
   */
  public constructor(
    transport: HarnessTransport,
    onAudit: (requestId: string, name: string, detail: string, source: string) => void,
  ) {
    this.transport = transport;
    this.onAudit = onAudit;
    this.transport.onLine((line: string): void => this.receive(line));
    this.transport.onClose((reason: string): void => this.handleClose(reason));
  }

  /**
   * Gets whether the harness is still able to take a turn.
   */
  public get alive(): boolean {
    return this.closedReason === null;
  }

  /**
   * Gets the harness's declared capabilities, or null before it is ready.
   */
  public get capabilities(): HarnessCapabilities | null {
    return this.capabilitiesValue;
  }

  /**
   * Performs the handshake, resolving once the harness declares itself ready.
   *
   * A harness whose protocol version this build cannot honour is **refused here**, before it is ever
   * given a turn. Refusing at the handshake is what makes an incompatibility a clear failure to start
   * rather than a turn that quietly does less than it was asked.
   * @returns Returns the capabilities, or null when the harness cannot be hosted.
   */
  public initialize(): Promise<HarnessCapabilities | null> {
    return new Promise<HarnessCapabilities | null>((resolve): void => {
      this.readyResolver = resolve;
      this.post({ type: 'initialize', protocolVersion: AGENT_PROTOCOL_VERSION });
    });
  }

  /**
   * Runs a turn, resolving when the harness settles it.
   * @param turn The turn envelope to send.
   * @param handlers The handlers for this turn's events and questions.
   * @returns Returns a promise that rejects when the turn fails and resolves when it completes.
   */
  public runTurn(turn: { requestId: string }, handlers: HarnessTurnHandlers): Promise<void> {
    if (!this.alive) {
      return Promise.reject(new Error(`The harness is not running: ${this.closedReason}`));
    }
    this.turns.set(turn.requestId, handlers);
    return new Promise<void>((resolve, reject): void => {
      this.settlers.set(turn.requestId, (error: string | null): void => {
        this.turns.delete(turn.requestId);
        this.settlers.delete(turn.requestId);
        if (error === null) {
          resolve();
        } else {
          reject(new Error(error));
        }
      });
      this.post({ type: 'turn.start', turn: turn as never });
    });
  }

  /**
   * Asks the harness what models it can run.
   *
   * 🔑 The discovery id **is** a run id. A harness that must ask Studio something before it can answer —
   * an API key, most obviously — asks under that id, and the host routes the reply exactly as it would
   * mid-turn. Giving discovery its own correlation space would have meant relaxing the rule that a
   * request naming an unknown run is refused, and that rule is what stops a harness asking questions
   * nothing is waiting for.
   * @param discoveryId The id to correlate the answer under.
   * @param handlers The handlers for anything the harness asks while answering.
   * @returns Returns the models, or null when the harness could not answer.
   */
  public discover(
    discoveryId: string,
    handlers: HarnessTurnHandlers,
  ): Promise<readonly HarnessModel[] | null> {
    if (!this.alive || !this.answers('discover')) {
      return Promise.resolve(null);
    }
    this.turns.set(discoveryId, handlers);
    return new Promise<readonly HarnessModel[] | null>((resolve): void => {
      this.discoveries.set(discoveryId, (models: readonly HarnessModel[] | null): void => {
        this.turns.delete(discoveryId);
        this.discoveries.delete(discoveryId);
        resolve(models);
      });
      this.post({ type: 'discover', discoveryId });
    });
  }

  /**
   * Asks the harness to abort a turn, and refuses everything that turn is waiting on.
   *
   * The refusals are sent locally rather than waited for: a harness that has stopped answering is
   * exactly the case abort exists for, and a prompt left open because the harness never replied would
   * outlive the turn it belonged to.
   * @param requestId The run to abort.
   */
  public abort(requestId: string): void {
    for (const [callId, call] of [...this.pending]) {
      if (call.requestId === requestId) {
        this.refuse(callId, call);
      }
    }
    if (this.alive) {
      this.post({ type: 'turn.abort', requestId });
    }
  }

  /**
   * Injects a user message into a running turn.
   * @param requestId The run to steer.
   * @param text The message to inject.
   * @returns Returns true when the harness declared it accepts steering.
   */
  public steer(requestId: string, text: string): boolean {
    if (!this.alive || !this.answers('steer')) {
      return false;
    }
    this.post({ type: 'steer', requestId, text });
    return true;
  }

  /**
   * Re-aims the harness's remote-control exposure.
   *
   * ⛔ Studio carries the mode and nothing else. The bridge a harness opens is the vendor's — claude.ai
   * for the Claude harness — and a Studio that opened it would be core keeping exactly the vendor code
   * this seam exists to remove.
   * @param mode How the session should now be exposed.
   * @returns Returns true when the harness declared it can honour this.
   */
  public setRemoteControl(mode: 'off' | 'mirror' | 'control'): boolean {
    if (!this.alive || !this.answers('remote-control')) {
      return false;
    }
    this.post({ type: 'remote-control', mode });
    return true;
  }

  /**
   * Ends the harness.
   */
  public close(): void {
    this.transport.close();
  }

  /**
   * Determines whether the harness said it answers a message.
   *
   * ⛔ The guard that makes an unimplemented message safe. A harness that ignores a message it has never
   * heard of leaves whoever sent it awaiting a reply forever — not a feature that fails, a turn or a
   * settings dialog that hangs. Refusing to send is an immediate "cannot" instead of a wait.
   *
   * The four mandatory messages are never gated: a harness that cannot handle `initialize`,
   * `turn.start`, `turn.abort` or `answer` is not a harness, and gating them would turn a broken
   * handshake into silence.
   *
   * ⚠️ A harness on an older minor sends no list, which reads as "the mandatory four only". That is what
   * keeps every already-published plugin working — it simply is not offered the optional messages.
   * @param type The message type.
   * @returns Returns true when the message may be sent.
   */
  private answers(type: HostMessage['type']): boolean {
    if (MANDATORY_MESSAGES.includes(type)) {
      return true;
    }
    return (this.capabilitiesValue?.answers ?? []).includes(type);
  }

  /**
   * Serialises and sends a message to the harness.
   * @param message The message to send.
   */
  private post(message: HostMessage): void {
    if (!this.answers(message.type)) {
      logger.debug('HarnessHost', `Not sending '${message.type}': the harness does not answer it`);
      return;
    }
    this.transport.send(JSON.stringify(message));
  }

  /**
   * Handles one line from the harness.
   * @param line The raw line.
   */
  private receive(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      logger.warn('HarnessHost', 'Discarded a line that is not JSON');
      return;
    }
    const message: HarnessMessage | null = parseHarnessMessage(parsed);
    if (message === null) {
      logger.warn('HarnessHost', 'Refused a message that is not one this protocol describes');
      return;
    }
    this.dispatch(message);
  }

  /**
   * Routes a validated message.
   * @param message The message.
   */
  private dispatch(message: HarnessMessage): void {
    switch (message.type) {
      case 'ready':
        this.handleReady(message.capabilities);
        break;
      case 'event':
        this.turns
          .get((message.event as { requestId?: string }).requestId ?? '')
          ?.onEvent(message.event);
        break;
      case 'request':
        this.handleRequest(message.callId, message.requestId, message.request);
        break;
      case 'audit':
        // Attributed to the turn that ran the action, which is what protocol 1.1.0 added `requestId`
        // for. Before it, this was host-level via a constructor sink, because routing an unattributed
        // record to an arbitrary in-flight turn would have credited whichever run was first in a map.
        this.onAudit(message.requestId, message.name, message.detail, message.source);
        break;
      case 'turn.completed':
        this.settlers.get(message.requestId)?.(null);
        break;
      case 'turn.failed':
        this.settlers.get(message.requestId)?.(message.error);
        break;
      case 'models':
        this.discoveries.get(message.discoveryId)?.(message.models);
        break;
    }
  }

  /**
   * Completes the handshake, refusing a harness this build cannot host.
   * @param capabilities The harness's declared capabilities.
   */
  private handleReady(capabilities: HarnessCapabilities): void {
    const version: string = capabilities?.protocolVersion ?? '';
    if (!isProtocolCompatible(version)) {
      logger.warn(
        'HarnessHost',
        `Refusing a harness speaking protocol '${version}'; this build implements ${AGENT_PROTOCOL_VERSION}`,
      );
      this.readyResolver?.(null);
      this.readyResolver = null;
      this.close();
      return;
    }
    this.capabilitiesValue = capabilities;
    logger.info(
      'HarnessHost',
      `Harness ready: protocol ${version}, ${capabilities.sessionModel}, ` +
        `answers [${(capabilities.answers ?? []).join(', ')}]`,
    );
    this.readyResolver?.(capabilities);
    this.readyResolver = null;
  }

  /**
   * Answers a blocking request, sending the answer back under its call id.
   * @param callId The correlation id to answer under.
   * @param requestId The run the request belongs to.
   * @param request The question.
   */
  private handleRequest(callId: string, requestId: string, request: unknown): void {
    const handlers: HarnessTurnHandlers | undefined = this.turns.get(requestId);
    if (handlers === undefined) {
      // A question about a turn that is not running cannot be put to the user meaningfully, and
      // leaving the harness blocked forever is worse than refusing it.
      logger.warn('HarnessHost', `Refusing a request for unknown run '${requestId}'`);
      this.post({ type: 'answer', callId, answer: refusalFor(request) });
      return;
    }
    const call: PendingCall = {
      requestId,
      request,
      settle: (answer: HarnessAnswer): void => {
        if (this.pending.delete(callId)) {
          this.post({ type: 'answer', callId, answer });
        }
      },
    };
    this.pending.set(callId, call);
    void handlers
      .onRequest(request)
      .then((answer: HarnessAnswer): void => call.settle(answer))
      .catch((): void => this.refuse(callId, call));
  }

  /**
   * Answers a pending call with the refusal shape for whatever it asked.
   * @param callId The call to refuse.
   * @param call The pending call.
   */
  private refuse(callId: string, call: PendingCall): void {
    if (!this.pending.delete(callId)) {
      return;
    }
    if (this.alive) {
      this.post({ type: 'answer', callId, answer: refusalFor(call.request) });
    }
  }

  /**
   * Fails everything outstanding when the harness ends.
   *
   * A turn whose harness has gone will never settle on its own — nothing remains to stream its events
   * or resolve it — and a conversation stuck "Working" forever is the worst available outcome, so every
   * in-flight turn is failed explicitly.
   * @param reason Why the harness ended.
   */
  private handleClose(reason: string): void {
    this.closedReason = reason;
    logger.info('HarnessHost', `Harness ended: ${reason}`);
    this.readyResolver?.(null);
    this.readyResolver = null;
    this.pending.clear();
    for (const settle of [...this.settlers.values()]) {
      settle(`The harness ended: ${reason}`);
    }
    // A discovery whose harness has gone will never answer on its own, and a settings dialog waiting
    // forever is the same failure as a turn stuck "Working".
    for (const resolve of [...this.discoveries.values()]) {
      resolve(null);
    }
  }
}

/**
 * Gets the "no answer" shape for whatever a request asked.
 *
 * Every question has one, because a turn can be aborted with a prompt open — so a harness must handle
 * a refusal for everything it asks, and this is where Studio produces it.
 * @param request The request being refused.
 * @returns Returns the refusal.
 */
export function refusalFor(request: unknown): HarnessAnswer {
  const kind: unknown = (request as { kind?: unknown } | null)?.kind;
  if (kind === 'input') {
    return { kind: 'input', answer: null };
  }
  if (kind === 'edit-decision') {
    return { kind: 'edit-decision', decision: 'no' };
  }
  if (kind === 'bridge') {
    return { kind: 'bridge', result: null, error: 'refused' };
  }
  if (kind === 'tools') {
    // An empty list, not an error: a refused turn has no tools, and a harness that reads this as "none
    // available" behaves correctly, where one handed an error might retry.
    return { kind: 'tools', tools: [] };
  }
  if (kind === 'tool') {
    return { kind: 'tool', result: null, error: 'refused' };
  }
  if (kind === 'credential') {
    // The same shape as "there is no key configured". A harness cannot tell a refused request from an
    // unconfigured connection, and does not need to: both mean it cannot authenticate, and inventing a
    // distinction would invite one to retry against the other.
    return { kind: 'credential', apiKey: null };
  }
  return { kind: 'permission', granted: false };
}
