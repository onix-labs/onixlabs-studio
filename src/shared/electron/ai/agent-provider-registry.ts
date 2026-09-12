import type { AiConnection } from '@shared/api/ai-types';
import { logger } from '@shared/electron/logger';
import type { ContributedHarness } from '../contributions/plugins/plugin-loader';
import type { AgentProvider } from './agent-provider';
import { HarnessAgentProvider } from './harness-agent-provider';
import type { HarnessTransport } from './harness-host';
import type { HarnessSpawnSpec } from './harness-process';

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
   *
   * ⛔ **Nothing serves a connection by default, and that is the design.** Core registers no harness
   * at all, so a connection is runnable only once a provider plugin is installed *and* the connection
   * names it. Returning null leaves the connection listed in Settings and absent from the agent —
   * which is the honest reading of "configured, but there is nothing to run it".
   * @param connection The connection to build a provider for.
   * @returns Returns the provider, or null when nothing registered serves the connection.
   */
  public providerFor(connection: AiConnection): AgentProvider | null {
    const descriptor: AgentProviderDescriptor | undefined = this.descriptors.find(
      (candidate: AgentProviderDescriptor): boolean => candidate.serves(connection),
    );
    if (descriptor === undefined) {
      logger.debug(
        'AgentProviderRegistry',
        `No harness serves connection '${connection.id}'; it names ` +
          `${connection.harnessId === null || connection.harnessId === undefined ? 'none' : `'${connection.harnessId}'`}`,
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
  connect: (spec: HarnessSpawnSpec) => HarnessTransport,
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
      const spec: HarnessSpawnSpec | null = harness.spawnSpec();
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
        // says nothing about which endpoint a connection points at. Sent at the handshake as well as
        // per turn (protocol 1.8.0), because `images` is declared once and `discover` has no envelope.
        //
        // ⛔ Nothing secret. Every field here is something the *user* typed into the connection form;
        // the key it authenticates with is obtained through the credential round-trip and never this.
        settings: {
          connectionKind: connection.kind,
          connectionLabel: connection.label,
          connectionAuth: connection.auth,
          baseUrl: connection.baseUrl ?? null,
          // Gateways that need an extra header need it on every request, including the one that
          // discovers models — so a harness that did not get them could reach an endpoint it is then
          // refused by, and report that as the endpoint being wrong.
          headers: connection.headers ?? {},
        },
      });
    },
  };
}

/**
 * The harnesses Studio compiles in.
 *
 * ⛔ **There are none, and this function exists to say so.** Core used to register three — the Claude
 * Agent SDK, Codex, and a generic AI-SDK adapter that served whatever was left — and every one of them
 * is now a plugin: `onixlabs.claude-harness`, `onixlabs.codex-harness`, `onixlabs.ai-sdk-harness`.
 * That was the point of #653, and Matthew's ruling states the acceptance test plainly: *a fresh binary
 * has no working agents until a provider plugin is installed.*
 *
 * 🔑 It is kept, empty, rather than deleted, because the *registry* is core's and the emptiness is a
 * decision rather than an oversight. Anything tempted to add a built-in back has to edit this function
 * and read this comment first.
 *
 * ⚠️ Note what is **not** implied: `ai-sdk-stream.ts` stays in core and is not a provider. It holds
 * Studio's own twenty-eight tools, which a harness asks for over the protocol — so adding a Studio
 * capability reaches every provider at once instead of requiring each plugin to be republished.
 * @returns Returns an empty list.
 */
export function coreAgentProviders(): readonly AgentProviderDescriptor[] {
  return [];
}
