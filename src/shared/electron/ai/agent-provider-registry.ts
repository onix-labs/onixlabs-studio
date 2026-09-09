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
    serves: (connection: AiConnection): boolean =>
      harness.connectionAuths.includes(connection.auth) && harness.spawnSpec() !== null,
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
