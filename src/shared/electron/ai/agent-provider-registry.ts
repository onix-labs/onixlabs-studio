import type { AiConnection } from '@shared/api/ai-types';
import { logger } from '@shared/electron/logger';
import type { ContributedHarness } from '../contributions/plugins/plugin-loader';
import type { AgentProvider } from './agent-provider';
import { HarnessAgentProvider } from './harness-agent-provider';
import type { HarnessTransport } from './harness-host';
import { AiSdkAdapter } from './ai-sdk-adapter';
import { ClaudeAgentProvider } from './claude-agent-provider';
import { CodexAgentProvider } from './codex-agent-provider';

/**
 * Describes one kind of agent harness: whether it serves a given connection, and how to build the
 * provider that runs it.
 *
 * The shape a harness would need to arrive as data later (#653) is exactly this pair of questions, which
 * is why it is a descriptor rather than a branch. What it deliberately does *not* say is how the harness
 * talks to anything — that stays inside {@link create}, and is what a protocol replaces.
 */
export interface AgentProviderDescriptor {
  /**
   * Gets the stable identifier for this harness, for logging and for reporting what is registered.
   */
  readonly id: string;

  /**
   * Gets whether this harness serves a connection.
   *
   * Asked in registration order, so a descriptor registered earlier wins a connection both could serve.
   * @param connection The connection to test.
   * @returns Returns true when this harness should run the connection.
   */
  serves(connection: AiConnection): boolean;

  /**
   * Builds the provider that runs a connection this harness serves.
   * @param connection The connection to build for.
   * @returns Returns the provider.
   */
  create(connection: AiConnection): AgentProvider;
}

/**
 * Owns which harness runs a connection.
 *
 * This replaced a three-way `if` on `connection.auth` inside `AiManager`. The behaviour is identical
 * and deliberately so — what changed is that the set of harnesses is now **open**: `register` takes a
 * descriptor, so adding one is a registration rather than another branch in a method that already knew
 * the name of every provider Studio ships.
 *
 * First match in registration order wins, and the generic AI-SDK adapter is registered last serving
 * everything. That is why there is no separate notion of a fallback: "the last descriptor serves
 * whatever is left" is the same rule as "first match wins", read from the other end, and it means a
 * future harness slots in ahead of it without anyone reordering a conditional.
 *
 * ⚠️ Registration order therefore matters. A descriptor that serves everything must be last, or it
 * takes every connection with it.
 */
export class AgentProviderRegistry {
  /**
   * Holds the registered descriptors, in registration order.
   */
  private readonly descriptors: AgentProviderDescriptor[] = [];

  /**
   * Registers a harness. Later registrations lose a connection an earlier one already serves.
   * @param descriptor The harness to register.
   */
  public register(descriptor: AgentProviderDescriptor): void {
    if (
      this.descriptors.some((known: AgentProviderDescriptor): boolean => known.id === descriptor.id)
    ) {
      logger.warn('AgentProviderRegistry', `Ignoring duplicate harness '${descriptor.id}'`);
      return;
    }
    this.descriptors.push(descriptor);
    logger.debug('AgentProviderRegistry', `Registered harness '${descriptor.id}'`);
  }

  /**
   * Reports where a contributed harness has taken a connection an in-core one would also have served.
   *
   * **This is the transitional hazard of #653, said out loud.** Contributed harnesses register ahead of
   * the ones Studio compiles in, which is the intended shape — a harness that has moved out of core
   * should win. But while both exist, an *incomplete* plugin claiming `claude-login` silently replaces
   * a provider that does considerably more, and the user's only symptom is capability quietly going
   * missing: no sub-agents, no remote control, no tool policy.
   *
   * Nothing is refused here, because refusing would defeat the point of the ordering. What this does is
   * make the displacement visible in the log instead of invisible in the product, so a bug report saying
   * "the agent stopped doing X after I installed Y" has one line that explains it.
   *
   * ⛔ Since a harness is now matched only by a connection naming it explicitly, this can no longer
   * happen by accident — a user chose it. It stays because the choice is still worth reporting: if the
   * plugin they picked does less than the built-in, this is the line that explains where the missing
   * capability went.
   * @param connection The connection being resolved.
   * @param winner The descriptor that served it.
   */
  private reportDisplacement(connection: AiConnection, winner: AgentProviderDescriptor): void {
    const core: readonly string[] = coreAgentProviders()
      .filter((candidate: AgentProviderDescriptor): boolean => candidate.id !== 'ai-sdk')
      .filter((candidate: AgentProviderDescriptor): boolean => candidate.serves(connection))
      .map((candidate: AgentProviderDescriptor): string => candidate.id);
    if (core.length === 0 || core.includes(winner.id)) {
      return;
    }
    logger.warn(
      'AgentProviderRegistry',
      `Harness '${winner.id}' is running connection '${connection.id}' in place of the built-in ` +
        `'${core.join(', ')}'. If capability is missing from this agent, that is where it went.`,
    );
  }

  /**
   * Builds the provider for a connection, from the first registered harness that serves it.
   * @param connection The connection to build a provider for.
   * @returns Returns the provider, or null when nothing registered serves the connection.
   */
  public providerFor(connection: AiConnection): AgentProvider | null {
    const descriptor: AgentProviderDescriptor | undefined = this.descriptors.find(
      (candidate: AgentProviderDescriptor): boolean => candidate.serves(connection),
    );
    if (descriptor === undefined) {
      // Only reachable if the catch-all descriptor was never registered. Worth saying rather than
      // returning a connection the user configured with no way to run it.
      logger.warn(
        'AgentProviderRegistry',
        `No harness serves connection '${connection.id}' (auth ${connection.auth})`,
      );
      return null;
    }
    this.reportDisplacement(connection, descriptor);
    return descriptor.create(connection);
  }

  /**
   * Gets the ids of the registered harnesses, in registration order.
   * @returns Returns the registered ids.
   */
  public registered(): readonly string[] {
    return this.descriptors.map((descriptor: AgentProviderDescriptor): string => descriptor.id);
  }
}

/**
 * Turns an installed harness plugin into a registry descriptor.
 *
 * Registered **ahead of** the in-core harnesses, so an installed plugin claiming a connection wins it.
 * That is what "core defines, plugins provide" means here: while the two live harnesses are still
 * compiled in, they are the fallback rather than the answer, and each one that moves out of core simply
 * stops being registered.
 *
 * ⚠️ A harness whose payload is not installed does not serve anything. The manifest can be in the
 * catalogue without the payload being on disk, and a descriptor that claimed a connection it cannot run
 * would take it from the in-core provider that can.
 * @param harness The contributed harness.
 * @param connect Opens a transport to a started harness.
 * @returns Returns the descriptor.
 */
export function toHarnessDescriptor(
  harness: ContributedHarness,
  connect: (spec: { command: string; args: readonly string[] }) => HarnessTransport,
): AgentProviderDescriptor {
  return {
    id: harness.id,
    // ⛔ Matched on the connection naming this harness, never on its authentication kind. A plugin
    // cannot claim a connection; a user points one at it. The first design matched on auth and was
    // wrong twice: `AiAuthKind` is a closed union, so a plugin could not name a kind of its own — and
    // naming an existing one would take every connection of that kind from the provider Studio ships.
    serves: (connection: AiConnection): boolean =>
      connection.harnessId === harness.id && harness.spawnSpec() !== null,
    create: (connection: AiConnection): AgentProvider => {
      const spec: { command: string; args: readonly string[] } | null = harness.spawnSpec();
      if (spec === null) {
        // Unreachable while `serves` checks the same thing, and worth failing loudly rather than
        // silently handing back something that cannot run.
        throw new Error(`${harness.displayName} is not installed.`);
      }
      return new HarnessAgentProvider({
        id: connection.id,
        label: harness.displayName,
        models: connection.models,
        defaultModelId: connection.defaultModelId,
        connect: (): HarnessTransport => connect(spec),
        sessionModel: harness.sessionModel,
        remoteControl: harness.remoteControl,
        // What the harness needs to know about the connection it serves. A harness talking to a plain
        // model API cannot build a client without them, and the turn envelope — being turn-scoped —
        // says nothing about which endpoint a connection points at.
        settings: {
          connectionKind: connection.kind,
          connectionLabel: connection.label,
          baseUrl: connection.baseUrl ?? null,
        },
      });
    },
  };
}

/**
 * The harnesses Studio compiles in, in the order they are asked.
 *
 * Two live harnesses that drive a vendor CLI, then the generic adapter that serves everything else —
 * which is why an OpenAI-compatible endpoint (including a local Ollama) needs no code here at all: it
 * is a connection, and the last descriptor takes it.
 * @returns Returns the first-party descriptors, in registration order.
 */
export function coreAgentProviders(): readonly AgentProviderDescriptor[] {
  return [
    {
      id: 'claude',
      serves: (connection: AiConnection): boolean => connection.auth === 'claude-login',
      create: (connection: AiConnection): AgentProvider =>
        new ClaudeAgentProvider(connection.models, connection.defaultModelId),
    },
    {
      id: 'codex',
      serves: (connection: AiConnection): boolean => connection.auth === 'codex-login',
      create: (connection: AiConnection): AgentProvider =>
        new CodexAgentProvider(connection.models, connection.defaultModelId),
    },
    {
      // Last, and serves everything: the generic adapter configured by the connection's own kind and
      // endpoint. Anything registered after this would never be asked.
      id: 'ai-sdk',
      serves: (): boolean => true,
      create: (connection: AiConnection): AgentProvider => new AiSdkAdapter(connection),
    },
  ];
}
