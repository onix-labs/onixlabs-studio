import type { AiEffort, AiEvent, AiModelInfo } from '@shared/api/ai-types';
import type { HarnessAnswer, HarnessCapabilities, TurnRequest } from '@shared/api/agent-protocol';
import { logger } from '@shared/electron/logger';
import type {
  AgentProvider,
  AgentRunContext,
  AgentSessionModel,
  ProviderAvailability,
} from './agent-provider';
import { HarnessHost, HarnessTransport } from './harness-host';

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
   * Gets whether the harness can expose a session to another machine.
   *
   * Always false. Remote Control (#331) is a provider-implemented capability with its own surface, and
   * the protocol carries no message for it — the `bridge` round-trip is Studio *reaching in*, not a
   * harness exposing itself outward. Offering the control for a harness that cannot honour it would be
   * offering a connection that cannot be made.
   */
  public readonly supportsRemoteControl: boolean = false;

  /**
   * Gets how the harness maintains a conversation, as declared.
   */
  public get sessionModel(): AgentSessionModel {
    return this.declared?.sessionModel === 'live-harness' ? 'live-harness' : 'stateless';
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
      context.setSteerHandler(
        capabilities.steering
          ? (text: string): boolean => host.steer(context.requestId, text)
          : null,
      );
      await host.runTurn(toTurnRequest(context), {
        onEvent: (event: unknown): void => context.emit(event as AiEvent),
        onRequest: (request: unknown): Promise<HarnessAnswer> => this.answer(request, context),
      });
    } finally {
      context.signal.removeEventListener('abort', abort);
      context.setSteerHandler(null);
      host.close();
    }
  }

  /**
   * Puts a harness's question to the user and returns the answer in the protocol's shape.
   * @param request The question.
   * @param context The run context the question belongs to.
   * @returns Returns the answer.
   */
  private async answer(request: unknown, context: AgentRunContext): Promise<HarnessAnswer> {
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
export function toTurnRequest(context: AgentRunContext): TurnRequest {
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
  };
}
