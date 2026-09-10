import { describe, expect, it, vi } from 'vitest';
import type { AiConnection } from '@shared/api/ai-types';
import { logger } from '@shared/electron/logger';
import type { AgentProvider } from './agent-provider';

// The core descriptors construct the real providers, and `ClaudeAgentProvider` reaches Electron through
// its executable resolver. Nothing here cares which binary that finds.
// ⛔ Mocking the relative module is not an option: the Angular unit-test system refuses `vi.mock` on a
// relative import, so the dependency is cut at the bare specifier instead.
vi.mock('electron', () => ({ app: { isPackaged: false } }));

const { AgentProviderRegistry, coreAgentProviders, toHarnessDescriptor } =
  await import('./agent-provider-registry');
type AgentProviderDescriptor = import('./agent-provider-registry').AgentProviderDescriptor;

/**
 * Builds a connection with only the fields the registry looks at.
 * @param id The connection identifier.
 * @param auth The authentication kind, which is what the core descriptors match on.
 * @returns Returns the connection.
 */
function connection(id: string, auth: string, harnessId?: string): AiConnection {
  return { id, auth, harnessId, models: [], defaultModelId: null } as unknown as AiConnection;
}

/**
 * Builds a descriptor that serves the connections whose auth matches, and reports itself when built.
 * @param id The harness identifier.
 * @param auth The auth kind it serves, or null to serve everything.
 * @param built Collects the ids of harnesses that were asked to build.
 * @returns Returns the descriptor.
 */
function harness(id: string, auth: string | null, built: string[]): AgentProviderDescriptor {
  return {
    id,
    serves: (candidate: AiConnection): boolean => auth === null || candidate.auth === auth,
    create: (): AgentProvider => {
      built.push(id);
      return { id } as unknown as AgentProvider;
    },
  };
}

describe('AgentProviderRegistry', () => {
  it('buildsFromTheFirstHarnessThatServesTheConnection', () => {
    const built: string[] = [];
    const registry: InstanceType<typeof AgentProviderRegistry> = new AgentProviderRegistry();
    registry.register(harness('first', 'demo-login', built));
    registry.register(harness('catch-all', null, built));

    registry.providerFor(connection('c1', 'demo-login'));

    expect(built).toEqual(['first']);
  });

  it('fallsThroughToAHarnessThatServesEverything', () => {
    const built: string[] = [];
    const registry: InstanceType<typeof AgentProviderRegistry> = new AgentProviderRegistry();
    registry.register(harness('first', 'demo-login', built));
    registry.register(harness('catch-all', null, built));

    registry.providerFor(connection('c1', 'api-key'));

    // There is no separate notion of a fallback: a descriptor that serves everything, registered last,
    // is the same rule read from the other end.
    expect(built).toEqual(['catch-all']);
  });

  it('registrationOrderDecidesWhoWinsAContestedConnection', () => {
    const built: string[] = [];
    const registry: InstanceType<typeof AgentProviderRegistry> = new AgentProviderRegistry();
    registry.register(harness('early', 'demo-login', built));
    registry.register(harness('late', 'demo-login', built));

    registry.providerFor(connection('c1', 'demo-login'));

    expect(built).toEqual(['early']);
  });

  it('ignoresASecondHarnessClaimingAnIdAlreadyRegistered', () => {
    const built: string[] = [];
    const registry: InstanceType<typeof AgentProviderRegistry> = new AgentProviderRegistry();
    registry.register(harness('claude', 'demo-login', built));
    registry.register(harness('claude', 'other-login', built));

    expect(registry.registered()).toEqual(['claude']);
    // The impostor is not merely deduplicated in the listing — it never serves anything either.
    expect(registry.providerFor(connection('c1', 'other-login'))).toBeNull();
  });

  it('reportsNoProviderWhenNothingServesTheConnection', () => {
    const registry: InstanceType<typeof AgentProviderRegistry> = new AgentProviderRegistry();
    registry.register(harness('only', 'demo-login', []));

    // Reachable only with no catch-all registered. Building something arbitrary would be worse than
    // leaving the connection listed and unrunnable.
    expect(registry.providerFor(connection('c1', 'api-key'))).toBeNull();
  });

  it('registeredListsTheHarnessesInRegistrationOrder', () => {
    const registry: InstanceType<typeof AgentProviderRegistry> = new AgentProviderRegistry();
    registry.register(harness('a', 'x', []));
    registry.register(harness('b', 'y', []));

    expect(registry.registered()).toEqual(['a', 'b']);
  });
});

describe('coreAgentProviders', () => {
  it('putsTheTwoLiveHarnessesAheadOfTheGenericAdapter', () => {
    // Order is load-bearing: the AI-SDK descriptor serves everything, so anything after it would never
    // be asked.
    expect(coreAgentProviders().map((d: AgentProviderDescriptor): string => d.id)).toEqual([
      'claude',
      'codex',
      'ai-sdk',
    ]);
  });

  it('routesEachAuthKindToTheHarnessThatUsedToBeItsBranch', () => {
    const descriptors: readonly AgentProviderDescriptor[] = coreAgentProviders();

    /**
     * Gets the id of the first core descriptor serving an auth kind.
     * @param auth The auth kind.
     * @returns Returns the harness id, or undefined.
     */
    const servedBy: (auth: string) => string | undefined = (auth: string): string | undefined =>
      descriptors.find((d: AgentProviderDescriptor): boolean => d.serves(connection('c', auth)))
        ?.id;

    // The exact mapping the three-way `if` in AiManager used to make, asserted so the move cannot have
    // changed behaviour.
    expect(servedBy('claude-login')).toBe('claude');
    expect(servedBy('codex-login')).toBe('codex');
    expect(servedBy('api-key')).toBe('ai-sdk');
    // Including a local Ollama, which needs no harness code at all — it is a connection.
    expect(servedBy('none')).toBe('ai-sdk');
  });
});

describe('toHarnessDescriptor', () => {
  /**
   * Builds a contributed harness whose payload may or may not be installed.
   * @param installed Whether the payload is on disk.
   * @returns Returns the contributed harness.
   */
  function contributed(installed: boolean): {
    id: string;
    displayName: string;
    priority: number;
    connectionAuths: readonly string[];
    sessionModel: 'stateless';
    spawnSpec: () => { command: string; args: readonly string[] } | null;
  } {
    return {
      id: 'claude-harness',
      displayName: 'Claude',
      priority: 100,
      connectionAuths: ['claude-login'],
      sessionModel: 'stateless',
      spawnSpec: (): { command: string; args: readonly string[] } | null =>
        installed ? { command: '/bin/harness', args: [] } : null,
    };
  }

  it('servesOnlyAConnectionThatNamesIt', () => {
    const descriptor: AgentProviderDescriptor = toHarnessDescriptor(
      contributed(true),
      () => ({}) as never,
    );

    expect(descriptor.serves(connection('c1', 'claude-login', 'claude-harness'))).toBe(true);
  });

  it('doesNotClaimAConnectionMerelyBecauseItsAuthMatches', () => {
    const descriptor: AgentProviderDescriptor = toHarnessDescriptor(
      contributed(true),
      () => ({}) as never,
    );

    // ⛔ The bug this replaced. Matching on auth meant a plugin took every connection of that kind
    // from the provider Studio ships — a capability downgrade nobody asked for. And `AiAuthKind` is a
    // closed union, so a plugin could not even name a kind of its own: the harness matched nothing at
    // all until a connection could point at it.
    expect(descriptor.serves(connection('c1', 'claude-login'))).toBe(false);
    expect(descriptor.serves(connection('c1', 'api-key'))).toBe(false);
  });

  it('servesNothingWhenItsPayloadIsNotInstalled', () => {
    const descriptor: AgentProviderDescriptor = toHarnessDescriptor(
      contributed(false),
      () => ({}) as never,
    );

    // The manifest can be in the catalogue without the payload being on disk, and a descriptor that
    // claimed a connection it cannot run would take it from the in-core provider that can.
    expect(descriptor.serves(connection('c1', 'claude-login', 'claude-harness'))).toBe(false);
  });

  it('buildsAProviderCarryingTheConnectionsOwnModels', () => {
    const descriptor: AgentProviderDescriptor = toHarnessDescriptor(
      contributed(true),
      () => ({}) as never,
    );

    // The harness knows how to run a turn; the connection knows which models and which id. The
    // registry joins them, which is why the manifest declares neither.
    const provider: AgentProvider = descriptor.create(
      connection('my-claude', 'claude-login', 'claude-harness'),
    );
    expect(provider.id).toBe('my-claude');
    expect(provider.label).toBe('Claude');
  });

  it('registersAheadOfTheInCoreHarnessSoAnInstalledPluginWinsTheConnection', () => {
    const registry: InstanceType<typeof AgentProviderRegistry> = new AgentProviderRegistry();
    registry.register(toHarnessDescriptor(contributed(true), () => ({}) as never));
    for (const core of coreAgentProviders()) {
      registry.register(core);
    }

    // "Core defines, plugins provide": while the two live harnesses are still compiled in, they are
    // the fallback rather than the answer.
    expect(registry.registered()[0]).toBe('claude-harness');
  });
});

describe('displacing a built-in harness', () => {
  /**
   * Builds a contributed harness claiming an auth kind.
   * @param id The harness id.
   * @param auth The auth kind it claims.
   * @returns Returns the contributed harness.
   */
  function claiming(
    id: string,
    auth: string,
  ): {
    id: string;
    displayName: string;
    priority: number;
    connectionAuths: readonly string[];
    sessionModel: 'stateless';
    spawnSpec: () => { command: string; args: readonly string[] } | null;
  } {
    return {
      id,
      displayName: id,
      priority: 100,
      connectionAuths: [auth],
      sessionModel: 'stateless',
      spawnSpec: (): { command: string; args: readonly string[] } | null => ({
        command: '/bin/harness',
        args: [],
      }),
    };
  }

  it('warnsWhenAPluginTakesAConnectionABuiltInHarnessWouldHaveServed', () => {
    const warnings: string[] = [];
    const original: typeof logger.warn = logger.warn.bind(logger);
    logger.warn = (source: string, message: string): void => void warnings.push(message);
    try {
      const registry: InstanceType<typeof AgentProviderRegistry> = new AgentProviderRegistry();
      registry.register(
        toHarnessDescriptor(claiming('my-claude', 'claude-login'), () => ({}) as never),
      );
      for (const core of coreAgentProviders()) {
        registry.register(core);
      }

      registry.providerFor(connection('c1', 'claude-login', 'my-claude'));
    } finally {
      logger.warn = original;
    }

    // Nothing is refused — refusing would defeat the ordering that makes moving a harness out of core
    // a one-line change. But an incomplete plugin replacing a provider that does more is a capability
    // regression whose only symptom is something quietly missing, so it is said in the log.
    expect(warnings.join(' ')).toContain('in place of the built-in');
    expect(warnings.join(' ')).toContain('claude');
  });

  it('saysNothingWhenNoBuiltInHarnessWantedTheConnection', () => {
    const warnings: string[] = [];
    const original: typeof logger.warn = logger.warn.bind(logger);
    logger.warn = (source: string, message: string): void => void warnings.push(message);
    try {
      const registry: InstanceType<typeof AgentProviderRegistry> = new AgentProviderRegistry();
      registry.register(
        toHarnessDescriptor(claiming('novel', 'some-new-login'), () => ({}) as never),
      );
      for (const core of coreAgentProviders()) {
        registry.register(core);
      }

      registry.providerFor(connection('c1', 'some-new-login', 'novel'));
    } finally {
      logger.warn = original;
    }

    // A harness serving an auth kind Studio ships no provider for displaces nothing. That is the
    // ordinary case and must stay quiet, or the warning becomes noise nobody reads.
    expect(warnings).toEqual([]);
  });

  it('saysNothingWhenTheGenericAdapterWouldHaveTakenIt', () => {
    const warnings: string[] = [];
    const original: typeof logger.warn = logger.warn.bind(logger);
    logger.warn = (source: string, message: string): void => void warnings.push(message);
    try {
      const registry: InstanceType<typeof AgentProviderRegistry> = new AgentProviderRegistry();
      registry.register(toHarnessDescriptor(claiming('novel', 'api-key'), () => ({}) as never));
      for (const core of coreAgentProviders()) {
        registry.register(core);
      }

      registry.providerFor(connection('c1', 'api-key', 'novel'));
    } finally {
      logger.warn = original;
    }

    // The AI-SDK descriptor serves everything, so counting it would warn on every harness ever
    // installed. It is a fallback, not a capability being lost.
    expect(warnings).toEqual([]);
  });
});
