import type {
  AgentContextRef,
  AiEffort,
  AiEvent,
  AiImageRef,
  AiModelInfo,
  AiRemoteControlMode,
} from '@shared/api/ai-types';
import type {
  HarnessAnswer,
  HarnessCapabilities,
  HarnessModel,
  HarnessTool,
  TurnContextRef,
  TurnImage,
  TurnRequest,
} from '@shared/api/agent-protocol';
import { logger } from '@shared/electron/logger';
import type {
  AgentAuth,
  AgentProvider,
  AgentRunContext,
  AgentSession,
  AgentSessionModel,
  ProviderAvailability,
} from './agent-provider';
import { HarnessHost, HarnessTransport, refusalFor } from './harness-host';
import { describeOffer, invokeTool } from './harness-tools';

/**
 * Opens a transport to a harness — a spawned process, or a fake in tests.
 */
export type HarnessTransportFactory = () => HarnessTransport;

/**
 * What a harness is, as far as this provider is concerned: how to reach it, and what to call it.
 */
export interface HarnessDefinition {
  /**
   * Gets the connection this harness serves, which is also the provider's identifier.
   */
  readonly id: string;

  /**
   * Gets the human-readable label.
   */
  readonly label: string;

  /**
   * Gets the models it can run, in display order.
   */
  readonly models: readonly AiModelInfo[];

  /**
   * Gets the default model's identifier.
   */
  readonly defaultModelId: string;

  /**
   * Opens a transport to the harness.
   */
  readonly connect: HarnessTransportFactory;

  /**
   * Gets how the harness maintains a conversation, as its **manifest** declares.
   *
   * ⛔ Not read from the handshake. `AiManager.dispatchLive` asks this before anything has been started,
   * so a value that only exists after a process has spoken arrives too late — and reading it from the
   * handshake produced the worst of both: a transient first turn, then live ones once the answer had
   * been learned.
   */
  readonly sessionModel: AgentSessionModel;

  /**
   * Gets whether the harness can expose its session to another machine, as its **manifest** declares.
   *
   * ⛔ Static for the same reason as {@link sessionModel}: the control is drawn in the agent ribbon from
   * what `listProviders` reported at start-up, long before anything has been spawned.
   */
  readonly remoteControl: boolean;

  /**
   * Gets the settings Studio holds on this harness's behalf, merged into every turn envelope.
   *
   * 🔑 Where a harness learns about the *connection* it serves. The envelope is turn-scoped and says
   * nothing about which endpoint or provider kind a connection points at — facts a harness talking to a
   * plain model API needs before it can build a client at all. They ride here rather than as named wire
   * fields for the reason the bag exists: the protocol must not name one vendor's concepts.
   */
  readonly settings: Readonly<Record<string, unknown>>;
}

/**
 * Runs an agent turn through a harness that speaks the agent protocol in its own process.
 *
 * This is the piece that makes a harness a *provider*: it turns `AgentRunContext` — with its live
 * `AbortSignal`, its bridge object and its three promise-returning callbacks — into the messages the
 * protocol describes, and turns what comes back into the events and prompts Studio already renders.
 *
 * **One harness process per turn**, for now. That is the transient `run` path every provider still
 * takes today; holding one open across turns is what `openSession` is for, and it lands with the live
 * session work rather than here. A `stateless` harness is served correctly by this either way.
 *
 * ⚠️ Capabilities are read from the handshake, so the properties below are only meaningful once a turn
 * has run. Before that they report the conservative answer — no images, no efforts, stateless — because
 * a control offered for a capability the harness turns out not to have is worse than one that appears
 * after the first turn.
 */
export class HarnessAgentProvider implements AgentProvider {
  /**
   * Holds what this provider runs.
   */
  private readonly definition: HarnessDefinition;

  /**
   * Holds what the harness declared at its last handshake, or null before the first one.
   */
  private declared: HarnessCapabilities | null = null;

  /**
   * Initializes a new instance of the {@link HarnessAgentProvider} class.
   * @param definition What the harness is and how to reach it.
   */
  public constructor(definition: HarnessDefinition) {
    this.definition = definition;
  }

  /**
   * Gets the provider's stable identifier.
   */
  public get id(): string {
    return this.definition.id;
  }

  /**
   * Gets the provider's label.
   */
  public get label(): string {
    return this.definition.label;
  }

  /**
   * Gets the models the harness can run.
   */
  public get models(): readonly AiModelInfo[] {
    return this.definition.models;
  }

  /**
   * Gets the default model's identifier.
   */
  public get defaultModelId(): string {
    return this.definition.defaultModelId;
  }

  /**
   * Gets whether the harness accepts image input, as declared.
   */
  public get supportsImages(): boolean {
    return this.declared?.images === true;
  }

  /**
   * Gets the reasoning-effort levels the harness offers, as declared.
   */
  public get supportedEfforts(): readonly AiEffort[] {
    return (this.declared?.efforts ?? []) as readonly AiEffort[];
  }

  /**
   * Gets whether the harness can expose its session to another machine, as its manifest declares.
   *
   * Was hardwired false until the protocol had a message for it. `bridge` was never the answer — that
   * is Studio reaching *in*, where remote control is a harness exposing itself *outward*.
   */
  public get supportsRemoteControl(): boolean {
    return this.definition.remoteControl;
  }

  /**
   * Gets how the harness maintains a conversation, as its manifest declares.
   */
  public get sessionModel(): AgentSessionModel {
    return this.definition.sessionModel;
  }

  /**
   * Opens a live session, held open across turns.
   *
   * Only offered for a harness whose manifest declares `live-harness`; `AiManager` reads
   * {@link sessionModel} before calling, and a `stateless` harness keeps the transient {@link run} path
   * where each turn is its own process.
   *
   * 🔑 The protocol needed nothing new for this. `HarnessHost` already tracks turns by run id and can
   * carry several, `turn.abort` is already what interrupting one turn means, and closing the transport
   * is already how a harness is told to stop. What was missing was a *provider* that keeps one host
   * rather than building and closing one per turn.
   * @param context The context of the turn the session opens for.
   * @returns Returns the live session.
   */
  public openSession(context: AgentRunContext): AgentSession {
    logger.info(
      'HarnessAgentProvider.openSession',
      `Opening a live session for ${this.definition.label}`,
    );
    return new HarnessAgentSession(
      this.definition,
      (capabilities: HarnessCapabilities): void => void (this.declared = capabilities),
      context,
    );
  }

  /**
   * Reports whether the provider can run with the given credential.
   *
   * A harness owns its own authentication — it is another program, and whatever it needs it obtains
   * itself, which is exactly why it can be one. So there is no credential for Studio to check, and the
   * honest answer is that whether it can run is not known until it is started.
   * @returns Returns the availability descriptor.
   */
  public describeAvailability(): ProviderAvailability {
    return { available: true, detail: `${this.definition.label} runs as its own process.` };
  }

  /**
   * Asks the harness what models it can run.
   *
   * Spawns the harness, asks, and closes it again — the same cost as one turn, for something a user
   * triggers from Settings rather than something that runs on a timer.
   *
   * ⚠️ A harness may need a credential to answer (an OpenAI-compatible endpoint has to call `/models`).
   * It asks under the discovery id, so the request path is the ordinary one and the only thing this
   * has to supply is the connection's auth.
   * @param auth The connection's credential.
   * @returns Returns what the harness reported, or null when it could not answer.
   */
  public async discoverModels(auth: AgentAuth): Promise<readonly HarnessModel[] | null> {
    const host: HarnessHost = new HarnessHost(this.definition.connect(), (): void => undefined);
    try {
      const capabilities: HarnessCapabilities | null = await host.initialize();
      // ⛔ The host refuses to send `discover` to a harness that did not list it, and answers null
      // instead — so a harness that never heard of the message cannot leave this awaiting a reply that
      // never comes. A settings dialog that says "could not ask" beats one that hangs.
      if (capabilities === null) {
        return null;
      }
      return await host.discover('discover-1', {
        onEvent: (): void => undefined,
        // ⛔ Only a credential is answerable here. Nothing is watching a settings dialog on the user's
        // behalf, so a harness that stops to ask permission during discovery is refused rather than
        // left blocked — and refused in the shape it asked in.
        onRequest: (request: unknown): Promise<HarnessAnswer> =>
          Promise.resolve(
            (request as { kind?: unknown } | null)?.kind === 'credential'
              ? { kind: 'credential', apiKey: auth.apiKey }
              : refusalFor(request),
          ),
      });
    } finally {
      host.close();
    }
  }

  /**
   * Runs a single agent turn through the harness.
   * @param context The run context.
   */
  public async run(context: AgentRunContext): Promise<void> {
    const host: HarnessHost = new HarnessHost(
      this.definition.connect(),
      (requestId: string, name: string, detail: string, source: string): void => {
        // ⚠️ A record naming a turn other than this one is refused rather than relabelled. One process
        // runs one turn today, so the only way to see a foreign id is a harness that invented it, and
        // an audit log that can be written on another run's behalf is not an audit log.
        if (requestId !== context.requestId) {
          logger.warn(
            'HarnessAgentProvider',
            `Discarding an audit record attributed to run '${requestId}' during run '${context.requestId}'`,
          );
          return;
        }
        context.recordAudit(name, detail, source as never);
      },
    );
    const abort: () => void = (): void => host.abort(context.requestId);
    context.signal.addEventListener('abort', abort);
    try {
      const capabilities: HarnessCapabilities | null = await host.initialize();
      if (capabilities === null) {
        throw new Error(`${this.definition.label} could not be started.`);
      }
      this.declared = capabilities;
      // Steering is only offered when the harness said it takes it; otherwise the renderer queues the
      // message for the next turn, exactly as it does for an in-core provider with no steer handler.
      // Steering is offered only when the harness listed it; otherwise the renderer queues the message
      // for the next turn, exactly as it does for an in-core provider with no steer handler.
      context.setSteerHandler(
        capabilities.answers.includes('steer')
          ? (text: string): boolean => host.steer(context.requestId, text)
          : null,
      );
      await host.runTurn(toTurnRequest(context, this.definition.settings), {
        onEvent: (event: unknown): void => context.emit(event as AiEvent),
        onRequest: (request: unknown): Promise<HarnessAnswer> => answerRequest(request, context),
      });
    } finally {
      context.signal.removeEventListener('abort', abort);
      context.setSteerHandler(null);
      host.close();
    }
  }
}

/**
 * A harness held open across turns.
 *
 * The counterpart to {@link HarnessAgentProvider.run}: one process, one handshake, many turns. What
 * makes it worth having is not efficiency — it is that a `live-harness` keeps the conversation in its
 * own memory, so turn two knows about turn one without Studio replaying anything.
 *
 * ⚠️ **Turns are routed by run id, not by "the current turn".** The audit sink and the request handler
 * both look the context up by the id the message carries, because a session can legitimately have more
 * than one turn in flight and crediting a record to whichever was most recent would be a plausible,
 * silent lie. Protocol 1.1.0 put `requestId` on `audit` precisely so this is answerable.
 */
export class HarnessAgentSession implements AgentSession {
  /**
   * Holds what the harness is and how to reach it.
   */
  private readonly definition: HarnessDefinition;

  /**
   * Reports the handshake back to the provider, so its capability getters stop being conservative.
   */
  private readonly onReady: (capabilities: HarnessCapabilities) => void;

  /**
   * Holds the host once the session has started, or null before the first turn.
   */
  private host: HarnessHost | null = null;

  /**
   * Holds the handshake, so a second turn does not repeat it.
   */
  private started: Promise<HarnessHost> | null = null;

  /**
   * Holds the contexts of the turns in flight, by run id.
   */
  private readonly contexts: Map<string, AgentRunContext> = new Map<string, AgentRunContext>();

  /**
   * Holds the run ids in flight, newest last, so {@link interrupt} knows what to stop.
   */
  private readonly inFlight: string[] = [];

  /**
   * Holds the session id the harness reported, or null before it has.
   */
  private sessionId: string | null = null;

  /**
   * Holds whether the session has been closed.
   */
  private closed: boolean = false;

  /**
   * Initializes a new instance of the {@link HarnessAgentSession} class.
   * @param definition What the harness is and how to reach it.
   * @param onReady Reports the handshake back to the provider.
   * @param opening The context of the turn the session opens for, kept only for its label in logs.
   */
  public constructor(
    definition: HarnessDefinition,
    onReady: (capabilities: HarnessCapabilities) => void,
    opening: AgentRunContext,
  ) {
    this.definition = definition;
    this.onReady = onReady;
    // The opening turn's resume id matters to the harness, not here: it rides in that turn's envelope.
    logger.debug(
      'HarnessAgentSession',
      `Session opening for run ${opening.requestId}${opening.resumeSessionId === null ? '' : ', resuming'}`,
    );
  }

  /**
   * Gets the session id the harness reported, or null before it has reported one.
   */
  public get id(): string | null {
    return this.sessionId;
  }

  /**
   * Gets whether the session can still take a turn.
   *
   * ⚠️ A session whose harness ended underneath it is **not** alive, even though nothing asked it to
   * close. `AiManager` checks this before reusing a session precisely because a turn dispatched into a
   * dead one would never settle, leaving the conversation "Working" forever.
   */
  public get alive(): boolean {
    return !this.closed && (this.host === null || this.host.alive);
  }

  /**
   * Runs one turn in the session.
   * @param context The run context.
   */
  public async turn(context: AgentRunContext): Promise<void> {
    const host: HarnessHost = await this.start();
    this.contexts.set(context.requestId, context);
    this.inFlight.push(context.requestId);
    const abort: () => void = (): void => host.abort(context.requestId);
    context.signal.addEventListener('abort', abort);
    try {
      const capabilities: HarnessCapabilities | null = host.capabilities;
      context.setSteerHandler(
        capabilities?.answers.includes('steer') === true
          ? (text: string): boolean => host.steer(context.requestId, text)
          : null,
      );
      await host.runTurn(toTurnRequest(context, this.definition.settings), {
        onEvent: (event: unknown): void => {
          this.noteSession(event);
          context.emit(event as AiEvent);
        },
        onRequest: (request: unknown): Promise<HarnessAnswer> => answerRequest(request, context),
      });
    } finally {
      context.signal.removeEventListener('abort', abort);
      context.setSteerHandler(null);
      this.contexts.delete(context.requestId);
      const at: number = this.inFlight.indexOf(context.requestId);
      if (at >= 0) {
        this.inFlight.splice(at, 1);
      }
      // ⛔ The host is NOT closed here. That is the whole difference from a transient run: the process
      // stays up holding the conversation, and only {@link close} ends it.
    }
  }

  /**
   * Re-aims the session's remote-control exposure, in place.
   *
   * ⚠️ A no-op with a warning when the harness did not confirm the capability its manifest claimed.
   * Deliberately **not** the same treatment as a session-model mismatch, which refuses the harness
   * outright: there the symptom is a conversation that silently forgets itself, here it is a toggle
   * that does nothing, and killing a working provider over the second would cost more than the fault.
   * @param mode How the session should now be exposed.
   */
  public setRemoteControl(mode: AiRemoteControlMode): void {
    if (this.host === null) {
      // Nothing started yet: the opening turn's envelope already carries the mode.
      return;
    }
    if (!this.host.setRemoteControl(mode === 'mirror' || mode === 'control' ? mode : 'off')) {
      logger.warn(
        'HarnessAgentSession.setRemoteControl',
        `${this.definition.label} was asked to aim remote control at '${mode}' but did not declare it`,
      );
    }
  }

  /**
   * Interrupts the in-flight turn, leaving the session open for the next one.
   */
  public interrupt(): void {
    const requestId: string | undefined = this.inFlight.at(-1);
    if (requestId === undefined || this.host === null) {
      return;
    }
    logger.debug('HarnessAgentSession.interrupt', `Interrupting run ${requestId}`);
    this.host.abort(requestId);
  }

  /**
   * Ends the session and the process holding it. Idempotent.
   * @returns Returns a promise that resolves once the harness has been told to stop.
   */
  public close(): Promise<void> {
    if (!this.closed) {
      logger.info(
        'HarnessAgentSession.close',
        `Closing the ${this.definition.label} session${this.sessionId === null ? '' : ` (${this.sessionId})`}`,
      );
    }
    this.closed = true;
    this.host?.close();
    return Promise.resolve();
  }

  /**
   * Records the session id the first time the harness reports one.
   *
   * Read from the transcript stream rather than from `turn.completed`, because that is where a
   * `live-harness` reports it: the id exists as soon as the harness has a conversation, which is part
   * way through the first turn, not at the end of it. A session reaped and reopened resumes from this.
   * @param event The streamed event.
   */
  private noteSession(event: unknown): void {
    const typed: { kind?: unknown; sessionId?: unknown } = event ?? {};
    if (typed.kind !== 'session' || typeof typed.sessionId !== 'string') {
      return;
    }
    if (typed.sessionId.length > 0 && typed.sessionId !== this.sessionId) {
      logger.info('HarnessAgentSession', `Session id reported: ${typed.sessionId}`);
      this.sessionId = typed.sessionId;
    }
  }

  /**
   * Starts the harness and completes the handshake, at most once.
   * @returns Returns the host.
   */
  private start(): Promise<HarnessHost> {
    this.started ??= this.handshake();
    return this.started;
  }

  /**
   * Spawns the harness, handshakes, and holds the host.
   * @returns Returns the host.
   */
  private async handshake(): Promise<HarnessHost> {
    const host: HarnessHost = new HarnessHost(
      this.definition.connect(),
      (requestId: string, name: string, detail: string, source: string): void => {
        const context: AgentRunContext | undefined = this.contexts.get(requestId);
        if (context === undefined) {
          logger.warn(
            'HarnessAgentSession',
            `Discarding an audit record for run '${requestId}', which this session is not running`,
          );
          return;
        }
        context.recordAudit(name, detail, source as never);
      },
    );
    this.host = host;
    const capabilities: HarnessCapabilities | null = await host.initialize();
    if (capabilities === null) {
      this.closed = true;
      throw new Error(`${this.definition.label} could not be started.`);
    }
    // ⛔ A harness that contradicts its own manifest is refused rather than reconciled. Studio has
    // already committed to holding a process open on the manifest's word, and a `stateless` harness kept
    // alive would collect turns it has no way to relate to one another — which reads to the user as a
    // model that has forgotten the conversation, with nothing in the logs to say why.
    if (capabilities.sessionModel !== this.definition.sessionModel) {
      this.closed = true;
      host.close();
      throw new Error(
        `${this.definition.label} declares '${capabilities.sessionModel}' at the handshake but ` +
          `'${this.definition.sessionModel}' in its manifest.`,
      );
    }
    // ⚠️ `?? []` because a harness speaking an older minor sends no list at all. Reading that as "the
    // mandatory four only" is what keeps an already-published plugin working, and it means this warns
    // only when a manifest genuinely over-claims rather than on every older harness.
    const declared: boolean = (capabilities.answers ?? []).includes('remote-control');
    if (declared !== this.definition.remoteControl) {
      logger.warn(
        'HarnessAgentSession',
        `${this.definition.label} ${declared ? 'answers' : 'does not answer'} remote control at the ` +
          `handshake but its manifest says ${String(this.definition.remoteControl)}`,
      );
    }
    this.onReady(capabilities);
    return host;
  }
}

/**
 * Puts a harness's question to the user and returns the answer in the protocol's shape.
 *
 * Module-level rather than a method, because a live session answers a question exactly as a transient
 * run does — the only difference between them is how long the process lives, which is not something a
 * permission prompt should know about.
 * @param request The question.
 * @param context The run context the question belongs to.
 * @returns Returns the answer.
 */
export async function answerRequest(
  request: unknown,
  context: AgentRunContext,
): Promise<HarnessAnswer> {
  const asked: Record<string, unknown> = (request ?? {}) as Record<string, unknown>;
  switch (asked['kind']) {
    case 'permission': {
      const granted: boolean = await context.requestPermission(
        text(asked['name'], 'Action'),
        text(asked['detail'], ''),
      );
      return { kind: 'permission', granted };
    }
    case 'input': {
      const choices: readonly string[] = Array.isArray(asked['choices'])
        ? (asked['choices'] as readonly string[])
        : [];
      const answer: string | null = await context.requestInput(
        text(asked['question'], ''),
        choices.map((label: string): { label: string } => ({ label: text(label, '') })),
      );
      return { kind: 'input', answer };
    }
    case 'edit-decision': {
      const decision: string = await context.requestEditDecision(
        text(asked['name'], ''),
        text(asked['detail'], ''),
        asked['hasDiff'] === true,
      );
      return { kind: 'edit-decision', decision: decision === 'yes' ? 'yes' : 'no' };
    }
    case 'bridge': {
      try {
        const result: unknown = await context.bridge.request(
          text(asked['capability'], ''),
          asked['input'],
          typeof asked['timeoutMs'] === 'number' ? asked['timeoutMs'] : undefined,
        );
        return { kind: 'bridge', result, error: null };
      } catch (error: unknown) {
        return { kind: 'bridge', result: null, error: String(error) };
      }
    }
    case 'tools': {
      // What Studio offers this turn: its instructions, and the tools those instructions describe. A
      // harness whose model brings its own tools — Claude's and Codex's SDKs both do — never asks.
      const offer: { systemPrompt: string; tools: readonly HarnessTool[] } =
        await describeOffer(context);
      return { kind: 'tools', tools: offer.tools, systemPrompt: offer.systemPrompt };
    }
    case 'tool': {
      const outcome: { result: string | null; error: string | null } = await invokeTool(
        context,
        text(asked['name'], ''),
        asked['input'],
      );
      return { kind: 'tool', result: outcome.result, error: outcome.error };
    }
    case 'credential': {
      // ⛔ Not put to the user. The key was configured in Settings against this connection; asking
      // again once per turn would be a prompt nobody could answer differently. Studio answers from
      // what it already holds, scoped to the connection this turn belongs to — a harness cannot ask
      // for another connection's secret, because it has no way to name one.
      return { kind: 'credential', apiKey: context.auth.apiKey };
    }
    default:
      // The host validated the envelope, not the body. A question Studio has no way to put to the
      // user is denied rather than guessed at.
      logger.warn(
        'HarnessAgentProvider',
        `Denying a request of unknown kind '${text(asked['kind'], 'absent')}'`,
      );
      return { kind: 'permission', granted: false };
  }
}

/**
 * Reads a field a harness sent as text, refusing anything that is not a string.
 *
 * ⚠️ Not `String(value)`. These strings reach the **permission prompt** — the one surface in Studio
 * where believing a badly-formed thing has consequences — and coercing an object there would put
 * `[object Object]` in front of a person about to grant an action. A harness that sends the wrong type
 * gets the fallback and a prompt that still reads sensibly.
 * @param value The value the harness sent.
 * @param fallback What to use when it is not a string.
 * @returns Returns the text.
 */
function text(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

/**
 * Builds the turn envelope from a run context, dropping everything that cannot cross a wire.
 *
 * The field names match `AgentRunContext` deliberately, so this reads as a projection rather than a
 * translation. What is *absent* is the interesting part: the abort signal, the bridge and the three
 * callbacks all become messages instead.
 * @param context The run context.
 * @returns Returns the envelope to send.
 */
export function toTurnRequest(
  context: AgentRunContext,
  settings: Readonly<Record<string, unknown>> = {},
): TurnRequest {
  return {
    requestId: context.requestId,
    prompt: context.prompt,
    workspaceRoot: context.workspaceRoot,
    model: context.model,
    agentSessionId: context.agentSessionId,
    effort: context.effort,
    mode: context.mode === 'chat' ? 'chat' : 'agent',
    surface: text(context.surface, 'editor'),
    allowedWritePaths: context.allowedWritePaths,
    deniedWritePaths: context.deniedWritePaths,
    allowedNetworkLocations: context.allowedNetworkLocations,
    deniedNetworkLocations: context.deniedNetworkLocations,
    tokenCap: context.tokenCap,
    resumeSessionId: context.resumeSessionId,
    forkSession: context.forkSession,
    resumeSessionAt: context.resumeSessionAt,
    permissionPosture: context.permissionPosture,
    toolPolicies: { ...context.toolPolicies },
    images: context.images.map((image: AiImageRef): TurnImage => ({
      mediaType: image.mediaType,
      data: image.data,
      ...(image.name === undefined ? {} : { name: image.name }),
    })),
    contextPaths: context.contextPaths.map((reference: AgentContextRef): TurnContextRef => ({
      path: reference.path,
      kind: reference.kind,
      ...(reference.content === undefined ? {} : { content: reference.content }),
    })),
    remoteControl: context.remoteControl,
    agentShell: context.agentShell,
    owningTabId: context.owningTabId,
    // ⛔ The one vendor-specific field, carried as an opaque setting rather than as a named one. A wire
    // field called `claudeExecutable` would be the seam naming a vendor; a plugin that understands the
    // key reads it, and every other plugin ignores a bag it did not put anything in.
    // The harness's own settings first, so a connection-level fact cannot be shadowed by a turn-level
    // one that happens to share a key.
    providerSettings: { ...settings, claudeExecutable: context.claudeExecutable },
  };
}
